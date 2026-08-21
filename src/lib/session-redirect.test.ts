import { describe, expect, it } from "vitest";

import { ProxyError } from "@/lib/api/proxy-error";
import { exitPath, exitPathForError } from "@/lib/session-redirect";

const HOPE = "https://staging.poweredbyh4c.org/modules/dashboard/facilitator";

const expired = new ProxyError(
    "/api/cohort-bundle",
    401,
    "Your session with Hope has ended.",
    "hope_session_expired",
);

describe("exitPathForError", () => {
    it("returns the facilitator to the dashboard they came from", () => {
        // They are still signed in to Hope, and the Insights Hub tile
        // there mints a fresh session in one click. Our own login page
        // could only ever tell them to go and do that.
        expect(exitPathForError(expired, HOPE)).toBe(HOPE);
    });

    it("sends any other 401 to the same place", () => {
        // The remedy is identical whichever 401 it was, and the
        // facilitator neither knows nor cares which door refused them.
        const e = new ProxyError("/api/x", 401, "Not signed in", "auth_required");
        expect(exitPathForError(e, HOPE)).toBe(HOPE);
    });

    it("falls back to the login page when no platform URL is configured", () => {
        expect(exitPathForError(expired, null)).toBe(
            "/login?error=session_expired",
        );
        expect(
            exitPathForError(new ProxyError("/api/x", 401, "nope"), null),
        ).toBe("/login");
    });

    it("stays put for a 403 — a lost cohort is not a lost session", () => {
        // Redirecting here would throw a facilitator out of a working
        // session because one cohort was taken off them.
        const e = new ProxyError("/api/x", 403, "Forbidden", "not_assigned");
        expect(exitPathForError(e, HOPE)).toBeNull();
    });

    it("stays put for an outage", () => {
        expect(
            exitPathForError(new ProxyError("/api/x", 503, "down"), HOPE),
        ).toBeNull();
    });

    it("ignores errors that did not come from our own API", () => {
        // A bare Error is a network failure or a bug, not an ended
        // session, and ejecting the facilitator would hide it.
        expect(exitPathForError(new Error("/api/x failed: 401"), HOPE)).toBeNull();
        expect(exitPathForError("401", HOPE)).toBeNull();
        expect(exitPathForError(null, HOPE)).toBeNull();
    });
});

describe("exitPath", () => {
    it("prefers the platform dashboard over our own pages", () => {
        expect(exitPath(HOPE, true)).toBe(HOPE);
        expect(exitPath(HOPE, false)).toBe(HOPE);
    });

    it("explains itself when there is nowhere on the platform to go", () => {
        expect(exitPath(null, true)).toBe("/login?error=session_expired");
        expect(exitPath(null, false)).toBe("/login");
    });
});
