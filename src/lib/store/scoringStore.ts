"use client";

import { create } from "zustand";

/**
 * Programme week the cohort is currently being scored at. Maps directly
 * onto engagement_ml's `score_at_day = week * 7`.
 *
 * Three separate limits govern which weeks a facilitator may pick, and
 * conflating them is the easy mistake here:
 *
 * 1. **Programme shape** — how many weeks the cohort runs for. Not fixed:
 *    4-week pilots, 6-week IIH cohorts, and 8-week modules all coexist,
 *    so this comes from cohort metadata, never a constant.
 *
 * 2. **Data availability** — how many weeks have actually elapsed. On a
 *    live feed a cohort in week 2 has no week-5 behaviour to score; the
 *    model would be handed an empty tail and would read it as total
 *    disengagement, flagging the whole cohort high-risk. Weeks beyond
 *    the elapsed point are therefore offered but disabled, not scored.
 *    (Each week is cumulative — week 2 scores days 0..13, i.e. weeks 1
 *    *and* 2 — so "weeks with data" is a simple ceiling, not a range.)
 *
 * 3. **Trained horizons** — engagement_ml ships bundles at
 *    T ∈ {7,14,21,28,35,42,49,56}. Past that the service still answers,
 *    but it anchors the score to days 0..55 and says so in the response
 *    (`horizon_used`, `anchored_to_days`, `note`). Verified live against
 *    the deployed Space. So weeks 9+ of a longer programme are selectable
 *    and honest — the UI just has to disclose the anchoring rather than
 *    present the score as if the model had been trained for that week.
 */

/**
 * Hard-coded rather than read from `/model/info` (which already reports
 * `horizons[]`, see `useRiskModelInfo`) because `isAnchoredWeek()` runs
 * in render paths that cannot tolerate a loading state. Keep in step
 * with the horizons the deployed service serves.
 */
export const MODEL_MAX_HORIZON_DAYS = 56;
export const MODEL_MAX_WEEK = 8;

/**
 * Sanity ceiling on programme length. Nothing in the platform enforces a
 * maximum, but a bad `programmeLengthDays` (a stray 3650) shouldn't paint
 * 520 week pills. Raise it if a genuinely longer programme appears.
 */
export const MAX_PROGRAMME_WEEK = 16;

/**
 * A 1-based programme week. Deliberately a plain `number` rather than a
 * `1|2|…|6` union: programme length is cohort metadata, so the valid set
 * is only known at runtime. Use `programmeWeeks()` / `weeksWithData()` to
 * get the legal values instead of assuming a range.
 */
export type ProgrammeWeek = number;

/**
 * Week the store holds before a cohort has told it anything.
 *
 * A literal, deliberately NOT derived from MODEL_MAX_WEEK: the store
 * initialises before the selector can measure the cohort, so this value
 * fires the first /batch. Deriving it from the model ceiling made every
 * cohort open with one wasted request at a week the cohort may not have.
 *
 * It is a starting point, not the landing week — `openCohort` replaces
 * it with the cohort's most recent elapsed week as soon as one is
 * known.
 */
const DEFAULT_PROGRAMME_WEEK: ProgrammeWeek = 6;

const DAY_MS = 86_400_000;

/** Day offset engagement_ml should score at for a given week. */
export function scoreAtDay(week: ProgrammeWeek): number {
    return week * 7;
}

/** True when this week is past the model's trained horizons and the
 *  service will anchor the score back to the last trained one. */
export function isAnchoredWeek(week: ProgrammeWeek): boolean {
    return scoreAtDay(week) > MODEL_MAX_HORIZON_DAYS;
}

/**
 * Every week the programme itself defines, regardless of whether data
 * exists yet.
 *
 *   4-week cohort  (28 days) → [1, 2, 3, 4]
 *   6-week cohort  (42 days) → [1, 2, 3, 4, 5, 6]
 *   8-week cohort  (56 days) → [1, 2, 3, 4, 5, 6, 7, 8]
 *
 * Always returns at least [1] so the UI never renders an empty selector.
 */
export function programmeWeeks(programmeLengthDays: number): ProgrammeWeek[] {
    const weeks = Math.floor(programmeLengthDays / 7);
    const cap = Math.min(Math.max(weeks, 1), MAX_PROGRAMME_WEEK);
    return Array.from({ length: cap }, (_, i) => i + 1);
}

/**
 * How many programme weeks have data as of `now`.
 *
 * A week is only scoreable once it has fully elapsed: scoring at week N
 * asks the model about days 0..(7N-1), so week N needs 7N days of
 * history behind it. Partial weeks are excluded — a half-finished week
 * looks like a drop in engagement to the model, not a week in progress.
 * Week 1 therefore unlocks on day 7, and a cohort on days 0–6 has zero
 * scoreable weeks; the selector renders every pill disabled with a
 * "first week in progress" note rather than scoring a window the model
 * would misread as disengagement.
 *
 * Clamped to the programme's own length: a finished cohort doesn't keep
 * accruing weeks forever.
 */
export function weeksWithData(
    programmeLengthDays: number,
    effectiveStart: string | number | Date,
    now: number = Date.now(),
): number {
    const startMs = new Date(effectiveStart).getTime();
    const total = programmeWeeks(programmeLengthDays).length;
    if (!Number.isFinite(startMs)) return total;
    const elapsedDays = Math.floor((now - startMs) / DAY_MS);
    const elapsed = Math.floor(elapsedDays / 7);
    return Math.min(total, Math.max(0, elapsed));
}

/**
 * Weeks a facilitator may actually score at — the programme's weeks,
 * truncated to those with data.
 */
export function availableWeeks(
    programmeLengthDays: number,
    effectiveStart?: string | number | Date,
    now: number = Date.now(),
): ProgrammeWeek[] {
    const all = programmeWeeks(programmeLengthDays);
    if (effectiveStart === undefined) return all;
    const max = weeksWithData(programmeLengthDays, effectiveStart, now);
    return all.filter((w) => w <= max);
}

type ScoringState = {
    scoreAtWeek: ProgrammeWeek;
    /** Which cohort the current selection belongs to. */
    openCohortId: number | null;
    setScoreAtWeek: (week: ProgrammeWeek) => void;
    /**
     * Land on a cohort's most recent elapsed week.
     *
     * Only on arrival at a different cohort, which is the distinction
     * that matters: a facilitator opening a cohort wants to see where it
     * stands now, but one who has deliberately stepped back to week 3 to
     * see how it looked then must not be yanked forward again by a
     * background refresh a few seconds later.
     */
    openCohort: (cohortId: number, maxWeek: ProgrammeWeek) => void;
    /**
     * Pull the current selection back to the last week that has data,
     * without moving it forward. For the case where the cohort is
     * shorter than the week already selected.
     */
    clampToAvailable: (maxWeek: ProgrammeWeek) => void;
};

export const useScoringStore = create<ScoringState>((set, get) => ({
    scoreAtWeek: DEFAULT_PROGRAMME_WEEK,
    openCohortId: null,
    setScoreAtWeek: (week) => set({ scoreAtWeek: week }),
    openCohort: (cohortId, maxWeek) => {
        if (get().openCohortId === cohortId) return;
        // Capped at the model's last trained week. Two reasons, and the
        // second is the one that matters. Past MODEL_MAX_WEEK the
        // service anchors the score back to that week anyway, so landing
        // there asks a question it cannot answer differently. And a
        // cohort's end date is when the platform CLOSES it, not when
        // teaching stopped — observed live, where six-week programmes
        // carry ten-week spans because they are left open a further
        // four. Landing on that ninth week would score everyone against
        // weeks of post-course quiet and report a cohort of people at
        // high risk of leaving something they had already finished.
        const landing = Math.min(Math.max(1, maxWeek), MODEL_MAX_WEEK);
        set({ openCohortId: cohortId, scoreAtWeek: landing });
    },
    clampToAvailable: (maxWeek) => {
        const safe = Math.max(1, maxWeek);
        if (get().scoreAtWeek > safe) set({ scoreAtWeek: safe });
    },
}));
