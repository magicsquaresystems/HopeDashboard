"use client";

import { useEffect, useMemo, useState } from "react";
import { Lock } from "lucide-react";

import { RiskModelChip } from "@/components/risk-model-chip";
import {
    isAnchoredWeek,
    MODEL_MAX_WEEK,
    programmeWeeks,
    useScoringStore,
    weeksWithData,
    type ProgrammeWeek,
} from "@/lib/store/scoringStore";

/**
 * Cohort-level scoring-week control.
 *
 * Renders the programme's *full* shape — an 8-week module shows W1..W8 —
 * and disables the weeks that haven't elapsed yet. Showing the whole
 * programme greyed-out beats hiding it: the facilitator can see how long
 * the cohort runs and why next week isn't clickable, which a truncated
 * list can't convey.
 *
 * Changing the week causes the queue's /batch call, every detail
 * /predict call, and the drafts column's engagement context to refire
 * with the new score_at_day — facilitators can replay how the cohort
 * looked at any earlier checkpoint. Weeks are cumulative: W3 scores days
 * 0..20, so it includes weeks 1 and 2.
 */
export function WeekSelector({
    programmeLengthDays,
    effectiveStart,
}: {
    programmeLengthDays: number;
    /** Cohort start. Drives which weeks have elapsed; omit only if a
     *  caller genuinely has no start date, in which case every programme
     *  week is treated as available. */
    effectiveStart?: string;
}) {
    const week = useScoringStore((s) => s.scoreAtWeek);
    const setWeek = useScoringStore((s) => s.setScoreAtWeek);
    const clamp = useScoringStore((s) => s.clampToAvailable);

    // "Now", frozen at mount. A live clock would let the available-week
    // set change mid-interaction (and re-render the selector under the
    // facilitator's cursor at a week boundary). The page remounts per
    // cohort, so the value is fresh whenever it matters.
    const [now] = useState(() => Date.now());

    const weeks = useMemo(
        () => programmeWeeks(programmeLengthDays),
        [programmeLengthDays],
    );
    const maxWithData = useMemo(
        () =>
            effectiveStart === undefined
                ? weeks.length
                : weeksWithData(programmeLengthDays, effectiveStart, now),
        [programmeLengthDays, effectiveStart, now, weeks.length],
    );

    // Pull the selection in when the cohort is shorter than the current
    // pick, or hasn't run long enough to have that week's data yet.
    useEffect(() => {
        clamp(maxWithData);
    }, [maxWithData, clamp]);

    const lastWeek = weeks[weeks.length - 1];
    const anchored = isAnchoredWeek(week);
    const hasFutureWeeks = maxWithData < weeks.length;

    return (
        <div
            className="flex flex-wrap items-center gap-2"
            role="group"
            aria-label="Programme week to score at"
        >
            <span className="text-xs font-medium uppercase tracking-wide text-muted">
                Score at week
            </span>
            <div
                className="inline-flex items-center rounded-md bg-surface-2 p-0.5"
                role="radiogroup"
                aria-label="Programme week"
            >
                {weeks.map((w: ProgrammeWeek) => {
                    const isActive = w === week;
                    const noData = w > maxWithData;
                    return (
                        <button
                            key={w}
                            type="button"
                            role="radio"
                            aria-checked={isActive}
                            disabled={noData}
                            onClick={() => setWeek(w)}
                            title={
                                noData
                                    ? `Week ${w} hasn't finished yet — no behaviour to score`
                                    : isAnchoredWeek(w)
                                      ? `Week ${w} · scored against the model's W${MODEL_MAX_WEEK} horizon`
                                      : `Score the cohort at week ${w} (days 1–${w * 7})`
                            }
                            className={
                                "min-w-8 rounded px-2 py-1 text-xs font-medium transition-colors " +
                                (isActive
                                    ? "bg-surface text-text shadow-sm"
                                    : noData
                                      ? "cursor-not-allowed text-muted/40"
                                      : "text-muted hover:text-text-2")
                            }
                        >
                            W{w}
                        </button>
                    );
                })}
            </div>
            <span className="text-xs text-muted">
                (
                {week === lastWeek
                    ? "end of programme"
                    : `days 1–${week * 7}`}
                )
            </span>
            {/* Weeks past the trained horizons still score — the service
                anchors them to the last trained week and says so.
                Surfacing it here keeps the number from reading as if the
                model had been trained for the selected week. */}
            {anchored && (
                <span
                    title={`The risk model's trained horizons stop at week ${MODEL_MAX_WEEK}. Week ${week} is scored on the first ${
                        MODEL_MAX_WEEK * 7
                    } days of behaviour; anything after that does not change the score.`}
                    className="inline-flex items-center gap-1.5 rounded-md border border-risk-md bg-risk-md-bg px-2 py-1 text-xs text-risk-md"
                >
                    anchored to W{MODEL_MAX_WEEK}
                </span>
            )}
            {hasFutureWeeks && (
                <span
                    title={`This cohort is ${weeks.length} weeks long and has completed ${maxWithData}. Later weeks unlock as they elapse.`}
                    className="inline-flex items-center gap-1.5 text-xs text-muted"
                >
                    <Lock className="h-3 w-3" aria-hidden />
                    {maxWithData === 0
                        ? "first week in progress — scoring opens at day 7"
                        : `W${maxWithData + 1}–W${weeks.length} not yet run`}
                </span>
            )}
            <RiskModelChip />
        </div>
    );
}
