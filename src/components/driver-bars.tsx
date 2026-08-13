import { ArrowDown, ArrowUp } from "lucide-react";

import { cn } from "@/lib/utils";

type Direction = "up" | "down";

type DriverBarsProps = {
    factors: string[];
    /** Aligned 1:1 with `factors`. When absent, synthetic decaying weights
     *  are used so the visual ranking still reads. */
    weights?: number[];
    /** Aligned 1:1 with `factors`. Per-factor SHAP direction: "up" raises
     *  this person's risk, "down" lowers it. When present, each bar is
     *  coloured and arrowed by its own direction, so a protective driver in a
     *  flagged participant's top-3 (or a risk driver in a low-risk one's)
     *  keeps its own direction instead of inheriting the panel's. When absent
     *  (API not yet redeployed), falls back to the tone-based single direction
     *  below. */
    directions?: Direction[];
    /** Tier-derived accent, used only for the fallback when `directions` is
     *  absent. Defaults to text. */
    tone?: "high" | "medium" | "low";
};

const TONE_BAR: Record<NonNullable<DriverBarsProps["tone"]>, string> = {
    high: "bg-risk-hi",
    medium: "bg-risk-md",
    low: "bg-risk-lo",
};

function syntheticWeights(n: number): number[] {
    // Decaying: 1.0, 0.78, 0.61, 0.48, ... — keeps the bar ladder reading
    // even when the backend hasn't shipped real magnitudes yet.
    return Array.from({ length: n }, (_, i) => 0.78 ** i);
}

export function DriverBars({
    factors,
    weights,
    directions,
    tone,
}: DriverBarsProps) {
    if (factors.length === 0) {
        return (
            <p className="text-xs text-muted">
                No contributing factors available.
            </p>
        );
    }
    const w = weights ?? syntheticWeights(factors.length);
    const max = Math.max(...w);
    const total = w.reduce((a, b) => a + b, 0);
    const estimated = !weights;

    // Per-factor direction: each driver carries whether it raised or lowered
    // this person's risk. Used only when the backend supplied one entry per
    // factor; otherwise fall back to a single tone-derived direction (low
    // risk → protective, else → risk).
    const hasDirections =
        Array.isArray(directions) && directions.length === factors.length;
    const protectiveFallback = tone === "low";
    const fallbackBar = tone ? TONE_BAR[tone] : "bg-text";

    return (
        <div className="space-y-2.5">
            {factors.map((f, i) => {
                const pct = max > 0 ? Math.round((w[i] / max) * 100) : 0;
                const share = total > 0 ? Math.round((w[i] / total) * 100) : 0;
                const raising = hasDirections
                    ? directions![i] === "up"
                    : !protectiveFallback;
                const barColor = hasDirections
                    ? raising
                        ? "bg-risk-hi"
                        : "bg-risk-lo"
                    : fallbackBar;
                const labelColor = hasDirections
                    ? raising
                        ? "text-risk-hi"
                        : "text-risk-lo"
                    : "text-muted";
                return (
                    <div
                        key={i}
                        className="grid grid-cols-[1fr_auto] items-end gap-3"
                    >
                        <div>
                            <div className="text-xs text-text-2">{f}</div>
                            <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-2">
                                <div
                                    className={cn(
                                        "h-full rounded-full",
                                        barColor,
                                    )}
                                    style={{ width: `${pct}%` }}
                                    aria-hidden
                                />
                            </div>
                        </div>
                        <div
                            className={cn(
                                "flex items-center gap-0.5 text-xs tabular-nums",
                                labelColor,
                            )}
                            title={
                                hasDirections
                                    ? raising
                                        ? `Raises risk — ${share}% of the explanation`
                                        : `Lowers risk — ${share}% of the explanation`
                                    : undefined
                            }
                        >
                            {hasDirections ? (
                                raising ? (
                                    <ArrowUp className="h-3 w-3" aria-hidden />
                                ) : (
                                    <ArrowDown className="h-3 w-3" aria-hidden />
                                )
                            ) : protectiveFallback ? (
                                ""
                            ) : (
                                "+"
                            )}
                            {share}%
                        </div>
                    </div>
                );
            })}
            <p className="pt-1 text-[10.5px] italic text-muted">
                {hasDirections
                    ? "↑ raises this person's risk · ↓ lowers it. Bar width = share of the explanation."
                    : protectiveFallback
                      ? "Share of why the model rates this person low risk."
                      : "Share of what's driving this person's risk score."}
                {estimated &&
                    " Bar widths are estimates until the model emits per-factor magnitudes."}
            </p>
        </div>
    );
}
