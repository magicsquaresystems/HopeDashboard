/**
 * What a facilitator is told when a shared marker fails to save.
 *
 * The guard these enforce is that nothing operational reaches the
 * message: an env var name or a status code in front of a facilitator
 * turns "that didn't save" into "something is badly broken", and they
 * cannot act on either.
 */

import { describe, expect, it } from "vitest";

import { ProxyError } from "@/lib/api/proxy-error";
import {
    friendlyQueueOpError,
    isQueueStateFatal,
    type QueueOpName,
} from "@/lib/queue-op-error";

const OPS: QueueOpName[] = [
    "snooze",
    "dismiss",
    "undoSnooze",
    "undoDismiss",
    "contacted",
];

const notConfigured = new ProxyError(
    "/api/queue-state",
    503,
    "Shared queue state is not configured (FIREBASE_SERVICE_ACCOUNT).",
    "queue_state_not_configured",
);

describe("friendlyQueueOpError", () => {
    it("names the action that failed, for every op", () => {
        for (const op of OPS) {
            const e = friendlyQueueOpError(op, new Error("boom"));
            expect(e.title.length).toBeGreaterThan(0);
            expect(e.title).toMatch(/^Couldn't /);
        }
    });

    it("never leaks an env var, route, or status code to the facilitator", () => {
        const errors = [
            notConfigured,
            new ProxyError("/api/queue-state", 401, "Not signed in", "auth_required"),
            new ProxyError("/api/queue-state", 403, "Forbidden"),
            new ProxyError("/api/queue-state", 500, "kaboom"),
            new Error("Failed to fetch"),
        ];
        for (const op of OPS) {
            for (const err of errors) {
                const { title, body } = friendlyQueueOpError(op, err);
                const text = `${title} ${body}`;
                expect(text).not.toMatch(/FIREBASE|SERVICE_ACCOUNT|_[a-z]+_[a-z]+/);
                expect(text).not.toMatch(/\/api\//);
                expect(text).not.toMatch(/\b(401|403|500|503)\b/);
            }
        }
    });

    it("says a missing store is for the programme team, not a retry", () => {
        const e = friendlyQueueOpError("snooze", notConfigured);
        expect(e.body).toMatch(/programme team/);
        expect(e.body).not.toMatch(/try again/i);
    });

    it("offers a retry for an ordinary network failure", () => {
        const e = friendlyQueueOpError("snooze", new Error("Failed to fetch"));
        expect(e.body).toMatch(/try again/i);
    });

    it("reassures that a copied reply is not lost when the contact marker fails", () => {
        // The reply reaches the clipboard before the marker is recorded,
        // so the draft survives. Without this the facilitator re-generates
        // a reply they are already holding.
        const e = friendlyQueueOpError("contacted", new Error("boom"));
        expect(e.body).toMatch(/clipboard/);
    });

    it("mentions the clipboard only for the contact marker", () => {
        for (const op of OPS.filter((o) => o !== "contacted")) {
            expect(friendlyQueueOpError(op, new Error("x")).body).not.toMatch(
                /clipboard/,
            );
        }
    });

    it("keeps the raw message for whoever operates the deployment", () => {
        expect(friendlyQueueOpError("snooze", notConfigured).detail).toContain(
            "FIREBASE_SERVICE_ACCOUNT",
        );
        expect(friendlyQueueOpError("snooze", "odd").detail).toBe("odd");
        expect(friendlyQueueOpError("snooze", null).detail).toBe("unknown error");
    });
});

describe("isQueueStateFatal", () => {
    it("stops polling for failures that cannot fix themselves", () => {
        expect(isQueueStateFatal(notConfigured)).toBe(true);
        expect(
            isQueueStateFatal(new ProxyError("/api/queue-state", 401, "x")),
        ).toBe(true);
        expect(
            isQueueStateFatal(new ProxyError("/api/queue-state", 403, "x")),
        ).toBe(true);
    });

    it("keeps polling through a blip, which is what the poll is for", () => {
        expect(
            isQueueStateFatal(new ProxyError("/api/queue-state", 503, "down")),
        ).toBe(false);
        expect(isQueueStateFatal(new Error("Failed to fetch"))).toBe(false);
        expect(isQueueStateFatal(null)).toBe(false);
    });
});
