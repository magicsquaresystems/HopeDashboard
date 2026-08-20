/**
 * Server-side persistence for shared triage state.
 *
 * Two drivers behind one interface:
 *
 *   - **Postgres** when `DATABASE_URL` is set. Each operation is a single
 *     upsert or delete, so there is no read-modify-write to lose and no
 *     lock to hold — which is what makes it correct on Vercel, where
 *     concurrent requests land on different serverless instances that
 *     share nothing.
 *   - **JSON files** otherwise, so a fresh clone runs with no database.
 *     Single-process only; this is a development convenience, not a
 *     deployment target.
 *
 * The interface is the swap point. If the platform team later wants this
 * in their own system, only `getQueueStateStore` changes.
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
import { ensureSchema, getPool, hasDatabase } from "@/lib/server/db";

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
    return hasDatabase() ? postgresStore : fileStore;
}

/* ---------------------------------------------------------------- Postgres */

/**
 * Rows are (cohort, participant, kind) with kind ∈ snooze|dismiss|contact.
 * Modelling each marker as its own row is what keeps every operation a
 * one-statement write: no instance ever reads the cohort's state, edits
 * it in memory, and writes it back — the pattern that loses a concurrent
 * facilitator's action.
 */
const postgresStore: QueueStateStore = {
    async get(cohortId) {
        await ensureSchema();
        const pool = await getPool();
        const { rows } = await pool.query<{
            participant_id: string;
            kind: string;
            by_email: string;
            at_ms: string;
            until_ms: string | null;
            action: string | null;
        }>(
            "SELECT participant_id, kind, by_email, at_ms, until_ms, action" +
                " FROM queue_state WHERE cohort_id = $1",
            [cohortId],
        );
        const state = emptyQueueState();
        for (const r of rows) {
            // BIGINT comes back as a string from node-postgres (it can
            // exceed Number.MAX_SAFE_INTEGER in general); epoch-ms fits
            // in a double comfortably, so a plain Number() is safe here.
            const at = Number(r.at_ms);
            if (r.kind === "snooze" && r.until_ms !== null) {
                state.snoozes[r.participant_id] = {
                    until: Number(r.until_ms),
                    by: r.by_email,
                    at,
                };
            } else if (r.kind === "dismiss") {
                state.dismissals[r.participant_id] = { by: r.by_email, at };
            } else if (r.kind === "contact") {
                state.contacted[r.participant_id] = {
                    by: r.by_email,
                    at,
                    action: r.action === "edit" ? "edit" : "accept",
                };
            }
        }
        return pruneQueueState(state, Date.now());
    },

    async apply(cohortId, op, by) {
        await ensureSchema();
        const pool = await getPool();
        const now = Date.now();
        switch (op.op) {
            case "snooze":
                await pool.query(
                    `INSERT INTO queue_state
                        (cohort_id, participant_id, kind, by_email, at_ms, until_ms)
                     VALUES ($1, $2, 'snooze', $3, $4, $5)
                     ON CONFLICT (cohort_id, participant_id, kind) DO UPDATE
                        SET by_email = EXCLUDED.by_email,
                            at_ms    = EXCLUDED.at_ms,
                            until_ms = EXCLUDED.until_ms`,
                    [
                        cohortId,
                        op.participantId,
                        by,
                        now,
                        now + op.days * 86_400_000,
                    ],
                );
                break;
            case "dismiss":
                await pool.query(
                    `INSERT INTO queue_state
                        (cohort_id, participant_id, kind, by_email, at_ms)
                     VALUES ($1, $2, 'dismiss', $3, $4)
                     ON CONFLICT (cohort_id, participant_id, kind) DO UPDATE
                        SET by_email = EXCLUDED.by_email, at_ms = EXCLUDED.at_ms`,
                    [cohortId, op.participantId, by, now],
                );
                break;
            case "contacted":
                await pool.query(
                    `INSERT INTO queue_state
                        (cohort_id, participant_id, kind, by_email, at_ms, action)
                     VALUES ($1, $2, 'contact', $3, $4, $5)
                     ON CONFLICT (cohort_id, participant_id, kind) DO UPDATE
                        SET by_email = EXCLUDED.by_email,
                            at_ms    = EXCLUDED.at_ms,
                            action   = EXCLUDED.action`,
                    [cohortId, op.participantId, by, now, op.action],
                );
                break;
            case "undoSnooze":
            case "undoDismiss":
                await pool.query(
                    "DELETE FROM queue_state WHERE cohort_id = $1" +
                        " AND participant_id = $2 AND kind = $3",
                    [
                        cohortId,
                        op.participantId,
                        op.op === "undoSnooze" ? "snooze" : "dismiss",
                    ],
                );
                break;
        }
        return this.get(cohortId);
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
                "deployment: they need DATABASE_URL to be set, because " +
                "the server cannot write files.",
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
