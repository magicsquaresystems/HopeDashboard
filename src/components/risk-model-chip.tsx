"use client";

import { Sigma } from "lucide-react";

import { useRiskModelInfo } from "@/lib/hooks/api";
import { scoreAtDay, useScoringStore } from "@/lib/store/scoringStore";

/**
 * Read-only chip showing which risk model is serving the current
 * week-selector value. Pulls from engagement_ml's `/model/info`
 * endpoint — the family is fixed at deploy time (one architecture per
 * deploy bundle) but the per-horizon metrics differ, so the AUC/Brier
 * shown here tracks the selected week.
 *
 * Useful in workshop contexts so facilitators know the queue's
 * ordering comes from a real, evaluated model and not a heuristic.
 * Silently hides itself when the dropout API is unreachable so a
 * Space outage doesn't add visual noise.
 */
export function RiskModelChip() {
    const info = useRiskModelInfo();
    const week = useScoringStore((s) => s.scoreAtWeek);
    const scoreAt = scoreAtDay(week);

    if (!info.data) return null;
    // Exact horizon when one exists, else the LARGEST trained horizon at
    // or below the requested day — which is what the service itself
    // anchors to. A plain `find(h => h.T <= scoreAt)` returns whichever
    // entry happens to come first in the response array, so an 8-week
    // cohort at W8 could show T7's metrics beside a T42-anchored score.
    const horizon =
        info.data.horizons.find((h) => h.T === scoreAt) ??
        [...info.data.horizons]
            .filter((h) => h.T <= scoreAt)
            .sort((a, b) => b.T - a.T)[0];
    if (!horizon) return null;

    const auc = pickMetric(horizon.metrics, ["auc_raw", "auc"]);
    const brier = pickMetric(horizon.metrics, [
        "brier_calibrated",
        "brier_raw",
        "brier",
    ]);

    const family = friendlyFamily(info.data.winner_architecture);
    const tooltip =
        `${family} per-horizon model from engagement_ml deploy bundle ` +
        `(${info.data.n_train.toLocaleString()} train / ${info.data.n_test.toLocaleString()} test). ` +
        `Current horizon: T${horizon.T}. ` +
        (auc !== null ? `AUC ${auc.toFixed(3)}. ` : "") +
        (brier !== null ? `Brier ${brier.toFixed(3)}. ` : "");

    return (
        <span
            title={tooltip}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-xs text-text-2"
        >
            <Sigma className="h-3.5 w-3.5 text-muted" aria-hidden />
            <span className="font-medium">{family}</span>
            <span className="text-muted">·</span>
            <span className="font-mono text-[11px] text-muted">T{horizon.T}</span>
            {auc !== null && (
                <>
                    <span className="text-muted">·</span>
                    <span className="font-mono text-[11px] text-muted">
                        AUC {auc.toFixed(2)}
                    </span>
                </>
            )}
        </span>
    );
}

function pickMetric(
    metrics: Record<string, unknown>,
    keys: string[],
): number | null {
    for (const k of keys) {
        const v = metrics[k];
        if (typeof v === "number" && Number.isFinite(v)) return v;
    }
    return null;
}

function friendlyFamily(raw: string): string {
    const m: Record<string, string> = {
        lightgbm: "LightGBM",
        random_forest: "Random Forest",
        logistic_regression: "Logistic Regression",
        xgboost: "XGBoost",
        mlp: "MLP",
        catboost: "CatBoost",
        gru: "GRU",
    };
    return m[raw.toLowerCase()] ?? raw;
}
