/**
 * Which cohorts a facilitator may open.
 *
 * A cohort bundle is confidential health data for ~50 named-by-pseudonym
 * people: wellbeing scores, forum posts, what they wrote about
 * themselves. Before this existed, any signed-in account could read
 * every cohort — fine for a single-operator demo, wrong the moment more
 * than one facilitator has a login, and wrong in a different way once
 * several live programmes run at once and a facilitator is only
 * responsible for one of them.
 *
 * Enforcement lives on the server routes that serve the data, not just
 * in the UI that lists it: hiding a card doesn't stop anyone typing the
 * URL, and `/api/cohort-bundle?cohortId=…` is the thing that actually
 * hands over the records.
 *
 * Source of truth, in precedence order:
 *   1. `facilitator_cohorts` in Postgres, when `DATABASE_URL` is set.
 *   2. `FACILITATOR_COHORTS` env JSON — `{"a@x.org":[1680],"b@x.org":[1600,1651]}`.
 *
 * When neither names the email, the answer depends on the auth posture:
 * in `open` mode (testing) everyone sees everything, which keeps local
 * development and reviewer walkthroughs working with zero setup; in
 * `allowlist` mode (production) an unlisted facilitator sees nothing.
 * Deny-by-default is only correct where identities are controlled, and
 * `open` mode is explicitly the mode where they aren't.
 *
 * FUTURE: the Hope Move platform API (weekly module/course pull, being
 * built by the platform engineer) will own both the cohort registry in
 * `src/lib/cohorts.ts` and these assignments. When it lands, this
 * function hydrates from it and every call site stays as-is.
 */

import { authMode } from "@/auth";
import { ApiError } from "@/lib/api/client";
import { COHORTS, type CohortMeta } from "@/lib/cohorts";
import { ensureSchema, getPool, hasDatabase } from "@/lib/server/db";

if (typeof window !== "undefined") {
    throw new Error("assignments.ts must not be imported in client code");
}

/** `"all"` means unrestricted — see the module docblock on open mode. */
export type Assignment = number[] | "all";

function fromEnv(email: string): number[] | null {
    const raw = process.env.FACILITATOR_COHORTS?.trim();
    if (!raw) return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        // A malformed env var must not silently grant or deny access —
        // it's an operator error, and staying loud is the safe failure.
        console.error(
            "FACILITATOR_COHORTS is not valid JSON — ignoring it. " +
                'Expected {"facilitator@example.org": [1680]}.',
        );
        return null;
    }
    if (!parsed || typeof parsed !== "object") return null;
    const table = parsed as Record<string, unknown>;
    // Case-insensitive lookup: emails are compared lowercased everywhere
    // else (auth allowlist, attribution), so the config shouldn't be the
    // one place where capitalisation matters.
    const key = Object.keys(table).find(
        (k) => k.trim().toLowerCase() === email,
    );
    if (key === undefined) return null;
    const ids = table[key];
    if (!Array.isArray(ids)) return null;
    return ids.map(Number).filter(Number.isFinite);
}

async function fromDatabase(email: string): Promise<number[] | null> {
    await ensureSchema();
    const pool = await getPool();
    const { rows } = await pool.query<{ cohort_id: number }>(
        "SELECT cohort_id FROM facilitator_cohorts WHERE lower(email) = $1",
        [email],
    );
    // No rows means "not configured here" rather than "assigned nothing",
    // so the env fallback still gets a chance before we deny.
    return rows.length > 0 ? rows.map((r) => r.cohort_id) : null;
}

export async function cohortsForFacilitator(
    email: string,
): Promise<Assignment> {
    const key = email.trim().toLowerCase();
    const explicit = hasDatabase()
        ? ((await fromDatabase(key)) ?? fromEnv(key))
        : fromEnv(key);
    if (explicit) return explicit;
    return authMode() === "allowlist" ? [] : "all";
}

export function isAssigned(assignment: Assignment, cohortId: number): boolean {
    return assignment === "all" || assignment.includes(cohortId);
}

/** Cohort registry entries this facilitator may open, registry order. */
export async function visibleCohorts(email: string): Promise<CohortMeta[]> {
    const assignment = await cohortsForFacilitator(email);
    if (assignment === "all") return COHORTS;
    return COHORTS.filter((c) => assignment.includes(c.id));
}

/**
 * Route guard. Throws `ApiError(403)`, which `withApiErrors` turns into
 * a 403 response with its status intact.
 */
export async function assertCohortAccess(
    email: string,
    cohortId: number,
): Promise<void> {
    const assignment = await cohortsForFacilitator(email);
    if (!isAssigned(assignment, cohortId)) {
        throw new ApiError(
            403,
            "You are not assigned to this cohort",
            "cohort_forbidden",
        );
    }
}
