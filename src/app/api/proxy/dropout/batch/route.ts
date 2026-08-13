import { NextResponse, type NextRequest } from "next/server";

import { dropoutApi } from "@/lib/api/server";
import type { BatchEventRequest } from "@/lib/api/dropout";
import { withApiErrors } from "../../_errors";

// Auth removed — gating delegated to the Hope Move platform layer.
export const POST = withApiErrors(async (req: NextRequest) => {
    const body = (await req.json()) as BatchEventRequest;
    const data = await dropoutApi().batch(body);
    return NextResponse.json(data);
});
