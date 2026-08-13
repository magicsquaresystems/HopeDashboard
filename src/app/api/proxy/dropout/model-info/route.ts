import { NextResponse } from "next/server";

import { dropoutApi } from "@/lib/api/server";
import { withApiErrors } from "../../_errors";

// Auth removed — gating delegated to the Hope Move platform layer.
// Surfaces the served risk-model metadata (family + per-horizon metrics
// from the engagement_ml deploy bundle) so the dashboard can show a
// "Risk: <family> @ T<horizon>" chip next to the week selector.
export const GET = withApiErrors(async () => {
    const data = await dropoutApi().modelInfo();
    return NextResponse.json(data);
});
