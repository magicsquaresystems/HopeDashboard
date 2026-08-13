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
    return STATUS[level];
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

