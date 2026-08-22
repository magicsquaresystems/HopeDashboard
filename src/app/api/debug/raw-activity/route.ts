import { type NextRequest } from "next/server";

import { auth } from "@/auth";
import { hopeConfig } from "@/lib/auth/hope-exchange";
import { hopeSession } from "@/lib/auth/hope-session";

/**
 * TEMPORARY: the platform's raw record for ONE activity, on the test
 * cohort only.
 *
 * Exists to answer one question: the goal text the drafting model
 * receives is a 255-character concatenation of the goal's sub-fields,
 * cut off mid-word. Does the platform also send the sub-fields
 * separately, so the dashboard can build a clean prompt itself? The
 * bundle keeps only six keys, so the raw payload has to be looked at.
 *
 * Hard-limited to cohort 1743 (dummy accounts only) so it cannot be
 * pointed at a real participant. Session-gated. Remove once answered.
 */
const TEST_COHORT_ID = 1743;

export async function GET(req: NextRequest) {
    const session = await auth();
    if (!session?.user?.email) return new Response(null, { status: 404 });

    const activityId = Number(req.nextUrl.searchParams.get("activityId"));
    if (!Number.isSafeInteger(activityId)) {
        return Response.json({ error: "activityId required" });
    }

    const config = hopeConfig();
    const hope = await hopeSession();
    if (!config || !hope) return Response.json({ error: "not linked" });

    const res = await fetch(
        `${config.apiUrl}/api/dashboard/cohorts/${TEST_COHORT_ID}/user-activity`,
        {
            headers: {
                Authorization: `Bearer ${hope.tokens.accessToken}`,
                Accept: "application/json",
                "Accept-Language": "en-GB",
            },
            cache: "no-store",
        },
    );
    if (!res.ok) return Response.json({ status: res.status });
    const doc = (await res.json()) as {
        modules?: { cohorts?: { users?: { activities?: Record<string, unknown>[] }[] }[] }[];
    };
    for (const m of doc.modules ?? [])
        for (const c of m.cohorts ?? [])
            for (const u of c.users ?? [])
                for (const a of u.activities ?? [])
                    if (Number(a.id) === activityId) return Response.json(a);
    return Response.json({ error: "activity not found in test cohort" });
}
