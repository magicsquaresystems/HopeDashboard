"use client";

import { useQuery } from "@tanstack/react-query";

import type { CohortBundle } from "@/lib/server/cohort-data";

const THIRTY_SECONDS = 30 * 1000;

/**
 * Fetch the cohort bundle (loaded server-side from
 * `local/iih-coh12-110226.json`).
 *
 * Returns:
 *  - data: CohortBundle when the file is on disk
 *  - data: null when the route 204s (bundle file removed)
 *
 * The synthetic-fallback path was removed; consumers should treat
 * `data === null` as an explicit "bundle missing" state. The route is
 * unauthenticated — facilitator auth will be wired on the original
 * Hope Move platform.
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
