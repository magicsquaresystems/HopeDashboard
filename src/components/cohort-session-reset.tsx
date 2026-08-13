"use client";

import { useEffect } from "react";

import { useNotesStore } from "@/lib/store/notesStore";
import { useUiStore } from "@/lib/store/uiStore";

/**
 * Reset client-side session state when the cohort route changes.
 *
 * The Zustand stores hold transient UI state (selected participant,
 * selected post, facilitator notes) keyed by participant_id.
 * Participants can re-enrol across cohorts under the same platform
 * user_id, so without an explicit reset, switching from /cohorts/A to
 * /cohorts/B would surface A's notes against a shared participant in B.
 * The clear runs once per cohortId via useEffect deps; renders nothing.
 *
 * Snooze/dismiss is deliberately absent: it now lives server-side keyed
 * by cohort (see lib/server/queue-state.ts), so it can neither leak
 * across cohorts nor be lost by clearing a client store.
 */
export function CohortSessionReset({ cohortId }: { cohortId: number }) {
    useEffect(() => {
        useUiStore.getState().selectParticipant(null);
        useNotesStore.getState().clear();
    }, [cohortId]);
    return null;
}
