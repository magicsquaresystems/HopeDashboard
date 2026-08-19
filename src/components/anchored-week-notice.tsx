"use client";

import { PauseCircle } from "lucide-react";

import { MODEL_MAX_WEEK } from "@/lib/store/scoringStore";

/**
 * Says plainly that the risk score has stopped moving.
 *
 * The dropout model ships trained horizons up to `MODEL_MAX_WEEK`
 * (currently week 8 / T56). Past that the service still answers, but it
 * anchors the prediction to the last trained horizon — later weeks
 * return *the same number*, whatever the participant has done since.
 * Unreachable for cohorts of 8 weeks or less; load-bearing for any
 * longer programme, which is expected on the live platform.
 *
 * A frozen number is more dangerous than a missing one. It looks
 * exactly like a fresh number, so a participant who was steady through
 * the last trained week and then vanished still reads as steady — at
 * the precise moment a facilitator most needs to notice. Hence a notice
 * rather than a tooltip: it has to be readable without hovering, and it
 * has to say what to look at *instead*.
 *
 * Recent-activity signals are the honest substitute. "Last active",
 * event counts, and the timeline are all measured against the selected
 * week's window, so unlike the model score they keep updating past the
 * trained horizons.
 */
export function AnchoredWeekNotice({
    week,
    variant = "full",
    className = "",
}: {
    week: number;
    /** `compact` for the queue header, `full` for the detail panel. */
    variant?: "full" | "compact";
    className?: string;
}) {
    if (variant === "compact") {
        return (
            <p
                className={
                    "flex items-start gap-1.5 rounded-md border border-risk-md/40 bg-risk-md-bg px-2.5 py-1.5 text-[11px] leading-relaxed text-risk-md " +
                    className
                }
            >
                <PauseCircle
                    className="mt-px h-3.5 w-3.5 shrink-0"
                    aria-hidden
                />
                <span>
                    Ranking held at week {MODEL_MAX_WEEK}. The model is not
                    trained past that week, so sort order and scores are
                    unchanged since week {MODEL_MAX_WEEK}. Use
                    &ldquo;last active&rdquo; to spot who has gone quiet
                    since.
                </span>
            </p>
        );
    }

    return (
        <div
            role="note"
            className={
                "rounded-lg border border-risk-md/40 bg-risk-md-bg px-3.5 py-3 " +
                className
            }
        >
            <div className="flex items-start gap-2">
                <PauseCircle
                    className="mt-0.5 h-4 w-4 shrink-0 text-risk-md"
                    aria-hidden
                />
                <div className="min-w-0">
                    <p className="text-xs font-semibold text-risk-md">
                        Risk score is held at week {MODEL_MAX_WEEK}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-text-2">
                        The dropout model is trained up to week{" "}
                        {MODEL_MAX_WEEK} only, so this score is calculated
                        from the first {MODEL_MAX_WEEK * 7} days and{" "}
                        <span className="font-medium">
                            will not change in week {week}
                        </span>
                        , whatever has happened since. Read it as a week-
                        {MODEL_MAX_WEEK} snapshot, not a current assessment.
                    </p>
                    <p className="mt-1.5 text-xs leading-relaxed text-text-2">
                        Recent activity below is still live. It is measured
                        to the selected week, so it is the reliable signal
                        for who needs attention now.
                    </p>
                </div>
            </div>
        </div>
    );
}
