/**
 * Every backend call the browser makes, as TanStack Query hooks.
 *
 * This is the single seam between the UI and the two FastAPI services. No
 * component fetches directly; if you need new backend data, add a hook here.
 *
 * ## Why every path starts with `/api/proxy`
 *
 * These hooks run in the browser, so they can never hold a credential. They
 * call this app's own server routes (`src/app/api/proxy/**`), which attach the
 * HMAC signature, the risk-service API key, and the HF bearer token server-side
 * before forwarding upstream. See ARCHITECTURE.md §2.4. A hook that called a
 * service URL directly would both leak secrets and fail CORS.
 *
 * ## Queries vs mutations
 *
 * Reads are `useQuery` and cached; writes are `useMutation` and never cached.
 * Two stale times are in play, and the difference is deliberate:
 *
 * - `ONE_DAY` for risk scores and the risk model card. Scores are produced by a
 *   weekly batch, so re-fetching within a session cannot return anything new —
 *   caching hard keeps the queue from re-scoring on every navigation.
 * - `FIVE_MIN` for participant memory, which a facilitator's own actions
 *   can change mid-session.
 *
 * ## Cache keys must include `cohortId`
 *
 * TanStack Query's cache is global to the app, and a participant can re-enrol
 * in a later cohort under the same platform `user_id`. Keying only on
 * participant id would let two cohort pages collide and serve one cohort's
 * prediction on the other's page. Every participant-scoped key therefore
 * carries `cohortId`, and score-dependent keys also carry `score_at_day` so
 * moving the week selector refetches instead of showing last week's number.
 *
 * ## Errors
 *
 * `postJSON`/`getJSON` throw on any non-2xx, so hooks surface `isError` rather
 * than resolving with a bad payload. Callers render the failure; the drafts
 * panel additionally maps upstream 5xx to a friendly offline card via
 * `classifyGenerateError`.
 */

"use client";

import {
    useMutation,
    useQuery,
    useQueryClient,
} from "@tanstack/react-query";

import type {
    Draft,
    EventRequest,
    GenerateRequest,
    GenerateResponse,
    MemoryEntry,
    PolishRequest,
    TextGenResponse,
    ThumbRequest,
} from "@/lib/api/commentGen";
import type {
    BatchEventRequest,
    BatchResponse,
    ModelInfo,
    ParticipantHistory,
    PredictionResponse,
} from "@/lib/api/dropout";
import { proxyFailure } from "@/lib/api/proxy-error";
import { BUSY_CODE } from "@/app/cohorts/[cohortId]/drafts-helpers";

const ONE_DAY = 24 * 60 * 60 * 1000;
const FIVE_MIN = 5 * 60 * 1000;

async function postJSON<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        throw await proxyFailure(path, res);
    }
    return res.json() as Promise<T>;
}

async function getJSON<T>(path: string): Promise<T> {
    const res = await fetch(path);
    if (!res.ok) {
        throw await proxyFailure(path, res);
    }
    return res.json() as Promise<T>;
}

/**
 * Score a whole cohort in one call — what the queue renders from.
 *
 * The service returns predictions **sorted by descending risk, not in request
 * order**, because it is built to feed a triage queue. Match results back to
 * participants on `participant_id`; never by index.
 */
export function useCohortBatch(
    participants: ParticipantHistory[],
    cohortId: number | string | null = null,
) {
    const body: BatchEventRequest = { participants };
    // Cache key must include cohortId in addition to score_at_day +
    // participant ids — participants can re-enrol across cohorts with
    // the same platform user_id, and TanStack Query caches globally,
    // so two cohort pages would otherwise collide on a participant
    // shared between them and serve the wrong cohort's prediction.
    const scoreAtDay = participants[0]?.score_at_day ?? null;
    return useQuery({
        queryKey: [
            "cohort-batch",
            cohortId,
            scoreAtDay,
            participants.map((p) => p.participant_id),
        ],
        queryFn: () => postJSON<BatchResponse>("/api/proxy/dropout/batch", body),
        staleTime: ONE_DAY,
        enabled: participants.length > 0,
    });
}

export function useParticipantPrediction(
    history: ParticipantHistory | null,
    cohortId: number | string | null = null,
) {
    return useQuery({
        queryKey: [
            "predict",
            cohortId,
            history?.participant_id ?? null,
            history?.score_at_day ?? null,
        ],
        queryFn: () =>
            postJSON<PredictionResponse>("/api/proxy/dropout/predict", history!),
        staleTime: ONE_DAY,
        enabled: history !== null,
    });
}

/**
 * The participant's recent writing history, as the comment service holds it.
 *
 * Capped at the 10 most recent rows — this feeds a side panel, not an archive.
 * `useEvent` invalidates this key on send so a just-sent reply appears without
 * a manual refresh.
 */
export function useMemory(participantId: string | null, cohortId: number | null) {
    return useQuery({
        queryKey: ["memory", participantId, cohortId],
        queryFn: () => {
            const url = new URL(
                `/api/proxy/memory/${participantId}`,
                window.location.origin,
            );
            if (cohortId != null) url.searchParams.set("cohort_id", String(cohortId));
            url.searchParams.set("limit", "10");
            return getJSON<MemoryEntry[]>(url.pathname + url.search);
        },
        staleTime: FIVE_MIN,
        enabled: participantId !== null,
    });
}

/**
 * Ask the SLM for reply drafts. The slowest call in the app.
 *
 * A warm model answers in seconds, but the first request after a service
 * restart or a model swap loads the adapter first — budget 60–90 s. It is a
 * mutation rather than a query because each call is a fresh generation:
 * re-running it for the same post is expected to produce different drafts, so
 * there is nothing meaningful to cache.
 *
 * Returns 1 draft for a `Discussion` (forum) post and 2–3 persona variants for
 * an activity post.
 */
export function useGenerate() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body: GenerateRequest) =>
            postJSON<GenerateResponse>("/api/proxy/generate", body),
        // A failed generation is the moment the cached service status is
        // least trustworthy. `useCommentGenStatus` holds its answer for five
        // minutes, so without this the header can name a live, loaded model
        // while the panel below it renders "comment generation is offline" —
        // the two read different endpoints and the stale one wins on screen.
        // Refetching costs one cheap `/version` + `/health` round trip and
        // makes the two agree.
        onError: () => {
            qc.invalidateQueries({ queryKey: ["comment-gen-status"] });
        },
        // The service serves one model in one process, so when several
        // facilitators generate at once it refuses the overflow with a
        // 503 rather than queueing them invisibly. Retrying is the right
        // response — the work will be possible shortly — but only for
        // that specific refusal: retrying a real failure just triples
        // the time before the facilitator learns about it.
        retry: (failureCount, error) =>
            failureCount < 3 && (error as Error).message.includes(BUSY_CODE),
        // Spaced to the service's own Retry-After ballpark, and rising,
        // so several waiting facilitators don't retry in lockstep.
        retryDelay: (attempt) => 15_000 * (attempt + 1),
    });
}

export function usePolishText() {
    return useMutation({
        mutationFn: (body: PolishRequest) =>
            postJSON<TextGenResponse>("/api/proxy/text/polish", body),
    });
}

/**
 * `facilitator_id` is absent from both client payloads on purpose: the
 * proxy routes stamp it from the signed-in session, so the browser never
 * gets to claim an identity. The wire types keep the field (the service
 * requires it) — these Omits describe what the *client* sends.
 */
export type ClientThumbRequest = Omit<ThumbRequest, "facilitator_id">;
export type ClientEventRequest = Omit<EventRequest, "facilitator_id">;

export function useThumb() {
    return useMutation({
        mutationFn: (body: ClientThumbRequest) =>
            postJSON("/api/proxy/thumb", body),
    });
}

export function useEvent() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body: ClientEventRequest) =>
            postJSON("/api/proxy/event", body),
        onSuccess: () => {
            // Invalidate memory so the freshly-sent reply appears next render.
            // The "contacted this session" stat is recorded by the drafts
            // panel's send handler, which knows the participant and cohort;
            // EventRequest carries draft ids only.
            qc.invalidateQueries({ queryKey: ["memory"] });
        },
    });
}

export function useRiskModelInfo() {
    return useQuery({
        queryKey: ["risk-model-info"],
        queryFn: async (): Promise<ModelInfo> => {
            const res = await fetch("/api/proxy/dropout/model-info");
            if (!res.ok) {
                throw new Error(`dropout/model-info failed: ${res.status}`);
            }
            return res.json();
        },
        staleTime: ONE_DAY,
        refetchOnWindowFocus: false,
    });
}

export type CommentGenStatus = {
    model_version: string;
    service_version: string;
    /** Null when the service omits the field (older build). */
    model_loaded: boolean | null;
    status: "healthy" | "degraded";
};

/**
 * Which reply model is configured and whether it is resident.
 *
 * `FIVE_MIN` rather than `ONE_DAY`: `model_loaded` flips from false to
 * true once the adapter finishes loading, and a facilitator waiting on
 * that should not have to reload the page to see it.
 */
export function useCommentGenStatus() {
    return useQuery({
        queryKey: ["comment-gen-status"],
        queryFn: () => getJSON<CommentGenStatus>("/api/proxy/comment-gen/status"),
        staleTime: FIVE_MIN,
        refetchOnWindowFocus: false,
        // A dead comment service is an expected state here (no GPU
        // assigned yet), not something to hammer.
        retry: 1,
    });
}

export type { Draft };
