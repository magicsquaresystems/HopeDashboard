import { NextResponse } from "next/server";

import { commentGen } from "@/lib/api/server";
import { requireFacilitatorEmail } from "@/lib/auth/facilitator";
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
    // Session-gated, for two reasons neither of which is the data. The
    // response names the production model, which is a private
    // repository and need not be advertised; and the health call behind
    // it wakes the GPU Space, so an anonymous caller hitting this in a
    // loop was a free way to spend the programme's compute credit.
    await requireFacilitatorEmail();
    const client = commentGen();
    const [version, health] = await Promise.all([
        client.version(),
        client.health(),
    ]);
    return NextResponse.json({
        model_version: version.model_version,
        service_version: version.service_version,
        model_loaded: health.model_loaded ?? null,
        // Whether drafts are being checked against the post they answer.
        // Forwarded but not rendered: the per-draft disclosure already
        // tells a facilitator when a draft was not checked, and a chip
        // saying so on every screen would be ops language in a clinical
        // interface. It is here so the state is observable at all —
        // "unavailable" means the check is switched on and silently doing
        // nothing, and it fails soft, so nothing else would ever say so.
        grounding_check: health.grounding_check ?? null,
        status: health.status,
    });
});
