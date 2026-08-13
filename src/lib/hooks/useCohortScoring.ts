"use client";

import { useMemo } from "react";

import { useCohortBatch } from "@/lib/hooks/api";
import { useCohortBundle } from "@/lib/hooks/useCohortBundle";
import { bundleParticipantIds, bundleToHistory } from "@/lib/realCohort";
import {
    scoreAtDay as scoreAtDayForWeek,
    useScoringStore,
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

    const histories = useMemo<ParticipantHistory[]>(() => {
        if (!bundle.data) return [];
        return bundleParticipantIds(bundle.data)
            .map((id) => bundleToHistory(bundle.data!, id, scoreAt))
            .filter((h): h is ParticipantHistory => h !== null);
    }, [bundle.data, scoreAt]);

    const batch = useCohortBatch(histories, cohortId);

    return {
        batch,
        /** Participants in this cohort — 0 until the bundle lands. */
        total: histories.length,
        /**
         * True from the moment a re-score is triggered until scores land.
         * Covers the bundle fetch too: both phases leave the queue without
         * numbers, and the distinction means nothing to a facilitator.
         */
        isScoring: bundle.isLoading || (histories.length > 0 && !batch.data),
    };
}
