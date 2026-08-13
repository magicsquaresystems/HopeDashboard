/**
 * Participant profile loader.
 *
 * Profiles come from the real cohort bundle (extracted from the
 * platform's `UserProfile` export). The synthetic-id stubs that used to
 * back fresh-clone rendering were removed alongside the broader
 * synthetic fallback — when the bundle is missing or doesn't carry the
 * participant, we return a minimal placeholder derived from the id
 * itself rather than fabricating bio prose.
 */

import { displayName } from "@/lib/signals";
import type { CohortBundle } from "@/lib/server/cohort-data";
import { bundleToProfile } from "@/lib/realCohort";

export type Profile = {
    participantId: string;
    displayName: string;
    bio: string;
    startedAt: string; // ISO
};

function placeholderProfile(participantId: string): Profile {
    return {
        participantId,
        displayName: displayName(participantId),
        bio: "",
        startedAt: new Date().toISOString(),
    };
}

/**
 * Resolve a participant profile from the cohort bundle. Falls back to a
 * placeholder (display name derived from the id, empty bio) when the
 * bundle is unavailable.
 */
export function getProfile(
    participantId: string,
    bundle: CohortBundle | null | undefined,
): Profile {
    if (bundle) {
        const real = bundleToProfile(bundle, participantId);
        if (real) return real;
    }
    return placeholderProfile(participantId);
}
