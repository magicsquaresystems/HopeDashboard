/**
 * Pure helpers used by the Drafts panel — extracted so Vitest can import
 * them in a Node environment without dragging in the React/Next tree.
 *
 * These functions exist here exactly so the failure surfaces they own
 * (error classification, model labelling, email gating) get unit-tested
 * directly rather than being verified only by Playwright walking the UI.
 */

import type { RiskLevel } from "@/lib/api/dropout";

/**
 * Shape of the error card rendered when /generate fails. The tone drives
 * the colour token and copy; title/body are user-facing strings.
 */
export type GenerateErrorState = {
    tone: "offline" | "auth" | "error" | "busy";
    title: string;
    body: string;
};

/** Substring the service puts in its 503 body when the decode queue is
 *  full. Matched before the generic 5xx branch — see below. */
export const BUSY_CODE = "generation_busy";

/**
 * Friendly labels for non-SLM ``model_version`` strings we ship from
 * the comment-gen service. Anything not in this map falls through to
 * the namespace-stripped repo id.
 */
export const MODEL_VERSION_FALLBACKS: Record<string, string> = {
    "stub-disabled": "stub (kill-switch)",
    "safety-block": "safety block",
    "error-fallback": "fallback",
    "legacy-stub": "legacy stub",
};

/**
 * Family-name overrides for token-by-token title-casing. Default
 * behaviour ("smollm3" -> "Smollm3") loses the canonical internal
 * capitalisation; this map preserves the publisher-preferred form.
 * Keys are lower-cased; values are exact replacements applied as the
 * first token of a stripped model id.
 */
const FAMILY_DISPLAY_OVERRIDES: Record<string, string> = {
    smollm: "SmolLM",
    smollm2: "SmolLM2",
    smollm3: "SmolLM3",
    smollm4: "SmolLM4",
    minicpm: "MiniCPM",
    tinyllama: "TinyLlama",
};

/**
 * Render the badge label for a draft response's ``model_version`` field.
 *
 * Goal: surface the base model identity and training corpus to the
 * facilitator, not the internal roster suffix. "-hope-only" is dropped as
 * UI noise; "-hope-forum" instead shows a "(forum)" tag.
 *
 *  - Hub ids (``namespace/repo``) drop the namespace, the ``-lora``
 *    suffix, the ``-hope-only`` segment, AND training-version tokens
 *    like ``-v5``: ``michaelajao/qwen3-1.7b-hope-only-lora`` →
 *    ``Qwen3 1.7B``; ``michaelajao/qwen3-4b-hope-only-v5-lora`` →
 *    ``Qwen3 4B``. The version is an internal training-iteration tag,
 *    not something a facilitator needs to see.
 *  - Tokens that look like a size (``1.7b``, ``4b``) get an upper-case
 *    ``B``. Other alphabetic tokens are title-cased.
 *  - Non-SLM versions (the kill-switch / safety / fallback strings) get
 *    their friendly mapping from MODEL_VERSION_FALLBACKS.
 */
export function formatModelLabel(modelVersion: string): string {
    if (MODEL_VERSION_FALLBACKS[modelVersion]) {
        return MODEL_VERSION_FALLBACKS[modelVersion];
    }
    const afterSlash = modelVersion.includes("/")
        ? modelVersion.split("/").pop()!
        : modelVersion;
    // Forum-trained adapters carry a "-hope-forum" segment; surface it as a
    // "(forum)" suffix to match the picker. "-hope-only" stays a silent strip.
    const isForum = /-hope-forum/.test(afterSlash);
    const stripped = afterSlash
        .replace(/-lora$/, "")
        .replace(/-hope-(?:only|forum)/g, "")
        // Drop training-iteration version tokens (e.g. "-v5"). Internal
        // tag; not facilitator-facing.
        .replace(/-v\d+/g, "");
    const base = stripped
        .split("-")
        .filter(Boolean)
        .map((part, idx) => {
            // First-token family-name override preserves canonical
            // internal capitalisation that title-casing would lose
            // (e.g. "smollm3" -> "SmolLM3" not "Smollm3").
            if (idx === 0 && FAMILY_DISPLAY_OVERRIDES[part]) {
                return FAMILY_DISPLAY_OVERRIDES[part];
            }
            // Size tokens like "1.7b", "4b", "0.6b" → upper-case the B.
            if (/^\d/.test(part) && part.endsWith("b")) {
                return part.slice(0, -1) + "B";
            }
            // Family / other alphabetic tokens — title-case.
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
            title: "Comment generation is offline",
            body: "The fine-tuned reply model isn't reachable right now. Risk scoring and activity views still work — try again once the Space is back.",
        };
    }
    return {
        tone: "error",
        title: "Couldn't generate drafts",
        body: message,
    };
}

/**
 * Deterministic placeholder address for the "Send by email" mailto:
 * link. The ``.invalid`` TLD (RFC 6761) guarantees the address never
 * resolves to a real inbox, so a stray Send during demo/testing can't
 * accidentally email anyone.
 *
 * Production wiring: replace with ``bundle.participants[id].email``
 * once the platform export includes a real email field.
 */
export function placeholderEmail(
    participantId: string | null,
    cohortId: number | string,
): string | null {
    if (!participantId) return null;
    return `participant-${participantId}@cohort-${cohortId}.hope-test.invalid`;
}

/**
 * Gate the Send-by-email action to disengaged participants. Email is
 * only useful when the participant isn't active in-app — on-track
 * (low-risk) participants get in-app message only. Needs-attention
 * (high) + check-in-soon (medium) qualify.
 *
 * Returns null when the participant doesn't qualify; that hides the
 * "Send by email" menuitem in DraftCard.
 */
export function emailForDisengaged(
    participantId: string | null,
    cohortId: number | string,
    riskLevel: RiskLevel | undefined,
): string | null {
    if (riskLevel !== "high" && riskLevel !== "medium") return null;
    return placeholderEmail(participantId, cohortId);
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
