import { create } from "zustand";

type UiState = {
    selectedParticipantId: string | null;
    selectParticipant: (id: string | null) => void;
    // Timestamp of the activity-event the facilitator picked from
    // Recent activity. Null = "use the most recent post" (default).
    // Resets to null on participant switch.
    selectedPostTs: string | null;
    selectPost: (ts: string | null) => void;
};

export const useUiStore = create<UiState>((set) => ({
    selectedParticipantId: null,
    selectParticipant: (id) =>
        set({ selectedParticipantId: id, selectedPostTs: null }),
    selectedPostTs: null,
    selectPost: (ts) => set({ selectedPostTs: ts }),
}));
