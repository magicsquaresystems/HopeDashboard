/**
 * The Hope Move platform API.
 *
 * Distinct from the two model backends: this is the programme platform
 * itself, and it authenticates with the facilitator's own access token
 * rather than a shared service credential. Every call is therefore made
 * on behalf of one person, and what comes back is already theirs.
 *
 * Only `GET /api/dashboard/cohorts` exists so far. Participant data —
 * events, prior facilitator replies, forum threads — still comes from
 * the extracted bundles in `local/`; the contract for the endpoint that
 * will replace them is `docs/INTEGRATION.md` §7.2.
 *
 * The conversion into the app's own shapes is a pure function so it can
 * be tested against a captured payload with no network, which is the
 * pattern `docs/INTEGRATION.md` §7.1 sets out for exactly this swap.
 */

import { type CohortMeta } from "@/lib/cohorts";
import { createClient } from "@/lib/api/client";
import { ensureUtc } from "@/lib/realCohort";

/** One row of `GET /api/dashboard/cohorts`, as documented by the platform. */
export type HopeCohort = {
    cohortId: number;
    cohortName: string;
    moduleId: number;
    moduleName: string;
    startDate: string;
    endDate: string;
};

/**
 * Used when `startDate`/`endDate` cannot be turned into a sane span.
 *
 * Every HOPE cohort so far runs six weeks, and a cohort we can name but
 * cannot measure is still worth showing — the alternative is hiding it,
 * which reads to a facilitator as "your cohort has disappeared".
 */
const DEFAULT_PROGRAMME_LENGTH_DAYS = 42;

const MS_PER_DAY = 86_400_000;

/**
 * The app models programme length in whole weeks: the week selector steps
 * by seven and engagement_ml is trained on week-aligned horizons, so a
 * 46-day programme has no representation. Real start/end dates will not
 * divide evenly, so round rather than truncate — truncating 46 days to 42
 * drops most of a week off the end of the selector, where rounding to 49
 * keeps it reachable.
 */
export function programmeLengthFrom(
    startDate: string,
    endDate: string,
): number {
    const start = Date.parse(ensureUtc(startDate));
    const end = Date.parse(ensureUtc(endDate));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return DEFAULT_PROGRAMME_LENGTH_DAYS;
    }
    const weeks = Math.round((end - start) / MS_PER_DAY / 7);
    return Math.max(1, weeks) * 7;
}

/**
 * One platform cohort in the app's own shape, or `null` if it is too
 * malformed to be useful.
 *
 * `cohortName` becomes `code`. The app's `code` has been a slug
 * (`IIH-COH12-110226`) and is rendered as the cohort card's title; the
 * platform sends one name and no slug, so there is nothing to preserve
 * alongside it. Split the two the day the platform sends both.
 *
 * `startDate` is normalised to UTC. The platform's documented example
 * carries no timezone at all, and engagement_ml rejects naive timestamps
 * — so this assumes UTC, which is the assumption to revisit first if
 * risk scores ever look shifted by a fixed number of hours.
 */
export function toCohortMeta(raw: unknown): CohortMeta | null {
    if (!raw || typeof raw !== "object") return null;
    const row = raw as Partial<HopeCohort>;

    const id = Number(row.cohortId);
    if (!Number.isFinite(id)) return null;

    const startDate = typeof row.startDate === "string" ? row.startDate : "";
    if (!startDate) return null;

    return {
        id,
        code: String(row.cohortName ?? `Cohort ${id}`),
        moduleId: Number(row.moduleId) || 0,
        moduleName: String(row.moduleName ?? ""),
        programmeLengthDays: programmeLengthFrom(
            startDate,
            typeof row.endDate === "string" ? row.endDate : "",
        ),
        effectiveStart: ensureUtc(startDate),
    };
}

/** Drops rows the platform sends that we cannot use, rather than failing
 *  the whole list — one malformed cohort should not hide the others. */
export function toCohortList(payload: unknown): CohortMeta[] {
    if (!Array.isArray(payload)) return [];
    return payload
        .map(toCohortMeta)
        .filter((c): c is CohortMeta => c !== null);
}

export function createHopeClient(opts: {
    baseUrl: string;
    accessToken: string;
    fetchImpl?: typeof fetch;
}) {
    // `authToken` is the shared client's generic bearer header. It was
    // introduced for the Hugging Face gateway, but the mechanism is the
    // same and the platform expects exactly this shape.
    const client = createClient({
        baseUrl: opts.baseUrl,
        authToken: opts.accessToken,
        fetchImpl: opts.fetchImpl,
    });

    return {
        /** Cohorts this access token's facilitator may see. */
        async listCohorts(): Promise<CohortMeta[]> {
            const payload = await client.request<unknown>({
                path: "/api/dashboard/cohorts",
            });
            return toCohortList(payload);
        },
    };
}
