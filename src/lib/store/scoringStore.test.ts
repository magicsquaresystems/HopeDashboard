import { describe, expect, it } from "vitest";

import {
    useScoringStore,
    isAnchoredWeek,
    MODEL_MAX_WEEK,
    programmeWeeks,
    scoreAtDay,
    weeksWithData,
} from "./scoringStore";

const START = "2026-02-11T00:00:00Z";
const DAY = 86_400_000;

/** `now`, expressed as whole days after the cohort start. */
const atDay = (d: number) => Date.parse(START) + d * DAY;

describe("scoreAtDay", () => {
    it("maps week N to day 7N", () => {
        expect(scoreAtDay(1)).toBe(7);
        expect(scoreAtDay(6)).toBe(42);
        expect(scoreAtDay(8)).toBe(56);
    });
});

describe("programmeWeeks", () => {
    it("derives the week set from programme length", () => {
        expect(programmeWeeks(28)).toEqual([1, 2, 3, 4]);
        expect(programmeWeeks(42)).toEqual([1, 2, 3, 4, 5, 6]);
        expect(programmeWeeks(56)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    });

    it("never returns an empty selector", () => {
        expect(programmeWeeks(0)).toEqual([1]);
    });
});

/**
 * The trained set now runs to T56. A week is anchored only when it asks
 * for more days than the model was trained on — W8 must NOT be flagged,
 * or an 8-week cohort permanently displays a "score is frozen" warning
 * over a score that is in fact current.
 */
describe("isAnchoredWeek", () => {
    it("does not flag weeks the model was trained for", () => {
        for (let w = 1; w <= MODEL_MAX_WEEK; w++) {
            expect(isAnchoredWeek(w)).toBe(false);
        }
    });

    it("flags weeks past the last trained horizon", () => {
        expect(isAnchoredWeek(MODEL_MAX_WEEK + 1)).toBe(true);
    });
});

/**
 * Week N is scoreable only once it has fully elapsed: scoring it asks
 * the model about days 0..7N-1, and a partly-elapsed window reads as
 * disengagement rather than a week in progress. So week 1 opens on day
 * 7, and a brand-new cohort has nothing to score.
 */
describe("weeksWithData", () => {
    it("has no scoreable week before the first one completes", () => {
        expect(weeksWithData(42, START, atDay(0))).toBe(0);
        expect(weeksWithData(42, START, atDay(6))).toBe(0);
    });

    it("opens week 1 on day 7", () => {
        expect(weeksWithData(42, START, atDay(7))).toBe(1);
    });

    it("accrues one week per elapsed week", () => {
        expect(weeksWithData(42, START, atDay(21))).toBe(3);
    });

    it("stops at the programme's own length", () => {
        expect(weeksWithData(42, START, atDay(200))).toBe(6);
    });

    it("falls back to the full programme when the start is unparseable", () => {
        expect(weeksWithData(42, "not-a-date", atDay(3))).toBe(6);
    });
});

describe("openCohort", () => {
    function fresh() {
        useScoringStore.setState({ scoreAtWeek: 6, openCohortId: null });
        return useScoringStore.getState();
    }

    it("lands on the cohort's most recent elapsed week", () => {
        // Not a fixed week 6: a six-week cohort used to open on its last
        // week and a ten-week one four weeks behind where it stood. See
        // the landing cap below for what happens past MODEL_MAX_WEEK.
        fresh().openCohort(1731, 7);
        expect(useScoringStore.getState().scoreAtWeek).toBe(7);
    });

    it("does not move a week the facilitator chose themselves", () => {
        // Stepping back to week 3 to see how the cohort looked then must
        // survive the background refresh that follows a few seconds later.
        fresh().openCohort(1731, 7);
        useScoringStore.getState().setScoreAtWeek(3);
        useScoringStore.getState().openCohort(1731, 7);
        expect(useScoringStore.getState().scoreAtWeek).toBe(3);
    });

    it("lands again when a different cohort is opened", () => {
        fresh().openCohort(1731, 7);
        useScoringStore.getState().setScoreAtWeek(3);
        useScoringStore.getState().openCohort(1223, 6);
        expect(useScoringStore.getState().scoreAtWeek).toBe(6);
    });

    it("never lands below week 1, even before a cohort has run a week", () => {
        fresh().openCohort(1800, 0);
        expect(useScoringStore.getState().scoreAtWeek).toBe(1);
    });
});

describe("openCohort landing cap", () => {
    it("never lands past the model's last trained week", () => {
        // A ten-week span is usually a six-week course left open four
        // weeks longer. Landing on week 9 would score everyone against
        // post-course quiet and call a finished cohort high risk — and
        // the service anchors anything past MODEL_MAX_WEEK back to it
        // regardless, so the request could not say anything new.
        useScoringStore.setState({ scoreAtWeek: 6, openCohortId: null });
        useScoringStore.getState().openCohort(1731, 10);
        expect(useScoringStore.getState().scoreAtWeek).toBe(MODEL_MAX_WEEK);
    });

    it("still lands on the real week when a cohort is shorter than the cap", () => {
        useScoringStore.setState({ scoreAtWeek: 6, openCohortId: null });
        useScoringStore.getState().openCohort(1743, 3);
        expect(useScoringStore.getState().scoreAtWeek).toBe(3);
    });

    it("leaves the later weeks selectable by hand", () => {
        // Capping the landing must not cap the control.
        useScoringStore.setState({ scoreAtWeek: 6, openCohortId: null });
        useScoringStore.getState().openCohort(1731, 10);
        useScoringStore.getState().setScoreAtWeek(10);
        expect(useScoringStore.getState().scoreAtWeek).toBe(10);
    });
});
