/**
 * The two decisions the bundle builder makes about *who* is in a cohort
 * and *what they are called*.
 *
 * Both were wrong against live platform data and both are invisible in a
 * unit test of anything else: the queue simply showed the wrong people
 * under the wrong labels. The builder lives in a `.mjs` script because
 * the extraction CLI and the live platform path share one
 * implementation (`lib/server/sources/platform.ts` imports the same
 * module), so it is exercised from here rather than duplicated.
 */

import { describe, expect, it } from "vitest";

import {
    buildCohortBundle,
    buildFacilitatorIdSet,
    buildProfileLookup,
} from "@/../scripts/extract-iih-cohort.mjs";

const COHORT_ID = 1223;
const MODULE_ID = 199;
const START = "2026-01-01T00:00:00";

const FACILITATOR_ID = 900;
const NAMED_ID = 1;
const FIRST_NAME_ONLY_ID = 2;
const ANONYMOUS_ID = 3;
const LOGIN = { signedIn: START };

function userActivity() {
    return {
        modules: [
            {
                id: MODULE_ID,
                name: "H4C Online Facilitator training 2024",
                cohorts: [
                    {
                        id: COHORT_ID,
                        name: "Hope Facilitators 2024",
                        users: [
                            // A login each: an account with no trace of use
                            // counts as never activated and is hidden.
                            { userId: NAMED_ID, started: START, activities: [], logins: [LOGIN] },
                            {
                                userId: FIRST_NAME_ONLY_ID,
                                started: START,
                                activities: [],
                                logins: [LOGIN],
                            },
                            { userId: ANONYMOUS_ID, started: START, activities: [], logins: [LOGIN] },
                            {
                                userId: FACILITATOR_ID,
                                started: START,
                                activities: [],
                            },
                        ],
                    },
                ],
            },
        ],
    };
}

const userProfiles = {
    modules: [
        {
            id: MODULE_ID,
            userProfiles: [
                {
                    userId: NAMED_ID,
                    screenName: "Kaz01",
                    imageUrl: "https://hope.example/u/kaz01.jpg",
                    firstName: "Karen",
                    bio: "",
                    interview: { items: [] },
                },
                {
                    userId: FIRST_NAME_ONLY_ID,
                    firstName: "Garry",
                    bio: "",
                    interview: { items: [] },
                },
                { userId: ANONYMOUS_ID, bio: "", interview: { items: [] } },
            ],
        },
    ],
};

/** One facilitator comment is what identifies a facilitator today. */
const facilitatorComments = {
    modules: [
        {
            userActivities: [
                {
                    facilitatorComments: [
                        { userId: FACILITATOR_ID, text: "Welcome everyone" },
                    ],
                },
            ],
        },
    ],
};

const meta = {
    code: "HC-TEST-010126",
    effectiveStart: `${START}Z`,
    programmeLengthDays: 42,
};

function bundle() {
    return buildCohortBundle(
        userActivity(),
        userProfiles,
        facilitatorComments,
        { modules: [] },
        buildFacilitatorIdSet(facilitatorComments),
        buildProfileLookup(userProfiles),
        new Set([MODULE_ID]),
        COHORT_ID,
        meta,
    );
}

it("keeps raw nullable starts and the full enrolment roster apart from the visible queue", () => {
    const source = userActivity();
    source.modules[0].cohorts[0].users[0].started = null as unknown as string;
    const result = buildCohortBundle(source, userProfiles, facilitatorComments, {modules:[]},
        buildFacilitatorIdSet(facilitatorComments), buildProfileLookup(userProfiles),
        new Set([MODULE_ID]), COHORT_ID, meta);
    const participant = result.participants.find((p: {participant_id: string}) => p.participant_id===String(NAMED_ID));
    expect(participant.recordedStartedAt).toBeNull();
    expect(result.predictionRoster.members.some((m: {participant_id: string}) => m.participant_id===String(FACILITATOR_ID))).toBe(true);
    expect(result.participants.some((p: {participant_id: string}) => p.participant_id===String(FACILITATOR_ID))).toBe(false);
});

describe("buildProfileLookup", () => {
    it("carries the platform's screen name, which is what a person is called there", () => {
        const byUser = buildProfileLookup(userProfiles);
        expect(byUser.get(NAMED_ID)?.screenName).toBe("Kaz01");
        expect(byUser.get(FIRST_NAME_ONLY_ID)?.screenName).toBeNull();
    });
});

describe("buildCohortBundle — who is a participant", () => {
    it("keeps facilitators out of the participant list", () => {
        // Facilitators appear in a cohort's user activity exactly as
        // participants do. Left in, they are scored for dropout risk and
        // sit in the follow-up queue among the people they support —
        // three of them ranked at 87% on cohort 1223 because they had
        // never taken part in their own course.
        const ids = bundle().participants.map(
            (p: { participant_id: string }) => p.participant_id,
        );
        expect(ids).not.toContain(String(FACILITATOR_ID));
        expect(ids).toHaveLength(3);
    });
});

describe("buildCohortBundle — what a participant is called", () => {
    it("prefers the screen name the platform shows", () => {
        // A facilitator has to find this person on Hope to reply to
        // them, so the name has to be the one Hope displays.
        const p = bundle().participants.find(
            (x: { participant_id: string }) =>
                x.participant_id === String(NAMED_ID),
        );
        expect(p.displayName).toBe("Kaz01");
    });

    it("falls back to a first name when there is no screen name", () => {
        const p = bundle().participants.find(
            (x: { participant_id: string }) =>
                x.participant_id === String(FIRST_NAME_ONLY_ID),
        );
        expect(p.displayName).toBe("Garry");
    });

    it("falls back to a positional alias only when the bundle has no profile", () => {
        // Which is the normal case for the extracted research bundles,
        // whose module carries no profile export at all.
        const p = bundle().participants.find(
            (x: { participant_id: string }) =>
                x.participant_id === String(ANONYMOUS_ID),
        );
        expect(p.displayName).toMatch(/^P\d+$/);
    });
});

describe("buildCohortBundle — the platform's profile photo", () => {
    it("carries the image through so the queue can show a face", () => {
        const p = bundle().participants.find(
            (x: { participant_id: string }) =>
                x.participant_id === String(NAMED_ID),
        );
        expect(p.imageUrl).toBe("https://hope.example/u/kaz01.jpg");
    });

    it("is null when the profile has no photo", () => {
        const p = bundle().participants.find(
            (x: { participant_id: string }) =>
                x.participant_id === String(FIRST_NAME_ONLY_ID),
        );
        expect(p.imageUrl).toBeNull();
    });

    it("is null when there is no profile at all", () => {
        // The normal case for extracted research bundles, whose module
        // carries no profile export.
        const p = bundle().participants.find(
            (x: { participant_id: string }) =>
                x.participant_id === String(ANONYMOUS_ID),
        );
        expect(p.imageUrl).toBeNull();
    });
});

describe("buildCohortBundle — never-activated enrolments", () => {
    type Id = { participant_id: string };
    const ids = (xs: Id[]) => xs.map((x) => x.participant_id);

    /** The fixture cohort plus one extra enrolment shaped by `extra`. */
    function withEnrolment(extra: Record<string, unknown>, profiles = userProfiles) {
        const source = userActivity();
        source.modules[0].cohorts[0].users.push({
            userId: 4,
            started: START,
            activities: [],
            ...extra,
        } as (typeof source.modules)[0]["cohorts"][0]["users"][0]);
        return buildCohortBundle(
            source, profiles, facilitatorComments, { modules: [] },
            buildFacilitatorIdSet(facilitatorComments),
            buildProfileLookup(profiles), new Set([MODULE_ID]), COHORT_ID, meta,
        );
    }

    it("hides an account with no trace of use but keeps it in the model's roster", () => {
        // Hope only lets facilitators message someone once they have
        // activated. The roster still counts them: cohort_size has to
        // match how the model was trained.
        const result = withEnrolment({});
        expect(ids(result.participants)).not.toContain("4");
        expect(ids(result.predictionRoster.members)).toContain("4");
        expect(result.cohort.hidden).toEqual({ facilitators: 1, neverActivated: 1 });
    });

    it("treats `started` alone as no evidence of activation", () => {
        // 350 raw users have logins but no `started`; it does not mean
        // what its name suggests, so it cannot keep someone visible.
        expect(ids(withEnrolment({ started: START }).participants)).not.toContain("4");
    });

    it.each([
        ["a page visit", { pageVisits: [{ url: "/modules/session-1/intro" }] }],
        ["a bookmark", { bookmarks: [{ recorded: START }] }],
        ["a login", { logins: [{ signedIn: START }] }],
    ])("keeps an account with %s", (_label, extra) => {
        expect(ids(withEnrolment(extra).participants)).toContain("4");
    });

    it("lets the platform's own `activated` flag override the proxy either way", () => {
        const flagged = (activated: boolean) => ({
            modules: [{
                id: MODULE_ID,
                userProfiles: [
                    ...userProfiles.modules[0].userProfiles,
                    { userId: 4, activated, bio: "", interview: { items: [] } },
                ],
            }],
        });
        expect(ids(withEnrolment({}, flagged(true)).participants)).toContain("4");
        expect(
            ids(withEnrolment({ logins: [LOGIN] }, flagged(false)).participants),
        ).not.toContain("4");
    });

    it("builds an empty queue rather than failing when nobody has activated", () => {
        // A cohort on its first morning: everyone enrolled, nobody in yet.
        const source = userActivity();
        for (const u of source.modules[0].cohorts[0].users) {
            delete (u as { logins?: unknown }).logins;
        }
        const result = buildCohortBundle(
            source, userProfiles, facilitatorComments, { modules: [] },
            buildFacilitatorIdSet(facilitatorComments),
            buildProfileLookup(userProfiles), new Set([MODULE_ID]), COHORT_ID, meta,
        );
        expect(result.participants).toEqual([]);
        expect(result.cohort.moduleId).toBe(MODULE_ID);
    });
});
