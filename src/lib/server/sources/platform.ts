/**
 * Cohort bundles built live from the Hope Move platform API.
 *
 * The alternative to reading `local/*.json`, and the one that replaces
 * it. The platform serves the same four documents the dashboard has been
 * consuming as files — user activity, profiles, facilitator comments,
 * discussion topics — scoped to one cohort inside one module.
 *
 * The conversion is not reimplemented here. `buildCohortBundle` in
 * `scripts/extract-iih-cohort.mjs` is the single implementation, called
 * with fetched payloads instead of parsed files. A second copy in
 * TypeScript would be two things that have to agree forever, and the
 * first time they quietly stopped agreeing the symptom would be a
 * plausible-looking risk score rather than an error.
 */

import {
    buildCohortBundle,
    buildFacilitatorIdSet,
    buildProfileLookup,
} from "@/../scripts/extract-iih-cohort.mjs";

import { createHopeClient } from "@/lib/api/hope";
import { type CohortMeta } from "@/lib/cohorts";
import { type CohortBundle } from "@/lib/server/cohort-data";

if (typeof window !== "undefined") {
    throw new Error("sources/platform.ts must not be imported in client code");
}

/**
 * Modules present in the profile export.
 *
 * `buildCohortBundle` warns when the cohort's own module is missing from
 * it, which is normal rather than broken — the IIH module has never had
 * a profile export, so only participants from earlier programmes carry a
 * bio. Derived here so the warning stays accurate against live data.
 */
function moduleIdsIn(userProfiles: unknown): Set<number> {
    const doc = userProfiles as { modules?: { id?: unknown }[] } | null;
    const ids = new Set<number>();
    for (const m of doc?.modules ?? []) {
        const id = Number(m?.id);
        if (Number.isFinite(id)) ids.add(id);
    }
    return ids;
}

export async function fetchCohortBundle(
    cohort: CohortMeta,
    opts: { baseUrl: string; accessToken: string },
): Promise<CohortBundle> {
    const client = createHopeClient({
        baseUrl: opts.baseUrl,
        accessToken: opts.accessToken,
    });

    const docs = await client.fetchCohortDocuments(cohort.id);

    return buildCohortBundle(
        docs.userActivity,
        docs.userProfiles,
        docs.facilitatorComments,
        docs.discussionTopics,
        buildFacilitatorIdSet(docs.facilitatorComments),
        buildProfileLookup(docs.userProfiles),
        moduleIdsIn(docs.userProfiles),
        cohort.id,
        {
            // The documents carry the events; the cohort record carries
            // what frames them. Both are needed and neither has the other.
            code: cohort.code,
            effectiveStart: cohort.effectiveStart,
            programmeLengthDays: cohort.programmeLengthDays,
        },
    );
}
