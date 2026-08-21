"use client";

import { create } from "zustand";

/**
 * Transient messages about things that failed quietly.
 *
 * A store rather than component state because the failures happen in
 * mutation callbacks (`useQueueState`), far from anywhere that could
 * render them, and the same failure can be triggered from the queue, the
 * detail panel or the drafts column. One always-mounted region reads
 * this; nobody has to thread a callback down three levels.
 *
 * Ids come from a counter, not `Date.now()` or `Math.random()`: two
 * notices pushed in the same millisecond would collide as React keys,
 * and a counter cannot.
 */

export type Notice = {
    id: number;
    title: string;
    body: string;
    /** Raw error text, shown behind a "Technical details" disclosure. */
    detail?: string;
};

/**
 * Three at once, oldest dropped.
 *
 * A failing store fails for every click, and an uncapped list would
 * stack a column of identical cards over the queue — burying the work
 * under the complaint about the work.
 */
const MAX_NOTICES = 3;

let nextId = 1;

type NoticeState = {
    notices: Notice[];
    push: (notice: Omit<Notice, "id">) => number;
    dismiss: (id: number) => void;
    clear: () => void;
};

export const useNoticeStore = create<NoticeState>((set) => ({
    notices: [],
    push: (notice) => {
        const id = nextId++;
        set((s) => ({ notices: [...s.notices, { ...notice, id }].slice(-MAX_NOTICES) }));
        return id;
    },
    dismiss: (id) =>
        set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),
    clear: () => set({ notices: [] }),
}));
