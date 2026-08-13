import { Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buildSnapshot } from "@/lib/signals";
import { buildSummary } from "@/lib/summary";
import { displayName } from "@/lib/signals";
import type { ParticipantHistory, PredictionResponse } from "@/lib/api/dropout";

type AiSummaryCardProps = {
    history: ParticipantHistory;
    prediction: PredictionResponse;
};

export function AiSummaryCard({ history, prediction }: AiSummaryCardProps) {
    const snapshot = buildSnapshot(
        history,
        prediction.contributing_factors,
        prediction.risk_level,
    );
    const name = displayName(history.participant_id);
    const paragraph = buildSummary(name, snapshot);

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between gap-2">
                    <CardTitle>Summary</CardTitle>
                    <Badge variant="info" className="gap-1">
                        <Sparkles className="h-3 w-3" aria-hidden />
                        AI generated
                    </Badge>
                </div>
            </CardHeader>
            <CardContent>
                <p className="text-sm leading-relaxed text-text-2">
                    {paragraph}
                </p>
            </CardContent>
        </Card>
    );
}
