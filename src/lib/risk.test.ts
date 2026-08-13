import { describe, expect, it } from "vitest";

import { friendlyStatus, tierExplanation } from "./risk";
import type { RiskLevel } from "@/lib/api/dropout";

/**
 * Live T42 cut-offs, taken from a real /predict response. Both are
 * CALIBRATED — the same scale as `dropout_probability`, which is what
 * the UI renders. The response also carries `threshold_used` (0.285),
 * which is in raw classifier space; passing that here instead would
 * quietly describe the wrong boundary.
 */
const LOW = 0.10084083525554764;
const HIGH = 0.21092813041807604;

describe("friendlyStatus", () => {
    it("maps each tier to its facilitator-facing label", () => {
        expect(friendlyStatus("high").label).toBe("Needs attention");
        expect(friendlyStatus("medium").label).toBe("Check in soon");
        expect(friendlyStatus("low").label).toBe("On track");
    });

    it("degrades to the cautious middle tier on an unexpected value", () => {
        // Reaches render straight off an API response; throwing here
        // would unmount the whole queue, not one row.
        const rogue = "unknown" as RiskLevel;
        expect(friendlyStatus(rogue).label).toBe("Check in soon");
    });
});

describe("tierExplanation", () => {
    it("states the boundary a high-risk participant cleared", () => {
        const note = tierExplanation("high", LOW, HIGH)!;
        // 30% reading as red is correct because red starts at 21%.
        expect(note).toContain("Needs attention: 21.1% or above");
    });

    it("states the band for the middle tier", () => {
        expect(tierExplanation("medium", LOW, HIGH)).toContain(
            "Check in soon: 10.1%–21.1%",
        );
    });

    it("states the ceiling for the low tier", () => {
        expect(tierExplanation("low", LOW, HIGH)).toContain(
            "On track: below 10.1%",
        );
    });

    it("explains why the cut-off is far below 50%", () => {
        expect(tierExplanation("high", LOW, HIGH)).toContain("9 in 10");
    });

    it("returns undefined when the service omits the cut-offs", () => {
        // Older service builds, or a payload shape change — better no
        // tooltip than one quoting "NaN%" boundaries.
        expect(tierExplanation("high", undefined, undefined)).toBeUndefined();
        expect(tierExplanation("high", LOW, undefined)).toBeUndefined();
        expect(tierExplanation("high", Number.NaN, HIGH)).toBeUndefined();
    });
});
