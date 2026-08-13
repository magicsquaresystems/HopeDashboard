/**
 * Templated AI-summary builder. Deterministic, server-side-safe (no
 * hooks), and zero extra network calls — the detail panel renders the
 * paragraph the moment the prediction lands.
 *
 * The trend clause leads with the dominant signal:
 *   - silent throughout: "has not started engaging"
 *   - dropped to zero recently: "has gone quiet"
 *   - otherwise: the trend window comparison
 *
 * Swap to a model-generated summary later by replacing buildSummary's
 * return value; the calling component contract stays the same.
 */

import type { SignalSnapshot } from "@/lib/signals";

function leadingClause(snap: SignalSnapshot): string {
    if (snap.daysSinceLastLogin >= 21)
        return "has gone quiet — no recent activity at all";
    if (snap.engagementTrend === "Declining")
        return "has declined over the past two weeks";
    if (snap.engagementTrend === "Improving")
        return "has been picking up over the past two weeks";
    return "has held steady over the past two weeks";
}

function loginClause(snap: SignalSnapshot): string {
    if (snap.daysSinceLastLogin >= 14)
        return `they have not logged in for ${snap.daysSinceLastLogin} days`;
    if (snap.daysSinceLastLogin >= 3)
        return `their last login was ${snap.daysSinceLastLogin} days ago`;
    return "they are still logging in regularly";
}

function discussionClause(snap: SignalSnapshot): string {
    const { count, deltaPercent } = snap.discussionLastWindow;
    if (count === 0) return "discussion posts have stopped";
    if (deltaPercent !== null && deltaPercent <= -50)
        return `discussion posts are down ${Math.abs(deltaPercent)}%`;
    if (deltaPercent !== null && deltaPercent >= 50)
        return `discussion posts are up ${deltaPercent}%`;
    return "discussions are ticking over at the usual pace";
}

function outreachClause(snap: SignalSnapshot): string {
    if (snap.riskLevel === "high")
        return "A low-effort, supportive check-in may help re-engage them.";
    if (snap.riskLevel === "medium")
        return "A short nudge with one concrete next step is a fitting response.";
    if (snap.riskLevel === "low")
        return "Keep things light — a quick acknowledgement is usually enough.";
    return "";
}

export function buildSummary(name: string, snap: SignalSnapshot): string {
    const sentence1 = `${name}'s engagement ${leadingClause(snap)}.`;
    const sentence2 =
        snap.daysSinceLastLogin >= 3
            ? `${capitalize(loginClause(snap))} and ${discussionClause(snap)}.`
            : `${capitalize(discussionClause(snap))}, and ${loginClause(snap)}.`;
    const sentence3 = outreachClause(snap);
    return [sentence1, sentence2, sentence3].filter(Boolean).join(" ");
}

function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}
