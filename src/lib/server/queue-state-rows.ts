/**
 * The storage row shape, and the mapping from rows to queue state.
 *
 * Every backend stores one record per marker, keyed by (cohort,
 * participant, kind) — a Postgres row, a Firestore document, whatever
 * comes next. That decomposition is not incidental: it is what makes
 * every operation a single addressed write, so no driver ever reads a
 * cohort's state, edits it in memory and writes it back, which is the
 * pattern that loses a concurrent facilitator's action.
 *
 * Because the shape is shared, so is the mapping back out of it. This
 * module holds that mapping, extracted from the driver that used to
 * inline it, so two backends cannot quietly disagree about what an
 * expired snooze or an unreadable action means.
 *
 * Pure by construction: no `fs`, no database driver, no React. It lives
 * under `server/` rather than beside `queue-state-shared.ts` because a
 * storage row is a concept the browser can never produce, and
 * `queue-state-shared.ts` is deliberately client-safe.
 */

import {
    type CohortQueueState,
    type QueueOp,
    emptyQueueState,
    pruneQueueState,
} from "@/lib/queue-state-shared";

/**
 * The stored discriminator.
 *
 * Note `contact`, not `contacted`. The operation a facilitator performs
 * is "contacted"; the marker it leaves is a "contact". The two names
 * have always differed, and `kindForOp` below is the only place that
 * conversion is allowed to happen.
 */
export type QueueKind = "snooze" | "dismiss" | "contact";

/**
 * One stored marker, in the neutral shape every driver converts to.
 *
 * `kind` is a plain string rather than `QueueKind`: rows come from
 * storage, so a value written by a newer deployment must be readable —
 * and ignorable — by an older one, rather than throwing.
 */
export type QueueStateRow = {
    participantId: string;
    kind: string;
    /** Facilitator email. */
    by: string;
    /** Epoch ms. */
    at: number;
    /** Epoch ms. Only meaningful for a snooze. */
    until?: number | null;
    /** Only meaningful for a contact. */
    action?: string | null;
};

/**
 * Which marker an operation writes or removes.
 *
 * The undo operations name the marker they clear, so they map to the
 * same kind as the operation that created it.
 */
export function kindForOp(op: QueueOp): QueueKind {
    switch (op.op) {
        case "snooze":
        case "undoSnooze":
            return "snooze";
        case "dismiss":
        case "undoDismiss":
            return "dismiss";
        case "contacted":
            return "contact";
    }
}

/**
 * Rows to queue state, pruned at `now`.
 *
 * `now` is a parameter rather than a call to the clock so the result is
 * reproducible in tests, matching `applyOp` and `pruneQueueState`.
 *
 * Tolerant on the way in, because this reads persisted data rather than
 * a request body: an unknown `kind` is skipped, and an unreadable
 * `action` falls back to "accept". Dropping a contact marker because
 * its action was unreadable would let a second facilitator message
 * someone who has already been contacted, which is a worse outcome than
 * recording the wrong verb against it. A snooze with no expiry is the
 * one exception and is dropped: keeping it would mean `until: NaN`,
 * which compares false against every clock and would hide the
 * participant permanently.
 */
export function hydrateQueueState(
    rows: Iterable<QueueStateRow>,
    now: number,
): CohortQueueState {
    const state = emptyQueueState();

    for (const row of rows) {
        if (!row?.participantId) continue;

        switch (row.kind) {
            case "snooze": {
                if (typeof row.until !== "number" || !Number.isFinite(row.until)) {
                    continue;
                }
                state.snoozes[row.participantId] = {
                    until: row.until,
                    by: row.by,
                    at: row.at,
                };
                break;
            }
            case "dismiss":
                state.dismissals[row.participantId] = {
                    by: row.by,
                    at: row.at,
                };
                break;
            case "contact":
                state.contacted[row.participantId] = {
                    by: row.by,
                    at: row.at,
                    action: row.action === "edit" ? "edit" : "accept",
                };
                break;
            default:
                // A kind this build does not know about. Skip it rather
                // than fail the whole cohort's queue.
                break;
        }
    }

    return pruneQueueState(state, now);
}
