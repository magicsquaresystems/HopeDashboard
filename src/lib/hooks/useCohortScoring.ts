"use client";

import { useMemo } from "react";

import { useCohortBatch } from "@/lib/hooks/api";
import { useCohortBundle } from "@/lib/hooks/useCohortBundle";
import { bundleParticipantIds, bundleToHistory } from "@/lib/realCohort";
import { rosterOrder } from "@/lib/roster";
import {
    scoreAtDay as scoreAtDayForWeek,
    useScoringStore,
    weeksWithData,
} from "@/lib/store/scoringStore";
import type { ParticipantHistory } from "@/lib/api/dropout";

/**
 * Whole-cohort scoring state, for anything that needs to show it.
 *
 * Changing the week rebuilds every participant's history truncated to the
 * new day, which changes the `/batch` cache key and re-scores the entire
 * cohort — ~4s for 51 participants. Several components need to know that
 * is happening (the week bar announces it, the topbar stats must not
 * publish a confident `0` meanwhile), and TanStack Query dedupes on the
 * shared key, so calling this from more than one component costs nothing.
 */
export function useCohortScoring(cohortId: number) {
    const bundle = useCohortBundle(cohortId);
    const scoreAtWeek = useScoringStore((s) => s.scoreAtWeek);
    const scoreAt = scoreAtDayForWeek(scoreAtWeek);

    // A cohort in its first six days has no fully elapsed week. Scoring
    // it anyway would hand the model a mostly-empty window that reads as
    // total disengagement and flags everyone high-risk, so the batch is
    // withheld until week 1 completes (day 7).
    //
    // It withholds the SCORES only. Histories are still built, because
    // the queue lists its rows from them: emptying the array here also
    // emptied the queue, and a brand-new cohort showed no participants
    // at all — nobody to select, so no detail panel and no drafts —
    // while people were posting on day one.
    const notStarted = useMemo(
        () =>
            bundle.data
                ? weeksWithData(
                      bundle.data.cohort.programmeLengthDays,
                      bundle.data.cohort.effectiveStart,
                  ) === 0
                : false,
        [bundle.data],
    );

    const histories = useMemo<ParticipantHistory[]>(() => {
        if (!bundle.data) return [];
        return bundleParticipantIds(bundle.data)
            .map((id) => bundleToHistory(bundle.data!, id, scoreAt))
            .filter((h): h is ParticipantHistory => h !== null);
    }, [bundle.data, scoreAt]);

    const batch = useCohortBatch(histories, cohortId, !notStarted);

    /**
     * The first-week list: everyone, most recently active first.
     *
     * Empty once scoring is available, so a caller can treat a non-empty
     * roster as "render these unscored" without also checking the flag.
     */
    const roster = useMemo<ParticipantHistory[]>(
        () => (notStarted ? rosterOrder(histories) : []),
        [notStarted, histories],
    );

    return {
        batch,
        /** Unscored, recency-ordered rows for a cohort in its first
         *  week. Empty whenever `batch` can speak. */
        roster,
        /** The underlying cohort-bundle query, exposed so the queue can
         *  tell "the data failed to load" and "this cohort has no data"
         *  apart from "everything loaded and the filter matched nobody"
         *  — three states that used to collapse into the last one. */
        bundle,
        /** Cohort started under a week ago — nothing is scoreable yet. */
        notStarted,
        /** Per-participant histories truncated to the selected week — the
         *  exact rows the batch call scored, for callers that need to
         *  join predictions back to their inputs. */
        histories,
        /** Participants in this cohort — 0 until the bundle lands.
         *  Counts everyone the bundle carries, scored or not. */
        total: histories.length,
        /**
         * True from the moment a re-score is triggered until scores land.
         * Covers the bundle fetch too: both phases leave the queue without
         * numbers, and the distinction means nothing to a facilitator.
         *
         * A failed scoring call ends it. Keying purely on the absence of
         * `batch.data` cannot distinguish "still working" from "asked and
         * was refused", so a failure left "Scoring N participants…"
         * spinning over the middle of the page for as long as the
         * facilitator was willing to wait, while the real reason sat in a
         * line of red text beside the empty queue. Whatever the failure
         * is, scoring is not in progress.
         */
        isScoring:
            bundle.isLoading ||
            // `!notStarted` is load-bearing now that histories survive
            // the first week: without it a day-one cohort has rows, no
            // batch and no error, and the topbar would claim to be
            // scoring forever something it has deliberately not asked
            // about.
            (!notStarted &&
                histories.length > 0 &&
                !batch.data &&
                !batch.isError),
    };
}
