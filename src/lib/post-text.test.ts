import { describe, expect, it } from "vitest";

import { postTextForModel } from "@/lib/post-text";

const MICH007 =
    "I want to walk to the end of my road and back. I'll aim to do this three times a week, in the morning when my knee is less stiff. on In the morning after breakfast, along my own road . I will aim to do this Three times a week to start with, and I'll build";

describe("postTextForModel", () => {
    it("gives the model the goal box alone, not the platform's template", () => {
        // The real record from the test cohort: goal stated twice, a
        // stray " on ", and a mid-word cut at 255 characters. The model
        // answered that with a reply about "training up to" a reward.
        expect(postTextForModel("GoalSetting", MICH007)).toBe(
            "I want to walk to the end of my road and back. I'll aim to do this three times a week, in the morning when my knee is less stiff.",
        );
    });

    it("handles the template when the goal box has no full stop", () => {
        const raw =
            "rest on At home. I will aim to do this Every day for 15 mins";
        expect(postTextForModel("GoalSetting", raw)).toBe("rest");
    });

    it("leaves a goal with no template seam alone", () => {
        expect(
            postTextForModel("GoalSetting", "Walk to the shop and back twice a week."),
        ).toBe("Walk to the shop and back twice a week.");
    });

    it("drops a word bitten off by the 255-character cut", () => {
        const cut = "a".repeat(240) + " and then I'll bui";
        const out = postTextForModel("GoalSetting", cut);
        expect(out.endsWith("…")).toBe(true);
        expect(out).not.toMatch(/bui…$/);
    });

    it("does not touch other activity types", () => {
        // Only goals go through the template; a gratitude entry that
        // happens to contain " on " must survive intact.
        const g = "Grateful for my neighbour who came walking with me on Tuesday. I will aim to do this again.";
        expect(postTextForModel("Gratitude", g)).toBe(g);
        expect(postTextForModel(undefined, g)).toBe(g);
    });

    it("does not mistake the word 'on' inside the goal for the seam", () => {
        // "on" appears in ordinary prose; only the full template shape
        // — " on … . I will aim to do this" — marks the boundary.
        const raw = "Keep going on my exercises every morning.";
        expect(postTextForModel("GoalSetting", raw)).toBe(raw);
    });
});
