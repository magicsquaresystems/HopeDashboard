import { describe, expect, it } from "vitest";

import {
    classifyGenerateError,
    formatModelLabel,
    pickReplyTarget,
} from "./drafts-helpers";
import type { ParticipantHistory } from "@/lib/api/dropout";

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

    it("keeps the raw detail out of the body for anything unrecognised", () => {
        // The card body is facilitator-facing prose; the raw message
        // moves to `detail`, rendered behind a disclosure.
        const state = classifyGenerateError("422 programme_length_days too low");
        expect(state.tone).toBe("error");
        expect(state.detail).toContain("programme_length_days");
        expect(state.body).not.toContain("programme_length_days");
    });

    it("never mentions hosting jargon to facilitators", () => {
        for (const msg of [
            "fetch failed",
            "/api/proxy/generate failed: 503 Service Unavailable",
            "anything else entirely",
        ]) {
            const state = classifyGenerateError(msg);
            expect(state.title.toLowerCase()).not.toContain("space");
            expect(state.body.toLowerCase()).not.toContain("space");
            expect(state.body.toLowerCase()).not.toContain("fine-tuned");
        }
    });
});

/**
 * Target-picking owns two honesty rules that used to be broken inline:
 * an explicit timeline click must not reach an Emotions event (the
 * reply model rejects it and the platform can't file a reply under
 * it), and a missing activity_type must be reported as unknown rather
 * than silently presented as "GoalSetting".
 */
describe("pickReplyTarget", () => {
    const history = (
        events: ParticipantHistory["events"],
    ): ParticipantHistory => ({
        participant_id: "P1",
        effective_start: "2026-01-01T00:00:00Z",
        events,
        cohort_size: 10,
        programme_length_days: 42,
        score_at_day: 42,
    });

    const activity = (
        ts: string,
        over: Partial<ParticipantHistory["events"][number]> = {},
    ): ParticipantHistory["events"][number] => ({
        timestamp: ts,
        event_type: "activity",
        activity_type: "Gratitude",
        description: "wrote something",
        ...over,
    });

    it("auto-picks the newest draftable activity", () => {
        const target = pickReplyTarget(
            history([
                activity("2026-01-10T00:00:00Z", { description: "older" }),
                activity("2026-01-20T00:00:00Z", { description: "newer" }),
            ]),
            null,
        );
        expect(target?.text).toBe("newer");
        expect(target?.typeKnown).toBe(true);
        expect(target?.activityType).toBe("Gratitude");
    });

    it("never auto-picks Emotions", () => {
        const target = pickReplyTarget(
            history([
                activity("2026-01-20T00:00:00Z", {
                    activity_type: "Emotions",
                }),
                activity("2026-01-10T00:00:00Z", { description: "usable" }),
            ]),
            null,
        );
        expect(target?.text).toBe("usable");
    });

    it("refuses an explicit timeline pick of an Emotions event", () => {
        // The old inline version honoured the click and targeted an
        // event the model rejects. Falling back to the newest draftable
        // activity keeps the panel usable.
        const target = pickReplyTarget(
            history([
                activity("2026-01-20T00:00:00Z", {
                    activity_type: "Emotions",
                }),
                activity("2026-01-10T00:00:00Z", { description: "usable" }),
            ]),
            "2026-01-20T00:00:00Z",
        );
        expect(target?.text).toBe("usable");
    });

    it("honours an explicit pick of a forum post", () => {
        const target = pickReplyTarget(
            history([
                activity("2026-01-10T00:00:00Z"),
                {
                    timestamp: "2026-01-15T00:00:00Z",
                    event_type: "discussion_post",
                    description: "forum words",
                    topic_id: 88,
                },
            ]),
            "2026-01-15T00:00:00Z",
        );
        expect(target?.isDiscussion).toBe(true);
        expect(target?.topicId).toBe(88);
        expect(target?.typeKnown).toBe(true);
    });

    it("reports a missing activity_type as unknown, not GoalSetting", () => {
        const target = pickReplyTarget(
            history([
                activity("2026-01-20T00:00:00Z", {
                    activity_type: undefined,
                }),
            ]),
            null,
        );
        // The wire value still defaults (the service requires the enum)…
        expect(target?.activityType).toBe("GoalSetting");
        // …but the UI is told the truth.
        expect(target?.typeKnown).toBe(false);
    });

    it("carries the platform activity id when present", () => {
        const target = pickReplyTarget(
            history([activity("2026-01-20T00:00:00Z", { activity_id: 4242 })]),
            null,
        );
        expect(target?.activityId).toBe(4242);
    });

    it("returns null when nothing is draftable", () => {
        expect(
            pickReplyTarget(
                history([
                    activity("2026-01-20T00:00:00Z", { description: "  " }),
                ]),
                null,
            ),
        ).toBeNull();
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
