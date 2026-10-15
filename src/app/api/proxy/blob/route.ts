import { NextResponse, type NextRequest } from "next/server";

import { ApiError } from "@/lib/api/client";
import { requireFacilitatorEmail } from "@/lib/auth/facilitator";
import {
    blobConfig,
    normaliseBlobPath,
    signedBlobUrl,
} from "@/lib/server/blob-url";
import { assertImageAccess } from "@/lib/server/participant-access";
import { requiredId } from "../_params";
import { withApiErrors } from "../_errors";

/**
 * Redirect an `<img>` to a short-lived signed URL for participant content.
 *
 * The platform stores uploaded photos in Azure and sends us blob paths.
 * Rendering one needs a signed URL; signing needs the storage account key,
 * which grants read and write over every participant's uploaded content
 * and must never leave the server.
 *
 * A redirect rather than a proxy, deliberately. The browser follows the
 * 302 straight to Azure, so the image bytes never pass through this
 * deployment — no bandwidth, no latency, and participant photographs are
 * not copied through infrastructure that has no reason to hold them. What
 * this route hands out is a five-minute read capability for one named
 * blob, which is the smallest thing that makes the picture appear.
 *
 * Session-gated. The URL it produces is a bearer credential for that blob,
 * short-lived but real, so it is not something to hand to anyone who asks.
 *
 * The cohort must be accessible and the exact image path must occur in
 * its participant profiles or activity records before a URL can be signed.
 */
export const GET = withApiErrors(async (req: NextRequest) => {
    const email = await requireFacilitatorEmail();
    const cohortId = requiredId(req.nextUrl.searchParams, "cohortId");

    const path = normaliseBlobPath(req.nextUrl.searchParams.get("path"));
    if (!path) {
        // Covers an absent parameter and a hostile one (`..`, an absolute
        // URL, a backslash) with the same answer: nothing here names a
        // blob we will sign.
        throw new ApiError(400, "a blob path is required", "invalid_request");
    }

    await assertImageAccess(email, cohortId, path);

    const config = blobConfig();
    if (!config) {
        // A deployment without storage credentials is a working
        // deployment that shows initials instead of photos, so this says
        // which variable is absent rather than implying a broken image.
        throw new ApiError(
            503,
            "This deployment is missing AZURE_STORAGE_CONNECTION_STRING or " +
                "AZURE_STORAGE_CONTAINER, so participant images cannot be shown.",
            "blob_not_configured",
        );
    }

    // Recheck access on subsequent signing requests, including after
    // a cohort assignment changes. Never cache the credential-bearing redirect.
    return NextResponse.redirect(signedBlobUrl(path, config), {
        status: 302,
        headers: {
            "Cache-Control": "private, no-store",
        },
    });
});
