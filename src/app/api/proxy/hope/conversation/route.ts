import { NextResponse, type NextRequest } from "next/server";

import { ApiError } from "@/lib/api/client";
import { createHopeClient, toPlatformActivityType } from "@/lib/api/hope";
import { hopeConfig } from "@/lib/auth/hope-exchange";
import { hopeSession } from "@/lib/auth/hope-session";
import { requireFacilitatorEmail } from "@/lib/auth/facilitator";
import { assertCohortAccess } from "@/lib/server/assignments";
import { requiredId } from "../../_params";
import { withApiErrors } from "../../_errors";

/**
 * The comments already on one activity, so a facilitator can see the
 * conversation before adding to it.
 *
 * Two things this fixes. A facilitator drafting a reply could not see
 * that a colleague had already answered the same post, because the
 * cohort bundle's `priorFacilitatorReplies` is empty for every
 * participant on the platform feed — the data simply was not there until
 * the platform added this endpoint. And the corpus audit found replies
 * that were not the first on their post flagged as ungrounded at 2.3x
 * the rate of first replies: a reply answering something said mid-thread
 * looks invented when the thread is missing.
 *
 * `cohortId` is required even though the platform's endpoint does not
 * take one. Without it there is nothing to check access against, and
 * this route would hand any signed-in facilitator the conversation on
 * any record id they cared to guess. With it, the same cohort allowlist
 * that guards every other participant read applies here too.
 */
export const GET = withApiErrors(async (req: NextRequest) => {
    const email = await requireFacilitatorEmail();
    const params = req.nextUrl.searchParams;

    const cohortId = requiredId(params, "cohortId");
    await assertCohortAccess(email, cohortId);

    const recordId = requiredId(params, "recordId");

    // Mapped through the same function the send path uses, so only the
    // platform's own enum values are ever interpolated into its URL.
    const activityType = toPlatformActivityType(params.get("activityType"));
    if (!activityType) {
        throw new ApiError(
            400,
            `Unsupported activity type: ${params.get("activityType") ?? "(none)"}`,
            "invalid_request",
        );
    }

    const config = hopeConfig();
    const session = await hopeSession();
    if (!config || !session) {
        throw new ApiError(
            503,
            "This session is not linked to Hope",
            "hope_not_linked",
        );
    }

    const comments = await createHopeClient({
        baseUrl: config.apiUrl,
        accessToken: session.tokens.accessToken,
    }).fetchConversation(activityType, recordId);

    return NextResponse.json({ comments });
});
