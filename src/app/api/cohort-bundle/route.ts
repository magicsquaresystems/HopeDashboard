import { NextResponse, type NextRequest } from "next/server";

import { withApiErrors } from "@/app/api/proxy/_errors";
import { requireFacilitatorEmail } from "@/lib/auth/facilitator";
import { assertCohortAccess } from "@/lib/server/assignments";
import { resolveCohortBundle } from "@/lib/server/cohort-data";

/**
 * Returns the cohort bundle for `?cohortId=<id>`, else 204. Defaults to
 * cohort 1680 (IIH-COH12) when the query param is missing so prior
 * single-cohort callers keep working without a code change.
 *
 * The bundle comes from the Hope Move platform when this deployment is
 * linked to it, and from the extracted file otherwise — `resolveCohortBundle`
 * decides, and both run the same conversion.
 *
 * Gated on both sign-in and cohort assignment. This route hands over the
 * actual participant records — wellbeing scores, posts, profile answers —
 * so it is the place where access control has to hold, regardless of
 * what the UI chose to display.
 */
export const GET = withApiErrors(async (req: NextRequest) => {
    const email = await requireFacilitatorEmail();
    const raw = req.nextUrl.searchParams.get("cohortId");
    const cohortId = raw ? Number(raw) : 1680;
    if (!Number.isFinite(cohortId)) {
        return NextResponse.json(
            { detail: "cohortId must be a number" },
            { status: 400 },
        );
    }
    await assertCohortAccess(email, cohortId);
    const bundle = await resolveCohortBundle(cohortId);
    if (!bundle) return new NextResponse(null, { status: 204 });
    return NextResponse.json(bundle);
});
