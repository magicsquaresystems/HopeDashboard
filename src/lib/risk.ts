/**
 * Shared display copy keyed on engagement_ml's `RiskLevel`. Queue, detail,
 * and drafts all read from here so a wording change lands in one place.
 */

import type { RiskLevel } from "@/lib/api/dropout";

export type FriendlyStatus = {
    label: string;
    badgeVariant: "high" | "medium" | "low";
    queuePillLabel: string;
};

const STATUS: Record<RiskLevel, FriendlyStatus> = {
    high: {
        label: "Needs attention",
        badgeVariant: "high",
        queuePillLabel: "Needs attention",
    },
    medium: {
        label: "Check in soon",
        badgeVariant: "medium",
        queuePillLabel: "Check in soon",
    },
    low: {
        label: "On track",
        badgeVariant: "low",
        queuePillLabel: "On track",
    },
};

export function friendlyStatus(level: RiskLevel): FriendlyStatus {
    // The wire type says `level` is always one of the three, but this is
    // read straight off an API response and dereferenced unguarded by
    // every queue row — an unexpected value would throw in render and
    // unmount the whole queue, not one row. Degrade to the cautious
    // middle tier instead.
    return STATUS[level] ?? STATUS.medium;
}

/**
 * Explain where a participant's percentage sits against the cut-offs the
 * model actually used.
 *
 * Worth surfacing because the boundaries are counter-intuitive: red
 * starts around 21%, not 50%. That is deliberate — the operating point
 * is tuned for recall >= 0.90, so the model flags nearly everyone who
 * goes on to leave and accepts false alarms to do it. Without the
 * numbers on screen a facilitator reading "30% · Needs attention"
 * reasonably concludes the badge is wrong.
 *
 * `thresholdLow` and `thresholdHigh` must be the service's calibrated
 * cut-offs (`threshold_low` / `threshold_high`), which share a scale
 * with `dropout_probability`. Do NOT pass `threshold_used` — that one is
 * in raw classifier space and comparing it to the displayed percentage
 * is meaningless.
 */
export function tierExplanation(
    level: RiskLevel,
    thresholdLow: number | undefined,
    thresholdHigh: number | undefined,
): string | undefined {
    if (
        !Number.isFinite(thresholdLow) ||
        !Number.isFinite(thresholdHigh)
    ) {
        return undefined;
    }
    // One decimal, not zero. Row percentages are whole numbers, so an
    // integer cut-off collides with them: a participant on 9.97% renders
    // as "10%" and is correctly On track, but against a cut-off also
    // rounded to "10%" the tooltip reads as a contradiction. Trailing
    // ".0" is dropped so the common case stays clean.
    const pct = (v: number) => `${Number((v * 100).toFixed(1))}%`;
    const lo = pct(thresholdLow!);
    const hi = pct(thresholdHigh!);
    const band =
        level === "high"
            ? `${hi} or above`
            : level === "low"
              ? `below ${lo}`
              : `${lo}–${hi}`;
    return (
        `${STATUS[level]?.label ?? "Check in soon"}: ${band} for this week's model. ` +
        `Cut-offs are set low on purpose. They catch around 9 in 10 ` +
        `participants who go on to leave, so a flag means "worth a look", ` +
        `not "likely to drop out".`
    );
}

export const QUEUE_PILL_LABELS: Record<RiskLevel | "all", string> = {
    all: "All",
    high: STATUS.high.queuePillLabel,
    medium: STATUS.medium.queuePillLabel,
    low: STATUS.low.queuePillLabel,
};

export const WELLBEING_CUE: Record<RiskLevel, string> = {
    high: "Show empathy when support signals are strong, and let the participant set the pace.",
    medium: "Acknowledge contribution and invite a small next step without pressure.",
    low: "Light-touch encouragement keeps momentum without overloading their inbox.",
};

