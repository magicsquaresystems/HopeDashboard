import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/client";
import { requiredId } from "./_params";

function query(search: string): URLSearchParams {
    return new URLSearchParams(search);
}

/**
 * The case that motivated this: an absent parameter must not read as the
 * number zero. Two proxy routes checked `Number(params.get(...))` with
 * `Number.isFinite` / `Number.isSafeInteger`, and both let a request with
 * no cohort id through to the access check as cohort 0.
 */
describe("requiredId", () => {
    it("reads a normal id", () => {
        expect(requiredId(query("cohortId=1743"), "cohortId")).toBe(1743);
    });

    it("refuses an absent parameter rather than calling it zero", () => {
        expect(() => requiredId(query(""), "cohortId")).toThrow(ApiError);
        try {
            requiredId(query(""), "cohortId");
        } catch (err) {
            expect((err as ApiError).status).toBe(400);
            expect((err as ApiError).detail).toContain("cohortId");
        }
    });

    it.each([
        ["empty", "cohortId="],
        ["whitespace", "cohortId=%20%20"],
        ["zero", "cohortId=0"],
        ["negative", "cohortId=-5"],
        ["fractional", "cohortId=1.5"],
        ["not a number", "cohortId=abc"],
        ["a number with junk", "cohortId=17x"],
    ])("refuses %s", (_label, search) => {
        expect(() => requiredId(query(search), "cohortId")).toThrow(ApiError);
    });

    it("names the parameter it is complaining about", () => {
        try {
            requiredId(query("cohortId=1"), "recordId");
        } catch (err) {
            expect((err as ApiError).detail).toContain("recordId");
        }
    });
});
