import { NextResponse, type NextRequest } from "next/server";
import { commentGen } from "@/lib/api/server";
import { requireFacilitatorEmail } from "@/lib/auth/facilitator";
import { withApiErrors } from "../_errors";

export const POST = withApiErrors(async (req: NextRequest) => {
    const facilitator_id = await requireFacilitatorEmail();
    const body = await req.json() as { draft_set_id: string; draft_id: string };
    return NextResponse.json(await commentGen().copy({ ...body, facilitator_id }));
});
