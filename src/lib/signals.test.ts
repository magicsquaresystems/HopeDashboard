import { describe, expect, it } from "vitest";

import {
    daysSinceLastEvent,
    eventsLastNDays,
    lastActiveLabel,
    scoreWindowEnd,
    signalClock,
} from "./signals";
import type { EventRecord, ParticipantHistory } from "@/lib/api/dropout";

const START = "2026-02-11T00:00:00Z";
const DAY = 86_400_000;

/** An event `day` days after the cohort start. */
function evt(day: number, event_type = "discussion_post"): EventRecord {
    return {
        timestamp: new Date(Date.parse(START) + day * DAY).toISOString(),
        event_type,
    } as EventRecord;
}

function history(
    events: EventRecord[],
    scoreAtDay: number,
): ParticipantHistory {
    return {
        participant_id: "1",
        effective_start: START,
        events,
        score_at_day: scoreAtDay,
        programme_length_days: 42,
    } as ParticipantHistory;
}

describe("scoreWindowEnd", () => {
    it("closes the window at effective_start + score_at_day", () => {
        expect(scoreWindowEnd(history([], 21))).toBe(Date.parse(START) + 21 * DAY);
    });
});

/**
 * A participant with no events at all is a different fact from one last
 * seen N days ago, and the queue leads with this line. Returning
 * `score_at_day` as a stand-in claimed activity on day 0 for people who
 * never showed up — 20 of 51 participants in one shipped cohort.
 */
describe("daysSinceLastEvent", () => {
    it("returns null when the participant has no events", () => {
        expect(daysSinceLastEvent(history([], 42))).toBeNull();
        expect(lastActiveLabel(history([], 42))).toBe("No activity yet");
    });

    it("measures against the scoring window, not the wall clock", () => {
        // Last event on day 40, window closes day 42 → 2 days.
        expect(daysSinceLastEvent(history([evt(40)], 42))).toBe(2);
        expect(lastActiveLabel(history([evt(40)], 42))).toBe(
            "Last active 2 days ago",
        );
    });

    it("reports same-day activity as zero", () => {
        expect(daysSinceLastEvent(history([evt(42)], 42))).toBe(0);
        expect(lastActiveLabel(history([evt(42)], 42))).toBe("Active today");
    });
});

/**
 * The comparison window must fit inside the programme. Events before
 * `effective_start` do not exist, so at week 3 the "prior 14d" window
 * covers only 7 real days — a perfectly steady participant then reads
 * "+100%" (or worse) and the tile turns green for no reason. Suppress
 * the delta until the baseline is a full window.
 */
describe("eventsLastNDays", () => {
    it("counts events inside the trailing window", () => {
        const h = history([evt(30), evt(35), evt(40)], 42);
        expect(eventsLastNDays(h, "discussion_post", 14).count).toBe(3);
    });

    it("ignores events of other types", () => {
        const h = history([evt(40), evt(41, "login")], 42);
        expect(eventsLastNDays(h, "discussion_post", 14).count).toBe(1);
    });

    it("suppresses the delta while the prior window predates the cohort", () => {
        // score_at_day 21 < 2 * 14: the prior window would start on day -7.
        const steady = history([evt(8), evt(12), evt(16), evt(20)], 21);
        expect(eventsLastNDays(steady, "discussion_post", 14).deltaPercent).toBeNull();
    });

    it("reports the delta once the prior window fits", () => {
        // score_at_day 28 = 2 * 14, so days 0–13 vs 14–27 are both real.
        const h = history(
            [evt(1), evt(2), evt(15), evt(16), evt(17), evt(18)],
            28,
        );
        const { count, deltaPercent } = eventsLastNDays(h, "discussion_post", 14);
        expect(count).toBe(4); // days 14–27
        expect(deltaPercent).toBe(100); // 4 vs 2
    });

    it("returns a null delta when the prior window is empty", () => {
        const h = history([evt(20), evt(21)], 28);
        expect(eventsLastNDays(h, "discussion_post", 14).deltaPercent).toBeNull();
    });
});

describe("daysSinceLastEvent — a window that has not closed yet", () => {
    const DAY = 86_400_000;
    const START = "2026-08-21T00:00:00Z";
    const now = new Date("2026-08-21T20:00:00Z").getTime();

    function history(eventAt: string) {
        return {
            participant_id: "1",
            effective_start: START,
            // Week 1 closes on day 7 — six days after this cohort began
            // and well into the future at `now`.
            score_at_day: 7,
            cohort_size: 3,
            programme_length_days: 49,
            events: [{ timestamp: eventAt, event_type: "login" }],
        } as never;
    }

    it("does not age activity against days that have not happened", () => {
        // The bug this covers: a participant who posted this morning was
        // shown as "Last active 6 days ago", because the distance was
        // measured to the close of a week still in progress.
        expect(daysSinceLastEvent(history("2026-08-21T17:00:00Z"), now)).toBe(0);
        expect(lastActiveLabel(history("2026-08-21T17:00:00Z"), now)).toBe(
            "Active today",
        );
    });

    it("still counts real quiet inside an unfinished week", () => {
        expect(
            daysSinceLastEvent(history("2026-08-19T17:00:00Z"), now),
        ).toBe(2);
    });

    it("measures to the window's close once that close is in the past", () => {
        // Replaying an earlier checkpoint must keep saying how quiet
        // someone was AT that checkpoint, not how long ago it was.
        const later = now + 30 * DAY;
        expect(daysSinceLastEvent(history("2026-08-21T00:00:00Z"), later)).toBe(
            7,
        );
    });
});


/**
 * The first-week case. `scoreWindowEnd` sits up to seven days in the
 * future while a cohort's first week is running, and everything measured
 * against it aged by days that had not happened: yesterday's post read
 * "6d ago" in the drafts panel while the queue said "1 day ago".
 */
describe("signalClock", () => {
    it("is the window end once that week has passed", () => {
        const h = history([], 21);
        const later = Date.parse(START) + 40 * DAY;
        expect(signalClock(h, later)).toBe(scoreWindowEnd(h));
    });

    it("is the wall clock while the window is still open", () => {
        const h = history([], 7);
        const duringWeekOne = Date.parse(START) + 2 * DAY;
        expect(signalClock(h, duringWeekOne)).toBe(duringWeekOne);
    });
});
