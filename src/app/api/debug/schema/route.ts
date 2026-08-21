import { type NextRequest } from "next/server";

import { hopeConfig } from "@/lib/auth/hope-exchange";
import { hopeSession } from "@/lib/auth/hope-session";

/**
 * TEMPORARY: what FIELDS the platform's cohort documents carry.
 *
 * Written to answer one question that cannot be answered from the
 * integration doc: does a participant record carry a role, so the
 * dashboard can tell a facilitator from a participant? Today it cannot,
 * and facilitators who have never posted sit in the follow-up queue
 * being scored for dropout risk.
 *
 * Returns key NAMES only, never values. The documents hold participant
 * writing and wellbeing scores, and none of that is needed — or wanted —
 * to answer a question about shape. Session-gated on top of the key, so
 * it can only be reached by someone already signed in through Hope.
 *
 * Remove with the other debug routes once the integration settles.
 */
const GATE_KEY = "9f2c1d84ab6e470bb3d5c0e7a1f84d26";

/** Field names on the first element of a nested array, if there is one. */
function keysOfFirst(value: unknown, path: string[]): string[] | string {
    let node: unknown = value;
    for (const step of path) {
        if (!node || typeof node !== "object") return `no ${step}`;
        node = (node as Record<string, unknown>)[step];
        if (Array.isArray(node)) node = node[0];
    }
    if (!node || typeof node !== "object") return "absent";
    return Object.keys(node as Record<string, unknown>).sort();
}

export async function GET(req: NextRequest) {
    if (req.nextUrl.searchParams.get("key") !== GATE_KEY) {
        return new Response(null, { status: 404 });
    }
    const cohortId = Number(req.nextUrl.searchParams.get("cohortId"));
    if (!Number.isSafeInteger(cohortId)) {
        return Response.json({ error: "cohortId must be a whole number" });
    }

    const config = hopeConfig();
    const session = await hopeSession();
    if (!config || !session) {
        return Response.json({ error: "no platform-linked session" });
    }

    const base = `${config.apiUrl}/api/dashboard/cohorts/${cohortId}`;
    const headers = {
        Authorization: `Bearer ${session.tokens.accessToken}`,
        Accept: "application/json",
        "Accept-Language": "en-GB",
    };

    async function shape(path: string, into: string[]) {
        try {
            const res = await fetch(`${base}${path}`, {
                headers,
                cache: "no-store",
                signal: AbortSignal.timeout(20_000),
            });
            if (!res.ok) return { status: res.status };
            const body: unknown = await res.json();
            return {
                status: res.status,
                topLevel: Object.keys(body as Record<string, unknown>).sort(),
                sample: keysOfFirst(body, into),
            };
        } catch (err) {
            return { error: (err as Error).message };
        }
    }

    return Response.json({
        userProfiles: await shape("/user-profiles", ["modules", "userProfiles"]),
        userActivity: await shape("/user-activity", ["modules", "cohorts", "users"]),
        // Does an activity carry an id we can reply to, and does a forum
        // reply carry one? The publish route needs a per-record id, and
        // forum posts are the case it currently cannot serve.
        activity: await shape("/user-activity", [
            "modules",
            "cohorts",
            "users",
            "activities",
        ]),
        discussionTopics: await shape("/discussion-topics", ["modules", "topics"]),
        facilitatorComments: await shape("/facilitator-comments", [
            "modules",
            "userActivities",
        ]),
    });
}
