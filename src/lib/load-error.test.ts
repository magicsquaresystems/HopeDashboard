import { describe, expect, it } from "vitest";

import { friendlyLoadError } from "./load-error";

/**
 * The queue's failure card is what a facilitator reads mid-session when
 * the risk service is down. These pin the two contracts: the body never
 * contains the raw technical string, and the raw string is always
 * preserved in `detail` for the disclosure.
 */
describe("friendlyLoadError", () => {
    const RAW =
        '/api/proxy/dropout/batch failed: 503 {"detail":"This deployment is missing HOPE_RISK_API_KEY","code":"backend_not_configured"}';

    it("keeps the raw message out of the body and in the detail", () => {
        const state = friendlyLoadError(RAW);
        expect(state.detail).toBe(RAW);
        expect(state.body).not.toContain("HOPE_RISK_API_KEY");
        expect(state.body).not.toContain("/api/proxy");
        expect(state.title).not.toContain("503");
    });

    it("reads a 401 as a session problem with a way back", () => {
        const state = friendlyLoadError(
            '/api/proxy/dropout/batch failed: 401 {"detail":"Not signed in","code":"auth_required"}',
        );
        expect(state.title).toBe("Your session has ended");
        // Names the page they land on, not this project's internal
        // "Hope Move", which appears nowhere a facilitator can see.
        expect(state.body).toContain("Facilitator Dashboard");
    });

    it("reads a 403 as an assignment problem, not an outage", () => {
        const state = friendlyLoadError(
            "/api/proxy/dropout/batch failed: 403 cohort_forbidden",
        );
        expect(state.title).toBe("This cohort isn't available to you");
    });

    it("falls back to the generic outage copy", () => {
        const state = friendlyLoadError("connect ECONNREFUSED 127.0.0.1:8000");
        expect(state.title).toBe("Risk scores aren't available right now");
        expect(state.detail).toContain("ECONNREFUSED");
    });
});

describe("failure kind", () => {
    it("marks an expired Hope link as a session problem, not an outage", () => {
        // The distinction drives whether the UI offers a retry or a way
        // back to Hope. Retrying an expired session fails identically
        // every time, which reads as the dashboard being broken.
        const e = friendlyLoadError(
            "/api/cohort-bundle failed: 401 Your session with Hope has ended. (hope_session_expired)",
        );
        expect(e.kind).toBe("session");
        expect(e.body).not.toMatch(/try again/i);
        expect(e.body).toMatch(/Facilitator Dashboard/);
    });

    it("marks a plain 401 as a session problem", () => {
        expect(friendlyLoadError("/api/x failed: 401 Not signed in").kind).toBe(
            "session",
        );
    });

    it("marks a lost cohort assignment as an access problem", () => {
        expect(friendlyLoadError("/api/x failed: 403 Forbidden").kind).toBe(
            "access",
        );
    });

    it("marks anything else as an outage, which is the retryable one", () => {
        expect(friendlyLoadError("/api/x failed: 503 upstream down").kind).toBe(
            "outage",
        );
        expect(friendlyLoadError("Failed to fetch").kind).toBe("outage");
    });
});
