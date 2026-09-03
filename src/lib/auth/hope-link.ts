/**
 * What state a session's link to the Hope Move platform is in.
 *
 * Split out of `hope-session.ts` because that module could only answer
 * "are there usable tokens?" — it returned `null` both for a hand-off
 * session that never had any and for a platform session whose refresh
 * had just failed. Those two must not be treated alike:
 *
 *   none    → hand-off sign-in. Falling back to env/database cohort
 *             assignment is correct.
 *   linked  → usable platform credentials.
 *   broken  → minted through the platform, but the tokens are gone.
 *
 * Collapsing `broken` into `none` is what let a dead link WIDEN access:
 * `hopeCohorts()` returned null, `cohortsForFacilitator` read that as
 * "the platform is not the source here" and fell through to open mode,
 * which lists every cohort. A facilitator the platform had just stopped
 * vouching for ended up seeing more than one it still trusted.
 */

export type HopeLinkState = "none" | "linked" | "broken";

/** The JWT fields this decision reads. */
export type LinkableJwt = {
    hopeUserId?: unknown;
    hope?: {
        accessToken?: unknown;
        refreshToken?: unknown;
        expiresAt?: unknown;
    } | null;
} | null;

export function classifyHopeLink(jwt: LinkableJwt): HopeLinkState {
    if (typeof jwt?.hopeUserId !== "string" || jwt.hopeUserId === "") {
        return "none";
    }

    // Every field is checked, not just presence of `hope`: a partially
    // written token is not a usable credential, and treating it as
    // "linked" would send an undefined bearer to the platform. The same
    // checks `hopeSession()` has always made — kept identical so the two
    // can never disagree about what "usable" means.
    const hope = jwt.hope;
    // `expiresAt` may legitimately be null — the platform did not tell
    // us the lifetime — and a token whose expiry is unknown is still a
    // usable credential. What is not usable is the field being absent
    // or some other type, which means a partially written token.
    const usable =
        !!hope &&
        typeof hope.accessToken === "string" &&
        typeof hope.refreshToken === "string" &&
        (typeof hope.expiresAt === "number" || hope.expiresAt === null);

    return usable ? "linked" : "broken";
}
