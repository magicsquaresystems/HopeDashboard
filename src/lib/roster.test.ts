/**
 * The order the queue falls back to when the risk model has nothing to
 * say — a cohort in its first week.
 *
 * The bug these cover is not a mis-sort: it is that the queue used to
 * render no rows at all in this state, because rows were derived from
 * predictions and predictions are withheld before day 7.
 */

import { describe, expect, it } from "vitest";

import { lastEventAt, rosterOrder } from "@/lib/roster";
import type { EventRecord, ParticipantHistory } from "@/lib/api/dropout";

function history(
    id: string,
    timestamps: string[],
): ParticipantHistory {
    return {
        participant_id: id,
        effective_start: "2026-08-21T00:00:00Z",
        events: timestamps.map(
            (timestamp) =>
                ({ timestamp, event_type: "login" }) as EventRecord,
        ),
        cohort_size: 3,
        programme_length_days: 49,
        score_at_day: 7,
    };
}

describe("lastEventAt", () => {
    it("takes the latest event, not the last one in the array", () => {
        // Event order is not part of the bundle's contract. Reading
        // `events.at(-1)` would mis-sort the whole roster on a single
        // out-of-order row, and the symptom would be an ordering that
        // looks merely odd rather than wrong.
        const h = history("1", [
            "2026-08-21T10:00:00Z",
            "2026-08-21T18:00:00Z",
            "2026-08-21T12:00:00Z",
        ]);
        expect(lastEventAt(h)).toBe("2026-08-21T18:00:00Z");
    });

    it("is null when the participant has done nothing", () => {
        expect(lastEventAt(history("1", []))).toBeNull();
    });

    it("ignores empty and non-string timestamps rather than ranking on them", () => {
        const h = history("1", ["", "2026-08-21T09:00:00Z"]);
        expect(lastEventAt(h)).toBe("2026-08-21T09:00:00Z");
    });
});

describe("rosterOrder", () => {
    it("puts the most recently active participant first", () => {
        const order = rosterOrder([
            history("quiet", ["2026-08-21T09:00:00Z"]),
            history("recent", ["2026-08-21T19:00:00Z"]),
            history("middle", ["2026-08-21T12:00:00Z"]),
        ]).map((h) => h.participant_id);
        expect(order).toEqual(["recent", "middle", "quiet"]);
    });

    it("puts participants with no activity last", () => {
        // Not a judgement that they matter least — there is simply
        // nothing to reply to and no score to justify ranking them.
        const order = rosterOrder([
            history("silent", []),
            history("posted", ["2026-08-21T09:00:00Z"]),
        ]).map((h) => h.participant_id);
        expect(order).toEqual(["posted", "silent"]);
    });

    it("orders several silent participants deterministically", () => {
        // Two renders of identical data must not disagree, or rows swap
        // under the facilitator's cursor.
        const input = [history("b", []), history("a", []), history("c", [])];
        expect(rosterOrder(input).map((h) => h.participant_id)).toEqual([
            "a",
            "b",
            "c",
        ]);
        expect(rosterOrder(input).map((h) => h.participant_id)).toEqual(
            rosterOrder([...input].reverse()).map((h) => h.participant_id),
        );
    });

    it("does not mutate the array it was given", () => {
        // The caller passes the memoised `histories` array; sorting it
        // in place would reorder the batch call's cache key too.
        const input = [
            history("a", ["2026-08-21T09:00:00Z"]),
            history("b", ["2026-08-21T19:00:00Z"]),
        ];
        rosterOrder(input);
        expect(input.map((h) => h.participant_id)).toEqual(["a", "b"]);
    });

    it("keeps every participant", () => {
        const input = [
            history("a", []),
            history("b", ["2026-08-21T19:00:00Z"]),
            history("c", ["2026-08-21T09:00:00Z"]),
        ];
        expect(rosterOrder(input)).toHaveLength(3);
    });
});
