import { describe, expect, it } from "vitest";
import { generationMemory } from "./generation-memory";
import type { CohortBundle } from "./cohort-data";

describe("trusted generation memory", () => {
    it("seeds platform participant posts, excludes later records and other authors", () => {
        const events = [
            {activity_id:1,activity_type:"GoalSetting",event_type:"activity",timestamp:"2026-01-01T00:00:00Z",description:"A prior goal"},
            {activity_id:2,activity_type:"GoalSetting",event_type:"activity",timestamp:"2026-01-02T00:00:00Z",description:"The focal goal"},
            {activity_id:3,activity_type:"GoalSetting",event_type:"activity",timestamp:"2026-01-03T00:00:00Z",description:"A later goal"},
            {activity_id:4,activity_type:"GoalSetting",event_type:"facilitator_comment",timestamp:"2026-01-01T00:00:00Z",description:"A facilitator reply"},
        ];
        const bundle = {cohort:{id:77,moduleId:1},participants:[{participant_id:"101",events}]} as CohortBundle;
        const request = {participant_id:101,cohort_id:77,activity_id:2,activity_type:"GoalSetting",post_text:"Browser-supplied text"} as const;
        const memory=generationMemory(bundle,101,request);
        expect(memory.items.map((i) => i.text)).toEqual(["A prior goal","The focal goal"]);
        expect(memory.postRecordedAt).toBe("2026-01-02T00:00:00Z");
        expect(memory.items.every((i) => i.cohort_id===77 && i.participant_id===101)).toBe(true);
    });
});
