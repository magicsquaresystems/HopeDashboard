/**
 * Facilitator ids beyond the ones the platform documents reveal.
 *
 * `buildFacilitatorIdSet` only knows someone is staff once they have
 * written a facilitator comment, so a co-facilitator who has not posted
 * yet sits in the follow-up queue as a participant who has never taken
 * part. Two cheap sources close most of that gap until the platform sends
 * a `facilitators` collection per cohort (agreed with Magic Square,
 * 22 Oct 2026): the facilitator who is signed in, and an operator list in
 * `HOPE_FACILITATOR_USER_IDS`.
 */

/** Comma-separated platform user ids. Anything non-numeric is ignored. */
export function parseFacilitatorIds(raw: string | undefined): number[] {
    if (!raw) return [];
    return raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => /^\d+$/.test(s))
        .map(Number);
}

/**
 * The comment-author set widened with extra ids.
 *
 * Platform user ids arrive as JSON numbers, so the set the bundle builder
 * checks against is keyed by number; `hopeUserId` comes off the session as
 * a string. Normalising here, once, keeps a string "123" from silently
 * failing to match a numeric 123.
 */
export function withExtraFacilitators(
    base: Set<unknown>,
    extra: readonly (string | number | null | undefined)[],
): Set<unknown> {
    const out = new Set(base);
    for (const id of extra) {
        const n = typeof id === "number" ? id : Number(String(id ?? "").trim());
        if (Number.isSafeInteger(n) && n > 0) out.add(n);
    }
    return out;
}
