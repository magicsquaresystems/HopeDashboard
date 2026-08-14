/**
 * Server-only loader for the Hope Move cohort bundle.
 *
 * The JSON at `local/iih-coh12-110226.json` is produced by
 * `scripts/extract-iih-cohort.mjs` from the platform exports in
 * `../comment_generation/data/`. It contains real participant IDs and
 * activity histories for cohort 1680 (IIH-COH12-110226). Bios fall back
 * to a placeholder because the UserProfile export in hand doesn't cover
 * module 337.
 *
 * The bundle is committed in-tree so the dashboard is self-contained on
 * any host. The synthetic-fallback path that previously rendered
 * fake participants when the file was absent has been removed — if the
 * file ever disappears, the API route returns 204 and the queue shows
 * an empty state rather than fabricating data. Read/parse failures on a
 * bundle that IS present propagate rather than degrading to empty.
 */

import fs from "node:fs";
import path from "node:path";

import { hopeConfig } from "@/lib/auth/hope-exchange";
import { hopeSession } from "@/lib/auth/hope-session";
import { hopeCohorts } from "@/lib/server/hope-cohorts";

if (typeof window !== "undefined") {
    throw new Error(
        "cohort-data.ts must not be imported in client code (reads fs)",
    );
}

// Per-cohort bundle slugs. Match the `bundleSlug` field in
// scripts/extract-iih-cohort.mjs's COHORT_REGISTRY so the loader and
// extractor stay in sync. Adding a new cohort means adding a row here
// AND in src/lib/cohorts.ts; both lookups are id-keyed for an O(1)
// resolve at request time.
const BUNDLE_SLUG_BY_COHORT_ID: Record<number, string> = {
    1600: "iih-coh10-190325",
    1651: "iih-coh11-170925",
    1680: "iih-coh12-110226",
};

function bundlePathFor(cohortId: number): string | null {
    const slug = BUNDLE_SLUG_BY_COHORT_ID[cohortId];
    if (!slug) return null;
    return path.join(process.cwd(), "local", `${slug}.json`);
}

export type RealEvent = {
    timestamp: string;
    event_type: string;
    activity_type?: string;
    words_written?: number;
    description?: string | null;
    /** Forum topic id for `discussion_post` events — links the post to
     * its thread in `CohortBundle.discussionThreads` so the dashboard
     * can show + draft against the full conversation. Absent on
     * non-discussion events. */
    topicId?: number;
    /** Human-readable page name for `page_visit` and `bookmark` events
     * (e.g. "Being self-compassionate"). Absent on bundles extracted
     * before page metadata was carried through. */
    page_title?: string;
    /** Platform path for `page_visit` and `bookmark` events (e.g.
     * `/modules/session-2/being-self-compassionate`). */
    page_url?: string;
    /** Visit count for this URL. Page visits are a per-URL rollup, not
     * one row per view, so a single event can represent many reads. */
    hits?: number;
    /** Per-URL average dwell from the platform rollup. Unit is
     * undocumented in the export (likely ms) — do not render as a
     * duration until the platform confirms. */
    avg_duration?: number;
    /** Platform activity id for `activity` events. Joins
     * `priorFacilitatorReplies[].activityId` to the exact post, and is
     * forwarded to comment-gen's /generate for memory dedup. */
    activity_id?: number;
};

/** One reply in a reconstructed forum thread. Authors outside the
 * focal cohort are aliased generically ("Facilitator" / "A
 * participant") so no cross-cohort identity leaks. */
export type RealThreadReply = {
    alias: string;
    role: "facilitator" | "participant";
    text: string;
    recordedAt: string;
};

export type RealDiscussionThread = {
    title: string;
    replies: RealThreadReply[];
};

export type RealFacilitatorReply = {
    activityId: number;
    activityType: string;
    text: string;
    recordedAt: string | null;
};

/** One SWEMWBS (Short Warwick-Edinburgh Mental Well-being Scale)
 * questionnaire result. `metricScore` is the calibrated 7–35 scale value
 * (the one worth trending); `rawScore` is the unweighted item sum. Only
 * present when the bundle was extracted from engagement_ml's
 * `UserActivity_120526.txt` — see `loadUserActivity()` in the extractor. */
export type RealWellbeingResult = {
    recordedAt: string;
    format: string;
    rawScore: number | null;
    metricScore: number;
};

/** One self-authored profile Q&A pair ("Where is your favourite place on
 *  Earth?" → "Anywhere beside the sea…"). The platform's own
 *  get-to-know-me prompts — the closest thing to a participant-written
 *  profile the export carries. */
export type RealInterviewItem = {
    question: string;
    answer: string;
};

export type RealParticipant = {
    participant_id: string;
    displayName: string;
    bio: string;
    /** Self-authored profile Q&A. Empty for most IIH participants —
     * `UserProfile (1).txt` has no module 337, so only people who were on
     * an earlier programme have one. Absence is normal. */
    interview: RealInterviewItem[];
    firstName: string | null;
    startedAt: string;
    finishedAt: string | null;
    events: RealEvent[];
    priorFacilitatorReplies: RealFacilitatorReply[];
    activityCount: number;
    /** Chronological SWEMWBS results, oldest first. Empty array (not
     * undefined) on bundles extracted before wellbeing support and on
     * participants who never completed a questionnaire. */
    wellbeing: RealWellbeingResult[];
};

export type CohortBundle = {
    cohort: {
        id: number;
        code: string;
        moduleId: number;
        moduleName: string;
        effectiveStart: string;
        /** Length of the programme in days. Multiple of 7 (one week
         * granularity). Used to derive the week-selector range and the
         * `programme_length_days` field sent to engagement_ml. */
        programmeLengthDays: number;
    };
    participants: RealParticipant[];
    /** Forum threads this cohort took part in, keyed by topic id.
     * Optional for backward-compat with bundles extracted before forum
     * support; treat `undefined` as "no forum data". */
    discussionThreads?: Record<string, RealDiscussionThread>;
};

type CacheEntry = { bundle: CohortBundle | null; mtimeMs: number | null };
const _cache: Map<number, CacheEntry> = new Map();

/**
 * Loads the bundle for a given cohort, invalidating the in-memory cache
 * when the file on disk has changed. Mtime-based invalidation is
 * important during dev: when the extraction script is re-run, the next
 * dashboard request picks up the new data without a Next.js restart.
 *
 * Returns `null` only when the cohort has no bundle slug or the file
 * isn't on disk yet — the API route surfaces this as a 204 and the queue
 * renders its empty state. That absence is a real state, not a failure.
 *
 * A bundle that IS on disk but can't be read or parsed throws. It
 * previously logged a warning and returned `null`, which rendered a
 * corrupt bundle as an ordinary empty queue — indistinguishable from a
 * cohort that legitimately has no data, and silent enough to ship.
 */
export function loadCohortBundle(cohortId: number): CohortBundle | null {
    const bundlePath = bundlePathFor(cohortId);
    if (!bundlePath) return null;
    if (!fs.existsSync(bundlePath)) {
        _cache.set(cohortId, { bundle: null, mtimeMs: null });
        return null;
    }
    const mtimeMs = fs.statSync(bundlePath).mtimeMs;
    const cached = _cache.get(cohortId);
    if (cached && cached.mtimeMs === mtimeMs) {
        return cached.bundle;
    }
    const raw = fs.readFileSync(bundlePath, "utf8");
    const bundle = JSON.parse(raw) as CohortBundle;
    _cache.set(cohortId, { bundle, mtimeMs });
    return bundle;
}

/**
 * The bundle for a cohort, from whichever source this deployment has.
 *
 * Prefers the Hope Move platform when the session carries credentials
 * for it and the cohort is one the platform knows; falls back to the
 * extracted file otherwise. Both paths run the same conversion — see
 * `sources/platform.ts` — so the only difference is where the four
 * documents came from.
 *
 * A platform fetch that fails falls back to the file rather than
 * throwing. The file is stale rather than wrong, and a facilitator
 * looking at last week's export is in a better position than one looking
 * at an error page. The failure is logged so the staleness is not
 * silent.
 */
export async function resolveCohortBundle(
    cohortId: number,
): Promise<CohortBundle | null> {
    const config = hopeConfig();
    if (config) {
        const session = await hopeSession();
        const cohort = (await hopeCohorts())?.find((c) => c.id === cohortId);
        if (session && cohort) {
            try {
                const { fetchCohortBundle } = await import(
                    "@/lib/server/sources/platform"
                );
                return await fetchCohortBundle(cohort, {
                    baseUrl: config.apiUrl,
                    accessToken: session.tokens.accessToken,
                });
            } catch (err) {
                console.error(
                    `cohort ${cohortId}: platform fetch failed, falling back ` +
                        `to the extracted file — ${(err as Error).message}`,
                );
            }
        }
    }
    return loadCohortBundle(cohortId);
}
