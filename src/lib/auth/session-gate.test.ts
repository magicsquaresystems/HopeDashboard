/**
 * The rule that decides whether a session may still read participant
 * data. The case that matters is `hope_refresh_failed`: before this
 * gate existed it was indistinguishable from a healthy session, and API
 * routes served it for the remaining life of the cookie.
 */

import { describe, expect, it } from "vitest";

import { gateFacilitatorSession } from "@/lib/auth/session-gate";

const EMAIL = "support@h4c.org.uk";

describe("gateFacilitatorSession", () => {
    it("allows a hand-off session, which never had a platform link", () => {
        const r = gateFacilitatorSession({ user: { email: EMAIL } });
        expect(r).toEqual({ ok: true, email: EMAIL });
    });

    it("allows a deployment with no platform integration configured", () => {
        // An operator state, not a failed login. Refusing it would take
        // local development and the hand-off test path offline.
        const r = gateFacilitatorSession({
            user: { email: EMAIL },
            error: "hope_not_configured",
        });
        expect(r.ok).toBe(true);
    });

    it("refuses a session whose Hope link has broken", () => {
        const r = gateFacilitatorSession({
            user: { email: EMAIL },
            error: "hope_refresh_failed",
        });
        expect(r).toMatchObject({
            ok: false,
            status: 401,
            code: "hope_session_expired",
        });
    });

    it("tells the facilitator the only way back in", () => {
        // There is no sign-in form to send them to — this dashboard is
        // entered from Hope or not at all — so copy saying "sign in
        // again" would describe a page that does not exist.
        const r = gateFacilitatorSession({
            user: { email: EMAIL },
            error: "hope_refresh_failed",
        });
        if (r.ok) throw new Error("expected refusal");
        expect(r.detail).toMatch(/Facilitator Dashboard/);
        expect(r.detail).not.toMatch(/sign in/i);
    });

    it("refuses a session with no email at all", () => {
        expect(gateFacilitatorSession(null)).toMatchObject({
            ok: false,
            status: 401,
            code: "auth_required",
        });
        expect(gateFacilitatorSession({ user: null })).toMatchObject({
            code: "auth_required",
        });
        expect(gateFacilitatorSession({ user: { email: "" } })).toMatchObject({
            code: "auth_required",
        });
    });

    it("reports the plainer problem first when a session is both broken and anonymous", () => {
        const r = gateFacilitatorSession({ error: "hope_refresh_failed" });
        expect(r).toMatchObject({ ok: false, code: "auth_required" });
    });

    it("lowercases the email, because assignments and audit rows key on it", () => {
        const r = gateFacilitatorSession({ user: { email: "Support@H4C.org.uk" } });
        expect(r).toEqual({ ok: true, email: EMAIL });
    });

    it("ignores an unrecognised error rather than locking everyone out", () => {
        // A future error string is not evidence the link is dead, and
        // failing closed on anything unknown would turn a new auth
        //state into a site-wide outage.
        const r = gateFacilitatorSession({
            user: { email: EMAIL },
            error: "something_new",
        });
        expect(r.ok).toBe(true);
    });
});
