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
 *
 * Deliberately the one route under `/api/proxy` with no session check,
 * so it can be curled as a liveness probe without minting a session. It
 * returns no participant data and spends no model time; the only thing
 * it discloses is the configured adapter id. If that ever becomes
 * unacceptable, gate it — the chip that consumes it only ever renders
 * for a signed-in facilitator, so nothing in the UI would notice.
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
