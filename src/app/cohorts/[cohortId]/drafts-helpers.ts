/**
 * Pure helpers used by the Drafts panel — extracted so Vitest can import
 * them in a Node environment without dragging in the React/Next tree.
 *
 * These functions exist here exactly so the failure surfaces they own
 * (error classification, model labelling, reply-target picking) get
 * unit-tested directly rather than being verified only by Playwright
 * walking the UI.
 */

import { DAY_MS, scoreWindowEnd } from "@/lib/signals";
import type { ParticipantHistory } from "@/lib/api/dropout";
import type { ActivityType } from "@/lib/api/commentGen";

/**
 * Shape of the error card rendered when /generate fails. The tone drives
 * the colour token and copy; title/body are user-facing strings. `detail`
 * carries the raw technical message for a collapsed disclosure — never
 * for the card body, where it reads as the interface shouting stack
 * traces at a facilitator.
 */
export type GenerateErrorState = {
    tone: "offline" | "auth" | "error" | "busy";
    title: string;
    body: string;
    detail?: string;
};

/** Substring the service puts in its 503 body when the decode queue is
 *  full. Matched before the generic 5xx branch — see below. */
export const BUSY_CODE = "generation_busy";

/**
 * Friendly labels for non-SLM ``model_version`` strings the comment-gen
 * service can return in place of an adapter id: the kill-switch stub,
 * the safety block, and the error fallback. Anything not in this map is
 * treated as a Hub adapter id.
 */
const MODEL_VERSION_FALLBACKS: Record<string, string> = {
    "stub-disabled": "stub (kill-switch)",
    "safety-block": "safety block",
    "error-fallback": "fallback",
    "legacy-stub": "legacy stub",
};

/**
 * Render the "Drafted by …" badge label for a response's
 * ``model_version`` field.
 *
 * Production serves one pinned adapter (Qwen3.5-4B), so this is not a
 * roster formatter any more — it answers "which model wrote this?" for
 * the adapter id the service reports, which also surfaces a stale
 * deployment at a glance. Hub ids drop the namespace and the ``-lora``
 * suffix; the ``-hope-forum`` corpus segment renders as a "(forum)"
 * tag; size tokens like ``4b`` upper-case the B:
 * ``h4cdev/qwen3.5-4b-hope-forum-lora`` → ``Qwen3.5 4B (forum)``.
 * Non-SLM versions map through MODEL_VERSION_FALLBACKS.
 */
export function formatModelLabel(modelVersion: string): string {
    if (MODEL_VERSION_FALLBACKS[modelVersion]) {
        return MODEL_VERSION_FALLBACKS[modelVersion];
    }
    const afterSlash = modelVersion.includes("/")
        ? modelVersion.split("/").pop()!
        : modelVersion;
    const isForum = /-hope-forum/.test(afterSlash);
    const stripped = afterSlash
        .replace(/-lora$/, "")
        .replace(/-hope-(?:only|forum)/g, "")
        // Corpus-processing tag ("intent-tense cleaned"); internal, not
        // facilitator-facing.
        .replace(/-clean\b/g, "");
    const base = stripped
        .split("-")
        .filter(Boolean)
        .map((part) => {
            // Size tokens like "0.6b", "4b" → upper-case the B.
            if (/^\d/.test(part) && part.endsWith("b")) {
                return part.slice(0, -1) + "B";
            }
            if (/^[a-z]/.test(part)) {
                return part[0].toUpperCase() + part.slice(1);
            }
            return part;
        })
        .join(" ");
    return isForum ? `${base} (forum)` : base;
}

/**
 * Classify a /generate failure into an actionable error card. Three
 * tones today: auth (session expired), offline (Space + network +
 * upstream 5xx), or error (everything else — surface the raw detail).
 *
 * Matching is case-insensitive substring on the error message text we
 * receive from the proxy (which itself stringifies the upstream
 * response). The 5xx codes get the same treatment as ECONNREFUSED so
 * facilitators see a single "comment generation is offline" card
 * whether the Space is down, slow, or crashing.
 */
export function classifyGenerateError(message: string): GenerateErrorState {
    const m = message.toLowerCase();
    if (
        m.includes("401") ||
        m.includes("unauthorized") ||
        m.includes("not authenticated")
    ) {
        return {
            tone: "auth",
            title: "Sign in again",
            body: "Your session expired. Refresh the page and sign in to generate drafts.",
        };
    }
    // Must precede the 5xx branch below, which would otherwise swallow
    // this 503 as "offline" — telling the facilitator to wait for a
    // service that is up and busy writing somebody else's draft. The
    // difference matters: one means give up, the other means wait.
    if (m.includes(BUSY_CODE)) {
        return {
            tone: "busy",
            title: "Another draft is generating",
            body: "The reply model handles one request at a time, and a colleague's draft is ahead of yours. This usually clears within a minute — try again shortly.",
        };
    }
    if (
        m.includes("404") ||
        m.includes("not found") ||
        m.includes("econnrefused") ||
        m.includes("fetch failed") ||
        m.includes("failed to fetch") ||
        m.includes("network") ||
        m.includes("etimedout") ||
        m.includes("500") ||
        m.includes("502") ||
        m.includes("503") ||
        m.includes("504") ||
        m.includes("internal server error") ||
        m.includes("bad gateway") ||
        m.includes("service unavailable") ||
        m.includes("gateway timeout")
    ) {
        return {
            tone: "offline",
            title: "AI drafts aren't available right now",
            body: "The reply assistant isn't reachable at the moment. Risk scores and activity still work, and you can write your own reply — try again in a few minutes.",
            detail: message,
        };
    }
    return {
        tone: "error",
        title: "Couldn't generate drafts",
        body: "Something unexpected stopped the drafts. Try again — if it keeps happening, let the programme team know.",
        detail: message,
    };
}

/**
 * What the drafts panel replies to: the participant's newest draftable
 * activity, or the specific post the facilitator clicked in the
 * timeline.
 *
 * Extracted from the panel both for testability and because two
 * honesty bugs lived in the inline version:
 *
 * - An explicit timeline click skipped the Emotions filter that the
 *   auto-pick applies, so a facilitator could target an event the
 *   reply model rejects (no training pairs) — and, once publishing is
 *   live, one that maps to no platform activity type at all.
 * - A missing `activity_type` was silently presented as "GoalSetting".
 *   As a wire default for /generate that is harmless (the service
 *   requires the enum); shown on screen — and later, filed on the
 *   platform — it is a fabricated claim about what the participant
 *   did. `typeKnown` lets the UI say "Activity" instead.
 */
export type ReplyTarget = {
    text: string;
    /** Wire value for /generate — defaulted when unknown. */
    activityType: ActivityType;
    /** False when the event carried no activity_type; render a generic
     *  label rather than the defaulted wire value. */
    typeKnown: boolean;
    daysAgo: number;
    isDiscussion: boolean;
    topicId?: number;
    /** Platform activity id — forwarded on /generate so the service's
     *  memory store can dedupe repeated generations against the same
     *  post. Absent for forum posts and pre-linkage bundles. */
    activityId?: number;
};

export function pickReplyTarget(
    history: ParticipantHistory,
    selectedPostTs: string | null,
): ReplyTarget | null {
    const draftable = (e: ParticipantHistory["events"][number]) =>
        typeof e.description === "string" &&
        e.description.trim().length > 0 &&
        // Emotions removed 2026-05-27 — comment-gen rejects it (no
        // training pairs), and it maps to no platform activity type.
        // Applies to explicit picks too; the timeline still shows
        // Emotions events, they just aren't draftable.
        e.activity_type !== "Emotions";

    // Default auto-pick is the newest draftable ACTIVITY (the primary
    // flow). Discussion/forum posts are never auto-picked — a
    // facilitator opts into replying to one by clicking it in the
    // timeline (sets selectedPostTs).
    const acts = history.events
        .filter((e) => e.event_type === "activity" && draftable(e))
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    const picked = selectedPostTs
        ? history.events.find(
              (e) =>
                  e.timestamp === selectedPostTs &&
                  (e.event_type === "activity" ||
                      e.event_type === "discussion_post") &&
                  draftable(e),
          )
        : undefined;

    const latest = picked ?? acts[0];
    if (!latest) return null;

    // Age is measured against the end of the scoring window, not the
    // wall clock — the same reference every other signal on the page
    // uses. Anchoring to Date.now() made the panel claim a post was
    // "137d ago" while the detail panel, correctly, called the same
    // participant active that week.
    const ageMs =
        scoreWindowEnd(history) - new Date(latest.timestamp).getTime();
    const daysAgo = Math.max(0, Math.floor(ageMs / DAY_MS));
    const isDiscussion = latest.event_type === "discussion_post";
    const typeKnown = isDiscussion || latest.activity_type != null;
    // Forum posts are typed "Discussion" (server-side enum); cast
    // through unknown because the dashboard ActivityType union stays
    // narrow (GoalSetting/Gratitude/MyHOPE) by design.
    const activityType: ActivityType = isDiscussion
        ? ("Discussion" as unknown as ActivityType)
        : ((latest.activity_type as ActivityType | undefined) ??
          "GoalSetting");

    return {
        text: (latest.description ?? "").trim(),
        activityType,
        typeKnown,
        daysAgo,
        isDiscussion,
        topicId: latest.topic_id,
        activityId: latest.activity_id,
    };
}

/**
 * Warm, low-pressure first-contact message for a participant who hasn't
 * posted in the current scoring window. Seeds the "Write my own" editor so
 * a facilitator can act on a silent at-risk participant rather than waiting
 * for a post to AI-draft a reply to.
 *
 * Intentionally a static template, not model output: there's no post to
 * condition on, and a proactive check-in should be the facilitator's own
 * warmth. It mirrors the high-risk wellbeing cue — acknowledge, no pressure,
 * let them set the pace — and is fully editable before sending. Making first
 * contact (a facilitator comment in week 1) is itself a dropout-lowering
 * signal in engagement_ml, so this is the high-value early action.
 */
export function firstContactTemplate(firstName: string | null): string {
    const name = (firstName ?? "").trim() || "there";
    return (
        `Hi ${name}, I noticed it's been a little while since your last visit ` +
        `to Hope, and I wanted to check in — no pressure at all. How have ` +
        `things been? If anything's making it harder to get back to the ` +
        `programme, I'm happy to help in whatever way works for you.`
    );
}
