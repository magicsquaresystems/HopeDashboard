/**
 * Pure helpers over `ParticipantHistory`. The detail panel's metric tiles,
 * the AI-summary card, and the queue's "Last active" line all derive from
 * these functions so the platform-feed swap later changes one file.
 *
 * No React imports, no hooks — call from anywhere.
 */

import type { ParticipantHistory, RiskLevel } from "@/lib/api/dropout";

/** Milliseconds in a day. Exported so callers don't redefine the
 *  constant in five different places (component clocks, store TTLs,
 *  demo-event back-dating). */
export const DAY_MS = 86_400_000;

export type EngagementTrend = "Declining" | "Stable" | "Improving";
export type ActivationLevel = "Low" | "Medium" | "High";

/**
 * The instant the current scoring window closes — the "now" every signal
 * on the page is measured against.
 *
 * Deliberately NOT `Date.now()`. The week selector replays how a cohort
 * looked at an earlier checkpoint, so "last active" and any trailing
 * window have to be relative to that checkpoint or the panel mixes two
 * different clocks. Under a live feed, scoring at the current week puts
 * this within a day of wall-clock time, so the same code is correct in
 * both modes. Exported so non-signal callers (the drafts panel's post
 * age) can share the one clock instead of reaching for `Date.now()`.
 */
export function scoreWindowEnd(history: ParticipantHistory): number {
    return (
        new Date(history.effective_start).getTime() +
        history.score_at_day * DAY_MS
    );
}

function sortedTimestamps(history: ParticipantHistory): number[] {
    return history.events
        .map((e) => new Date(e.timestamp).getTime())
        .sort((a, b) => a - b);
}

export function daysSinceLastEvent(history: ParticipantHistory): number {
    const stamps = sortedTimestamps(history);
    if (stamps.length === 0) return history.score_at_day;
    const last = stamps[stamps.length - 1];
    return Math.max(0, Math.floor((scoreWindowEnd(history) - last) / DAY_MS));
}

export function lastActiveLabel(history: ParticipantHistory): string {
    const d = daysSinceLastEvent(history);
    if (d === 0) return "Active today";
    if (d === 1) return "Last active 1 day ago";
    return `Last active ${d} days ago`;
}

/**
 * Count events of a given `event_type` in a trailing N-day window ending at
 * `score_at_day`. Returns the count and the percentage delta vs. the prior
 * N-day window. Delta is null when the prior window has zero events (the
 * percentage would be undefined).
 */
export function eventsLastNDays(
    history: ParticipantHistory,
    eventType: string,
    nDays: number,
): { count: number; deltaPercent: number | null } {
    const end = scoreWindowEnd(history);
    const windowStart = end - nDays * DAY_MS;
    const priorStart = end - 2 * nDays * DAY_MS;

    let count = 0;
    let prior = 0;
    for (const e of history.events) {
        if (e.event_type !== eventType) continue;
        const ts = new Date(e.timestamp).getTime();
        if (ts >= windowStart && ts < end) count += 1;
        else if (ts >= priorStart && ts < windowStart) prior += 1;
    }
    const deltaPercent =
        prior === 0 ? null : Math.round(((count - prior) / prior) * 100);
    return { count, deltaPercent };
}

export function distinctActivityTypes(
    history: ParticipantHistory,
    nDays: number,
): number {
    const end = scoreWindowEnd(history);
    const windowStart = end - nDays * DAY_MS;
    const types = new Set<string>();
    for (const e of history.events) {
        if (e.event_type !== "activity" || !e.activity_type) continue;
        const ts = new Date(e.timestamp).getTime();
        if (ts >= windowStart && ts < end) types.add(e.activity_type);
    }
    return types.size;
}

export function facilitatorContactCount(history: ParticipantHistory): number {
    return history.events.filter((e) => e.event_type === "facilitator_comment")
        .length;
}

/**
 * Compare event volume in the latest 2-week window vs. the prior 2-week
 * window. Threshold is intentionally generous (15% swing) so "Stable" is
 * the common case, not the rare one.
 */
export function engagementTrend(history: ParticipantHistory): EngagementTrend {
    const end = scoreWindowEnd(history);
    const recent = end - 14 * DAY_MS;
    const prior = end - 28 * DAY_MS;

    let r = 0;
    let p = 0;
    for (const e of history.events) {
        const ts = new Date(e.timestamp).getTime();
        if (ts >= recent && ts < end) r += 1;
        else if (ts >= prior && ts < recent) p += 1;
    }
    // Both windows empty AND participant hasn't been seen recently —
    // they're disengaged, not "stable at zero". Calling it Stable would
    // misrepresent total silence in the metric tile.
    if (p === 0 && r === 0)
        return daysSinceLastEvent(history) >= 14 ? "Declining" : "Stable";
    if (p === 0) return r > 0 ? "Improving" : "Stable";
    const delta = (r - p) / p;
    if (delta < -0.15) return "Declining";
    if (delta > 0.15) return "Improving";
    return "Stable";
}

/**
 * Activation derives from the risk tier when one is available — High risk
 * means the participant is barely engaging, so activation is Low. When no
 * prediction is available (cold start, partial history) we fall back to
 * scanning factor strings, but only with conservative high-confidence
 * keywords; the prior `\b(active)\b` HIGH match was a false-positive trap
 * because engagement_ml's "Returning across multiple days" factor reads as
 * activity even for participants with declining engagement.
 */
const LOW_RX = /\b(few|inactive|silent|delayed|none|no |slow|down|low|stopped|gone)\b/i;
const HIGH_RX = /\b(strong|engaged|first day|consistent|rich)\b/i;

export function activationLevel(
    factors: string[],
    riskLevel?: RiskLevel | null,
): ActivationLevel {
    if (riskLevel === "high") return "Low";
    if (riskLevel === "medium") return "Medium";
    if (riskLevel === "low") return "High";
    if (factors.some((f) => HIGH_RX.test(f))) return "High";
    if (factors.some((f) => LOW_RX.test(f))) return "Low";
    return "Medium";
}

/**
 * Best-effort display name. Synthetic ids like `iih-coh12-001` collapse to
 * `P1`. Real platform ids will pass through unchanged — replace with a
 * lookup once the platform feed lands.
 */
export function displayName(participantId: string): string {
    // Fallback when the cohort bundle isn't available. Inside React
    // components prefer `useBundleDisplayName(participantId)` from
    // `@/lib/hooks/displayName` — that returns the bundle's
    // sequential alias (e.g. "P26") which is the canonical short
    // label across the dashboard. This helper is only for non-React
    // call sites or rendering before the bundle has loaded.
    const m = participantId.match(/(\d+)$/);
    if (m) return `P${parseInt(m[1], 10)}`;
    return participantId;
}

/** A small bundle of derived signals the AI-summary template needs. */
export type SignalSnapshot = {
    daysSinceLastEvent: number;
    daysSinceLastLogin: number;
    discussionLastWindow: { count: number; deltaPercent: number | null };
    engagementTrend: EngagementTrend;
    facilitatorContact: number;
    distinctActivityTypes14d: number;
    activation: ActivationLevel;
    riskLevel: RiskLevel | null;
};

export function buildSnapshot(
    history: ParticipantHistory,
    factors: string[],
    riskLevel: RiskLevel | null,
): SignalSnapshot {
    return {
        daysSinceLastEvent: daysSinceLastEvent(history),
        daysSinceLastLogin: (() => {
            const logins = history.events.filter((e) => e.event_type === "login");
            if (logins.length === 0) return history.score_at_day;
            const last = Math.max(
                ...logins.map((e) => new Date(e.timestamp).getTime()),
            );
            return Math.max(
                0,
                Math.floor((scoreWindowEnd(history) - last) / DAY_MS),
            );
        })(),
        discussionLastWindow: eventsLastNDays(history, "discussion_post", 14),
        engagementTrend: engagementTrend(history),
        facilitatorContact: facilitatorContactCount(history),
        distinctActivityTypes14d: distinctActivityTypes(history, 14),
        activation: activationLevel(factors, riskLevel),
        riskLevel,
    };
}
