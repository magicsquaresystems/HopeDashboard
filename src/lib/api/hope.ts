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
 * `startDate` is normalised to UTC with `ensureUtc`, the same treatment
 * every other platform timestamp gets. The platform sends naive datetime
 * strings and engagement_ml rejects them, so appending `Z` is the
 * established convention here — see `realCohort.ts` and the extraction
 * script, which both do it. Nothing about this field is special.
 */
export function toCohortMeta(raw: unknown): CohortMeta | null {
    if (!raw || typeof raw !== "object") return null;
    const row = raw as Partial<HopeCohort>;

    const id = Number(row.cohortId);
    if (!Number.isFinite(id)) return null;

    const startDate = typeof row.startDate === "string" ? row.startDate : "";
    if (!startDate) return null;

    const endDate = typeof row.endDate === "string" ? row.endDate : "";
    const programmeLengthDays = programmeLengthFrom(startDate, endDate);
    // `endDate: null` is common on the platform for cohorts with no
    // scheduled finish. The length still has to be a number for scoring,
    // but the UI must not present the fallback as the programme's shape.
    const programmeLengthKnown =
        programmeLengthDays !== DEFAULT_PROGRAMME_LENGTH_DAYS ||
        Boolean(endDate);

    return {
        id,
        code: String(row.cohortName ?? `Cohort ${id}`),
        moduleId: Number(row.moduleId) || 0,
        moduleName: String(row.moduleName ?? ""),
        programmeLengthDays,
        programmeLengthKnown,
        effectiveStart: ensureUtc(startDate),
    };
}

/**
 * Drops rows the platform sends that we cannot use, rather than failing
 * the whole list — one malformed cohort should not hide the others.
 *
 * The live endpoint wraps the rows in `{ "cohorts": [...] }` rather than
 * returning the bare array this was first written against, and answers a
 * facilitator with no cohorts the same way. Both shapes are accepted:
 * insisting on the bare array turned a perfectly good 200 into an empty
 * picker, which reads to a facilitator as "you have no cohorts" and is
 * indistinguishable from the platform being down. `Cohorts` is accepted
 * beside `cohorts` because the platform's own `/api/auth/exchange`
 * serialises PascalCase, so the casing is evidently per-endpoint rather
 * than a property of the API.
 */
export function toCohortList(payload: unknown): CohortMeta[] {
    const wrapped = payload as { cohorts?: unknown; Cohorts?: unknown } | null;
    const rows = Array.isArray(payload)
        ? payload
        : (wrapped?.cohorts ?? wrapped?.Cohorts);
    if (!Array.isArray(rows)) return [];
    return rows.map(toCohortMeta).filter((c): c is CohortMeta => c !== null);
}

/** The values `POST /api/dashboard/comment` accepts for `activityType`. */
export type PlatformActivityType =
    | "Gratitude"
    | "GoalSetting"
    | "MyHOPE"
    | "Post";

/**
 * Our activity type, in the platform's vocabulary.
 *
 * `Emotions` maps to nothing and that is correct, not an oversight:
 * across all three cohorts facilitators replied to GoalSetting (152),
 * Gratitude (77) and MyHOPE (6) and never to an Emotions entry. The
 * platform has no value for it because there is nothing to post.
 *
 * Forum activity is `Post` on their side. Ours arrives as `Discussion`
 * on an activity record and `discussion_post` on an event, so both are
 * accepted.
 *
 * Returns `null` rather than guessing. Posting a reply under the wrong
 * activity type would attach it to the wrong record on a live programme.
 */
export function toPlatformActivityType(
    activityType: string | null | undefined,
): PlatformActivityType | null {
    switch ((activityType ?? "").trim().toLowerCase()) {
        case "gratitude":
            return "Gratitude";
        case "goalsetting":
            return "GoalSetting";
        case "myhope":
            return "MyHOPE";
        case "discussion":
        case "discussion_post":
        case "post":
            return "Post";
        default:
            return null;
    }
}

export type PostCommentInput = {
    cohortId: number;
    activityType: PlatformActivityType;
    /** The platform's id for the activity record being replied to. */
    recordId: number;
    comment: string;
};

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
        // The platform 500s with CultureNotFoundException on Node fetch's
        // default `Accept-Language: *` — the same crash hope-exchange.ts
        // works around. Every bearer call here needs the real locale too,
        // or the cohort list quietly fails closed to empty.
        headers: {
            Accept: "application/json",
            "Accept-Language": "en-GB",
        },
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

        /**
         * The four platform documents behind one cohort's bundle.
         *
         * Each mirrors one of the raw platform exports the dashboard has
         * been reading from disk — same `{ modules: [...] }` shape, but
         * scoped to a single cohort inside a single module. That is what
         * lets `buildCohortBundle` consume either source unchanged.
         *
         * Fetched together because the conversion needs all four: user
         * activity supplies the event stream, profiles the bios, and the
         * other two contribute both their own records and events derived
         * from them.
         */
        async fetchCohortDocuments(cohortId: number): Promise<{
            userActivity: unknown;
            userProfiles: unknown;
            facilitatorComments: unknown;
            discussionTopics: unknown;
        }> {
            const base = `/api/dashboard/cohorts/${cohortId}`;
            const [
                userActivity,
                userProfiles,
                facilitatorComments,
                discussionTopics,
            ] = await Promise.all([
                client.request<unknown>({ path: `${base}/user-activity` }),
                client.request<unknown>({ path: `${base}/user-profiles` }),
                client.request<unknown>({ path: `${base}/facilitator-comments` }),
                client.request<unknown>({ path: `${base}/discussion-topics` }),
            ]);
            return {
                userActivity,
                userProfiles,
                facilitatorComments,
                discussionTopics,
            };
        },

        /**
         * Publish a facilitator's reply to a participant.
         *
         * The only call in this codebase that writes something a
         * participant will read. Everything else the dashboard produces
         * is a draft or a research record, so this is the one where a
         * mistake reaches a person on a health programme rather than a
         * row in a dataset. Callers must have a human's explicit
         * confirmation before reaching it.
         */
        async postComment(input: PostCommentInput): Promise<void> {
            await client.request<unknown>({
                method: "POST",
                path: "/api/dashboard/comment",
                body: input,
            });
        },
    };
}
