import { ArrowRight, Lightbulb } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { WELLBEING_CUE } from "@/lib/risk";
import { activationLevel } from "@/lib/signals";
import type { PredictionResponse } from "@/lib/api/dropout";

/**
 * "What to do" — the model's recommended actions for this participant.
 *
 * This was three side-by-side cards (activation level / recommended
 * approach / wellbeing cue). They were collapsed into one because all
 * three are keyed on the same `risk_level` and therefore said the same
 * thing three ways — a low-risk participant got "keep the touch light",
 * "continue light-touch monitoring" and "light-touch encouragement"
 * simultaneously. Three columns inside an already-narrow detail panel
 * also wrapped the action text every few words, which is the one part
 * here a facilitator actually needs to read.
 *
 * One full-width card: actions get a readable measure, activation stays
 * as a chip (it's a one-word qualifier, not a paragraph), and the
 * wellbeing cue drops to a footnote.
 */

type InfoCardRowProps = {
    prediction: PredictionResponse;
};

const ACTIVATION_TONE: Record<"Low" | "Medium" | "High", string> = {
    Low: "border-risk-hi/40 bg-risk-hi-bg text-risk-hi",
    Medium: "border-risk-md/40 bg-risk-md-bg text-risk-md",
    High: "border-risk-lo/40 bg-risk-lo-bg text-risk-lo",
};

export function InfoCardRow({ prediction }: InfoCardRowProps) {
    const activation = activationLevel(
        prediction.contributing_factors,
        prediction.risk_level,
    );
    // Top 1–2 recommended actions as discrete steps rather than one
    // run-on sentence — so the actual "what to do" is legible at a glance.
    const actions = (prediction.recommended_actions ?? []).slice(0, 2);
    const fallback = [
        "Acknowledge their last contribution",
        "Invite one small next step",
    ];
    const steps = actions.length ? actions : fallback;

    return (
        <Card className="border-l-4 border-l-accent">
            <CardContent className="py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                        <Lightbulb
                            className="h-3.5 w-3.5 text-accent-ink"
                            aria-hidden
                        />
                        What to do
                    </span>
                    <span
                        title="How engaged this participant currently is — derived from their risk drivers."
                        className={
                            "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium " +
                            ACTIVATION_TONE[activation]
                        }
                    >
                        {activation} activation
                    </span>
                </div>

                <ul className="mt-2 space-y-1.5">
                    {steps.map((it, i) => (
                        <li
                            key={i}
                            className="flex items-start gap-2 text-sm leading-relaxed text-text-2"
                        >
                            <ArrowRight
                                className="mt-1 h-3.5 w-3.5 shrink-0 text-accent-ink"
                                aria-hidden
                            />
                            <span>{it}</span>
                        </li>
                    ))}
                </ul>

                <p className="mt-2 border-t border-border pt-2 text-xs leading-relaxed text-muted">
                    {WELLBEING_CUE[prediction.risk_level]}
                </p>
            </CardContent>
        </Card>
    );
}
