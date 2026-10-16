import type { CohortBundle } from "./cohort-data";
import type { GenerateRequest, MemoryPostRequest } from "@/lib/api/commentGen";
import { ensureUtc } from "@/lib/realCohort";

/** Reconcile trusted platform records; browser-authored text never seeds history. */
export function generationMemory(bundle: CohortBundle, participantId: number, request: GenerateRequest) {
    const participant = bundle.participants.find((p) => p.participant_id === String(participantId));
    const events = participant?.events ?? [];
    const focal = Number.isSafeInteger(request.activity_id) && request.activity_id
        ? events.find((e) => e.activity_id === request.activity_id && e.activity_type === request.activity_type) : undefined;
    const focalTime = focal && Number.isFinite(Date.parse(focal.timestamp)) ? ensureUtc(focal.timestamp) : undefined;
    const cutoff = focalTime ? Date.parse(focalTime) : Date.now();
    const items: (MemoryPostRequest & { kind: "post" })[] = [];
    for (const event of events) {
        if (!["activity", "discussion_post"].includes(event.event_type) ||
            !Number.isSafeInteger(event.activity_id) || !event.activity_id || event.activity_id <= 0 ||
            !event.description?.trim() || !["GoalSetting", "Gratitude", "MyHOPE", "Discussion"].includes(event.activity_type ?? "") ||
            !Number.isFinite(Date.parse(event.timestamp)) || Date.parse(event.timestamp) > cutoff) continue;
        items.push({kind: "post", activity_id: event.activity_id, participant_id: participantId,
            cohort_id: bundle.cohort.id, module_id: bundle.cohort.moduleId,
            activity_type: event.activity_type as MemoryPostRequest["activity_type"],
            text: event.description, recorded_at: ensureUtc(event.timestamp), source: "json_reconcile"});
    }
    return {items: items.slice(-5000), postRecordedAt: focalTime};
}
