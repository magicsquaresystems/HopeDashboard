/**
 * Shared triage state — types and the pure reducer.
 *
 * Snooze, dismiss and "already contacted" used to be per-browser zustand
 * state. With one facilitator that was invisible; with several it is a
 * correctness bug, because the queue's whole job is to say who still
 * needs attention. Two facilitators working the same cohort would each
 * see the same at-risk participant, and both message them — the one
 * outcome a support programme most wants to avoid.
 *
 * This module holds no storage of its own on purpose. `applyOp` is a
 * pure function so the server store and the client's optimistic update
 * apply *the same* transition, and so it can be unit-tested without a
 * database or a browser. Keep it free of `fs`, `pg`, and React — it is
 * imported on both sides.
 *
 * Conflict handling is last-write-wins per participant per kind. Two
 * facilitators snoozing the same person land on the same outcome, and
 * an undo racing a snooze resolves to whichever arrived last. Anything
 * stronger (locks, claims) would need a concept of "who owns this
 * participant" that the programme doesn't currently have.
 */

/** Days a snooze lasts when the detail panel offers "snooze". */
export const SNOOZE_DAYS = 7;

/** How long a "contacted" marker stays visible to other facilitators. */
export const CONTACTED_TTL_DAYS = 7;

const DAY_MS = 86_400_000;

export type ActorStamp = {
    /** Facilitator email — stamped server-side from the session. */
    by: string;
    /** Epoch ms when the action was taken. */
    at: number;
};

export type SnoozeEntry = ActorStamp & { until: number };
export type ContactEntry = ActorStamp & { action: "accept" | "edit" };

export type CohortQueueState = {
    snoozes: Record<string, SnoozeEntry>;
    dismissals: Record<string, ActorStamp>;
    contacted: Record<string, ContactEntry>;
};

export type QueueOp =
    | { op: "snooze"; participantId: string; days: number }
    | { op: "dismiss"; participantId: string }
    | { op: "undoSnooze"; participantId: string }
    | { op: "undoDismiss"; participantId: string }
    | { op: "contacted"; participantId: string; action: "accept" | "edit" };

export function emptyQueueState(): CohortQueueState {
    return { snoozes: {}, dismissals: {}, contacted: {} };
}

/** Narrowing guard for request bodies — there is no schema library here. */
export function isQueueOp(value: unknown): value is QueueOp {
    if (!value || typeof value !== "object") return false;
    const v = value as Record<string, unknown>;
    if (typeof v.participantId !== "string" || !v.participantId) return false;
    switch (v.op) {
        case "snooze":
            return (
                typeof v.days === "number" &&
                Number.isFinite(v.days) &&
                v.days > 0 &&
                v.days <= 90
            );
        case "contacted":
            return v.action === "accept" || v.action === "edit";
        case "dismiss":
        case "undoSnooze":
        case "undoDismiss":
            return true;
        default:
            return false;
    }
}

/**
 * Applies one operation. Pure: returns a new state, never mutates.
 * `now` is a parameter rather than a `Date.now()` call so the server,
 * the optimistic client update, and tests can all pin it.
 */
export function applyOp(
    state: CohortQueueState,
    op: QueueOp,
    by: string,
    now: number,
): CohortQueueState {
    const pid = op.participantId;
    switch (op.op) {
        case "snooze":
            return {
                ...state,
                snoozes: {
                    ...state.snoozes,
                    [pid]: { until: now + op.days * DAY_MS, by, at: now },
                },
            };
        case "dismiss":
            return {
                ...state,
                dismissals: { ...state.dismissals, [pid]: { by, at: now } },
            };
        case "undoSnooze":
            return { ...state, snoozes: omit(state.snoozes, pid) };
        case "undoDismiss":
            return { ...state, dismissals: omit(state.dismissals, pid) };
        case "contacted":
            return {
                ...state,
                contacted: {
                    ...state.contacted,
                    [pid]: { by, at: now, action: op.action },
                },
            };
    }
}

/**
 * Drops entries that no longer affect anything: elapsed snoozes and
 * contact markers past their TTL. Dismissals are permanent for the
 * cohort's lifetime and are never pruned. Applied on read so a stale
 * store can't keep a participant hidden past their snooze.
 */
export function pruneQueueState(
    state: CohortQueueState,
    now: number,
): CohortQueueState {
    const snoozes: Record<string, SnoozeEntry> = {};
    for (const [pid, entry] of Object.entries(state.snoozes)) {
        if (entry.until > now) snoozes[pid] = entry;
    }
    const contacted: Record<string, ContactEntry> = {};
    const cutoff = now - CONTACTED_TTL_DAYS * DAY_MS;
    for (const [pid, entry] of Object.entries(state.contacted)) {
        if (entry.at > cutoff) contacted[pid] = entry;
    }
    return { snoozes, dismissals: state.dismissals, contacted };
}

export function isHidden(
    state: CohortQueueState,
    participantId: string,
    now: number,
): boolean {
    if (state.dismissals[participantId]) return true;
    const snooze = state.snoozes[participantId];
    return snooze !== undefined && snooze.until > now;
}

/** "alice@hope.org" → "alice". Emails are long; queue rows are narrow. */
export function shortActor(email: string): string {
    return email.split("@")[0] || email;
}

/** Compact relative time for attribution lines ("2h ago"). */
export function agoLabel(at: number, now: number): string {
    const mins = Math.max(0, Math.round((now - at) / 60_000));
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    return days === 1 ? "yesterday" : `${days}d ago`;
}

function omit<T>(record: Record<string, T>, key: string): Record<string, T> {
    if (!(key in record)) return record;
    const next = { ...record };
    delete next[key];
    return next;
}
