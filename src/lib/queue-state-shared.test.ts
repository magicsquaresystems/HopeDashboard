import { describe, expect, it } from "vitest";

import {
    applyOp,
    emptyQueueState,
    isHidden,
    isQueueOp,
    pruneQueueState,
    agoLabel,
    shortActor,
    type CohortQueueState,
} from "./queue-state-shared";

const T0 = 1_700_000_000_000; // fixed epoch — no wall-clock in tests
const DAY = 86_400_000;
const ALICE = "alice@hope.org";
const BOB = "bob@hope.org";

describe("applyOp", () => {
    it("records who snoozed and until when", () => {
        const s = applyOp(
            emptyQueueState(),
            { op: "snooze", participantId: "P1", days: 7 },
            ALICE,
            T0,
        );
        expect(s.snoozes.P1).toEqual({ until: T0 + 7 * DAY, by: ALICE, at: T0 });
    });

    it("does not mutate the input state", () => {
        const before = emptyQueueState();
        applyOp(before, { op: "dismiss", participantId: "P1" }, ALICE, T0);
        expect(before.dismissals).toEqual({});
    });

    it("lets a second facilitator overwrite the first (last write wins)", () => {
        let s = applyOp(
            emptyQueueState(),
            { op: "snooze", participantId: "P1", days: 7 },
            ALICE,
            T0,
        );
        s = applyOp(
            s,
            { op: "snooze", participantId: "P1", days: 1 },
            BOB,
            T0 + 1000,
        );
        expect(s.snoozes.P1.by).toBe(BOB);
        expect(s.snoozes.P1.until).toBe(T0 + 1000 + DAY);
    });

    it("undo removes only the matching kind", () => {
        let s = applyOp(
            emptyQueueState(),
            { op: "snooze", participantId: "P1", days: 7 },
            ALICE,
            T0,
        );
        s = applyOp(s, { op: "dismiss", participantId: "P1" }, ALICE, T0);
        s = applyOp(s, { op: "undoSnooze", participantId: "P1" }, ALICE, T0);
        expect(s.snoozes.P1).toBeUndefined();
        expect(s.dismissals.P1).toBeDefined();
    });

    it("undoing something that was never set is a no-op", () => {
        const s = applyOp(
            emptyQueueState(),
            { op: "undoDismiss", participantId: "ghost" },
            ALICE,
            T0,
        );
        expect(s.dismissals).toEqual({});
    });

    it("records the contact action so colleagues see who replied", () => {
        const s = applyOp(
            emptyQueueState(),
            { op: "contacted", participantId: "P1", action: "edit" },
            BOB,
            T0,
        );
        expect(s.contacted.P1).toEqual({ by: BOB, at: T0, action: "edit" });
    });
});

describe("pruneQueueState", () => {
    it("drops an elapsed snooze so the participant reappears", () => {
        const s = applyOp(
            emptyQueueState(),
            { op: "snooze", participantId: "P1", days: 1 },
            ALICE,
            T0,
        );
        expect(pruneQueueState(s, T0 + 2 * DAY).snoozes.P1).toBeUndefined();
        expect(pruneQueueState(s, T0 + DAY / 2).snoozes.P1).toBeDefined();
    });

    it("expires contact markers past the TTL but keeps dismissals forever", () => {
        let s = applyOp(
            emptyQueueState(),
            { op: "contacted", participantId: "P1", action: "accept" },
            ALICE,
            T0,
        );
        s = applyOp(s, { op: "dismiss", participantId: "P2" }, ALICE, T0);
        const later = pruneQueueState(s, T0 + 30 * DAY);
        expect(later.contacted.P1).toBeUndefined();
        expect(later.dismissals.P2).toBeDefined();
    });
});

describe("isHidden", () => {
    const base: CohortQueueState = {
        snoozes: { P1: { until: T0 + DAY, by: ALICE, at: T0 } },
        dismissals: { P2: { by: BOB, at: T0 } },
        contacted: {},
    };

    it("hides snoozed until expiry, dismissed indefinitely", () => {
        expect(isHidden(base, "P1", T0)).toBe(true);
        expect(isHidden(base, "P1", T0 + 2 * DAY)).toBe(false);
        expect(isHidden(base, "P2", T0 + 365 * DAY)).toBe(true);
        expect(isHidden(base, "P3", T0)).toBe(false);
    });
});

describe("isQueueOp", () => {
    it("accepts every valid operation", () => {
        expect(
            isQueueOp({ op: "snooze", participantId: "P1", days: 7 }),
        ).toBe(true);
        expect(isQueueOp({ op: "dismiss", participantId: "P1" })).toBe(true);
        expect(
            isQueueOp({ op: "contacted", participantId: "P1", action: "edit" }),
        ).toBe(true);
    });

    it("rejects malformed bodies rather than trusting the client", () => {
        expect(isQueueOp(null)).toBe(false);
        expect(isQueueOp({ op: "drop-table", participantId: "P1" })).toBe(false);
        expect(isQueueOp({ op: "snooze", participantId: "" , days: 7 })).toBe(
            false,
        );
        // Unbounded or nonsensical snoozes would hide someone for years.
        expect(
            isQueueOp({ op: "snooze", participantId: "P1", days: 9999 }),
        ).toBe(false);
        expect(
            isQueueOp({ op: "snooze", participantId: "P1", days: -1 }),
        ).toBe(false);
        expect(
            isQueueOp({ op: "contacted", participantId: "P1", action: "sent" }),
        ).toBe(false);
    });
});

describe("display helpers", () => {
    it("shortens emails for narrow queue rows", () => {
        expect(shortActor(ALICE)).toBe("alice");
        expect(shortActor("nodomain")).toBe("nodomain");
    });

    it("labels elapsed time in the coarsest useful unit", () => {
        expect(agoLabel(T0, T0)).toBe("just now");
        expect(agoLabel(T0, T0 + 5 * 60_000)).toBe("5m ago");
        expect(agoLabel(T0, T0 + 3 * 3_600_000)).toBe("3h ago");
        expect(agoLabel(T0, T0 + DAY)).toBe("yesterday");
        expect(agoLabel(T0, T0 + 4 * DAY)).toBe("4d ago");
    });
});
