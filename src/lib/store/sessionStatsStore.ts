import { create } from "zustand";

/**
 * Session-local counters surfaced in the topbar. Resets on page reload —
 * which is the right behavior for "this session" framing. The 7-day
 * facilitator-reply rollup from comment-gen's memory feed is still
 * available via useMemory if we want a longer window later.
 */

type SessionStatsState = {
    sentThisSession: number;
    incrementSent: () => void;
    reset: () => void;
};

export const useSessionStatsStore = create<SessionStatsState>((set) => ({
    sentThisSession: 0,
    incrementSent: () =>
        set((s) => ({ sentThisSession: s.sentThisSession + 1 })),
    reset: () => set({ sentThisSession: 0 }),
}));
