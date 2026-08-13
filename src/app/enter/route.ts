import { type NextRequest } from "next/server";

import { signIn } from "@/auth";
import { handoffSecret, verifyHandoffToken } from "@/lib/auth/handoff";

/**
 * The door the Hope Move platform sends facilitators through.
 *
 * Link shape:
 *   https://<assistant>/enter?token=<signed>&cohortId=1680
 *
 * The token carries who they are (see lib/auth/handoff.ts); `cohortId`
 * is optional and just decides where they land — omit it and they get
 * the cohort picker.
 *
 * The token is verified here *before* `signIn` is called, even though
 * the `platform-handoff` provider verifies it again. That is not
 * redundancy for its own sake: a provider rejection surfaces as a
 * NextAuth error that strands the visitor on this URL with a dead
 * token in the address bar, whereas checking first lets a bad link end
 * on a page that explains what to do about it.
 *
 * Kept out of `/api` on purpose: this is a navigation, not a fetch, so
 * `proxy.ts` treats it like a page. It is exempt from the sign-in gate
 * there — requiring a session to reach the route that creates one is a
 * loop.
 */
export async function GET(req: NextRequest) {
    const token = req.nextUrl.searchParams.get("token");
    const cohortId = req.nextUrl.searchParams.get("cohortId");
    // Only ever an internal path — never redirect to a caller-supplied
    // absolute URL, which would make this an open redirect.
    const destination =
        cohortId && /^\d+$/.test(cohortId)
            ? `/cohorts/${cohortId}`
            : "/cohorts";

    const fail = (reason: string) =>
        Response.redirect(new URL(`/login?error=${reason}`, req.url));

    if (!token) return fail("no_token");

    const secret = handoffSecret();
    if (!secret) {
        console.error(
            "HOPE_HANDOFF_SECRET is not set — platform hand-off cannot work",
        );
        return fail("not_configured");
    }

    const result = await verifyHandoffToken(token, secret);
    if (!result.ok) {
        // Logged, not shown: the visitor gets one message for every
        // rejection, so a probing caller learns nothing about which
        // part of their token was wrong.
        console.warn(`handoff rejected: ${result.reason}`);
        return fail("invalid_token");
    }

    // Throws a redirect to `destination` on success.
    await signIn("platform-handoff", { token, redirectTo: destination });
    return fail("invalid_token");
}
