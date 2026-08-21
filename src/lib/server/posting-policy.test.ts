import { describe, expect, it } from "vitest";

import {
    isPostingAllowedFor,
    parseCohortAllowlist,
    postingPolicy,
    type PostingPolicy,
} from "./posting-policy";

const TEST = { id: 1731, code: "MICHAEL-TEST-210826" };
const LIVE = { id: 1223, code: "HOPE-MOVE-170626" };

function policy(env: Record<string, string | undefined>): PostingPolicy {
    return postingPolicy(env);
}

describe("parseCohortAllowlist", () => {
    it("splits ids from codes", () => {
        const a = parseCohortAllowlist("1731, MICHAEL-TEST-210826 ,1600");
        if (a === "all") throw new Error("expected a list, got all");
        expect(a.ids).toEqual(new Set([1731, 1600]));
        expect(a.codes).toEqual(new Set(["MICHAEL-TEST-210826"]));
    });

    it("treats * as every cohort", () => {
        expect(parseCohortAllowlist("*")).toBe("all");
    });

    it("treats unset or blank as nothing, never as all", () => {
        // The whole safety property: forgetting this variable must not
        // open every live course.
        for (const raw of [undefined, "", "   "]) {
            const a = parseCohortAllowlist(raw);
            if (a === "all") throw new Error("blank must not mean all");
            expect(a.ids.size + a.codes.size).toBe(0);
        }
    });

    it("does not read an exponent as a cohort id", () => {
        // Number("1e3") is 1000, a perfectly valid safe integer, so a
        // fat-fingered exponent would otherwise have allowlisted
        // whatever cohort 1000 happens to be.
        const a = parseCohortAllowlist("1e3");
        if (a === "all") throw new Error("expected a list, got all");
        expect(a.ids.has(1000)).toBe(false);
        expect(
            isPostingAllowedFor(
                { enabled: true, dryRun: false, allow: a },
                { id: 1000, code: "ANYTHING" },
            ),
        ).toBe(false);
    });

    it("keeps a decimal or a negative out of the id set", () => {
        const a = parseCohortAllowlist("1.5, -4");
        if (a === "all") throw new Error("expected a list, got all");
        expect(a.ids.size).toBe(0);
    });
});

describe("isPostingAllowedFor", () => {
    it("refuses everything when the flag is off, whatever the list says", () => {
        expect(
            isPostingAllowedFor(policy({ HOPE_POST_COMMENT_COHORTS: "*" }), TEST),
        ).toBe(false);
    });

    it("refuses everything when the flag is on but no list is set", () => {
        const p = policy({ HOPE_ENABLE_POST_COMMENT: "1" });
        expect(p.enabled).toBe(true);
        expect(isPostingAllowedFor(p, TEST)).toBe(false);
        expect(isPostingAllowedFor(p, LIVE)).toBe(false);
    });

    it("allows the listed cohort by id and refuses its neighbours", () => {
        const p = policy({
            HOPE_ENABLE_POST_COMMENT: "1",
            HOPE_POST_COMMENT_COHORTS: "1731",
        });
        expect(isPostingAllowedFor(p, TEST)).toBe(true);
        expect(isPostingAllowedFor(p, LIVE)).toBe(false);
        expect(isPostingAllowedFor(p, { id: 1732 })).toBe(false);
    });

    it("allows the listed cohort by code, case-insensitively", () => {
        const p = policy({
            HOPE_ENABLE_POST_COMMENT: "1",
            HOPE_POST_COMMENT_COHORTS: "michael-test-210826",
        });
        expect(isPostingAllowedFor(p, TEST)).toBe(true);
        expect(isPostingAllowedFor(p, LIVE)).toBe(false);
    });

    it("refuses when only a code is listed and the cohort has no code", () => {
        // resolveCohort may hand us a cohort with no code; the id must
        // then be what decides, and an id was never listed.
        const p = policy({
            HOPE_ENABLE_POST_COMMENT: "1",
            HOPE_POST_COMMENT_COHORTS: "MICHAEL-TEST-210826",
        });
        expect(isPostingAllowedFor(p, { id: 1731 })).toBe(false);
    });

    it("allows everything only on the explicit go-live wildcard", () => {
        const p = policy({
            HOPE_ENABLE_POST_COMMENT: "1",
            HOPE_POST_COMMENT_COHORTS: "*",
        });
        expect(isPostingAllowedFor(p, LIVE)).toBe(true);
    });

    it("dry run neither grants nor withholds permission", () => {
        // Dry run must not become a way round the allowlist, nor a
        // reason to refuse a cohort that is on it.
        const p = policy({
            HOPE_ENABLE_POST_COMMENT: "1",
            HOPE_POST_COMMENT_COHORTS: "1731",
            HOPE_POST_COMMENT_DRY_RUN: "1",
        });
        expect(p.dryRun).toBe(true);
        expect(isPostingAllowedFor(p, TEST)).toBe(true);
        expect(isPostingAllowedFor(p, LIVE)).toBe(false);
    });
});
