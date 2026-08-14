import { NextResponse, type NextRequest } from "next/server";

import { commentGen } from "@/lib/api/server";
import type { GenerateRequest } from "@/lib/api/commentGen";
import { withApiErrors } from "../_errors";

/**
 * Generation is by far the slowest call the dashboard makes, so this route
 * pins its own ceiling rather than inheriting one.
 *
 * Measured on a T4: 16 s for a single forum reply, 99–175 s for a
 * three-persona activity set, plus ~60 s if the Space is waking from sleep.
 * Worst case therefore runs past four minutes. Vercel's current default is
 * 300 s, which covers that — but the default is invisible from the repo and a
 * project-level override would silently truncate long generations into a
 * gateway timeout, which `classifyGenerateError` reports to the facilitator as
 * "comment generation is offline". Stating the number here means the deploy
 * target cannot change it without someone editing this file.
 *
 * 300 s is the Hobby ceiling and the default on every plan; raising it further
 * needs Pro or Enterprise. See docs/HOSTING.md §1.
 */
export const maxDuration = 300;

// Auth removed — gating delegated to the Hope Move platform layer.
export const POST = withApiErrors(async (req: NextRequest) => {
    const body = (await req.json()) as GenerateRequest;
    const data = await commentGen().generate(body);
    return NextResponse.json(data);
});
