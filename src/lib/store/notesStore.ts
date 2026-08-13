import { create } from "zustand";

/**
 * Session-local facilitator notes, keyed by participant id.
 *
 * Persistence: in-memory only. Notes survive panel switches but not page
 * reloads. comment_generation's memory schema has no freeform-note role
 * today (only `participant_post` via /memory/post and `facilitator_reply`
 * tied to a specific activity via /memory/reply), so a real persistence
 * hop needs a backend addition. When that lands, swap this store for a
 * useMutation that POSTs to the new endpoint and invalidates the
 * `["memory", ...]` query.
 */

export type FacilitatorNote = {
    id: string;
    participantId: string;
    text: string;
    ts: string;
};

type NotesState = {
    notes: Record<string, FacilitatorNote[]>;
    addNote: (participantId: string, text: string) => void;
    getNotes: (participantId: string) => FacilitatorNote[];
    /** Wipe all notes. Called on cohort route change so notes against
     *  one cohort's participants never appear under another's, even
     *  when the same participantId is shared (re-enrolment). */
    clear: () => void;
};

export const useNotesStore = create<NotesState>((set, get) => ({
    notes: {},
    addNote: (participantId, text) => {
        const note: FacilitatorNote = {
            id: `${participantId}-${Date.now()}`,
            participantId,
            text,
            ts: new Date().toISOString(),
        };
        set((state) => ({
            notes: {
                ...state.notes,
                [participantId]: [note, ...(state.notes[participantId] ?? [])],
            },
        }));
    },
    getNotes: (participantId) => get().notes[participantId] ?? [],
    clear: () => set({ notes: {} }),
}));
