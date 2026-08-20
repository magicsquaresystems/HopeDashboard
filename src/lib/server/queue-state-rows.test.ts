import { describe, expect, it } from "vitest";

import { CONTACTED_TTL_DAYS } from "@/lib/queue-state-shared";
import {
    hydrateQueueState,
    kindForOp,
    type QueueStateRow,
} from "./queue-state-rows";

const T0 = 1_700_000_000_000; // fixed epoch — no wall-clock in tests
const DAY = 86_400_000;
const ALICE = "alice@hope.org";
const BOB = "bob@hope.org";

function row(over: Partial<QueueStateRow> = {}): QueueStateRow {
    return {
        participantId: "P1",
        kind: "dismiss",
        by: ALICE,
        at: T0,
        until: null,
        action: null,
        ...over,
    };
}

describe("hydrateQueueState", () => {
    it("maps a snooze row into snoozes with its expiry and actor", () => {
        const s = hydrateQueueState(
            [row({ kind: "snooze", until: T0 + 7 * DAY })],
            T0,
        );
        expect(s.snoozes.P1).toEqual({ until: T0 + 7 * DAY, by: ALICE, at: T0 });
        expect(s.dismissals).toEqual({});
    });

    it("maps a dismiss row into dismissals", () => {
        const s = hydrateQueueState([row({ kind: "dismiss" })], T0);
        expect(s.dismissals.P1).toEqual({ by: ALICE, at: T0 });
    });

    it("maps the stored kind 'contact' into contacted", () => {
        // The op is `contacted`, the stored kind is `contact`. Renaming
        // either without the other is the bug this test exists to catch.
        const s = hydrateQueueState(
            [row({ kind: "contact", action: "edit" })],
            T0,
        );
        expect(s.contacted.P1).toEqual({ by: ALICE, at: T0, action: "edit" });
    });

    it("keeps a contact marker whose action is unreadable, as an accept", () => {
        // Losing the marker would let a second facilitator message
        // someone already contacted. Mislabelling the verb is the
        // lesser harm.
        const s = hydrateQueueState(
            [row({ kind: "contact", action: "nonsense" })],
            T0,
        );
        expect(s.contacted.P1).toEqual({ by: ALICE, at: T0, action: "accept" });
    });

    it("drops a snooze with no expiry rather than storing NaN", () => {
        // `until: NaN` compares false against every clock, so the
        // participant would be hidden forever.
        const s = hydrateQueueState([row({ kind: "snooze", until: null })], T0);
        expect(s.snoozes).toEqual({});
    });

    it("ignores a kind it does not recognise", () => {
        // Forward compatibility: a newer deployment writing a fourth
        // kind must not take an older one's queue down.
        const s = hydrateQueueState(
            [row({ kind: "escalate" }), row({ participantId: "P2" })],
            T0,
        );
        expect(s.dismissals.P2).toBeDefined();
        expect(Object.keys(s.snoozes)).toEqual([]);
        expect(Object.keys(s.contacted)).toEqual([]);
    });

    it("prunes against the supplied now, not the wall clock", () => {
        // The case that guarantees every backend agrees about what is
        // still in force.
        const later = T0 + 30 * DAY;
        const s = hydrateQueueState(
            [
                row({ kind: "snooze", until: T0 + DAY }),
                row({
                    participantId: "P2",
                    kind: "contact",
                    at: T0 - (CONTACTED_TTL_DAYS + 1) * DAY,
                    action: "accept",
                }),
                row({ participantId: "P3", kind: "dismiss", at: T0 - 400 * DAY }),
            ],
            later,
        );
        expect(s.snoozes).toEqual({});
        expect(s.contacted).toEqual({});
        // Dismissals are never pruned — they are a decision, not a timer.
        expect(s.dismissals.P3).toEqual({ by: ALICE, at: T0 - 400 * DAY });
    });

    it("returns all three buckets for an empty row set", () => {
        // The UI indexes into these unguarded.
        expect(hydrateQueueState([], T0)).toEqual({
            snoozes: {},
            dismissals: {},
            contacted: {},
        });
    });

    it("resolves duplicate rows for one marker as last-wins", () => {
        // A primary key makes this impossible in storage; the function
        // stays total anyway rather than throwing.
        const s = hydrateQueueState(
            [
                row({ kind: "dismiss", by: ALICE }),
                row({ kind: "dismiss", by: BOB, at: T0 + 1 }),
            ],
            T0,
        );
        expect(s.dismissals.P1).toEqual({ by: BOB, at: T0 + 1 });
    });
});

describe("kindForOp", () => {
    it("maps every operation to the marker it writes or clears", () => {
        const cases = [
            [{ op: "snooze", participantId: "P1", days: 7 }, "snooze"],
            [{ op: "undoSnooze", participantId: "P1" }, "snooze"],
            [{ op: "dismiss", participantId: "P1" }, "dismiss"],
            [{ op: "undoDismiss", participantId: "P1" }, "dismiss"],
            [{ op: "contacted", participantId: "P1", action: "accept" }, "contact"],
        ] as const;
        for (const [op, expected] of cases) {
            expect(kindForOp(op)).toBe(expected);
        }
    });
});
