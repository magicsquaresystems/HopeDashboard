/**
 * Ordering for the queue in a cohort's first week, before any score exists.
 *
 * A cohort under seven days old has no elapsed week, so the risk model is
 * withheld rather than handed a mostly-empty window that reads as total
 * disengagement (see `useCohortScoring`). Withholding the *scores* was
 * right; withholding the *people* was not. The queue built its rows from
 * predictions alone, so a brand-new cohort listed nobody — no row to
 * select, so no detail panel and no drafts — while participants were
 * posting on day one, which is exactly when a welcome reply lands best.
 *
 * So the roster lists everyone, ordered by the only signal that needs no
 * model: who posted most recently.
 *
 * This is deliberately NOT a risk proxy, and the queue labels these rows
 * "Not scored yet" rather than giving them a tier. Recency is something
 * a facilitator can confirm with their own eyes on Hope; dressing it up
 * as risk would invent the number the model just declined to give.
 */

import type { ParticipantHistory } from "@/lib/api/dropout";

/**
 * When this participant last did anything, as an ISO timestamp.
 *
 * `events` arrives sorted in practice but is not guaranteed to be, and a
 * single out-of-order row would otherwise silently mis-sort the roster,
 * so the maximum is taken rather than the last element.
 */
export function lastEventAt(history: ParticipantHistory): string | null {
    let latest: string | null = null;
    for (const e of history.events ?? []) {
        const t = e.timestamp;
        if (typeof t !== "string" || t === "") continue;
        if (latest === null || t > latest) latest = t;
    }
    return latest;
}

/**
 * Most recently active first; participants who have done nothing at all
 * go last.
 *
 * Those silent participants are arguably the ones worth chasing, but
 * there is nothing to reply *to* yet and no score to justify ranking
 * them — so they sit at the bottom where they are still reachable rather
 * than at the top implying an urgency nothing has established.
 *
 * Ties break on participant id purely for determinism: without it the
 * order could differ between two renders of identical data, and rows
 * would swap under the facilitator's cursor.
 */
export function rosterOrder(
    histories: readonly ParticipantHistory[],
): ParticipantHistory[] {
    return [...histories].sort((a, b) => {
        const ta = lastEventAt(a);
        const tb = lastEventAt(b);
        if (ta !== tb) {
            if (ta === null) return 1;
            if (tb === null) return -1;
            return tb.localeCompare(ta);
        }
        return a.participant_id.localeCompare(b.participant_id);
    });
}
