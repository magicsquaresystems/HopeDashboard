/**
 * Reading the tokens the Hope Move platform issues.
 *
 * The platform runs an authorization-code exchange: it redirects a
 * facilitator to `/auth/callback?code=…`, we trade that code for an
 * access + refresh pair over a server-to-server call, and from then on
 * we call its API with the access token as a bearer credential.
 *
 * Everything here is pure and dependency-free so it unit-tests in the
 * node-environment Vitest setup with no mocking and no network — see
 * `vitest.config.mts`. The impure parts (the actual exchange, cookie
 * storage) live in `src/auth.ts`.
 *
 * On not verifying the signature
 * ------------------------------
 * `decodeJwtClaims` reads the payload without checking anything. That is
 * deliberate and it is not the same as trusting a token off the wire:
 * this token arrived as the response body of a TLS call we made to a
 * known host, authenticated with our client secret. The transport is the
 * proof. Verifying locally would mean fetching and caching Hope's JWKS to
 * re-establish something we already know, so we read the claims only to
 * learn *who* the platform says this is.
 *
 * A token that arrived any other way must not be passed through here.
 */

/**
 * Refresh this long before the access token actually expires.
 *
 * Covers clock skew between us and the platform, and stops a token
 * expiring mid-flight on a request that was valid when it started.
 */
export const REFRESH_SKEW_MS = 60_000;

export type HopeTokens = {
    accessToken: string;
    refreshToken: string;
    /**
     * Absolute epoch ms, resolved from the wire's relative lifetime, or
     * `null` when the platform sent no lifetime we could read.
     *
     * `null` means unknown, and there is deliberately no substitute
     * value. A previous version invented a 60-second lifetime here,
     * which happened to equal `REFRESH_SKEW_MS` — so `needsRefresh` was
     * `now >= now`, true on the first request after sign-in and every
     * one after it. Since the platform ROTATES refresh tokens, the
     * several requests a page load fires in parallel then raced the same
     * rotation: one won, the rest were handed a token that no longer
     * existed, and the session died about a minute after signing in.
     *
     * The guess was defended as "check again shortly rather than assume
     * it lasts forever", the fear being a facilitator stranded on a dead
     * token. But a dead token is not stranding — it is a 401, which
     * `gateFacilitatorSession` already turns into a clean sign-out with
     * a message. Guessing bought nothing and cost the session, so it is
     * gone: an unknown lifetime now means we do not pre-empt, and the
     * platform remains the authority on when its own token dies.
     */
    expiresAt: number | null;
};

export type HopeFacilitator = {
    /** The platform's own identifier. Stable across email changes. */
    hopeUserId: string;
    email: string;
    name?: string;
};

/**
 * The `user` object the platform returns beside the tokens on both
 * `/exchange` and `/refresh`.
 *
 * Only `userId` is depended on. The other two are read when present and
 * fall back to the access token's claims when not, so a deployment that
 * omits them still signs people in.
 */
export type HopeUser = {
    userId: string;
    email?: string;
    screenName?: string;
};

/**
 * Claim names to try, most standard first.
 *
 * The platform has not published its claim set yet, so this is a
 * documented guess rather than a contract. Once they confirm, collapse
 * each list to the single real name — a lookup chain that outlives the
 * uncertainty quietly starts matching the wrong claim the day they add
 * one.
 */
const ID_CLAIMS = ["sub", "userId", "user_id", "id", "nameid"] as const;
const EMAIL_CLAIMS = ["email", "emailAddress", "preferred_username", "upn"] as const;
const NAME_CLAIMS = ["name", "fullName", "given_name"] as const;

/** Standalone rather than shared with `handoff.ts`: that module owns a
 *  different token format and the two should not move together. */
function decodeBase64Url(segment: string): string {
    const pad =
        segment.length % 4 === 0 ? "" : "=".repeat(4 - (segment.length % 4));
    const b64 = segment.replace(/-/g, "+").replace(/_/g, "/") + pad;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
}

/**
 * The payload segment of a JWT, or `null` if it is not shaped like one.
 * Reads only — see the module docblock on why nothing is verified.
 */
export function decodeJwtClaims(
    token: string,
): Record<string, unknown> | null {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    try {
        const claims: unknown = JSON.parse(decodeBase64Url(parts[1]));
        if (!claims || typeof claims !== "object" || Array.isArray(claims)) {
            return null;
        }
        return claims as Record<string, unknown>;
    } catch {
        return null;
    }
}

function firstString(
    claims: Record<string, unknown>,
    names: readonly string[],
): string | null {
    for (const name of names) {
        const value = claims[name];
        if (typeof value === "string" && value.trim()) return value.trim();
        // Numeric ids are common and JSON-legal; accept them as ids.
        if (typeof value === "number" && Number.isFinite(value)) {
            return String(value);
        }
    }
    return null;
}

/**
 * Who the platform says this is.
 *
 * `user` is the identity sent beside the tokens, and it wins field by
 * field over the access token's claims: those are values the platform
 * chose to send, where the claim names are inferred. Field by field
 * matters — a payload carrying a userId but no screen name should fall
 * through to the claims for that one field, not drag the whole identity
 * back with it.
 *
 * The user id is required; without it we cannot attribute work to anyone
 * in particular. Email is not. When neither source supplies one we
 * synthesise a stable address from the id and warn: attribution stays
 * unique per person while staying obviously artificial in the data, and
 * it fails safe against `FACILITATOR_COHORTS`, matching no entry so
 * `allowlist` mode grants nothing.
 */
export function resolveFacilitator(
    claims: Record<string, unknown>,
    user?: HopeUser | null,
): HopeFacilitator | null {
    const hopeUserId = user?.userId?.trim() || firstString(claims, ID_CLAIMS);
    if (!hopeUserId) return null;

    const email = user?.email?.trim() || firstString(claims, EMAIL_CLAIMS);
    const name =
        user?.screenName?.trim() || firstString(claims, NAME_CLAIMS) || undefined;

    return {
        hopeUserId,
        email: (email ?? `${hopeUserId}@hope.invalid`).toLowerCase(),
        name,
    };
}

/** True when the claims carried no email and one was synthesised. */
export function hasSyntheticEmail(email: string): boolean {
    return email.endsWith("@hope.invalid");
}

/**
 * Absolute expiry from the wire's relative lifetime (seconds), or `null`
 * when there is no lifetime to read.
 *
 * `null` rather than a stand-in: see `HopeTokens.expiresAt`. A caller
 * that cannot act on "unknown" should say so, not be handed a number
 * that looks like knowledge.
 */
export function expiresAtFrom(
    expiresIn: unknown,
    nowMs: number,
): number | null {
    if (expiresIn === null || expiresIn === undefined || expiresIn === "") {
        return null;
    }
    const seconds =
        typeof expiresIn === "number" ? expiresIn : Number(expiresIn);
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    return nowMs + seconds * 1000;
}

/**
 * Is this token close enough to expiry to refresh it now?
 *
 * `null` — no lifetime from the platform — is `false`. We cannot know
 * that an unknown token is nearly dead, and acting as if we did is what
 * caused the refresh storm described on `HopeTokens.expiresAt`. The
 * token is used until the platform rejects it.
 */
export function needsRefresh(
    expiresAt: number | null,
    nowMs: number,
    skewMs: number = REFRESH_SKEW_MS,
): boolean {
    if (expiresAt === null) return false;
    return nowMs >= expiresAt - skewMs;
}

export type HopeTokenResponse = {
    tokens: HopeTokens;
    /** Absent if the platform sent no readable `user` object. */
    user?: HopeUser;
};

/**
 * The `user` object out of a token response.
 *
 * Casing is tried both ways on every field. The platform is ASP.NET and
 * declares these PascalCase; whether they reach the wire camelCased
 * depends on the serializer's naming policy, and guessing wrong would
 * silently drop the identity rather than fail loudly.
 */
function userFromBody(raw: Record<string, unknown>): HopeUser | null {
    const nested = raw.user ?? raw.User;
    if (!nested || typeof nested !== "object" || Array.isArray(nested)) {
        return null;
    }
    const source = nested as Record<string, unknown>;

    const userId = firstString(source, ["userId", "UserId"]);
    if (!userId) return null;

    return {
        userId,
        email: firstString(source, ["email", "Email"]) ?? undefined,
        screenName:
            firstString(source, ["screenName", "ScreenName"]) ?? undefined,
    };
}

/**
 * Validate an `/api/auth/exchange` or `/api/auth/refresh` body.
 *
 * Both endpoints return the same shape, and both rotate the refresh
 * token, so a caller must always store what comes back rather than
 * keeping the token it sent.
 *
 * The token fields are tried in both casings for the same reason the
 * user object's are: the platform declares `AccessToken` / `RefreshToken`
 * / `ExpiresIn` PascalCase, and its error bodies reach the wire that way
 * (`{"Message": …}`), so the success body likely does too.
 */
export function parseTokenResponse(
    body: unknown,
    nowMs: number,
): HopeTokenResponse | null {
    if (!body || typeof body !== "object") return null;
    const raw = body as Record<string, unknown>;
    const accessToken = firstString(raw, ["accessToken", "AccessToken"]);
    const refreshToken = firstString(raw, ["refreshToken", "RefreshToken"]);
    if (!accessToken || !refreshToken) return null;
    // `expires_in` is the OAuth 2.0 spelling and the likeliest thing a
    // .NET token endpoint emits; the other two cover the serializer
    // naming policies we already know this platform uses. Reading the
    // lifetime under any of its plausible names is the difference
    // between a proactive refresh and none at all.
    const expiresAt = expiresAtFrom(
        raw.expiresIn ?? raw.ExpiresIn ?? raw.expires_in,
        nowMs,
    );
    if (expiresAt === null) {
        // Loudly, and once per token: this is a contract gap, and
        // without naming the keys the platform DID send, the next person
        // to look at it is back to guessing. Not an error — the token is
        // still usable, we simply will not pre-empt its expiry.
        console.warn(
            "hope auth: token response carried no readable lifetime " +
                "(expiresIn / ExpiresIn / expires_in); proactive refresh " +
                `is off for this token. Keys present: ${Object.keys(raw).join(", ")}`,
        );
    }
    return {
        tokens: { accessToken, refreshToken, expiresAt },
        user: userFromBody(raw) ?? undefined,
    };
}
