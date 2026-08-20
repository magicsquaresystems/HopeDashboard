import { NextResponse, type NextRequest } from "next/server";

import { ApiError } from "@/lib/api/client";
import { createHopeClient, toPlatformActivityType } from "@/lib/api/hope";
import { hopeConfig } from "@/lib/auth/hope-exchange";
import { hopeSession } from "@/lib/auth/hope-session";
import { requireFacilitatorEmail } from "@/lib/auth/facilitator";
import { assertCohortAccess } from "@/lib/server/assignments";
import { withApiErrors } from "../../_errors";

/**
 * Publish a facilitator's reply to a participant, via the Hope Move
 * platform.
 *
 * This is the only route in the dashboard that writes something a
 * participant will read. Every other thing it produces is a draft on a
 * screen or a research record in comment_generation, where a mistake
 * costs a bad row. Here a mistake is a wrong message to someone on a
 * health programme, which is a different kind of wrong and cannot be
 * taken back.
 *
 * That difference is why the capability ships switched off. Building it
 * and enabling it are separate decisions, and the second one belongs to
 * HOPE MOVE rather than to whoever merges this:
 *
 *     HOPE_ENABLE_POST_COMMENT=1
 *
 * Without it the route answers 503 `posting_disabled`. With it, every
 * request still has to clear a session, cohort assignment, and a
 * recognised activity type.
 */
export const POST = withApiErrors(async (req: NextRequest) => {
    const email = await requireFacilitatorEmail();

    if (process.env.HOPE_ENABLE_POST_COMMENT !== "1") {
        throw new ApiError(
            503,
            "Publishing replies to participants is not enabled on this deployment",
            "posting_disabled",
        );
    }

    const body = (await req.json()) as {
        cohortId?: number;
        activityType?: string;
        recordId?: number;
        comment?: string;
    };

    const cohortId = Number(body.cohortId);
    if (!Number.isFinite(cohortId)) {
        throw new ApiError(400, "cohortId is required", "invalid_request");
    }
    // The facilitator must be on this cohort. Checked here rather than
    // trusted from the body: the client picks the cohort, and a client
    // can be wrong or hostile.
    await assertCohortAccess(email, cohortId);

    const recordId = Number(body.recordId);
    if (!Number.isFinite(recordId)) {
        throw new ApiError(400, "recordId is required", "invalid_request");
    }

    const comment = (body.comment ?? "").trim();
    if (!comment) {
        // An empty reply is always a bug on the way here, never an
        // intention. Posting one would still notify the participant.
        throw new ApiError(400, "comment is empty", "invalid_request");
    }

    const activityType = toPlatformActivityType(body.activityType);
    if (!activityType) {
        // Refused rather than defaulted. A reply filed under the wrong
        // activity type attaches to the wrong record.
        throw new ApiError(
            400,
            `Unsupported activity type: ${body.activityType ?? "(none)"}`,
            "invalid_request",
        );
    }

    const config = hopeConfig();
    const session = await hopeSession();
    if (!config || !session) {
        // A hand-off session has no platform credentials, so it cannot
        // post as anyone. Saying so beats a confusing upstream 401.
        throw new ApiError(
            503,
            "This session is not linked to Hope",
            "hope_not_linked",
        );
    }

    await createHopeClient({
        baseUrl: config.apiUrl,
        accessToken: session.tokens.accessToken,
    }).postComment({ cohortId, activityType, recordId, comment });

    // Logged deliberately: this is an irreversible outward action, and
    // the record of who published what should not live only in the
    // platform's database.
    console.info(
        `hope comment published: cohort=${cohortId} ` +
            `activity=${activityType}#${recordId} by=${email}`,
    );

    return NextResponse.json({ status: "published" });
});
