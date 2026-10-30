import { describe, expect, it } from "vitest";

import { parseFacilitatorIds, withExtraFacilitators } from "./facilitator-ids";

describe("parseFacilitatorIds", () => {
    it("reads a comma list and ignores blanks and junk", () => {
        expect(parseFacilitatorIds(" 101, 202 ,,abc, 3.5 ")).toEqual([101, 202]);
    });

    it("is empty when unset", () => {
        expect(parseFacilitatorIds(undefined)).toEqual([]);
        expect(parseFacilitatorIds("")).toEqual([]);
    });
});

describe("withExtraFacilitators", () => {
    it("matches a string session id against numeric platform ids", () => {
        // The session carries "6785"; the documents carry 6785. Without
        // normalising, the signed-in facilitator stays in their own queue.
        const set = withExtraFacilitators(new Set([900]), ["6785"]);
        expect(set.has(6785)).toBe(true);
        expect(set.has(900)).toBe(true);
    });

    it("skips ids that are not positive integers and leaves the input untouched", () => {
        const base = new Set<unknown>([900]);
        const set = withExtraFacilitators(base, ["", null, undefined, "x", -1, 0]);
        expect([...set]).toEqual([900]);
        expect(base.size).toBe(1);
    });
});
