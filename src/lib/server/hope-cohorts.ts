/**
 * Cohorts as the Hope Move platform sees them, for the signed-in
 * facilitator.
 *
 * When the platform integration is configured and the session carries
 * platform credentials, this replaces the hardcoded registry in
 * `lib/cohorts.ts` — which is what that module's docblock and
 * `assignments.ts` have both been anticipating.
 *
 * Note the cohort ids will not match the extracted bundles in `local/`
 * unless the platform happens to serve the same programmes. A platform
 * cohort with no bundle renders the "bundle missing" empty state rather
 * than failing, which is the correct behaviour while participant data
 * still comes from files.
 */

import { ApiError } from "@/lib/api/client";
import { createHopeClient } from "@/lib/api/hope";
import { type CohortMeta } from "@/lib/cohorts";
import { hopeConfig } from "@/lib/auth/hope-exchange";
import { hopeSession } from "@/lib/auth/hope-session";

if (typeof window !== "undefined") {
    throw new Error("hope-cohorts.ts must not be imported in client code");
}

/**
 * Short on purpose. This list is an authorization input, not just
 * display data: a facilitator taken off a programme on the platform
 * should lose access in about a minute, not whenever their session
 * happens to end.
 */
const TTL_MS = 60_000;

type Entry = { fetchedAt: number; cohorts: CohortMeta[] };

/** Per platform user id. Process-local, so each serverless instance
 *  warms its own — which is fine at this TTL. */
const cache = new Map<string, Entry>();

/**
 * `null` means "the platform is not the source here" — either the
 * integration is unconfigured or this session signed in by hand-off. The
 * caller then falls back to the existing env/database assignment. That
 * distinction matters: `null` is *not* the same as "this facilitator has
 * no cohorts", which is an empty array.
 */
export async function hopeCohorts(): Promise<CohortMeta[] | null> {
    const config = hopeConfig();
    if (!config) return null;

    const session = await hopeSession();
    if (!session) return null;

    const cached = cache.get(session.hopeUserId);
    if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
        return cached.cohorts;
    }

    try {
        const cohorts = await createHopeClient({
            baseUrl: config.apiUrl,
            accessToken: session.tokens.accessToken,
        }).listCohorts();
        cache.set(session.hopeUserId, { fetchedAt: Date.now(), cohorts });
        return cohorts;
    } catch (err) {
        console.error(
            `hope cohorts: fetch failed — ${(err as Error).message}`,
        );
        // An auth rejection is not an outage: the platform is refusing
        // the very token its exchange issued, which means the dashboard
        // API contract is broken and the platform cannot be the cohort
        // authority at all right now. Treat it like an unconfigured
        // integration — fall back to the env/database assignment and the
        // local registry — rather than blanking every cohort until the
        // platform's token validation is fixed. (Observed 2026-08-18:
        // `/api/dashboard/cohorts` 401s freshly-exchanged tokens.)
        if (
            err instanceof ApiError &&
            (err.status === 401 || err.status === 403)
        ) {
            return null;
        }
        // Everything else — network failure, 5xx, malformed body — keeps
        // serving the stale list if we have one, otherwise nothing.
        //
        // Deliberately not falling through to `null` here: `null` sends
        // the caller to the env/database fallback, which in `open` mode
        // resolves to "every cohort". A platform outage must never be
        // able to *widen* what a facilitator can open — showing too
        // little is recoverable, showing too much is not.
        return cached?.cohorts ?? [];
    }
}

/** Test seam and sign-out hygiene — the cache is keyed by platform user
 *  id, so a second facilitator on the same instance cannot read the
 *  first's list, but a stale entry should not outlive a deliberate
 *  refresh either. */
export function clearHopeCohortCache(): void {
    cache.clear();
}
