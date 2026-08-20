import { type NextRequest } from "next/server";

import { firestoreConfig, hasFirestore } from "@/lib/server/firestore";

/**
 * TEMPORARY diagnostic for the two backend services. Remove once the
 * risk and drafting proxies work on the deployment.
 *
 * The dashboard reaches engagement_ml and comment_generation through
 * server-side env vars that only the team owning the Vercel project can
 * set. When one is missing the facilitator sees a 502 and the reason
 * sits in logs we cannot read, so this reports which vars the running
 * deployment actually has and whether each service answers.
 *
 * Secrets are never returned, only whether they are set and their
 * length — enough to catch an empty or truncated paste. The two URLs
 * are returned in full because they are not secret and a wrong one is
 * the likeliest misconfiguration.
 */
const GATE_KEY = "caf8de47164c272f8a5eae2bf05b8e00";

function describeSecret(value: string | undefined) {
    const trimmed = value?.trim();
    return { set: Boolean(trimmed), length: trimmed?.length ?? 0 };
}

async function probe(
    url: string | undefined,
    headers: Record<string, string>,
): Promise<Record<string, unknown>> {
    if (!url) return { skipped: "no url configured" };
    try {
        const res = await fetch(`${url.replace(/\/+$/, "")}/health`, {
            headers,
            cache: "no-store",
            signal: AbortSignal.timeout(20_000),
        });
        const text = await res.text();
        return { status: res.status, body: text.slice(0, 200) };
    } catch (err) {
        return { error: (err as Error).message };
    }
}

export async function GET(req: NextRequest) {
    if (req.nextUrl.searchParams.get("key") !== GATE_KEY) {
        return new Response(null, { status: 404 });
    }

    const hfToken = process.env.HF_TOKEN?.trim();
    const dropoutUrl = process.env.DROPOUT_API_URL?.trim();
    const commentGenUrl = process.env.COMMENT_GEN_URL?.trim();
    const authHeaders: Record<string, string> = hfToken
        ? { Authorization: `Bearer ${hfToken}` }
        : {};

    return Response.json({
        env: {
            DROPOUT_API_URL: dropoutUrl ?? null,
            COMMENT_GEN_URL: commentGenUrl ?? null,
            HF_TOKEN: describeSecret(process.env.HF_TOKEN),
            HOPE_RISK_API_KEY: describeSecret(process.env.HOPE_RISK_API_KEY),
            HOPE_API_SECRET: describeSecret(process.env.HOPE_API_SECRET),
            HOPE_API_AUTH: process.env.HOPE_API_AUTH ?? null,
            AUTH_MODE: process.env.AUTH_MODE ?? null,
            // `parsed` is the field worth having: a base64 blob that is
            // set but malformed is treated as unconfigured and only
            // logged, so from outside this is the one way to tell that
            // apart from not being set at all.
            FIREBASE_SERVICE_ACCOUNT: {
                ...describeSecret(process.env.FIREBASE_SERVICE_ACCOUNT),
                parsed: hasFirestore(),
            },
            FIREBASE_DATABASE_ID: process.env.FIREBASE_DATABASE_ID ?? null,
        },
        // Neither the project nor the database name is a secret, and a
        // deployment pointed at the wrong project is the likeliest
        // misconfiguration. The client email and key never appear here.
        firebaseProjectId: firestoreConfig()?.projectId ?? null,
        queueStateBackend: hasFirestore() ? "firestore" : "files",
        dropout: await probe(dropoutUrl, authHeaders),
        commentGen: await probe(commentGenUrl, authHeaders),
    });
}
