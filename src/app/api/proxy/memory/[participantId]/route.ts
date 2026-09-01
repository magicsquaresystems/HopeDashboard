import { NextResponse, type NextRequest } from "next/server";

import { commentGen } from "@/lib/api/server";
import { requireFacilitatorEmail } from "@/lib/auth/facilitator";
import { assertCohortAccess } from "@/lib/server/assignments";
import { requiredId } from "../../_params";
import { withApiErrors } from "../../_errors";

/**
 * Proxy → comment-gen `/memory/{participant_id}` for the activity feed.
 *
 * Failures propagate with their real status. This route previously
 * returned `200 []` for 404s, 5xx, and fetch-layer failures alike, which
 * made an unreachable comment-gen indistinguishable from a participant
 * with no history — the feed rendered "no follow-ups yet" over a broken
 * backend. The feed now shows an explicit error state instead.
 *
 * Requires a session AND assignment to the cohort. A session alone was
 * not enough: the participant id is a small integer, so any signed-in
 * facilitator could walk the range and read the writing history of
 * participants on cohorts they were never assigned to — the same data
 * the bundle route already refuses them. `cohort_id` is therefore
 * mandatory here, not optional; without it there is nothing to check
 * access against, and the comment-gen memory store is not partitioned
 * by who is asking.
 *
 * Checked before the upstream call, so an unassigned request costs
 * nothing and leaks nothing — not even whether the participant exists.
 */
export const GET = withApiErrors(
    async (
        req: NextRequest,
        { params }: { params: Promise<{ participantId: string }> },
    ) => {
        const email = await requireFacilitatorEmail();
        const { participantId } = await params;
        const cohortId = requiredId(req.nextUrl.searchParams, "cohort_id");
        await assertCohortAccess(email, cohortId);
        const limit = req.nextUrl.searchParams.get("limit");
        const data = await commentGen().debugMemory(
            Number(participantId),
            cohortId,
            limit != null ? Number(limit) : 10,
        );
        return NextResponse.json(data);
    },
);
