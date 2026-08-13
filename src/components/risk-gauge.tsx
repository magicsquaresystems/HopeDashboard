import { cn } from "@/lib/utils";

type RiskGaugeProps = {
    value: number; // 0..1
    level: "low" | "medium" | "high";
    size?: number;
    /** Dates the number when it isn't current — set past the model's
     *  trained horizons, where the score is anchored to the last trained
     *  week and stops responding. The gauge is the most screenshot-able
     *  thing on the page, so the caveat has to travel with the number
     *  itself, not only sit in a banner above it. */
    asOfLabel?: string;
};

const COLOR: Record<RiskGaugeProps["level"], string> = {
    low: "stroke-risk-lo",
    medium: "stroke-risk-md",
    high: "stroke-risk-hi",
};

export function RiskGauge({
    value,
    level,
    size = 160,
    asOfLabel,
}: RiskGaugeProps) {
    // NaN passes straight through Math.min/max, and a NaN dasharray makes
    // browsers paint the full arc — a missing value rendering as 100%
    // risk on the most screenshot-able element on the page. Clamp to the
    // floor instead; the visibly empty arc reads as "no score", which is
    // the truth.
    const clamped = Number.isFinite(value)
        ? Math.max(0, Math.min(1, value))
        : 0;
    const radius = size / 2 - 12;
    const cx = size / 2;
    const cy = size / 2 + 8;
    const arcLength = Math.PI * radius;
    const filled = arcLength * clamped;
    return (
        <div className="flex flex-col items-center">
            <svg
                width={size}
                height={size / 2 + 24}
                viewBox={`0 0 ${size} ${size / 2 + 24}`}
                aria-label={
                    `Dropout risk ${(clamped * 100).toFixed(0)} percent` +
                    (asOfLabel ? `, ${asOfLabel}` : "")
                }
                role="img"
            >
                <path
                    d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
                    className="fill-none stroke-border"
                    strokeWidth={12}
                    strokeLinecap="round"
                />
                <path
                    d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
                    className={cn("fill-none", COLOR[level])}
                    strokeWidth={12}
                    strokeLinecap="round"
                    strokeDasharray={`${filled} ${arcLength}`}
                />
                <text
                    x={cx}
                    y={cy - 4}
                    textAnchor="middle"
                    className="fill-text text-2xl font-semibold"
                >
                    {(clamped * 100).toFixed(0)}%
                </text>
            </svg>
            <div className="text-xs uppercase tracking-wide text-muted">
                {level} risk
            </div>
            {asOfLabel && (
                <div className="mt-0.5 text-[10px] font-medium text-risk-md">
                    {asOfLabel}
                </div>
            )}
        </div>
    );
}
