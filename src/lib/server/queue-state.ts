/**
 * Server-side persistence for shared triage state.
 *
 * Two drivers behind one interface:
 *
 *   - **Firestore** when `FIREBASE_SERVICE_ACCOUNT` is set. Each
 *     operation is a single addressed write or delete, so there is no
 *     read-modify-write to lose and no lock to hold — which is what
 *     makes it correct on Vercel, where concurrent requests land on
 *     different serverless instances that share nothing.
 *   - **JSON files** otherwise, so a fresh clone runs with no cloud
 *     anything. Single-process only, and it cannot work on a serverless
 *     host, whose filesystem is read-only: a development convenience,
 *     not a deployment target.
 *
 * There was a third, Postgres, removed once Firestore landed. Two
 * database backends where only one is ever configured means the next
 * person has to work out which is live, and a half-configured
 * deployment could quietly use the wrong one. It is in the history if
 * it is ever wanted back; commented-out code would only rot.
 *
 * The interface is the swap point. If the platform team later wants
 * this in their own system, only `getQueueStateStore` changes.
 */

import fs from "node:fs";
import path from "node:path";

import {
    applyOp,
    emptyQueueState,
    pruneQueueState,
    type CohortQueueState,
    type QueueOp,
} from "@/lib/queue-state-shared";
import { ApiError } from "@/lib/api/client";
import {
    firestoreConfig,
    getFirestoreDb,
    hasFirestore,
    mapFirestoreError,
    type FirestoreConfig,
} from "@/lib/server/firestore";
import {
    hydrateQueueState,
    kindForOp,
    type QueueStateRow,
} from "@/lib/server/queue-state-rows";

if (typeof window !== "undefined") {
    throw new Error("queue-state.ts must not be imported in client code");
}

export interface QueueStateStore {
    get(cohortId: number): Promise<CohortQueueState>;
    apply(
        cohortId: number,
        op: QueueOp,
        by: string,
    ): Promise<CohortQueueState>;
}

export function getQueueStateStore(): QueueStateStore {
    return hasFirestore() ? firestoreStore : fileStore;
}

/* --------------------------------------------------------------- Firestore */

/**
 * Documents live at `queue_state/{cohortId}/markers/{participantId}:{kind}`.
 *
 * One document per marker, addressed directly, so every operation is a
 * single `set` or `delete` that never reads the cohort first. A single
 * document per cohort holding a map would be fewer reads and would also
 * reintroduce exactly the lost-update race this shape exists to avoid.
 *
 * Scoping by path rather than by a `where` clause has two consequences
 * worth stating: no composite index is needed, so there is nothing for
 * an operator to create, and a wrong cohort id reads an empty
 * collection rather than another cohort's markers.
 */
const COLLECTION = "queue_state";

const NOT_CONFIGURED =
    "Snoozing and contact markers are not available on this deployment: " +
    "it is missing FIREBASE_SERVICE_ACCOUNT.";

function markerId(participantId: string, kind: string): string {
    // Encoded first: participant ids are opaque strings from the
    // platform and may contain characters Firestore forbids in a
    // document id, including "/". Encoding also escapes ":", so the
    // separator can never appear in the left-hand side.
    return `${encodeURIComponent(participantId)}:${kind}`;
}

/**
 * The route validates `cohortId` with `Number.isFinite`, which a
 * Postgres INTEGER column used to reject for us. Firestore would
 * happily create a collection under a document named "1.5" or "1e+21".
 */
function requireConfig(cohortId: number): FirestoreConfig {
    if (!Number.isSafeInteger(cohortId)) {
        throw new ApiError(
            400,
            "cohortId must be a whole number",
            "invalid_request",
        );
    }
    const config = firestoreConfig();
    if (!config) {
        throw new ApiError(503, NOT_CONFIGURED, "queue_state_not_configured");
    }
    return config;
}

function markersRef(db: FirebaseFirestore.Firestore, cohortId: number) {
    return db.collection(COLLECTION).doc(String(cohortId)).collection("markers");
}

const firestoreStore: QueueStateStore = {
    async get(cohortId) {
        const config = requireConfig(cohortId);
        try {
            const db = await getFirestoreDb();
            const snap = await markersRef(db, cohortId).get();
            const rows: QueueStateRow[] = snap.docs.map((d) => {
                const v = d.data();
                return {
                    participantId: String(v.participantId ?? ""),
                    kind: String(v.kind ?? ""),
                    by: String(v.byEmail ?? ""),
                    at: Number(v.atMs ?? 0),
                    until: typeof v.untilMs === "number" ? v.untilMs : null,
                    action: typeof v.action === "string" ? v.action : null,
                };
            });
            return hydrateQueueState(rows, Date.now());
        } catch (err) {
            if (err instanceof ApiError) throw err;
            mapFirestoreError(err, config);
        }
    },

    async apply(cohortId, op, by) {
        const config = requireConfig(cohortId);
        try {
            const db = await getFirestoreDb();
            const kind = kindForOp(op);
            const ref = markersRef(db, cohortId).doc(
                markerId(op.participantId, kind),
            );
            const now = Date.now();

            if (op.op === "undoSnooze" || op.op === "undoDismiss") {
                // Deleting a document that is not there resolves, which
                // matches a DELETE affecting no rows.
                await ref.delete();
            } else {
                // A full overwrite, not a merge: last write wins, and a
                // stale `untilMs` cannot survive on a reused marker.
                // Explicit nulls rather than omitted fields, so a stray
                // `undefined` from a later change is a loud error rather
                // than a silently dropped field.
                await ref.set({
                    cohortId,
                    participantId: op.participantId,
                    kind,
                    byEmail: by,
                    atMs: now,
                    untilMs:
                        op.op === "snooze" ? now + op.days * 86_400_000 : null,
                    action: op.op === "contacted" ? op.action : null,
                });
            }
        } catch (err) {
            if (err instanceof ApiError) throw err;
            mapFirestoreError(err, config);
        }
        // Re-read rather than compute locally: the caller installs this
        // as the authoritative cache, so it must include the markers
        // other facilitators wrote concurrently.
        return firestoreStore.get(cohortId);
    },
};

/* ------------------------------------------------------------------- Files */

function statePath(cohortId: number): string {
    return path.join(
        process.cwd(),
        "local",
        "state",
        `queue-state-${cohortId}.json`,
    );
}

type CacheEntry = { state: CohortQueueState; mtimeMs: number };
const g = globalThis as typeof globalThis & {
    __hopeQueueCache?: Map<number, CacheEntry>;
    __hopeQueueWrites?: Promise<unknown>;
};
g.__hopeQueueCache ??= new Map();

function readFile(cohortId: number): CohortQueueState {
    const file = statePath(cohortId);
    if (!fs.existsSync(file)) return emptyQueueState();
    const mtimeMs = fs.statSync(file).mtimeMs;
    const cached = g.__hopeQueueCache!.get(cohortId);
    if (cached && cached.mtimeMs === mtimeMs) return cached.state;
    let state: CohortQueueState;
    try {
        state = {
            ...emptyQueueState(),
            ...(JSON.parse(fs.readFileSync(file, "utf8")) as CohortQueueState),
        };
    } catch {
        // A torn or hand-edited file must not take the queue down: an
        // unreadable snooze list is recoverable (worst case someone
        // reappears), an unrenderable queue is not.
        console.error(`queue-state: ${file} is unreadable, starting empty`);
        state = emptyQueueState();
    }
    g.__hopeQueueCache!.set(cohortId, { state, mtimeMs });
    return state;
}

function writeFile(cohortId: number, state: CohortQueueState): void {
    const file = statePath(cohortId);
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
    } catch {
        // A serverless host serves the bundle from a read-only
        // filesystem, so this driver cannot work there at all: every
        // snooze, dismiss and contacted marker failed with a raw
        // `ENOENT … mkdir '/var/task/local/state'` surfaced to the
        // browser as a 502, and the optimistic update then rolled back
        // with no explanation. Say what is actually wrong instead. The
        // fix is a database; this only stops the deployment lying about
        // which problem it has.
        throw new ApiError(
            503,
            "Snoozing and contact markers are not available on this " +
                "deployment: they need FIREBASE_SERVICE_ACCOUNT to be set, " +
                "because the server cannot write files.",
            "queue_state_not_configured",
        );
    }
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
    // rename() replaces atomically, but on Windows it throws EPERM when
    // an indexer or antivirus momentarily holds the destination handle.
    // Retrying beats losing the write.
    for (let attempt = 0; ; attempt++) {
        try {
            fs.renameSync(tmp, file);
            break;
        } catch (err) {
            if (attempt >= 3) {
                fs.writeFileSync(file, JSON.stringify(state, null, 2), "utf8");
                try {
                    fs.unlinkSync(tmp);
                } catch {
                    /* best effort */
                }
                console.error("queue-state: rename failed, wrote in place", err);
                break;
            }
        }
    }
    g.__hopeQueueCache!.set(cohortId, {
        state,
        mtimeMs: fs.statSync(file).mtimeMs,
    });
}

const fileStore: QueueStateStore = {
    async get(cohortId) {
        return pruneQueueState(readFile(cohortId), Date.now());
    },

    async apply(cohortId, op, by) {
        // Serialize read-modify-write across concurrent requests in this
        // process by chaining onto a single promise. Node is
        // single-threaded, but `await`s inside a handler interleave, and
        // two interleaved read-then-writes lose one of the operations.
        const run = async (): Promise<CohortQueueState> => {
            const now = Date.now();
            const next = pruneQueueState(
                applyOp(readFile(cohortId), op, by, now),
                now,
            );
            writeFile(cohortId, next);
            return next;
        };
        const chained = (g.__hopeQueueWrites ?? Promise.resolve()).then(
            run,
            run,
        );
        g.__hopeQueueWrites = chained.catch(() => {});
        return chained;
    },
};
