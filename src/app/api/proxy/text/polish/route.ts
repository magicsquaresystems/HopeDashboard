import { NextResponse, type NextRequest } from "next/server";

import { commentGen } from "@/lib/api/server";
import type { PolishRequest } from "@/lib/api/commentGen";
import { withApiErrors } from "../../_errors";

// Auth removed — gating delegated to the Hope Move platform layer.
// Forwards a facilitator-typed draft to comment-gen's /text/polish for
// grammar + spelling + rephrase. The Space's output filter runs
// `scrub_first_names` + `fill_name_slot` on the response so any
// memorised first names ("Sarah", "Sue") that leak from the LoRA are
// caught here too.
export const POST = withApiErrors(async (req: NextRequest) => {
    const body = (await req.json()) as PolishRequest;
    if (!body?.draft_text?.trim()) {
        return NextResponse.json(
            { detail: "draft_text is required" },
            { status: 400 },
        );
    }
    const data = await commentGen().polishText(body);
    return NextResponse.json(data);
});
