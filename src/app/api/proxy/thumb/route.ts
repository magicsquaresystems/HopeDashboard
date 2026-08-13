import { NextResponse, type NextRequest } from "next/server";

import { commentGen } from "@/lib/api/server";
import { requireFacilitatorEmail } from "@/lib/auth/facilitator";
import type { ThumbRequest } from "@/lib/api/commentGen";
import { withApiErrors } from "../_errors";

/**
 * `facilitator_id` is stamped from the session, after the spread, so a
 * client-supplied value can never win. The HMAC in `createClient` is
 * computed over the final object, so injecting here is signed correctly
 * — don't pre-stringify the body.
 */
export const POST = withApiErrors(async (req: NextRequest) => {
    const facilitator_id = await requireFacilitatorEmail();
    const body: ThumbRequest = {
        ...((await req.json()) as ThumbRequest),
        facilitator_id,
    };
    const data = await commentGen().thumb(body);
    return NextResponse.json(data);
});
