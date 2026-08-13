/**
 * Helpers derived from a real `ParticipantHistory`.
 *
 * Previously this module also produced synthetic event streams when the
 * local cohort bundle wasn't on disk. That fallback has been removed —
 * the dashboard now requires the real bundle (`local/iih-coh12-110226.json`,
 * produced by `scripts/extract-iih-cohort.mjs`) and refuses to fabricate
 * data when it's missing.
 *
 * What's left:
 *  - `seedHash`     — deterministic avatar colouring.
 *  - `weekNumber`   — programme-week derivation for the comment-gen prompt.
 *  - `demoEngagementContext` — cheap aggregates surfaced alongside risk for
 *    the comment-gen prompt. Name kept for import-site stability; the data
 *    is real now, not demo.
 */

import type { ParticipantHistory } from "@/lib/api/dropout";

export function seedHash(s: string): number {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return Math.abs(h);
}

function addDays(d: Date, days: number, hourOffset = 9): Date {
    const out = new Date(d);
    out.setUTCDate(out.getUTCDate() + Math.floor(days));
    out.setUTCHours(hourOffset, 0, 0, 0);
    return out;
}

/**
 * Best-effort engagement-context fields for the comment-gen prompt.
 * engagement_ml itself returns calibrated risk + factors via the typed
 * client; this helper just derives a few cheap aggregates from the
 * participant's real history so the LLM gets richer prompt context.
 */
export function demoEngagementContext(history: ParticipantHistory | null) {
    if (!history) return undefined;
    const sorted = [...history.events].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
    const last = sorted.at(-1);
    const lastLogin = [...sorted]
        .reverse()
        .find((e) => e.event_type === "login");
    const lastActivity = [...sorted]
        .reverse()
        .find((e) => e.event_type === "activity");

    const cumLogins = sorted.filter((e) => e.event_type === "login").length;
    const cumActivities = sorted.filter(
        (e) => e.event_type === "activity",
    ).length;
    // Distinct URLs actually visited. Bundles carry `page_url` since the
    // page-metadata extractor change; events without it (older bundles)
    // fall back to a per-event key, degrading to a visit count — the
    // pre-fix behaviour, where `p${i}` made every event "unique".
    const uniquePages = new Set(
        sorted
            .filter((e) => e.event_type === "page_visit")
            .map((e, i) => e.page_url ?? `p${i}`),
    ).size;

    const start_ms = new Date(history.effective_start).getTime();
    const score_at_ms = addDays(
        new Date(history.effective_start),
        history.score_at_day,
    ).getTime();
    const dayMs = 86_400_000;
    const firstWeekEnd = start_ms + 7 * dayMs;
    const wroteFirstWeek = sorted.some(
        (e) =>
            e.event_type === "activity" &&
            new Date(e.timestamp).getTime() < firstWeekEnd,
    );
    // Early facilitator contact is a dropout-lowering signal the contract
    // asks for (`received_comment_first_week_binary`); previously never
    // sent.
    const receivedCommentFirstWeek = sorted.some(
        (e) =>
            e.event_type === "facilitator_comment" &&
            new Date(e.timestamp).getTime() < firstWeekEnd,
    );

    const halfMs = (score_at_ms - start_ms) / 2;
    const half = start_ms + halfMs;
    let firstHalf = 0;
    let secondHalf = 0;
    for (const e of sorted) {
        const ts = new Date(e.timestamp).getTime();
        if (ts < half) firstHalf += 1;
        else secondHalf += 1;
    }
    const denom = Math.max(firstHalf, 1);
    const engagementSlope = (secondHalf - firstHalf) / denom;

    const daysSince = (ts: string) =>
        Math.max(0, Math.floor((score_at_ms - new Date(ts).getTime()) / dayMs));

    return {
        days_since_last_login: lastLogin
            ? daysSince(lastLogin.timestamp)
            : history.score_at_day,
        days_since_last_activity: lastActivity
            ? daysSince(lastActivity.timestamp)
            : history.score_at_day,
        current_inactive_streak: last
            ? daysSince(last.timestamp)
            : history.score_at_day,
        cum_login_count: cumLogins,
        cum_activity_count: cumActivities,
        cum_unique_pages: uniquePages,
        wrote_first_week_binary: (wroteFirstWeek ? 1 : 0) as 0 | 1,
        received_comment_first_week_binary: (receivedCommentFirstWeek
            ? 1
            : 0) as 0 | 1,
        engagement_slope: engagementSlope,
    };
}

/**
 * Week number (1-based) within the participant's programme, derived from
 * `score_at_day`. Useful for the comment-gen prompt so the model knows
 * "this is week 6 messaging" vs "this is week 1 onboarding".
 */
export function weekNumber(history: ParticipantHistory | null): number | undefined {
    if (!history) return undefined;
    return Math.max(1, Math.ceil(history.score_at_day / 7));
}
