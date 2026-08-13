"use client";

import { useCohortBundle } from "@/lib/hooks/useCohortBundle";
import { displayName as fallbackDisplayName } from "@/lib/signals";

/**
 * Resolve a participant's short label for the UI.
 *
 * The cohort bundle assigns sequential aliases per cohort (P1..P51 for
 * COH12, P1..P103 for COH11, etc.) — those are the canonical
 * facilitator-facing labels because they're short, anonymised, and
 * already used by the Outreach / drafts panel.
 *
 * Falls back to ``signals.displayName(participantId)`` (which derives a
 * label from the raw id digits) when the bundle hasn't loaded yet or
 * the participant isn't in the bundle. That fallback yields the long
 * platform id (e.g. ``P100264``) — visible only during the brief
 * loading window before the bundle resolves.
 */
export function useBundleDisplayName(
    participantId: string,
    cohortId?: number,
): string {
    const bundle = useCohortBundle(cohortId);
    if (bundle.data) {
        const p = bundle.data.participants.find(
            (x) => x.participant_id === participantId,
        );
        if (p?.displayName) return p.displayName;
    }
    return fallbackDisplayName(participantId);
}
