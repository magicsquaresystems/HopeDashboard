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
                            { userId: NAMED_ID, started: START, activities: [] },
                            {
                                userId: FIRST_NAME_ONLY_ID,
                                started: START,
                                activities: [],
                            },
                            { userId: ANONYMOUS_ID, started: START, activities: [] },
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
