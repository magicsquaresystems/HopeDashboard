import { NextResponse, type NextRequest } from "next/server";

import { ApiError } from "@/lib/api/client";
import { requireFacilitatorEmail } from "@/lib/auth/facilitator";
import {
    SAS_TTL_SECONDS,
    blobConfig,
    normaliseBlobPath,
    signedBlobUrl,
} from "@/lib/server/blob-url";
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
 * The honest limit: this signs any well-formed path a signed-in
 * facilitator asks for, without proving that path belongs to one of their
 * cohorts. Establishing that would mean loading the cohort bundle on every
 * image request. The exposure is bounded by everyone reaching it already
 * being a facilitator trusted with participant data, and by blob paths
 * being unguessable GUIDs rather than enumerable ids — but it is a real
 * gap, and the day this serves anyone less trusted it needs closing.
 */
export const GET = withApiErrors(async (req: NextRequest) => {
    await requireFacilitatorEmail();

    const path = normaliseBlobPath(req.nextUrl.searchParams.get("path"));
    if (!path) {
        // Covers an absent parameter and a hostile one (`..`, an absolute
        // URL, a backslash) with the same answer: nothing here names a
        // blob we will sign.
        throw new ApiError(400, "a blob path is required", "invalid_request");
    }

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

    // `private`: the URL identifies one participant's photo and carries a
    // credential, so it must not be held by a shared cache. `max-age` sits
    // under the token's own lifetime so the browser never replays a URL
    // that has expired.
    return NextResponse.redirect(signedBlobUrl(path, config), {
        status: 302,
        headers: {
            "Cache-Control": `private, max-age=${Math.max(0, SAS_TTL_SECONDS - 30)}`,
        },
    });
});
