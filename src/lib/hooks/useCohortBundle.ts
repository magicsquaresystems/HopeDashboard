"use client";

import { useQuery } from "@tanstack/react-query";

import type { CohortBundle } from "@/lib/server/cohort-data";

const THIRTY_SECONDS = 30 * 1000;

/**
 * Fetch the cohort bundle. The server resolves the file per cohort via
 * `BUNDLE_SLUG_BY_COHORT_ID` in `cohort-data.ts`.
 *
 * Returns:
 *  - data: CohortBundle when the bundle exists
 *  - data: null when the route 204s (no bundle for this cohort)
 *
 * The synthetic-fallback path was removed; consumers should treat
 * `data === null` as an explicit "bundle missing" state. The route is
 * authenticated: it 401s without a session and 403s when the signed-in
 * facilitator has no assignment for the cohort (`requireFacilitatorEmail`
 * + `assertCohortAccess` in `api/cohort-bundle/route.ts`).
 *
 * `staleTime: 30s` so re-running `scripts/extract-iih-cohort.mjs` during
 * development picks up in the browser within half a minute instead of
 * needing a hard-reload. The server-side loader is mtime-aware (see
 * `cohort-data.ts`) so the new bundle is read immediately on next fetch.
 */
export function useCohortBundle(cohortId?: number) {
    return useQuery({
        queryKey: ["cohort-bundle", cohortId ?? "default"],
        queryFn: async (): Promise<CohortBundle | null> => {
            const url = cohortId
                ? `/api/cohort-bundle?cohortId=${cohortId}`
                : "/api/cohort-bundle";
            const res = await fetch(url);
            if (res.status === 204) return null;
            if (!res.ok) {
                throw new Error(
                    `cohort-bundle failed: ${res.status} ${res.statusText}`,
                );
            }
            return (await res.json()) as CohortBundle;
        },
        staleTime: THIRTY_SECONDS,
        refetchOnWindowFocus: false,
    });
}
