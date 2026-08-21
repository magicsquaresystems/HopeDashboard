import { describe, expect, it } from "vitest";

import { ProxyError } from "@/lib/api/proxy-error";
import { loginPathForError } from "@/lib/session-redirect";

describe("loginPathForError", () => {
    it("names the expired-link reason so the login page can explain it", () => {
        const e = new ProxyError(
            "/api/cohort-bundle",
            401,
            "Your session with Hope has ended.",
            "hope_session_expired",
        );
        expect(loginPathForError(e)).toBe("/login?error=session_expired");
    });

    it("sends any other 401 to the plain login page", () => {
        const e = new ProxyError("/api/x", 401, "Not signed in", "auth_required");
        expect(loginPathForError(e)).toBe("/login");
    });

    it("stays put for a 403 — a lost cohort is not a lost session", () => {
        // Redirecting here would throw a facilitator out of a working
        // session because one cohort was taken off them.
        const e = new ProxyError("/api/x", 403, "Forbidden", "not_assigned");
        expect(loginPathForError(e)).toBeNull();
    });

    it("stays put for an outage", () => {
        expect(
            loginPathForError(new ProxyError("/api/x", 503, "down")),
        ).toBeNull();
    });

    it("ignores errors that did not come from our own API", () => {
        // A bare Error is a network failure or a bug, not an ended
        // session, and a redirect would hide it.
        expect(loginPathForError(new Error("/api/x failed: 401"))).toBeNull();
        expect(loginPathForError("401")).toBeNull();
        expect(loginPathForError(null)).toBeNull();
    });
});
