import { describe, expect, it } from "vitest";
import { bundleToHistory, predictionContext } from "./realCohort";
import type { CohortBundle } from "./server/cohort-data";

const iso = (day: number) => `2026-01-${String(day).padStart(2,"0")}T00:00:00Z`;
function bundle(): CohortBundle {
    return {
        cohort: {id: 1, code: "TEST", moduleId: 1, moduleName: "Test", effectiveStart: iso(1), programmeLengthDays: 42},
        predictionRoster: {contract: "all_enrolments_v1", members: [
            {participant_id: "1", recordedStartedAt: iso(10)},
            {participant_id: "staff", recordedStartedAt: iso(2)},
            {participant_id: "future", recordedStartedAt: iso(30)},
            {participant_id: "missing", recordedStartedAt: null},
        ]},
        participants: [{participant_id: "1", displayName: "Tester", bio: "", interview: [], imageUrl:null,
            firstName:null, startedAt:iso(10), recordedStartedAt:iso(10), finishedAt:null,
            events:[9,10,16,17].map((d) => ({timestamp:iso(d),event_type:"login"})),
            priorFacilitatorReplies:[],activityCount:0,wellbeing:[]}],
    };
}
describe("frozen-model input contract", () => {
    it("uses the individual clock and a half-open window for late starters", () => {
        const history=bundleToHistory(bundle(),"1",7,Date.parse(iso(20)))!;
        expect(Date.parse(history.effective_start)).toBe(Date.parse(iso(10)));
        expect(history.events.map((e) => e.timestamp)).toEqual([iso(10),iso(16)]);
        expect(history.cohort_size).toBe(3); // includes staff and imputed start, excludes future enrolment.
        expect(history.prediction_eligible).toBe(true);
    });
    it("does not score a partial individual week even when the cohort week elapsed", () => {
        expect(predictionContext(bundle(),"1",7,Date.parse(iso(14))).eligible).toBe(false);
        expect(predictionContext(bundle(),"1",7,Date.parse(iso(17))).eligible).toBe(true);
    });
    it("imputes a missing start from the earliest recorded full-roster start", () => {
        const context=predictionContext(bundle(),"missing",7,Date.parse(iso(20)));
        expect(Date.parse(context.effectiveStart)).toBe(Date.parse(iso(2)));
        expect(context.cohortSize).toBe(2);
    });
    it("withholds a score if all raw starts are missing or provenance was lost", () => {
        const b=bundle();
        b.predictionRoster!.members.forEach((m) => m.recordedStartedAt=null);
        expect(predictionContext(b,"1",7,Date.parse(iso(20))).eligible).toBe(false);
        delete b.predictionRoster;
        expect(bundleToHistory(b,"1",7,Date.parse(iso(20)))!.prediction_eligible).toBe(false);
    });
    it("rejects invalid roster starts and horizons beyond the programme", () => {
        const b=bundle();
        expect(predictionContext(b,"1",49,Date.parse("2026-06-01Z")).eligible).toBe(false);
        b.predictionRoster!.members[0].recordedStartedAt="invalid";
        expect(predictionContext(b,"1",7,Date.parse(iso(20))).eligible).toBe(false);
    });
});
