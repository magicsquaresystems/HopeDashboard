"use client";

import { useMemo, useState } from "react";
import { useCohortBatch } from "@/lib/hooks/api";
import { useCohortBundle } from "@/lib/hooks/useCohortBundle";
import { bundleParticipantIds, bundleToHistory } from "@/lib/realCohort";
import { rosterOrder } from "@/lib/roster";
import { scoreAtDay, useScoringStore } from "@/lib/store/scoringStore";
import type { ParticipantHistory } from "@/lib/api/dropout";

/** Share model inputs and eligibility across queue, detail and session counts. */
export function useCohortScoring(cohortId: number) {
    const bundle = useCohortBundle(cohortId);
    const week = useScoringStore((s) => s.scoreAtWeek);
    const horizon = scoreAtDay(week);
    const [now] = useState(() => Date.now());
    const histories = useMemo<ParticipantHistory[]>(() => {
        if (!bundle.data) return [];
        return bundleParticipantIds(bundle.data)
            .map((id) => bundleToHistory(bundle.data!, id, horizon, now))
            .filter((h): h is ParticipantHistory => h !== null);
    }, [bundle.data, horizon, now]);
    const scoreable = histories.filter((h) => h.prediction_eligible !== false);
    const batch = useCohortBatch(scoreable, cohortId);
    const roster = useMemo(() => rosterOrder(histories.filter((h) => h.prediction_eligible === false)), [histories]);
    return {
        batch, roster, bundle, histories,
        // Retained name for callers: nobody has a scoreable selected window.
        notStarted: histories.length > 0 && scoreable.length === 0,
        total: histories.length,
        isScoring: bundle.isLoading || (scoreable.length > 0 && !batch.data && !batch.isError),
    };
}
