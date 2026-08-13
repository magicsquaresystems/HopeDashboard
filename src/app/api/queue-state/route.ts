import { NextResponse, type NextRequest } from "next/server";

import { withApiErrors } from "@/app/api/proxy/_errors";
import { requireFacilitatorEmail } from "@/lib/auth/facilitator";
import { isQueueOp, type QueueOp } from "@/lib/queue-state-shared";
import { assertCohortAccess } from "@/lib/server/assignments";
import { getQueueStateStore } from "@/lib/server/queue-state";

/**
 * Shared snooze / dismiss / contacted state for one cohort.
 *
 * Both verbs require a session and cohort assignment: the state names
 * participants and says who reached out to them, which is as
 * confidential as the bundle itself. The actor is taken from the
 * session, never from the body — attribution a client can set is
 * attribution that means nothing.
 */
function parseCohortId(raw: string | null): number | null {
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
}

export const GET = withApiErrors(async (req: NextRequest) => {
    const email = await requireFacilitatorEmail();
    const cohortId = parseCohortId(req.nextUrl.searchParams.get("cohortId"));
    if (cohortId === null) {
        return NextResponse.json(
            { detail: "cohortId must be a number" },
            { status: 400 },
        );
    }
    await assertCohortAccess(email, cohortId);
    return NextResponse.json(await getQueueStateStore().get(cohortId));
});

export const POST = withApiErrors(async (req: NextRequest) => {
    const email = await requireFacilitatorEmail();
    const body = (await req.json()) as { cohortId?: unknown } & Record<
        string,
        unknown
    >;
    const cohortId =
        typeof body.cohortId === "number" && Number.isFinite(body.cohortId)
            ? body.cohortId
            : null;
    if (cohortId === null) {
        return NextResponse.json(
            { detail: "cohortId must be a number" },
            { status: 400 },
        );
    }
    const rest = { ...body };
    delete rest.cohortId;
    if (!isQueueOp(rest)) {
        return NextResponse.json(
            { detail: "unrecognised queue operation" },
            { status: 400 },
        );
    }
    await assertCohortAccess(email, cohortId);
    const next = await getQueueStateStore().apply(
        cohortId,
        rest as QueueOp,
        email,
    );
    return NextResponse.json(next);
});
