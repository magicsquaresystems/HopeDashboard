/**
 * Typed client for the comment_generation FastAPI service.
 *
 * Spec: ../comment_generation/docs/openapi.yaml
 * Default base URL: http://localhost:8001
 */

import { createClient, type ApiClientOptions, type Schemas } from "./client";

const DEFAULT_BASE_URL =
    process.env.NEXT_PUBLIC_COMMENT_GEN_URL ?? "http://localhost:8001";

// The service dropped its pre-`RichGenerateRequest` body shape, so this is
// no longer a union — `LegacyGenerateRequest` left the spec and the alias
// exists only so call sites read as "the /generate body".
export type GenerateRequest = Schemas["RichGenerateRequest"];
export type GenerateResponse = Schemas["GenerateResponse"];
export type Draft = Schemas["Draft"];
export type Persona = Schemas["Persona"];
export type ActivityType = Schemas["ActivityType"];

export type ThumbRequest = Schemas["ThumbRequest"];
export type EventRequest = Schemas["EventRequest"];
export type EventAction = Schemas["EventAction"];

export type MemoryPostRequest = Schemas["MemoryPostRequest"];
export type MemoryReplyRequest = Schemas["MemoryReplyRequest"];
export type MemoryEntry = Schemas["MemoryEntry"];
export type MemoryWriteResponse = Schemas["MemoryWriteResponse"];

export type HealthResponse = Schemas["HealthResponse"];
export type VersionResponse = Schemas["VersionResponse"];

// Text tasks. /text/polish is the facilitator-input grammar+rephrase
// surface wired to the "Polish with AI" button on the draft card.
// `rephrase` is the default — it fixes spelling/grammar then rephrases
// for clarity while preserving the warmth. The other tones exist for
// future UI exposure (kebab menu) but the button currently calls
// rephrase only.
export type PolishTarget = "rephrase" | "warmer" | "shorter" | "clearer";
export type PolishRequest = {
    draft_text: string;
    participant_id: number;
    target_tone?: PolishTarget;
};
export type TextGenResponse = {
    text: string;
    task: string;
    model_version: string;
    generated_at: string;
};

export function createCommentGenClient(
    opts: Partial<ApiClientOptions> = {},
) {
    const { request } = createClient({
        baseUrl: opts.baseUrl ?? DEFAULT_BASE_URL,
        sign: opts.sign,
        // Forward the HF token so the comment-gen client can hit a
        // PRIVATE HF Space. Without this, the gateway returns 404
        // and the dashboard surfaces the 'comment generation is
        // offline' status card even though the Space is up.
        authToken: opts.authToken,
        cookie: opts.cookie,
        fetchImpl: opts.fetchImpl,
    });

    return {
        health: () => request<HealthResponse>({ path: "/health" }),
        version: () => request<VersionResponse>({ path: "/version" }),

        generate: (body: GenerateRequest) =>
            request<GenerateResponse>({
                method: "POST",
                path: "/generate",
                body,
                signed: true,
            }),

        thumb: (body: ThumbRequest) =>
            request<Schemas["AckResponse"]>({
                method: "POST",
                path: "/thumb",
                body,
                signed: true,
            }),

        event: (body: EventRequest) =>
            request<Schemas["AckResponse"]>({
                method: "POST",
                path: "/event",
                body,
                signed: true,
            }),

        writeMemoryPost: (body: MemoryPostRequest) =>
            request<MemoryWriteResponse>({
                method: "POST",
                path: "/memory/post",
                body,
                signed: true,
            }),

        writeMemoryReply: (body: MemoryReplyRequest) =>
            request<MemoryWriteResponse>({
                method: "POST",
                path: "/memory/reply",
                body,
                signed: true,
            }),

        debugMemory: (
            participantId: number,
            cohortId?: number,
            limit = 10,
        ) =>
            request<MemoryEntry[]>({
                path: `/memory/${participantId}`,
                query: { cohort_id: cohortId, limit },
                signed: true,
            }),

        polishText: (body: PolishRequest) =>
            request<TextGenResponse>({
                method: "POST",
                path: "/text/polish",
                body,
                signed: true,
            }),

        // The model-switcher surface (`/admin/models`, `/admin/model`)
        // was removed with the topbar ModelPicker: production serves one
        // pinned adapter (`HOPE_MODEL_LOCKED=1`), so a swap control is a
        // research affordance that has no place in a facilitator UI.
    };
}

export type CommentGenClient = ReturnType<typeof createCommentGenClient>;
