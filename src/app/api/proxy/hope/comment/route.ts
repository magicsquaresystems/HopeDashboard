import { NextResponse, type NextRequest } from "next/server";

import { ApiError } from "@/lib/api/client";
import { createHopeClient, toPlatformActivityType } from "@/lib/api/hope";
import { hopeConfig } from "@/lib/auth/hope-exchange";
import { hopeSession } from "@/lib/auth/hope-session";
import { requireFacilitatorEmail } from "@/lib/auth/facilitator";
import { assertCohortAccess, resolveCohort } from "@/lib/server/assignments";
import {
    isPostingAllowedFor,
    postingPolicy,
} from "@/lib/server/posting-policy";
import { withApiErrors } from "../../_errors";

/**
 * Longest reply the route will forward. Well above any draft the model
 * writes (under 50 words) and any reply a facilitator types. Mirrored in
 * the facilitator copy in `drafts-helpers.ts` — change both.
 */
const MAX_COMMENT_CHARS = 1000;

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
 * request still has to clear a session, a cohort allowlist, cohort
 * assignment, and a recognised activity type.
 *
 * Two more environment variables shape this, both in
 * `lib/server/posting-policy.ts`:
 *
 *   `HOPE_POST_COMMENT_COHORTS` names the cohorts that may receive a
 *   reply, by id or by code, and is REQUIRED whenever posting is
 *   enabled — the flag alone opens nothing. Being assigned to a cohort
 *   is not permission to post into it: the account this is tested with
 *   is assigned to around twenty-five cohorts, most of them live.
 *
 *   `HOPE_POST_COMMENT_DRY_RUN=1` runs every check and builds the real
 *   payload, then logs it and returns `{ status: "dry_run" }` instead of
 *   calling the platform. It is how the whole path is exercised before
 *   anything reaches a participant.
 */
export const POST = withApiErrors(async (req: NextRequest) => {
    const email = await requireFacilitatorEmail();

    const policy = postingPolicy();
    if (!policy.enabled) {
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
    // Before the assignment check, and long before the platform call:
    // being assigned to a cohort is not permission to post into it. The
    // account used for testing is assigned to roughly twenty-five
    // cohorts, most of them live courses with real participants.
    const cohort = await resolveCohort(cohortId);
    if (!isPostingAllowedFor(policy, { id: cohortId, code: cohort?.code })) {
        console.warn(
            `hope comment refused: cohort=${cohortId} ` +
                `code=${cohort?.code ?? "unknown"} not in ` +
                `HOPE_POST_COMMENT_COHORTS, by=${email}`,
        );
        throw new ApiError(
            403,
            "Sending replies to Hope is not switched on for this cohort. " +
                "You can still copy the reply and paste it into Hope.",
            "posting_not_allowed_for_cohort",
        );
    }

    // The facilitator must also be on this cohort. Checked here rather
    // than trusted from the body: the client picks the cohort, and a
    // client can be wrong or hostile.
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
    if (comment.length > MAX_COMMENT_CHARS) {
        // The reply travels as a JSON body since the platform's 2026-08-24
        // contract change, so the old IIS query-string ceiling no longer
        // applies — but their comment column's limit is unknown and a
        // thousand characters is already several times the longest real
        // facilitator reply. A bound with a clear reason beats finding
        // theirs the hard way.
        throw new ApiError(
            400,
            `comment is ${comment.length} characters; the limit is ${MAX_COMMENT_CHARS}`,
            "comment_too_long",
        );
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

    if (policy.dryRun) {
        // Every gate has passed and this is the exact payload that would
        // go out. Stopping here exercises the whole path — the button,
        // the confirm, the route, the validation — without a message
        // reaching anyone, which is how this feature gets tested at all.
        console.info(
            `hope comment DRY RUN (not sent): cohort=${cohortId} ` +
                `activity=${activityType}#${recordId} by=${email} ` +
                `chars=${comment.length}`,
        );
        return NextResponse.json({ status: "dry_run" });
    }

    try {
        await createHopeClient({
            baseUrl: config.apiUrl,
            accessToken: session.tokens.accessToken,
        }).postComment({ cohortId, activityType, recordId, comment });
    } catch (err) {
        // The platform's reason belongs in the deployment log as well as
        // on the screen. The first real send came back "400 Bad Request"
        // and nothing more, in both places; whoever reads this next
        // should not have to reproduce the failure to learn what it was.
        if (err instanceof ApiError) {
            console.error(
                `hope comment rejected: cohort=${cohortId} ` +
                    `activity=${activityType}#${recordId} by=${email} ` +
                    `status=${err.status} code=${err.code ?? "-"} ` +
                    `detail=${JSON.stringify(err.detail)}`,
            );
        }
        throw err;
    }

    // Logged deliberately: this is an irreversible outward action, and
    // the record of who published what should not live only in the
    // platform's database.
    console.info(
        `hope comment published: cohort=${cohortId} ` +
            `activity=${activityType}#${recordId} by=${email}`,
    );

    return NextResponse.json({ status: "published" });
});
