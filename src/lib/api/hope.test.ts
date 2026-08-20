import { describe, expect, it } from "vitest";

import {
    programmeLengthFrom,
    toCohortList,
    toCohortMeta,
    toPlatformActivityType,
} from "@/lib/api/hope";

/** The example from the platform engineer's integration note, verbatim.
 *  If the real endpoint disagrees with this, this fixture is what to
 *  update first. */
const DOCUMENTED_ROW = {
    cohortId: 123,
    cohortName: "Level 3 Business",
    moduleId: 45,
    moduleName: "Business Studies",
    startDate: "2026-01-01T00:00:00",
    endDate: "2026-12-31T00:00:00",
};

describe("toCohortMeta", () => {
    it("converts the documented payload", () => {
        expect(toCohortMeta(DOCUMENTED_ROW)).toEqual({
            id: 123,
            code: "Level 3 Business",
            moduleId: 45,
            moduleName: "Business Studies",
            programmeLengthDays: 364,
            programmeLengthKnown: true,
            effectiveStart: "2026-01-01T00:00:00Z",
        });
    });

    it("flags an absent end date rather than inventing a programme shape", () => {
        // Live platform data: cohort 1223 arrives with `endDate: null`
        // (an open-ended training module). The length still has to be a
        // number for scoring, but the week selector must not draw six
        // weeks and label the last one "end of programme" when nobody
        // set a finish date.
        const meta = toCohortMeta({ ...DOCUMENTED_ROW, endDate: null });
        expect(meta?.programmeLengthDays).toBe(42);
        expect(meta?.programmeLengthKnown).toBe(false);
    });

    it("does not trust an end date that measures nothing", () => {
        // Every one of these falls back to the six-week default, so
        // none of them may be reported as a known length. The first is
        // .NET's `default(DateTime)`, which this platform's serialiser
        // can emit; the rest are the ordinary ways a date field goes
        // wrong. Deriving the flag from "is endDate non-empty" called
        // all of them known and drew a six-week programme.
        for (const endDate of [
            "0001-01-01T00:00:00",
            "TBD",
            "   ",
            "2026-01-01T00:00:00", // same day as start
            "2025-01-01T00:00:00", // before start
        ]) {
            const meta = toCohortMeta({ ...DOCUMENTED_ROW, endDate });
            expect(meta?.programmeLengthDays).toBe(42);
            expect(meta?.programmeLengthKnown).toBe(false);
        }
    });

    it("treats a real end date as a known length", () => {
        // Cohort 1731, live at the time of writing: 17 Jun to 26 Aug is
        // ten weeks, and the platform does send the finish date for a
        // scheduled programme.
        const meta = toCohortMeta({
            ...DOCUMENTED_ROW,
            startDate: "2026-06-17T00:00:00",
            endDate: "2026-08-26T00:00:00",
        });
        expect(meta?.programmeLengthDays).toBe(70);
        expect(meta?.programmeLengthKnown).toBe(true);
    });

    it("adds the missing timezone to startDate", () => {
        // Platform timestamps arrive naive and engagement_ml 422s on them,
        // so every one of them gets `Z` appended. This field is no
        // different — the same rule the extraction script has always used.
        expect(toCohortMeta(DOCUMENTED_ROW)?.effectiveStart).toBe(
            "2026-01-01T00:00:00Z",
        );
    });

    it("leaves an already tz-aware startDate alone", () => {
        const meta = toCohortMeta({
            ...DOCUMENTED_ROW,
            startDate: "2026-01-01T00:00:00+01:00",
        });
        expect(meta?.effectiveStart).toBe("2026-01-01T00:00:00+01:00");
    });

    it("rejects a row with no usable cohort id", () => {
        expect(toCohortMeta({ ...DOCUMENTED_ROW, cohortId: undefined })).toBeNull();
        expect(toCohortMeta({ ...DOCUMENTED_ROW, cohortId: "not a number" })).toBeNull();
    });

    it("rejects a row with no start date", () => {
        // Everything downstream is measured from the start date; without
        // one there is no week selector and no risk score.
        expect(toCohortMeta({ ...DOCUMENTED_ROW, startDate: "" })).toBeNull();
        expect(toCohortMeta({ ...DOCUMENTED_ROW, startDate: undefined })).toBeNull();
    });

    it("rejects anything that is not an object", () => {
        for (const bad of [null, undefined, "cohort", 42, []]) {
            expect(toCohortMeta(bad)).toBeNull();
        }
    });

    it("names a cohort that arrived without one", () => {
        const meta = toCohortMeta({ ...DOCUMENTED_ROW, cohortName: undefined });
        expect(meta?.code).toBe("Cohort 123");
    });
});

describe("programmeLengthFrom", () => {
    it("returns whole weeks", () => {
        expect(programmeLengthFrom("2026-01-01", "2026-02-12") % 7).toBe(0);
    });

    it("keeps an exact six-week programme exact", () => {
        // The shape every HOPE cohort has had so far.
        expect(programmeLengthFrom("2026-02-11", "2026-03-25")).toBe(42);
    });

    it("rounds rather than truncates", () => {
        // 46 days is 6.57 weeks. Truncating gives 42 and drops most of a
        // week off the end of the selector; rounding gives 49.
        expect(programmeLengthFrom("2026-01-01", "2026-02-16")).toBe(49);
    });

    it("falls back when the dates make no sense", () => {
        // A cohort we can name but cannot measure is still worth showing —
        // hiding it reads to a facilitator as "your cohort has vanished".
        expect(programmeLengthFrom("2026-01-01", "")).toBe(42);
        expect(programmeLengthFrom("not a date", "also not")).toBe(42);
        expect(programmeLengthFrom("2026-06-01", "2026-01-01")).toBe(42);
    });

    it("never returns zero", () => {
        // A zero-length programme would divide by nothing downstream.
        expect(programmeLengthFrom("2026-01-01", "2026-01-02")).toBe(7);
    });
});

describe("toPlatformActivityType", () => {
    it("maps the three types facilitators actually reply to", () => {
        // Measured across all three cohorts: GoalSetting 152, Gratitude 77,
        // MyHOPE 6.
        expect(toPlatformActivityType("GoalSetting")).toBe("GoalSetting");
        expect(toPlatformActivityType("Gratitude")).toBe("Gratitude");
        expect(toPlatformActivityType("MyHOPE")).toBe("MyHOPE");
    });

    it("maps forum activity to Post under either of our names", () => {
        // `Discussion` on an activity record, `discussion_post` on an event.
        expect(toPlatformActivityType("Discussion")).toBe("Post");
        expect(toPlatformActivityType("discussion_post")).toBe("Post");
        expect(toPlatformActivityType("Post")).toBe("Post");
    });

    it("is case and whitespace insensitive", () => {
        expect(toPlatformActivityType("  goalsetting ")).toBe("GoalSetting");
        expect(toPlatformActivityType("MYHOPE")).toBe("MyHOPE");
    });

    it("returns null for Emotions", () => {
        // Not an oversight on either side: facilitators never reply to an
        // Emotions entry, so the platform has no value for one.
        expect(toPlatformActivityType("Emotions")).toBeNull();
    });

    it("returns null rather than guessing at anything unknown", () => {
        // A reply filed under the wrong activity type attaches to the wrong
        // record, on a live programme. Refusing is the only safe default.
        for (const bad of ["", null, undefined, "Wellbeing", "login"]) {
            expect(toPlatformActivityType(bad)).toBeNull();
        }
    });
});

describe("toCohortList", () => {
    it("maps a list", () => {
        const list = toCohortList([DOCUMENTED_ROW, { ...DOCUMENTED_ROW, cohortId: 124 }]);
        expect(list.map((c) => c.id)).toEqual([123, 124]);
    });

    it("drops malformed rows but keeps the rest", () => {
        // One bad cohort must not hide every other cohort a facilitator has.
        const list = toCohortList([DOCUMENTED_ROW, { cohortId: "junk" }, null]);
        expect(list.map((c) => c.id)).toEqual([123]);
    });

    it("reads the rows out of the wrapper the live endpoint sends", () => {
        // `{ cohorts: [...] }` is what the platform actually returns.
        // Insisting on a bare array here emptied the picker for every
        // facilitator while the platform was answering 200 with their
        // real cohorts.
        const list = toCohortList({ cohorts: [DOCUMENTED_ROW] });
        expect(list.map((c) => c.id)).toEqual([123]);
    });

    it("accepts the PascalCase wrapper too", () => {
        // The platform's own /api/auth/exchange serialises PascalCase, so
        // the casing is per-endpoint rather than a property of the API.
        const list = toCohortList({ Cohorts: [DOCUMENTED_ROW] });
        expect(list.map((c) => c.id)).toEqual([123]);
    });

    it("returns an empty list for a payload carrying no rows", () => {
        for (const bad of [null, undefined, {}, "[]", { cohorts: null }]) {
            expect(toCohortList(bad)).toEqual([]);
        }
    });
});
