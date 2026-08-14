import { NextResponse, type NextRequest } from "next/server";

import { dropoutApi } from "@/lib/api/server";
import { requireFacilitatorEmail } from "@/lib/auth/facilitator";
import type { ParticipantHistory } from "@/lib/api/dropout";
import { withApiErrors } from "../../_errors";

// Requires a session: the request body is one participant's event
// history and the response is their dropout risk. `proxy.ts` excludes
// `/api/*` from the page gate, so this route has to gate itself.
export const POST = withApiErrors(async (req: NextRequest) => {
    await requireFacilitatorEmail();
    const body = (await req.json()) as ParticipantHistory;
    const data = await dropoutApi().predict(body);
    return NextResponse.json(data);
});
