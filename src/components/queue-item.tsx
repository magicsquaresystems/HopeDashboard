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
    riskLevel: RiskLevel;
    riskScore: number;
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
    const status = friendlyStatus(riskLevel);
    const bandNote = tierExplanation(riskLevel, thresholdLow, thresholdHigh);
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
                        {Number.isFinite(riskScore)
                            ? `${(riskScore * 100).toFixed(0)}%`
                            : "—"}
                    </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Badge
                        variant={status.badgeVariant}
                        className="whitespace-nowrap"
                        title={bandNote}
                    >
                        {status.label}
                    </Badge>
                    {lastActiveLabel && (
                        <span className="truncate text-xs text-muted">
                            {lastActiveLabel}
                        </span>
                    )}
                </div>
                {contactedNote && (
                    <div className="mt-1 flex items-center gap-1 text-[11px] text-risk-lo">
                        <Check className="h-3 w-3 shrink-0" aria-hidden />
                        <span className="truncate">{contactedNote}</span>
                    </div>
                )}
            </div>
        </button>
    );
}
