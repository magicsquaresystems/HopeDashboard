import { NextResponse, type NextRequest } from "next/server";

import { dropoutApi } from "@/lib/api/server";
import { requireFacilitatorEmail } from "@/lib/auth/facilitator";
import type { BatchEventRequest } from "@/lib/api/dropout";
import { withApiErrors } from "../../_errors";

// Requires a session — this is the whole-cohort form of /predict, so it
// returns risk scores for every participant in one call.
export const POST = withApiErrors(async (req: NextRequest) => {
    await requireFacilitatorEmail();
    const body = (await req.json()) as BatchEventRequest;
    const data = await dropoutApi().batch(body);
    return NextResponse.json(data);
});
