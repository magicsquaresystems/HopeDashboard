import { describe, expect, it } from "vitest";

import { classifyGenerateError, formatModelLabel } from "./drafts-helpers";

/**
 * Ordering is the whole point of these tests. A busy 503 and an offline
 * 503 are the same status code with opposite advice — "wait, someone is
 * ahead of you" vs "give up, the service is down" — so the busy branch
 * has to be matched first. A refactor that reorders the branches would
 * silently tell facilitators the model is offline while it is working.
 */
describe("classifyGenerateError", () => {
    it("reads a busy 503 as busy, not offline", () => {
        const state = classifyGenerateError(
            '/api/proxy/generate failed: 503 {"detail":"Another draft is being generated.","code":"generation_busy"}',
        );
        expect(state.tone).toBe("busy");
        expect(state.title).toBe("Another draft is generating");
    });

    it("still reads a plain 503 as offline", () => {
        expect(
            classifyGenerateError(
                "/api/proxy/generate failed: 503 Service Unavailable",
            ).tone,
        ).toBe("offline");
    });

    it("treats an expired session as auth, not offline", () => {
        expect(
            classifyGenerateError(
                '/api/proxy/generate failed: 401 {"detail":"Not signed in"}',
            ).tone,
        ).toBe("auth");
    });

    it("buckets unreachable-service failures as offline", () => {
        for (const msg of [
            "fetch failed",
            "connect ECONNREFUSED 127.0.0.1:8001",
            "/api/proxy/generate failed: 502 Bad Gateway",
            "/api/proxy/generate failed: 504 Gateway Timeout",
        ]) {
            expect(classifyGenerateError(msg).tone).toBe("offline");
        }
    });

    it("surfaces the raw detail for anything unrecognised", () => {
        const state = classifyGenerateError("422 programme_length_days too low");
        expect(state.tone).toBe("error");
        expect(state.body).toContain("programme_length_days");
    });
});

/**
 * The badge answers "which model wrote this draft?". The production id
 * must render exactly — a regression here mislabels every draft — and
 * the service's non-SLM sentinels must keep their friendly names so a
 * kill-switched deployment is visible in the UI.
 */
describe("formatModelLabel", () => {
    it("renders the production adapter id", () => {
        expect(formatModelLabel("h4cdev/qwen3.5-4b-hope-forum-lora")).toBe(
            "Qwen3.5 4B (forum)",
        );
    });

    it("renders the CPU dev fallback without internal corpus tags", () => {
        expect(
            formatModelLabel("h4cdev/qwen3-0.6b-hope-forum-clean-lora"),
        ).toBe("Qwen3 0.6B (forum)");
    });

    it("maps service sentinels to their friendly names", () => {
        expect(formatModelLabel("stub-disabled")).toBe("stub (kill-switch)");
        expect(formatModelLabel("safety-block")).toBe("safety block");
        expect(formatModelLabel("error-fallback")).toBe("fallback");
    });
});
