/**
 * Optional Firestore connection, for the shared triage state.
 *
 * Chosen over a Postgres instance for a governance reason rather than a
 * technical one: these markers record which facilitator contacted which
 * participant and when, so the data is participant-linked, and a Google
 * project owned by the H4C account puts it under the programme lead's
 * control. The storage shape is unchanged — one record per (cohort,
 * participant, kind) — because that, not the vendor, is what keeps two
 * facilitators from overwriting each other.
 *
 * Credentials arrive as ONE base64 variable rather than three fields.
 * The service-account private key is a PEM containing real newlines,
 * and every environment-variable UI mangles those differently: the
 * usual `replace(/\\n/g, "\n")` fixes one of the two ways it can arrive
 * and silently breaks the other, surfacing much later as an opaque
 * DECODER error in front of a facilitator. One line of base64 survives
 * any text field, any paste, any chat client, and cannot be
 * half-configured.
 *
 * `GOOGLE_APPLICATION_CREDENTIALS` is deliberately NOT supported. It
 * names a file path, there is nowhere to put a file on a serverless
 * host, and the only way to arrange one is to commit it — into a public
 * repository. Supporting it would invite exactly that.
 */

import type { App } from "firebase-admin/app";
import type { Firestore } from "firebase-admin/firestore";

import { ApiError } from "@/lib/api/client";

if (typeof window !== "undefined") {
    throw new Error("firestore.ts must not be imported in client code");
}

/**
 * One app name for the process. firebase-admin throws on a duplicate,
 * so this is looked up before initialising rather than assumed absent.
 */
const APP_NAME = "hope-dashboard";

export type FirestoreConfig = {
    projectId: string;
    clientEmail: string;
    privateKey: string;
    /** Firestore allows several databases per project; almost always
     *  the default. */
    databaseId: string;
    /** True when pointed at a local emulator, which needs no credentials. */
    emulator: boolean;
};

function decodeServiceAccount(raw: string): Record<string, unknown> | null {
    // Someone will paste the raw JSON instead of base64. That should be
    // a non-event rather than a support call.
    const json = raw.startsWith("{")
        ? raw
        : Buffer.from(raw, "base64").toString("utf8");
    try {
        const parsed: unknown = JSON.parse(json);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return null;
        }
        return parsed as Record<string, unknown>;
    } catch {
        return null;
    }
}

/**
 * `null` when Firestore is not configured, which is the normal state
 * locally — the file driver takes over and `npm run dev` works on a
 * fresh clone.
 *
 * A malformed value is treated as unconfigured and logged loudly. An
 * operator error must not silently grant, deny, or crash, and the log
 * is the only channel that reaches whoever can fix it. Nothing here
 * ever logs the value, the decoded JSON, or any part of the key.
 */
export function firestoreConfig(): FirestoreConfig | null {
    const databaseId = process.env.FIREBASE_DATABASE_ID?.trim() || "(default)";

    // The emulator needs a project id and nothing else. Supporting it
    // means a developer never needs a production key on a laptop.
    const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST?.trim();
    if (emulatorHost) {
        return {
            projectId:
                process.env.FIREBASE_PROJECT_ID?.trim() || "hope-dashboard-dev",
            clientEmail: "",
            privateKey: "",
            databaseId,
            emulator: true,
        };
    }

    const raw = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
    if (!raw) return null;

    const parsed = decodeServiceAccount(raw);
    if (!parsed) {
        console.error(
            "FIREBASE_SERVICE_ACCOUNT is not valid JSON, base64-encoded or " +
                "otherwise — ignoring it. Shared triage state will not work.",
        );
        return null;
    }

    const projectId = String(parsed.project_id ?? "").trim();
    const clientEmail = String(parsed.client_email ?? "").trim();
    const privateKey = String(parsed.private_key ?? "");

    const missing = [
        !projectId && "project_id",
        !clientEmail && "client_email",
        !privateKey && "private_key",
    ].filter(Boolean);
    if (missing.length > 0) {
        console.error(
            `FIREBASE_SERVICE_ACCOUNT is missing ${missing.join(", ")} — ` +
                "ignoring it. Shared triage state will not work.",
        );
        return null;
    }

    // Catches a truncated paste before it becomes an opaque runtime
    // credential error.
    if (!privateKey.includes("BEGIN PRIVATE KEY")) {
        console.error(
            "FIREBASE_SERVICE_ACCOUNT's private_key does not look like a PEM " +
                "key; it may have been truncated. Ignoring it.",
        );
        return null;
    }

    return { projectId, clientEmail, privateKey, databaseId, emulator: false };
}

/** True when a Firestore backend is configured. */
export function hasFirestore(): boolean {
    return firestoreConfig() !== null;
}

declare global {
    var __hopeFirestore: Promise<Firestore> | undefined;
}

const g = globalThis as typeof globalThis & {
    __hopeFirestore?: Promise<Firestore>;
};

/**
 * Lazily constructs the client. `firebase-admin` is imported
 * dynamically so a deployment without Firestore never loads it — it is
 * a heavy import with a gRPC stack behind it.
 *
 * The PROMISE is memoised, and assigned before the first `await`. This
 * deliberately differs from `getPool`'s older shape, whose double-
 * construct race under concurrent cold-start requests was harmless for
 * a connection pool but is fatal here: `initializeApp` throws on a
 * duplicate app name. The `getApps` lookup covers the other direction,
 * where a hot reload clears this memo while the app still exists.
 */
export async function getFirestoreDb(): Promise<Firestore> {
    if (g.__hopeFirestore) return g.__hopeFirestore;

    const config = firestoreConfig();
    if (!config) {
        throw new ApiError(
            503,
            "Snoozing and contact markers are not available on this " +
                "deployment: it is missing FIREBASE_SERVICE_ACCOUNT.",
            "queue_state_not_configured",
        );
    }

    g.__hopeFirestore = (async () => {
        const { getApps, initializeApp, cert } = await import(
            "firebase-admin/app"
        );
        const { initializeFirestore } = await import("firebase-admin/firestore");

        const existing: App | undefined = getApps().find(
            (a) => a.name === APP_NAME,
        );
        const app =
            existing ??
            initializeApp(
                config.emulator
                    ? { projectId: config.projectId }
                    : {
                          projectId: config.projectId,
                          credential: cert({
                              projectId: config.projectId,
                              clientEmail: config.clientEmail,
                              privateKey: config.privateKey,
                          }),
                      },
                APP_NAME,
            );

        // `preferRest` keeps the client on HTTP rather than opening a
        // gRPC channel. Nothing here streams (no onSnapshot), and an
        // idle channel on an instance about to be frozen is pure cost.
        return initializeFirestore(app, { preferRest: true }, config.databaseId);
    })();

    return g.__hopeFirestore;
}

/**
 * Turn a Firestore failure into something a facilitator can act on.
 *
 * The proxy error wrapper renders any bare `Error` as a 502 "upstream
 * unreachable", and the queue hook puts the response body straight into
 * the message it throws — so this `detail` is effectively what appears
 * on screen. A raw PERMISSION_DENIED arriving as a 502 would have
 * someone waiting for a service that is never going to answer.
 *
 * Two rules hold throughout. The message is built from our own text
 * only, never by interpolating the upstream error, because that text
 * reaches a browser. And the project and database names are safe to
 * include — they are not secrets, and naming them is the difference
 * between an actionable message and a shrug — while the client email
 * and the key never appear.
 */
export function mapFirestoreError(err: unknown, config: FirestoreConfig): never {
    const code = (err as { code?: number | string } | null)?.code;
    const message = String((err as Error | null)?.message ?? "");

    // Logged in full server-side; only our own sentences go to the client.
    console.error(`firestore: ${code ?? "no code"} ${message}`);

    const credentialish =
        (typeof code === "string" && code.startsWith("app/")) ||
        /default credentials|private key|invalid_grant|DECODER/i.test(message);

    if (credentialish || code === 16) {
        throw new ApiError(
            503,
            "Snoozing and contact markers are not available: Google rejected " +
                "this deployment's FIREBASE_SERVICE_ACCOUNT. The key may have " +
                "been revoked or truncated, or this machine's clock may be " +
                "out of step.",
            "queue_state_not_configured",
        );
    }

    if (code === 7) {
        throw new ApiError(
            503,
            "Snoozing and contact markers are not available: the service " +
                `account has no access to Firestore in project ${config.projectId}. ` +
                "Grant it the Cloud Datastore User role, or enable the " +
                "Firestore API on the project.",
            "queue_state_not_configured",
        );
    }

    if (code === 5) {
        throw new ApiError(
            503,
            "Snoozing and contact markers are not available: project " +
                `${config.projectId} has no Firestore database named ` +
                `${config.databaseId}. Create one in Native mode.`,
            "queue_state_not_configured",
        );
    }

    if (code === 8) {
        throw new ApiError(
            503,
            "Snoozing and contact markers are paused: this project's daily " +
                "Firestore quota is used up. It resets at midnight Pacific " +
                "time, and enabling billing removes the cap.",
            "queue_state_quota_exhausted",
        );
    }

    // UNAVAILABLE, DEADLINE_EXCEEDED, anything unrecognised: the client
    // has already retried with backoff, so the backend genuinely is
    // unreachable. Let it become a 502, which is the honest answer.
    throw err instanceof Error ? err : new Error(message || "firestore failed");
}
