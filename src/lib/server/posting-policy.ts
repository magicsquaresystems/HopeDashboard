/**
 * Whether this deployment may publish a facilitator's reply to a
 * participant, and to which cohorts.
 *
 * This is the only place in the dashboard where a mistake reaches a real
 * person on a health programme, so it is deliberately the most
 * suspicious code here. Everything else the app produces is a number on
 * a screen or a research row; a reply published to the wrong cohort is a
 * message to someone that cannot be taken back.
 *
 * Three gates, each closing a different way of getting it wrong:
 *
 *   1. `HOPE_ENABLE_POST_COMMENT=1` — this deployment may post at all.
 *   2. `HOPE_POST_COMMENT_COHORTS` — which cohorts, by id or by code.
 *      REQUIRED whenever the flag is on: setting the flag and forgetting
 *      the list refuses every cohort rather than opening all of them.
 *      The failure mode of this pair has to be silence, not a message.
 *      `*` opens everything and is the deliberate go-live act, spelled
 *      out so nobody arrives there by omission.
 *   3. `HOPE_POST_COMMENT_DRY_RUN=1` — run every check and build the
 *      real payload, then log it and stop instead of calling the
 *      platform. This is how the whole path gets exercised, including
 *      the UI, without a single real message leaving the building.
 *
 * ## Why cohort codes are accepted, and preferred
 *
 * Ids are opaque and adjacent: mistyping 1731 as 1231 is one keystroke,
 * and 1231 is very likely another real cohort with real participants in
 * it. A code such as MICHAEL-TEST-210826 is self-documenting, and a typo
 * in one simply matches nothing and refuses. Both forms are accepted so
 * an operator can use whichever the console in front of them shows, but
 * the code is the safer thing to write and the one the docs recommend.
 */

export type PostingPolicy = {
    enabled: boolean;
    dryRun: boolean;
    /** `"all"` only ever comes from an explicit `*`. */
    allow: "all" | { ids: ReadonlySet<number>; codes: ReadonlySet<string> };
};

/** A cohort as this gate needs to see it. */
export type CohortIdentity = { id: number; code?: string };

/**
 * Split the allowlist into ids and codes.
 *
 * An entry counts as an id only if it is ALL DIGITS. `Number()` is not
 * used for that test because it accepts forms the platform never issues
 * and a human never means: `"1e3"` becomes 1000, so a fat-fingered
 * exponent would quietly allowlist whatever cohort 1000 happens to be.
 * Anything not all-digits is kept as a code, which fails closed — an
 * unmatched code allows nothing.
 */
export function parseCohortAllowlist(
    raw: string | undefined,
): "all" | { ids: Set<number>; codes: Set<string> } {
    const trimmed = raw?.trim();
    if (!trimmed) return { ids: new Set(), codes: new Set() };
    if (trimmed === "*") return "all";

    const ids = new Set<number>();
    const codes = new Set<string>();

    for (const part of trimmed.split(",")) {
        const token = part.trim();
        if (!token) continue;

        if (/^\d+$/.test(token)) {
            const id = Number(token);
            if (Number.isSafeInteger(id) && id > 0) {
                ids.add(id);
            } else {
                console.error(
                    `HOPE_POST_COMMENT_COHORTS: ignoring "${token}", which is ` +
                        "not a usable cohort id.",
                );
            }
            continue;
        }

        // Codes compare case-insensitively; the platform writes them
        // upper-case but an operator may not.
        codes.add(token.toUpperCase());
    }

    return { ids, codes };
}

export function postingPolicy(
    env: Record<string, string | undefined> = process.env,
): PostingPolicy {
    return {
        enabled: env.HOPE_ENABLE_POST_COMMENT === "1",
        dryRun: env.HOPE_POST_COMMENT_DRY_RUN === "1",
        allow: parseCohortAllowlist(env.HOPE_POST_COMMENT_COHORTS),
    };
}

export function isPostingAllowedFor(
    policy: PostingPolicy,
    cohort: CohortIdentity,
): boolean {
    if (!policy.enabled) return false;
    if (policy.allow === "all") return true;
    if (policy.allow.ids.has(cohort.id)) return true;
    const code = cohort.code?.trim().toUpperCase();
    return Boolean(code && policy.allow.codes.has(code));
}
