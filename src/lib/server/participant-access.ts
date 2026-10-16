import "server-only";

import { ApiError } from "@/lib/api/client";
import { assertCohortAccess } from "@/lib/server/assignments";
import { normaliseBlobPath } from "@/lib/server/blob-url";
import {
    resolveCohortBundle,
    type CohortBundle,
} from "@/lib/server/cohort-data";

export function positiveBodyId(value: unknown, name: string): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
        throw new ApiError(400, `${name} must be a positive id`, "invalid_request");
    }
    return value;
}

async function accessibleBundle(email: string, cohortId: number): Promise<CohortBundle> {
    // Check assignment before fetching any participant records.
    await assertCohortAccess(email, cohortId);
    const bundle = await resolveCohortBundle(cohortId);
    if (!bundle || bundle.cohort.id !== cohortId) {
        throw new ApiError(404, "Cohort data is unavailable", "cohort_data_unavailable");
    }
    return bundle;
}

export async function assertParticipantAccess(
    email: string,
    cohortId: number,
    participantId: number,
): Promise<CohortBundle> {
    const bundle = await accessibleBundle(email, cohortId);
    if (!bundle.participants.some((p) => p.participant_id === String(participantId))) {
        throw new ApiError(403, "Participant is not in this cohort", "participant_forbidden");
    }
    return bundle;
}

export async function assertImageAccess(
    email: string,
    cohortId: number,
    path: string,
): Promise<void> {
    const bundle = await accessibleBundle(email, cohortId);
    // Match the exact path from trusted records. A shared prefix or GUID is
    // not proof of ownership, and a caller-supplied cohort id alone is not enough.
    const belongs = bundle.participants.some((p) =>
        normaliseBlobPath(p.imageUrl) === path ||
        p.events.some((e) => normaliseBlobPath(e.image_url) === path),
    );
    if (!belongs) {
        throw new ApiError(403, "Image is not in this cohort", "image_forbidden");
    }
}
