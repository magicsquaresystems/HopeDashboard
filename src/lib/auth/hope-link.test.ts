/**
 * Telling "never had a platform link" apart from "had one and lost it".
 *
 * Worth its own module because collapsing the two did not merely lose
 * information — it inverted an access rule. A broken link read as "the
 * platform is not the source here", which falls back to open mode and
 * lists every cohort.
 */

import { describe, expect, it } from "vitest";

import { classifyHopeLink } from "@/lib/auth/hope-link";

const TOKENS = {
    accessToken: "at",
    refreshToken: "rt",
    expiresAt: 1_800_000_000,
};

describe("classifyHopeLink", () => {
    it("reports a hand-off session as having no link", () => {
        expect(classifyHopeLink({})).toBe("none");
        expect(classifyHopeLink(null)).toBe("none");
        expect(classifyHopeLink({ hope: TOKENS })).toBe("none");
    });

    it("reports usable platform credentials as linked", () => {
        expect(classifyHopeLink({ hopeUserId: "u1", hope: TOKENS })).toBe(
            "linked",
        );
    });

    it("reports a platform session whose tokens are gone as broken", () => {
        // Exactly the state the auth callback leaves behind when a
        // refresh fails: `hope` deleted, `hopeUserId` kept.
        expect(classifyHopeLink({ hopeUserId: "u1" })).toBe("broken");
        expect(classifyHopeLink({ hopeUserId: "u1", hope: null })).toBe(
            "broken",
        );
    });

    it("treats a half-written token as broken, not linked", () => {
        // A partial credential is not a credential. Calling it linked
        // would send `Bearer undefined` to the platform and surface as a
        // confusing 401 from Hope rather than an expired session here.
        expect(
            classifyHopeLink({
                hopeUserId: "u1",
                hope: { accessToken: "at" },
            }),
        ).toBe("broken");
        expect(
            classifyHopeLink({
                hopeUserId: "u1",
                hope: { ...TOKENS, expiresAt: "soon" },
            }),
        ).toBe("broken");
        expect(
            classifyHopeLink({
                hopeUserId: "u1",
                hope: { ...TOKENS, refreshToken: null },
            }),
        ).toBe("broken");
    });

    it("accepts a token whose lifetime the platform never sent", () => {
        // `null` expiry is unknown, not broken. The credential works;
        // we simply will not pre-empt its expiry. Treating this as
        // broken would refuse every token from a platform that omits
        // the lifetime — which is the platform we have.
        expect(
            classifyHopeLink({
                hopeUserId: "u1",
                hope: { ...TOKENS, expiresAt: null },
            }),
        ).toBe("linked");
    });

    it("does not accept a non-string or empty platform user id", () => {
        expect(classifyHopeLink({ hopeUserId: 42, hope: TOKENS })).toBe("none");
        expect(classifyHopeLink({ hopeUserId: "", hope: TOKENS })).toBe("none");
    });
});
