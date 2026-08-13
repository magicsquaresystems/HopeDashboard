import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "positive" | "negative";

type MetricTileProps = {
    label: string;
    value: ReactNode;
    delta?: string;
    tone?: Tone;
};

const DELTA_TONE: Record<Tone, string> = {
    neutral: "text-muted",
    positive: "text-risk-lo",
    negative: "text-risk-hi",
};

export function MetricTile({
    label,
    value,
    delta,
    tone = "neutral",
}: MetricTileProps) {
    return (
        <Card>
            <CardContent>
                <div className="text-xs uppercase tracking-wide text-muted">
                    {label}
                </div>
                <div className="mt-1 text-base font-semibold text-text">
                    {value}
                </div>
                {delta && (
                    <div className={cn("mt-1 text-xs", DELTA_TONE[tone])}>
                        {delta}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

type MetricGridProps = {
    children: ReactNode;
};

export function MetricGrid({ children }: MetricGridProps) {
    return (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{children}</div>
    );
}
