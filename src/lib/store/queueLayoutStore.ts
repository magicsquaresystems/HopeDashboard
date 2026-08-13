import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * Layout preference for the follow-up queue column. Persisted to
 * localStorage so a facilitator's collapsed/expanded preference survives
 * page reloads and route changes within a single browser. Not tied to a
 * cohort — the preference is a UI habit, not data state.
 */

type QueueLayoutState = {
    collapsed: boolean;
    toggle: () => void;
    setCollapsed: (v: boolean) => void;
};

export const useQueueLayoutStore = create<QueueLayoutState>()(
    persist(
        (set) => ({
            collapsed: false,
            toggle: () => set((s) => ({ collapsed: !s.collapsed })),
            setCollapsed: (v) => set({ collapsed: v }),
        }),
        {
            name: "hope-queue-layout",
            storage: createJSONStorage(() => localStorage),
        },
    ),
);
