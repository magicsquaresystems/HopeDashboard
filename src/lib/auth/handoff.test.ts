import { describe, expect, it } from "vitest";

import {
    MAX_TOKEN_LIFETIME_S,
    signHandoffToken,
    verifyHandoffToken,
} from "./handoff";

const SECRET = "test-secret-value";
const NOW = 1_786_048_951_000;

async function tokenFor(
    claims: Parameters<typeof signHandoffToken>[0],
    secret = SECRET,
) {
    return signHandoffToken(claims, secret, NOW);
}

describe("verifyHandoffToken", () => {
    it("accepts a token the platform signed with the shared secret", async () => {
        const t = await tokenFor({
            email: "Facilitator@Hope.ORG",
            name: "Dayo",
            cohorts: [1680],
        });
        const r = await verifyHandoffToken(t, SECRET, NOW);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        // Lowercased so it matches the attribution + assignment key.
        expect(r.claims.email).toBe("facilitator@hope.org");
        expect(r.claims.name).toBe("Dayo");
        expect(r.claims.cohorts).toEqual([1680]);
    });

    it("rejects a token signed with a different secret", async () => {
        const t = await tokenFor({ email: "a@b.org" }, "someone-elses-secret");
        const r = await verifyHandoffToken(t, SECRET, NOW);
        expect(r).toEqual({ ok: false, reason: "bad signature" });
    });

    it("rejects a tampered payload — the point of signing it", async () => {
        const t = await tokenFor({ email: "intern@hope.org" });
        const [, sig] = t.split(".");
        const forged = Buffer.from(
            JSON.stringify({
                email: "admin@hope.org",
                exp: Math.floor(NOW / 1000) + 60,
            }),
        ).toString("base64url");
        const r = await verifyHandoffToken(`${forged}.${sig}`, SECRET, NOW);
        expect(r.ok).toBe(false);
    });

    it("rejects an expired token", async () => {
        const t = await tokenFor({
            email: "a@b.org",
            exp: Math.floor(NOW / 1000) - 1,
        });
        expect(await verifyHandoffToken(t, SECRET, NOW)).toEqual({
            ok: false,
            reason: "token expired",
        });
    });

    it("refuses a long-lived token even when correctly signed", async () => {
        // A year-long token in a URL is a password in a URL.
        const t = await tokenFor({
            email: "a@b.org",
            exp: Math.floor(NOW / 1000) + MAX_TOKEN_LIFETIME_S + 60,
        });
        expect(await verifyHandoffToken(t, SECRET, NOW)).toEqual({
            ok: false,
            reason: "exp too far in the future",
        });
    });

    it("rejects structurally broken tokens rather than throwing", async () => {
        for (const bad of ["", "no-dot", "a.b.c", "!!!.!!!"]) {
            const r = await verifyHandoffToken(bad, SECRET, NOW);
            expect(r.ok).toBe(false);
        }
    });

    it("requires a plausible email", async () => {
        const t = await tokenFor({ email: "not-an-email" });
        expect(await verifyHandoffToken(t, SECRET, NOW)).toEqual({
            ok: false,
            reason: "missing email",
        });
    });
});
