import { NextResponse, type NextRequest } from "next/server";

import { commentGen } from "@/lib/api/server";
import { requireFacilitatorEmail } from "@/lib/auth/facilitator";
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
 * Requires a session. This is the most exposed of the routes that were
 * briefly ungated: the participant id is a small integer, so an
 * unauthenticated caller could walk the range and read one participant's
 * history after another.
 */
export const GET = withApiErrors(
    async (
        req: NextRequest,
        { params }: { params: Promise<{ participantId: string }> },
    ) => {
        await requireFacilitatorEmail();
        const { participantId } = await params;
        const cohort = req.nextUrl.searchParams.get("cohort_id");
        const limit = req.nextUrl.searchParams.get("limit");
        const data = await commentGen().debugMemory(
            Number(participantId),
            cohort != null ? Number(cohort) : undefined,
            limit != null ? Number(limit) : 10,
        );
        return NextResponse.json(data);
    },
);
