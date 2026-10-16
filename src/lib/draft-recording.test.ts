import { describe, expect, it, vi } from "vitest";
import { createDraftRecorder, currentGrounding, publicationStatus } from "./draft-recording";

describe("draft adoption and delivery", () => {
    it("copying leaves delivery available and records the final edited text", () => {
        const recorder = createDraftRecorder();
        const copy = vi.fn();
        const deliver = vi.fn();
        recorder.copy("draft", copy);
        recorder.copy("draft", copy);
        expect(copy).toHaveBeenCalledTimes(1);
        expect(deliver).not.toHaveBeenCalled();
        recorder.publish("draft", "The final edited reply", "edit", deliver);
        recorder.publish("draft", "The final edited reply", "edit", deliver);
        expect(deliver).toHaveBeenCalledExactlyOnceWith("draft", "The final edited reply", "edit");
    });
    it("a changed or polished reply loses its old grounding verdict", () => {
        const draft = { body: "Original", grounding: "grounded" as const };
        expect(currentGrounding(draft, "Original")).toBe("grounded");
        expect(currentGrounding(draft, "Polished")).toBe("unchecked");
        expect(currentGrounding(draft, "Edited")).toBe("unchecked");
    });
    it("missing publication confirmation cannot be mistaken for delivery", () => {
        expect(() => publicationStatus(undefined)).toThrow("did not confirm");
        expect(() => publicationStatus({})).toThrow("did not confirm");
        expect(publicationStatus({ status: "dry_run" })).toBe("dry_run");
        expect(publicationStatus({ status: "published" })).toBe("published");
    });
});
