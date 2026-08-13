import { create } from "zustand";

/**
 * Session-local outreach stats surfaced in the topbar. Resets on page
 * reload — the right behaviour for "this session" framing.
 *
 * Counts **distinct participants per cohort**, not sends: two replies to
 * the same person are one contact, and cohort A's outreach must not leak
 * into cohort B's topbar on client-side navigation (the old single
 * counter did both). Recorded from the drafts panel's send handler,
 * which is the one place that knows who the reply went to — the wire
 * `EventRequest` carries draft ids only.
 */

type SessionStatsState = {
    /** cohortId → set (as a record) of participant ids contacted. */
    contactedByCohort: Record<number, Record<string, true>>;
    recordContact: (cohortId: number, participantId: string) => void;
    contactedCount: (cohortId: number) => number;
};

export const useSessionStatsStore = create<SessionStatsState>((set, get) => ({
    contactedByCohort: {},
    recordContact: (cohortId, participantId) =>
        set((s) => {
            const cohort = s.contactedByCohort[cohortId] ?? {};
            if (cohort[participantId]) return s;
            return {
                contactedByCohort: {
                    ...s.contactedByCohort,
                    [cohortId]: { ...cohort, [participantId]: true },
                },
            };
        }),
    contactedCount: (cohortId) =>
        Object.keys(get().contactedByCohort[cohortId] ?? {}).length,
}));
