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
    // entry happens to come first in the response array, so a week past
    // the trained set could show T7's metrics beside a score anchored to
    // the last trained horizon.
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

    // A facilitator triaging a cohort does not need "LightGBM · T42 ·
    // AUC 0.90" in their eyeline; they need to know the ordering comes
    // from a real, evaluated model and where to look if they want the
    // numbers. So the face says the plain thing and the numbers live one
    // click away, in the same disclosure rather than a hover tooltip
    // (which keyboard and touch users never get).
    return (
        <details className="group inline-block align-middle text-xs">
            <summary className="inline-flex cursor-pointer select-none items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-text-2 hover:text-text">
                <Sigma className="h-3.5 w-3.5 text-muted" aria-hidden />
                How these scores work
            </summary>
            <div className="mt-1.5 max-w-md space-y-1.5 rounded-md border border-border bg-surface-2 p-2.5 leading-relaxed text-text-2">
                <p>
                    The follow-up list is ordered by a statistical model
                    trained on past Hope programmes. It reads each person&apos;s
                    sign-ins, posts and page reads up to the selected week.
                </p>
                <p>
                    Flags are set cautiously. They catch around 9 in 10 people
                    who later step away, so a flag means &ldquo;worth a
                    look&rdquo;, not &ldquo;will drop out&rdquo;.
                </p>
                <p className="font-mono text-[10px] text-muted">
                    {family} · week {Math.round(horizon.T / 7)} model (T
                    {horizon.T}) ·{" "}
                    {info.data.n_train.toLocaleString()} train /{" "}
                    {info.data.n_test.toLocaleString()} test
                    {auc !== null ? ` · AUC ${auc.toFixed(3)}` : ""}
                    {brier !== null ? ` · Brier ${brier.toFixed(3)}` : ""}
                </p>
            </div>
        </details>
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
