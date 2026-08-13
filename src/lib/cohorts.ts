/**
 * Known cohorts for the dashboard. v0 hardcodes the IIH demo cohort
 * (master plan §7); future versions can hydrate from
 * engagement_ml's cohort metadata via a server action once the platform
 * feed is wired.
 *
 * The participant list is no longer carried here — the dashboard reads
 * the real bundle from `local/iih-coh12-110226.json` (extracted from the
 * platform JSON exports by `scripts/extract-iih-cohort.mjs`). The
 * synthetic-id fallback was removed; if the bundle is missing the queue
 * surfaces an explicit "bundle missing" state instead of silently
 * fabricating data.
 */

export type CohortMeta = {
    id: number;
    code: string;
    moduleId: number;
    moduleName: string;
    /** Length of the programme in days. Drives the week-selector range
     * and the `programme_length_days` field sent to engagement_ml. Not
     * every cohort runs for 42 days — 4-week pilots, 6-week IIH cohorts
     * and 8-week modules coexist. The model only ships trained horizons
     * at T ∈ {7,14,21,28,35,42}; any score_at_day above 42 is scored and
     * anchored back to 42 by the service, which the week selector
     * discloses (see `scoringStore.isAnchoredWeek`). */
    programmeLengthDays: number;
    /** Cohort start (ISO). Together with `programmeLengthDays` this
     * decides which weeks have elapsed and are therefore scoreable —
     * on a live feed the selector must not offer a week the cohort
     * hasn't reached. Mirrors the bundle's `cohort.effectiveStart`, but
     * lives here too so the selector can gate before the bundle
     * loads. */
    effectiveStart: string;
};

export const COHORTS: CohortMeta[] = [
    // Ordered chronologically. IIH-COH10 (1600) is in the dropout
    // model's training set; COH11 (1651) and COH12 (1680) are temporal
    // test (TEMPORAL_CUTOFF = 2025-09-01 in engagement_ml). All three
    // are facilitator-led, all have draftable activity descriptions and
    // facilitator-reply history extracted from the platform export.
    {
        id: 1600,
        code: "IIH-COH10-190325",
        moduleId: 337,
        moduleName: "People living with IIH 2025 — V1",
        programmeLengthDays: 42,
        effectiveStart: "2025-03-19T00:00:00Z",
    },
    {
        id: 1651,
        code: "IIH-COH11-170925",
        moduleId: 337,
        moduleName: "People living with IIH 2025 — V1",
        programmeLengthDays: 42,
        effectiveStart: "2025-09-17T00:00:00Z",
    },
    {
        id: 1680,
        code: "IIH-COH12-110226",
        moduleId: 337,
        moduleName: "People living with IIH 2025 — V1",
        programmeLengthDays: 42,
        effectiveStart: "2026-02-11T00:00:00Z",
    },
];

export function findCohort(id: number): CohortMeta | undefined {
    return COHORTS.find((c) => c.id === id);
}
