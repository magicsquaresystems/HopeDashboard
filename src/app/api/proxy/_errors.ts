import { NextResponse } from "next/server";

import { ApiError } from "@/lib/api/client";

/**
 * Shared upstream-error translation for the proxy routes.
 *
 * This is not a fallback: it exists so the upstream status code survives
 * the hop to the browser. `classifyGenerateError` (drafts-helpers.ts)
 * buckets failures by substring-matching the status in the message text
 * that `postJSON` builds from `res.status`. Without this translation an
 * uncaught throw becomes Next's generic 500, and a 401 (expired session)
 * would be misread as "comment generation is offline" — the facilitator
 * would be told to wait for a Space that is already up, and never told
 * to sign in again.
 *
 * Handlers stay free of try/catch and simply throw; failures propagate
 * to the UI with their real status rather than degrading to empty data.
 */
export function withApiErrors<A extends unknown[]>(
    handler: (...args: A) => Promise<NextResponse>,
): (...args: A) => Promise<NextResponse> {
    return async (...args: A) => {
        try {
            return await handler(...args);
        } catch (err) {
            if (err instanceof ApiError) {
                return NextResponse.json(
                    { detail: err.detail, code: err.code },
                    { status: err.status },
                );
            }
            // Fetch-layer failure (ECONNREFUSED etc.) — upstream unreachable.
            // 502 distinguishes "we couldn't reach it" from "it returned 500".
            return NextResponse.json(
                { detail: (err as Error).message },
                { status: 502 },
            );
        }
    };
}
