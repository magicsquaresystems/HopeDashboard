import { describe, expect, it } from "vitest";

import {
    canPublishReply,
    classifyGenerateError,
    draftWarnings,
    formatModelLabel,
    friendlyPublishError,
    pickReplyTarget,
    publishBlockedReason,
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

    it("treats an empty activity_type as unknown", () => {
        // "" is not null, so it used to pass as a known type: a blank
        // badge on screen and an empty activity_type on the wire, which
        // /generate rejects.
        const target = pickReplyTarget(
            history([activity("2026-01-20T00:00:00Z", { activity_type: "" })]),
            null,
        );
        expect(target?.typeKnown).toBe(false);
        expect(target?.activityType).toBe("GoalSetting");
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

describe("canPublishReply", () => {
    const target = {
        text: "I will walk to the end of the road",
        activityType: "GoalSetting" as const,
        typeKnown: true,
        daysAgo: 1,
        isDiscussion: false,
        activityId: 4321,
    };

    it("allows the happy case", () => {
        expect(
            canPublishReply({ publishEnabled: true, writeMode: false, target }),
        ).toBe(true);
    });

    it("refuses when the deployment or cohort is not cleared for posting", () => {
        expect(
            canPublishReply({ publishEnabled: false, writeMode: false, target }),
        ).toBe(false);
    });

    it("refuses a hand-written reply", () => {
        // Write-my-own has no draft set behind it; the send path is for
        // a generated draft the research record can account for.
        expect(
            canPublishReply({ publishEnabled: true, writeMode: true, target }),
        ).toBe(false);
    });

    it("refuses a forum post, which has no record to attach to", () => {
        expect(
            canPublishReply({
                publishEnabled: true,
                writeMode: false,
                target: { ...target, isDiscussion: true },
            }),
        ).toBe(false);
    });

    it("refuses when the activity type was guessed rather than known", () => {
        // pickReplyTarget defaults an unknown type to GoalSetting so
        // drafting has something to send. Publishing files the reply
        // against a record type, so the guess would attach a
        // facilitator's words to the wrong entry.
        expect(
            canPublishReply({
                publishEnabled: true,
                writeMode: false,
                target: { ...target, typeKnown: false },
            }),
        ).toBe(false);
    });

    it("refuses when there is no activity id", () => {
        expect(
            canPublishReply({
                publishEnabled: true,
                writeMode: false,
                target: { ...target, activityId: undefined },
            }),
        ).toBe(false);
        expect(
            canPublishReply({ publishEnabled: true, writeMode: false, target: null }),
        ).toBe(false);
    });
});

describe("publishBlockedReason", () => {
    const base = {
        text: "x",
        activityType: "GoalSetting" as const,
        typeKnown: true,
        daysAgo: 1,
        isDiscussion: false,
        activityId: 1,
    };

    it("explains a forum post and points at the thread", () => {
        const r = publishBlockedReason({
            publishEnabled: true,
            writeMode: false,
            target: { ...base, isDiscussion: true },
        });
        expect(r).toMatch(/forum/i);
        expect(r).toMatch(/Hope/);
    });

    it("says nothing when sending is simply available", () => {
        expect(
            publishBlockedReason({ publishEnabled: true, writeMode: false, target: base }),
        ).toBeNull();
    });

    it("says nothing when the deployment has posting switched off", () => {
        // An operator's business, not something to narrate on every draft.
        expect(
            publishBlockedReason({ publishEnabled: false, writeMode: false, target: base }),
        ).toBeNull();
    });
});

describe("friendlyPublishError", () => {
    it("never promises a failed send was not delivered", () => {
        // The platform may have accepted it before the connection
        // dropped. "Try again" would invite a duplicate under a
        // participant's post.
        const e = friendlyPublishError("/api/proxy/hope/comment failed: 502 upstream");
        expect(e.body).toMatch(/may or may not/i);
        expect(e.body).toMatch(/check/i);
    });

    it("maps every gate the route can refuse with", () => {
        for (const code of [
            "posting_not_allowed_for_cohort",
            "posting_disabled",
            "hope_not_linked",
            "hope_session_expired",
            "invalid_request",
        ]) {
            const e = friendlyPublishError(`/api/proxy/hope/comment failed: 403 ${code}`);
            expect(e.title.length).toBeGreaterThan(0);
            expect(e.body.length).toBeGreaterThan(0);
        }
    });

    it("tells a facilitator to shorten a reply that is too long, not to repost it", () => {
        // Matched before the generic 400 branch: that one says "copy the
        // reply and post it on Hope", which for a too-long reply sends
        // them away from the one place they can fix it.
        const e = friendlyPublishError(
            "/api/proxy/hope/comment failed: 400 comment_too_long",
        );
        expect(e.title).toMatch(/too long/i);
        expect(e.body).toMatch(/1,000/);
        expect(e.body).not.toMatch(/post it on Hope/);
    });

    it("keeps route paths, env names and status codes out of the copy", () => {
        for (const msg of [
            "/api/proxy/hope/comment failed: 503 posting_disabled",
            "/api/proxy/hope/comment failed: 400 invalid_request",
            "/api/proxy/hope/comment failed: 400 comment_too_long",
            "/api/proxy/hope/comment failed: 502 upstream",
        ]) {
            const { title, body } = friendlyPublishError(msg);
            const text = `${title} ${body}`;
            expect(text).not.toMatch(/\/api\//);
            expect(text).not.toMatch(/HOPE_[A-Z_]+/);
            expect(text).not.toMatch(/\b(400|401|403|502|503)\b/);
        }
    });
});

/**
 * The warning strip is the only place two safety checks reach a
 * facilitator, and both fail quietly: an MI violation the service could
 * not repair, and a draft that mentions something the post never said.
 * Neither blocks sending, so if the copy is wrong or missing the draft
 * goes out as if it were clean.
 */
describe("draftWarnings", () => {
    it("says nothing about a clean draft", () => {
        expect(draftWarnings({ mi_violations: [], grounding: "grounded" })).toEqual([]);
        expect(draftWarnings({ mi_violations: null, grounding: null })).toEqual([]);
    });

    it("stays silent when the check did not run", () => {
        // "unchecked" is not an approval, but a warning on every draft
        // teaches facilitators to ignore the strip. See the docblock.
        expect(draftWarnings({ mi_violations: [], grounding: "unchecked" })).toEqual([]);
    });

    it("warns that an ungrounded draft may have invented something", () => {
        const [warning] = draftWarnings({ mi_violations: [], grounding: "ungrounded" });
        expect(warning.id).toBe("grounding");
        // The point of the copy is the action, not the verdict: a
        // facilitator can only judge this by looking at the post.
        expect(warning.body.toLowerCase()).toContain("post");
    });

    it("puts grounding first, because a skim would miss it", () => {
        const warnings = draftWarnings({
            mi_violations: ["contains 1 URL(s): facilitators do not share external links."],
            grounding: "ungrounded",
        });
        expect(warnings.map((w) => w.id)).toEqual(["grounding", "mi-url"]);
    });

    it("translates each MI violation the scorer can produce", () => {
        // Verbatim from src/safety/mi_scorer.py — if those strings change,
        // this test fails rather than the interface silently falling back
        // to "Needs a second look" for everything.
        const cases: [string, string][] = [
            ["diagnostic language (2 matches): facilitators do not diagnose.", "mi-diagnostic"],
            ["medication/dosage mention (1 matches): outside facilitator scope.", "mi-medication"],
            ["contains 1 URL(s): facilitators do not share external links.", "mi-url"],
            ["too prescriptive (3 imperatives) for a flagged input.", "mi-prescriptive"],
            ["uses 'Why' question (1 times); HOPE guide flags this as judgmental.", "mi-why"],
            ["reflection:question ratio is 0.20 (< 0.5); too interrogative for a distressed participant.", "mi-ratio"],
        ];
        for (const [violation, id] of cases) {
            const warnings = draftWarnings({ mi_violations: [violation], grounding: null });
            expect(warnings.map((w) => w.id)).toEqual([id]);
        }
    });

    it("still warns about a violation it does not recognise", () => {
        const warnings = draftWarnings({
            mi_violations: ["some new rule nobody has mapped yet"],
            grounding: null,
        });
        expect(warnings).toHaveLength(1);
        expect(warnings[0].id).toBe("mi-other");
    });

    it("collapses repeats of the same kind into one warning", () => {
        const warnings = draftWarnings({
            mi_violations: [
                "contains 1 URL(s): facilitators do not share external links.",
                "contains 2 URL(s): facilitators do not share external links.",
            ],
            grounding: null,
        });
        expect(warnings).toHaveLength(1);
    });

    it("keeps developer wording out of the copy", () => {
        const warnings = draftWarnings({
            mi_violations: [
                "diagnostic language (2 matches): facilitators do not diagnose.",
                "reflection:question ratio is 0.20 (< 0.5); too interrogative for a distressed participant.",
            ],
            grounding: "ungrounded",
        });
        for (const { title, body } of warnings) {
            const text = `${title} ${body}`;
            expect(text).not.toMatch(/HOPE_[A-Z_]+/);
            expect(text).not.toMatch(/\/api\//);
            expect(text).not.toMatch(/matches\)|ratio is|imperatives/);
            expect(text).not.toMatch(/ungrounded|mi_violations/);
        }
    });
});
