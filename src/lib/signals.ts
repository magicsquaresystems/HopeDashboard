/**
 * Pure helpers over `ParticipantHistory`. The detail panel's metric tiles
 * and the queue's "Last active" line all derive from these functions so
 * the platform-feed swap later changes one file.
 *
 * No React imports, no hooks — call from anywhere.
 */

import type { ParticipantHistory, RiskLevel } from "@/lib/api/dropout";

/** Milliseconds in a day. Exported so callers don't redefine the
 *  constant in five different places (component clocks, store TTLs,
 *  demo-event back-dating). */
export const DAY_MS = 86_400_000;

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

/**
 * Whole days between the participant's most recent event and the scoring
 * window's close. `null` when the participant has no events at all —
 * "never active" is a different fact from "active N days ago", and the
 * old fallback of returning `score_at_day` fabricated a day-0 event that
 * rendered as "Last active 42 days ago" for people who never showed up.
 *
 * Measured against the window's close rather than today on purpose: at
 * week 3 of a finished cohort the honest statement is how quiet someone
 * was *at that checkpoint*, not how long ago the cohort ended.
 *
 * But the close is capped at `now`, because a window that has not
 * finished yet cannot have elapsed. In a cohort's first week the
 * selected week closes on day 7 — up to six days in the future — and
 * without the cap someone who posted this morning was reported as "Last
 * active 6 days ago". Nobody can be inactive for time that has not
 * happened.
 */
export function daysSinceLastEvent(
    history: ParticipantHistory,
    now: number = Date.now(),
): number | null {
    const stamps = sortedTimestamps(history);
    if (stamps.length === 0) return null;
    const last = stamps[stamps.length - 1];
    const end = Math.min(scoreWindowEnd(history), now);
    return Math.max(0, Math.floor((end - last) / DAY_MS));
}

export function lastActiveLabel(
    history: ParticipantHistory,
    now: number = Date.now(),
): string {
    const d = daysSinceLastEvent(history, now);
    if (d === null) return "No activity yet";
    if (d === 0) return "Active today";
    if (d === 1) return "Last active 1 day ago";
    return `Last active ${d} days ago`;
}

/**
 * Count events of a given `event_type` in a trailing N-day window ending at
 * `score_at_day`. Returns the count and the percentage delta vs. the prior
 * N-day window.
 *
 * Delta is null in two cases where a percentage would mislead:
 *  - the prior window has zero events (undefined percentage), or
 *  - the prior window is not fully inside the programme
 *    (`score_at_day < 2 * nDays`). Events before `effective_start` do not
 *    exist, so early weeks would compare a full window against a
 *    truncated one — a flat participant read "+200%" at week 3.
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
    const priorWindowComplete = history.score_at_day >= 2 * nDays;
    const deltaPercent =
        !priorWindowComplete || prior === 0
            ? null
            : Math.round(((count - prior) / prior) * 100);
    return { count, deltaPercent };
}

export function facilitatorContactCount(history: ParticipantHistory): number {
    return history.events.filter((e) => e.event_type === "facilitator_comment")
        .length;
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
