import { describe, expect, it } from "vitest";

import {
    decodeJwtClaims,
    expiresAtFrom,
    hasSyntheticEmail,
    needsRefresh,
    parseTokenResponse,
    REFRESH_SKEW_MS,
    resolveFacilitator,
} from "@/lib/auth/hope-token";

/** Builds a JWT-shaped string. The signature is never checked (see the
 *  module docblock), so a placeholder is honest here rather than lazy. */
function jwtWith(claims: Record<string, unknown>): string {
    const b64url = (s: string) =>
        btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return [
        b64url(JSON.stringify({ alg: "RS256", typ: "JWT" })),
        b64url(JSON.stringify(claims)),
        "not-checked",
    ].join(".");
}

describe("decodeJwtClaims", () => {
    it("reads the payload segment", () => {
        expect(decodeJwtClaims(jwtWith({ sub: "u-1", email: "a@b.org" }))).toEqual(
            { sub: "u-1", email: "a@b.org" },
        );
    });

    it("returns null for anything not shaped like a JWT", () => {
        expect(decodeJwtClaims("opaque-token")).toBeNull();
        // Two segments is the hand-off token's shape, not a JWT's. Passing
        // one here should fail rather than half-decode.
        expect(decodeJwtClaims("header.payload")).toBeNull();
        expect(decodeJwtClaims("")).toBeNull();
    });

    it("returns null when the payload is not a JSON object", () => {
        const b64url = (s: string) =>
            btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        expect(decodeJwtClaims(`x.${b64url("[1,2,3]")}.y`)).toBeNull();
        expect(decodeJwtClaims(`x.${b64url("not json")}.y`)).toBeNull();
    });
});

describe("resolveFacilitator", () => {
    it("prefers sub for the user id", () => {
        const who = resolveFacilitator({
            sub: "u-1",
            userId: "ignored",
            email: "fac@hopemove.org",
        });
        expect(who?.hopeUserId).toBe("u-1");
    });

    it("falls back through the other id claim names", () => {
        expect(resolveFacilitator({ userId: "u-2" })?.hopeUserId).toBe("u-2");
        expect(resolveFacilitator({ id: "u-3" })?.hopeUserId).toBe("u-3");
    });

    it("accepts a numeric id", () => {
        // Platform ids are often ints, and JSON keeps them as numbers.
        expect(resolveFacilitator({ sub: 4210 })?.hopeUserId).toBe("4210");
    });

    it("returns null when no id claim is present", () => {
        // The whole point of failing here: without an id we would attribute
        // every facilitator's work to the same empty string.
        expect(resolveFacilitator({ email: "fac@hopemove.org" })).toBeNull();
        expect(resolveFacilitator({})).toBeNull();
    });

    it("prefers the platform's user object over the token's claims", () => {
        const who = resolveFacilitator(
            { sub: "from-claim", email: "claim@hopemove.org", name: "From Claim" },
            {
                userId: "from-platform",
                email: "platform@hopemove.org",
                screenName: "From Platform",
            },
        );
        expect(who).toEqual({
            hopeUserId: "from-platform",
            email: "platform@hopemove.org",
            name: "From Platform",
        });
    });

    it("fills each field independently", () => {
        // A payload with a userId but no screen name should fall through to
        // the claims for that one field, not drag the whole identity back.
        const who = resolveFacilitator(
            { sub: "from-claim", email: "claim@hopemove.org", name: "From Claim" },
            { userId: "from-platform" },
        );
        expect(who).toEqual({
            hopeUserId: "from-platform",
            email: "claim@hopemove.org",
            name: "From Claim",
        });
    });

    it("falls back to the claims when no user object was sent", () => {
        expect(
            resolveFacilitator({ sub: "from-claim" }, undefined)?.hopeUserId,
        ).toBe("from-claim");
        expect(
            resolveFacilitator({ sub: "from-claim" }, { userId: "  " })?.hopeUserId,
        ).toBe("from-claim");
    });

    it("identifies a facilitator from the user object alone", () => {
        // An opaque access token is not fatal now the platform sends the
        // identity separately.
        const who = resolveFacilitator(
            {},
            { userId: "hope-user-77", email: "fac@hopemove.org" },
        );
        expect(who?.hopeUserId).toBe("hope-user-77");
        expect(hasSyntheticEmail(who!.email)).toBe(false);
    });

    it("lowercases the email", () => {
        const who = resolveFacilitator({ sub: "u-1", email: "Fac@HopeMove.org" });
        expect(who?.email).toBe("fac@hopemove.org");
    });

    it("synthesises an email when the claims carry none", () => {
        const who = resolveFacilitator({ sub: "u-9" });
        expect(who?.email).toBe("u-9@hope.invalid");
        expect(hasSyntheticEmail(who!.email)).toBe(true);
    });

    it("does not mark a real email as synthetic", () => {
        const who = resolveFacilitator({ sub: "u-1", email: "fac@hopemove.org" });
        expect(hasSyntheticEmail(who!.email)).toBe(false);
    });

    it("treats a blank claim as absent", () => {
        expect(resolveFacilitator({ sub: "   " })).toBeNull();
        expect(resolveFacilitator({ sub: "u-1", name: "  " })?.name).toBeUndefined();
    });
});

describe("expiresAtFrom", () => {
    it("resolves seconds to an absolute epoch ms", () => {
        expect(expiresAtFrom(900, 1_000_000)).toBe(1_000_000 + 900_000);
    });

    it("falls back to a short window when the value is unusable", () => {
        // Short, not long: an unreadable lifetime must mean "check again
        // soon", never "this lasts forever".
        for (const bad of [undefined, null, "nonsense", 0, -5, NaN]) {
            expect(expiresAtFrom(bad, 1_000_000)).toBeLessThanOrEqual(
                1_000_000 + 60_000,
            );
            expect(expiresAtFrom(bad, 1_000_000)).toBeGreaterThan(1_000_000);
        }
    });

    it("accepts a numeric string", () => {
        expect(expiresAtFrom("900", 1_000_000)).toBe(1_000_000 + 900_000);
    });
});

describe("needsRefresh", () => {
    const expiresAt = 1_000_000;

    it("is false while the token has more than the skew left", () => {
        expect(needsRefresh(expiresAt, expiresAt - REFRESH_SKEW_MS - 1)).toBe(false);
    });

    it("is true once inside the skew window", () => {
        // The point of the skew: refresh before expiry, so a request that
        // was valid when it started cannot expire mid-flight.
        expect(needsRefresh(expiresAt, expiresAt - REFRESH_SKEW_MS)).toBe(true);
        expect(needsRefresh(expiresAt, expiresAt - 1)).toBe(true);
    });

    it("is true after expiry", () => {
        expect(needsRefresh(expiresAt, expiresAt + 1)).toBe(true);
    });
});

describe("parseTokenResponse", () => {
    const now = 1_000_000;

    it("reads the documented exchange shape", () => {
        expect(
            parseTokenResponse(
                {
                    user: {
                        userId: "hope-user-77",
                        screenName: "Test Facilitator",
                        email: "fac@hopemove.org",
                    },
                    accessToken: "at",
                    refreshToken: "rt",
                    expiresIn: 900,
                },
                now,
            ),
        ).toEqual({
            tokens: {
                accessToken: "at",
                refreshToken: "rt",
                expiresAt: now + 900_000,
            },
            user: {
                userId: "hope-user-77",
                screenName: "Test Facilitator",
                email: "fac@hopemove.org",
            },
        });
    });

    it("accepts the user object and its fields in either casing", () => {
        // The platform declares these PascalCase; whether they reach the
        // wire camelCased depends on the serializer, and guessing wrong
        // would silently drop the identity.
        expect(
            parseTokenResponse(
                {
                    User: {
                        UserId: "hope-user-77",
                        Email: "fac@hopemove.org",
                        ScreenName: "Test Facilitator",
                    },
                    accessToken: "at",
                    refreshToken: "rt",
                },
                now,
            )?.user,
        ).toEqual({
            userId: "hope-user-77",
            email: "fac@hopemove.org",
            screenName: "Test Facilitator",
        });
    });

    it("accepts a numeric userId", () => {
        expect(
            parseTokenResponse(
                { user: { userId: 4210 }, accessToken: "at", refreshToken: "rt" },
                now,
            )?.user?.userId,
        ).toBe("4210");
    });

    it("leaves user undefined when the platform sends none", () => {
        // Identity then comes from the token's claims, which still carry
        // the id, so sign-in keeps working.
        for (const body of [
            { accessToken: "at", refreshToken: "rt" },
            { user: null, accessToken: "at", refreshToken: "rt" },
            { user: "nope", accessToken: "at", refreshToken: "rt" },
            { user: {}, accessToken: "at", refreshToken: "rt" },
        ]) {
            expect(parseTokenResponse(body, now)?.user).toBeUndefined();
        }
    });

    it("rejects a response missing either token", () => {
        expect(parseTokenResponse({ refreshToken: "rt", expiresIn: 900 }, now)).toBeNull();
        expect(parseTokenResponse({ accessToken: "at", expiresIn: 900 }, now)).toBeNull();
        expect(
            parseTokenResponse({ accessToken: "", refreshToken: "rt" }, now),
        ).toBeNull();
    });

    it("rejects a non-object body", () => {
        // A 200 carrying an error string, or an HTML error page, must not
        // read as a successful exchange.
        for (const bad of [null, undefined, "ok", 42, ["at", "rt"]]) {
            expect(parseTokenResponse(bad, now)).toBeNull();
        }
    });

    it("still returns tokens when expiresIn is missing", () => {
        // Missing lifetime is recoverable — we just refresh sooner.
        const parsed = parseTokenResponse(
            { accessToken: "at", refreshToken: "rt" },
            now,
        );
        expect(parsed?.tokens.accessToken).toBe("at");
        expect(parsed?.tokens.expiresAt).toBeGreaterThan(now);
    });
});
