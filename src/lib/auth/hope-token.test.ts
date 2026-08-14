import { describe, expect, it } from "vitest";

import {
    decodeJwtClaims,
    expiresAtFrom,
    facilitatorFromClaims,
    hasSyntheticEmail,
    needsRefresh,
    parseTokenResponse,
    REFRESH_SKEW_MS,
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

describe("facilitatorFromClaims", () => {
    it("prefers sub for the user id", () => {
        const who = facilitatorFromClaims({
            sub: "u-1",
            userId: "ignored",
            email: "fac@hopemove.org",
        });
        expect(who?.hopeUserId).toBe("u-1");
    });

    it("falls back through the other id claim names", () => {
        expect(facilitatorFromClaims({ userId: "u-2" })?.hopeUserId).toBe("u-2");
        expect(facilitatorFromClaims({ id: "u-3" })?.hopeUserId).toBe("u-3");
    });

    it("accepts a numeric id", () => {
        // Platform ids are often ints, and JSON keeps them as numbers.
        expect(facilitatorFromClaims({ sub: 4210 })?.hopeUserId).toBe("4210");
    });

    it("returns null when no id claim is present", () => {
        // The whole point of failing here: without an id we would attribute
        // every facilitator's work to the same empty string.
        expect(facilitatorFromClaims({ email: "fac@hopemove.org" })).toBeNull();
        expect(facilitatorFromClaims({})).toBeNull();
    });

    it("lowercases the email", () => {
        const who = facilitatorFromClaims({ sub: "u-1", email: "Fac@HopeMove.org" });
        expect(who?.email).toBe("fac@hopemove.org");
    });

    it("synthesises an email when the claims carry none", () => {
        const who = facilitatorFromClaims({ sub: "u-9" });
        expect(who?.email).toBe("u-9@hope.invalid");
        expect(hasSyntheticEmail(who!.email)).toBe(true);
    });

    it("does not mark a real email as synthetic", () => {
        const who = facilitatorFromClaims({ sub: "u-1", email: "fac@hopemove.org" });
        expect(hasSyntheticEmail(who!.email)).toBe(false);
    });

    it("treats a blank claim as absent", () => {
        expect(facilitatorFromClaims({ sub: "   " })).toBeNull();
        expect(facilitatorFromClaims({ sub: "u-1", name: "  " })?.name).toBeUndefined();
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
                { accessToken: "at", refreshToken: "rt", expiresIn: 900 },
                now,
            ),
        ).toEqual({
            accessToken: "at",
            refreshToken: "rt",
            expiresAt: now + 900_000,
        });
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
        expect(parsed?.accessToken).toBe("at");
        expect(parsed?.expiresAt).toBeGreaterThan(now);
    });
});
