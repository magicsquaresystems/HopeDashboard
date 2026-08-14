import { NextResponse } from "next/server";

import { dropoutApi } from "@/lib/api/server";
import { requireFacilitatorEmail } from "@/lib/auth/facilitator";
import { withApiErrors } from "../../_errors";

// Surfaces the served risk-model metadata (family + per-horizon metrics
// from the engagement_ml deploy bundle) so the dashboard can show a
// "Risk: <family> @ T<horizon>" chip next to the week selector.
//
// Gated for consistency with the rest of `/api/proxy/dropout` rather than
// because held-out AUC is sensitive. Only signed-in facilitators have a
// chip to render, so nothing is lost by requiring one.
export const GET = withApiErrors(async () => {
    await requireFacilitatorEmail();
    const data = await dropoutApi().modelInfo();
    return NextResponse.json(data);
});
