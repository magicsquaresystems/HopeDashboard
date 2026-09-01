"use client";

import { useCohortBundle } from "@/lib/hooks/useCohortBundle";
import { displayName as fallbackDisplayName } from "@/lib/signals";
import { imageSrc } from "@/lib/image-src";

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

/**
 * The participant's profile photo from the platform, or `null`.
 *
 * Lives beside the display-name hook because it answers the same
 * question from the same source — how this person is presented on Hope —
 * and reusing `useCohortBundle` here costs nothing: TanStack Query
 * dedupes on the shared key, so an avatar in every queue row does not
 * mean a fetch per row.
 *
 * `null` covers three cases the caller does not need to tell apart: the
 * bundle has not loaded, the participant has no photo, or the bundle
 * predates the field (every extracted research bundle). All three mean
 * the same thing to a renderer, which is to fall back to initials.
 */
export function useBundleImageUrl(
    participantId: string,
    cohortId?: number,
): string | null {
    const bundle = useCohortBundle(cohortId);
    if (!bundle.data) return null;
    const p = bundle.data.participants.find(
        (x) => x.participant_id === participantId,
    );
    // Two shapes arrive in this one field: an absolute URL when the
    // participant chose a Hope library avatar, an Azure blob path when
    // they uploaded a photo. This used to drop the second kind, because
    // a bare path resolves against THIS origin and 404s — so every
    // participant with a real photograph showed initials. `imageSrc`
    // routes those through the signing proxy instead.
    return imageSrc(p?.imageUrl);
}
