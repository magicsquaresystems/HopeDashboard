/**
 * Typed client for the engagement_ml FastAPI service (dropout risk).
 *
 * Source: engagement_ml/deploy/api/main.py + schemas.py
 * Backend lives on a private HF Space; gated by X-API-Key (HOPE_RISK_API_KEY)
 * plus the HF Space `Authorization: Bearer <HF_TOKEN>` gateway gate.
 *
 * Wire-level contract is the event-record / ParticipantHistory shape from
 * engagement_ml. The dashboard-friendly response aliases (`dropout_risk`,
 * `risk_level`, `contributing_factors`, `recommended_actions`) are emitted
 * server-side by engagement_ml's `score_one` / `score_many` so this client
 * can render them directly without a per-call adapter.
 *
 * Cache predictions at the dashboard layer via TanStack Query
 * (`staleTime: 1 day`) — risk scores update on a weekly cadence.
 */

import { createClient, type ApiClientOptions } from "./client";

// No default base URL, on purpose. `lib/api/server.ts` supplies it from
// `DROPOUT_API_URL`; see the note in commentGen.ts for why the
// `NEXT_PUBLIC_` fallback that used to live here was removed.

export type RiskLevel = "low" | "medium" | "high";

/**
 * A single platform event. Mirrors `EventRecord` in
 * engagement_ml/deploy/api/schemas.py. Timestamps must fall in
 * `[effective_start, effective_start + score_at_day)` on the parent
 * history; the backend rejects out-of-window events with a 422.
 */
export type EventRecord = {
    timestamp: string; // ISO-8601
    event_type:
        | "activity"
        | "login"
        | "page_visit"
        | "bookmark"
        | "discussion_post"
        | "facilitator_comment";
    activity_type?: string;
    words_written?: number;
    description?: string;
    /** Forum topic id for `discussion_post` events — links to the
     * cohort bundle's `discussionThreads[topicId]` so the dashboard can
     * show the thread and pass it as reply context. */
    topic_id?: number;

    // --- `page_visit` rollup metadata (dashboard-only) ------------------
    // The platform exports page visits as one row per URL carrying a hit
    // count and a last-seen timestamp, not one row per view. These three
    // fields let the timeline name what a participant actually read.
    //
    // They ride along to `/predict` and `/batch` like `topic_id` does:
    // engagement_ml's `EventRecord` doesn't declare them and pydantic
    // defaults to ignoring unknown fields, so they're inert on the wire.
    // Page visits feed no model feature at all — see the `page_visit` note
    // in engagement_ml/deploy/api/schemas.py.
    /** e.g. "Being self-compassionate". Also set on `bookmark` events. */
    page_title?: string;
    /** e.g. `/modules/session-2/being-self-compassionate`. Also set on
     * `bookmark` events. */
    page_url?: string;
    /** How many times this URL was visited. */
    hits?: number;
    /** Average dwell per the platform rollup; unit undocumented (likely
     * ms) — carry, don't display as a duration. */
    avg_duration?: number;
    /** Platform activity id for `activity` events — forwarded to
     * comment-gen `/generate` (its memory store dedupes on it). Inert on
     * the risk-service wire like the page fields above. */
    activity_id?: number;
};

/**
 * One participant's raw event history at score-time.
 *
 * `cohort_size` is a live cohort-context feature. `cohort_facilitator_density`
 * is retained in the request for backward compatibility but is no longer a
 * model feature: the training-time leave-one-out density feature was removed
 * because it could not be reproduced identically at serve-time, so any value
 * supplied here is accepted and ignored.
 */
export type ParticipantHistory = {
    participant_id: string;
    effective_start: string; // ISO-8601
    events: EventRecord[];
    cohort_size: number;
    /** @deprecated no longer used as a model feature; accepted and ignored. */
    cohort_facilitator_density?: number;
    programme_length_days: number;
    score_at_day: number;
};

export type BatchEventRequest = {
    participants: ParticipantHistory[];
};

/**
 * Per-participant prediction. engagement_ml emits both its native fields
 * (`dropout_probability`, `risk_tier`) AND the dashboard-friendly aliases
 * (`dropout_risk`, `risk_level`) with identical values, plus
 * `contributing_factors` (TreeSHAP or rule-based) and `recommended_actions`
 * (tier-keyed playbook).
 */
export type PredictionResponse = {
    participant_id: string;

    // Native engagement_ml fields.
    dropout_probability: number;
    raw_probability: number;
    risk_tier: RiskLevel;
    threshold_used: number;
    threshold_low: number;
    threshold_high: number;
    model_version: string;
    horizon_used: number;
    programme_length_days: number;
    score_at_day: number;
    anchored_to_days: string;
    note?: string | null;

    // Dashboard contract aliases (same values as the native fields).
    dropout_risk: number;
    risk_level: RiskLevel;
    contributing_factors: string[];
    recommended_actions: string[];

    // Optional. Aligned with `contributing_factors` 1:1. Each entry is the
    // normalised |SHAP| magnitude for the corresponding factor, summing to
    // ~1 across the returned top-K. Absent for non-tree models or when the
    // rule-based fallback supplies the factors. Dashboard falls back to
    // decaying synthetic weights when this field is missing.
    contributing_factor_weights?: number[];

    // Optional. Aligned with `contributing_factors` 1:1. Per-factor SHAP
    // direction: "up" raises this person's risk, "down" lowers it. Lets the
    // dashboard render each driver with its own arrow/colour (a protective
    // driver isn't shown as if it raised risk, and vice-versa). Absent until
    // the engagement_ml Space is redeployed; DriverBars then falls back to a
    // single tone-based direction.
    contributing_factor_directions?: ("up" | "down")[];
};

export type BatchResponse = {
    total: number;
    high: number;
    medium: number;
    low: number;
    predictions: PredictionResponse[];
};

export type DropoutHealth = {
    status: "ok";
    horizons: number[];
    winner_architecture: string;
};

export type ModelInfoHorizon = {
    T: number;
    model_version: string;
    decision_threshold_raw: number;
    metrics: Record<string, unknown>;
};

export type ModelInfo = {
    winner_architecture: string;
    horizons: ModelInfoHorizon[];
    training_period: string;
    n_train: number;
    n_test: number;
    citation: string;
    limitations: string[];
};

export function createDropoutClient(
    opts: Partial<ApiClientOptions> & Pick<ApiClientOptions, "baseUrl">,
) {
    const { request } = createClient({
        baseUrl: opts.baseUrl,
        apiKey: opts.apiKey,
        authToken: opts.authToken,
        cookie: opts.cookie,
        fetchImpl: opts.fetchImpl,
    });

    return {
        health: () => request<DropoutHealth>({ path: "/health" }),
        modelInfo: () =>
            request<ModelInfo>({ path: "/model/info", auth: "apiKey" }),

        predict: (body: ParticipantHistory) =>
            request<PredictionResponse>({
                method: "POST",
                path: "/predict",
                body,
                auth: "apiKey",
            }),

        batch: (body: BatchEventRequest) =>
            request<BatchResponse>({
                method: "POST",
                path: "/batch",
                body,
                auth: "apiKey",
            }),
    };
}

export type DropoutClient = ReturnType<typeof createDropoutClient>;
