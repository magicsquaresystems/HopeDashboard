import { NextResponse } from "next/server";

import { commentGen } from "@/lib/api/server";
import { withApiErrors } from "../../_errors";

/**
 * Which reply model is configured, and whether its weights are resident.
 *
 * Combines comment-gen's `/version` (the adapter id) and `/health`
 * (`model_loaded`) so the Outreach panel can name the model before a
 * facilitator clicks Generate — the risk panel has always announced its
 * model this way, and drafting had no equivalent.
 *
 * `model_loaded: false` is the useful half. The first request after a
 * restart pays a 60–90 s adapter load, and on hardware that cannot host
 * the adapter at all it never completes — a facilitator otherwise waits
 * on a spinner with no way to know which case they are in.
 *
 * Both upstream endpoints are unauthenticated reads; the HF bearer for
 * the private Space is injected server-side as usual.
 */
export const GET = withApiErrors(async () => {
    const client = commentGen();
    const [version, health] = await Promise.all([
        client.version(),
        client.health(),
    ]);
    return NextResponse.json({
        model_version: version.model_version,
        service_version: version.service_version,
        model_loaded: health.model_loaded ?? null,
        status: health.status,
    });
});
