"use client";

import { Check } from "lucide-react";

import { Avatar } from "@/components/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { friendlyStatus, tierExplanation } from "@/lib/risk";
import { useBundleDisplayName } from "@/lib/hooks/displayName";
import type { RiskLevel } from "@/lib/api/dropout";

type QueueItemProps = {
    participantId: string;
    cohortId?: number;
    /**
     * Absent in a cohort's first week, where the risk model is withheld
     * because no week has elapsed to score. The row then reads "Not
     * scored yet" instead of borrowing a tier it was never given — the
     * facilitator can still open the person and reply to them, which is
     * the whole reason the row is rendered at all.
     */
    riskLevel?: RiskLevel;
    riskScore?: number;
    /** The service's calibrated tier cut-offs for the scored horizon
     *  (`threshold_low` / `threshold_high`). Drive the tooltip that
     *  explains why e.g. 30% reads as "Needs attention". */
    thresholdLow?: number;
    thresholdHigh?: number;
    lastActiveLabel?: string;
    selected?: boolean;
    onClick?: () => void;
    /** "Replied by alice · 2h ago" when another facilitator (or you)
     *  has already reached out recently. Absent when nobody has. */
    contactedNote?: string;
};

export function QueueItem({
    participantId,
    cohortId,
    riskLevel,
    riskScore,
    thresholdLow,
    thresholdHigh,
    lastActiveLabel,
    selected,
    onClick,
    contactedNote,
}: QueueItemProps) {
    const scored = riskLevel !== undefined;
    const status = scored ? friendlyStatus(riskLevel) : null;
    const bandNote = scored
        ? tierExplanation(riskLevel, thresholdLow, thresholdHigh)
        : "This cohort is still in its first week, so there is not yet a full week of activity for the model to read.";
    const aliasLabel = useBundleDisplayName(participantId, cohortId);
    return (
        <button
            type="button"
            onClick={onClick}
            aria-current={selected ? "true" : undefined}
            className={cn(
                "flex w-full items-center gap-3 rounded-lg border border-transparent px-3 py-2 text-left transition-colors hover:bg-surface-2",
                selected && "border-border-2 bg-surface-2",
            )}
        >
            <Avatar
                participantId={participantId}
                cohortId={cohortId}
                size="md"
            />
            <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-text">
                        {aliasLabel}
                    </span>
                    <span
                        className="shrink-0 text-xs tabular-nums text-muted"
                        title={bandNote}
                    >
                        {typeof riskScore === "number" &&
                        Number.isFinite(riskScore)
                            ? `${(riskScore * 100).toFixed(0)}%`
                            : "—"}
                    </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Badge
                        variant={status ? status.badgeVariant : "neutral"}
                        className="whitespace-nowrap"
                        title={bandNote}
                    >
                        {status ? status.label : "Not scored yet"}
                    </Badge>
                    {lastActiveLabel && (
                        <span className="truncate text-xs text-muted">
                            {lastActiveLabel}
                        </span>
                    )}
                </div>
                {contactedNote && (
                    <div className="mt-1 flex items-start gap-1 text-[11px] text-risk-lo">
                        {/* Wraps rather than truncates. "Contacted by support ·
                            yesterday" is the whole point of the line, and the
                            queue column is narrow enough that `truncate` cut
                            it to "Contacted by support · yest…" — hiding the
                            one word a facilitator scans for. */}
                        <Check className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                        <span className="min-w-0 break-words">{contactedNote}</span>
                    </div>
                )}
            </div>
        </button>
    );
}
