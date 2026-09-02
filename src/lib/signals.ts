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

/**
 * The instant "how long ago" is measured from: the window end, unless
 * that has not arrived yet, in which case the wall clock.
 *
 * `scoreWindowEnd` is the right anchor for a week being replayed, and
 * its docblock assumes that under a live feed it sits within a day of
 * now. That holds from the second week on. In a cohort's first week the
 * window closes up to seven days in the future, and anything measured
 * against it ages by the days that have not happened: a post from
 * yesterday read "6d ago" in the drafts panel and "7d ago" on the
 * timeline while the queue, on the wall clock, said "1 day ago". Two
 * clocks on one page, which is the exact thing the window-end anchor
 * exists to prevent.
 *
 * `nowMs` is a parameter rather than `Date.now()` read here so callers
 * can hold one value across a render (hydration) and tests can pin it.
 */
export function signalClock(
    history: ParticipantHistory,
    nowMs: number = Date.now(),
): number {
    return Math.min(scoreWindowEnd(history), nowMs);
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
    const end = signalClock(history, now);
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

/** Programme week the scoring window closes in. 1-based, so day 7 is
 *  week 1. Duplicated from `demo-events.ts` rather than imported: this
 *  file is the one with no dependencies, and the copy is one line. */
function weekOf(history: ParticipantHistory): number {
    return Math.max(1, Math.ceil(history.score_at_day / 7));
}

/**
 * Copy for the "Facilitator contact" tile.
 *
 * The tile counts replies inside the scoring window, like everything
 * else in the panel — but it used to describe that count in absolute
 * terms ("no comments yet", "to date this programme"), and the two are
 * not the same claim. A facilitator replied to Mich007 in week 2 of a
 * cohort being replayed at week 1, and the panel then said "0 · no
 * comments yet" directly beside a drafts column showing that very
 * reply. Both halves of the screen were reading the same platform feed
 * and telling the facilitator opposite things.
 *
 * So the tile now separates three states it used to collapse into two:
 * nobody has ever replied; replies happened and all of them fall inside
 * the window; and the window is quiet but replies have landed since.
 * The last one is the one worth saying out loud — it is the difference
 * between "this person has been left alone" and "you are looking at an
 * earlier week".
 *
 * `total` is the unwindowed count from the cohort bundle, which is where
 * the truncation happens (`bundleToHistory` drops events past the
 * window end), so it cannot be recovered from `history` alone.
 */
export function facilitatorContactTile(
    history: ParticipantHistory,
    total: number,
    now: number = Date.now(),
): { value: number; delta: string; tone: "neutral" | "negative" } {
    const inWindow = facilitatorContactCount(history);
    // Never negative, even if a caller passes a stale `total` from a
    // bundle refetched before the history it is paired with.
    const since = Math.max(0, total - inWindow);
    if (total === 0) {
        return { value: 0, delta: "no replies yet", tone: "negative" };
    }
    if (since === 0) {
        // Every reply this person has had falls inside the window, so
        // the windowed count is also the whole story.
        return {
            value: inWindow,
            delta:
                scoreWindowEnd(history) > now
                    ? "to date this programme"
                    : `by end of week ${weekOf(history)}`,
            tone: "neutral",
        };
    }
    // Someone has replied, just not by the checkpoint being viewed. Not
    // a negative tone: the participant has been contacted.
    return {
        value: inWindow,
        delta: `${since} more since week ${weekOf(history)}`,
        tone: "neutral",
    };
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
