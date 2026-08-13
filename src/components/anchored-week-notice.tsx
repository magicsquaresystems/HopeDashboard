"use client";

import { PauseCircle } from "lucide-react";

import { MODEL_MAX_WEEK } from "@/lib/store/scoringStore";

/**
 * Says plainly that the risk score has stopped moving.
 *
 * The dropout model ships trained horizons up to week 6. Past that the
 * service still answers, but it anchors the prediction to the first 42
 * days — so weeks 7 and 8 return *the same number as week 6*, whatever
 * the participant has done since. On an 8-week programme (HOPE MOVE and
 * NHS Long COVID both are) that covers the final quarter of the course.
 *
 * A frozen number is more dangerous than a missing one. It looks
 * exactly like a fresh number, so a participant who was steady through
 * week 6 and then vanished still reads as steady — at the precise
 * moment a facilitator most needs to notice. Hence a notice rather than
 * a tooltip: it has to be readable without hovering, and it has to say
 * what to look at *instead*.
 *
 * Recent-activity signals are the honest substitute. "Last active",
 * event counts, and the timeline are all measured against the selected
 * week's window, so unlike the model score they keep updating through
 * weeks 7 and 8.
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
                {/* Explicit {" "} before the dash: the compiler strips a
                    plain space between an expression and a text node that
                    carries an HTML entity, rendering "week 6— the model". */}
                <span>
                    Ranking held at week {MODEL_MAX_WEEK}{" "}
                    — the model has no week {week} horizon. Sort order and
                    scores are unchanged since week {MODEL_MAX_WEEK}; use
                    “last active” to spot who has gone quiet since.
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
                        Recent activity below is still live — it is measured
                        to the selected week, so it is the reliable signal
                        for who needs attention now.
                    </p>
                </div>
            </div>
        </div>
    );
}
