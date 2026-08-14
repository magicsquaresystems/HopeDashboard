import { type NextRequest } from "next/server";

import { signIn } from "@/auth";
import { hopeConfig } from "@/lib/auth/hope-exchange";

/**
 * Where the Hope Move platform lands a facilitator after signing them in.
 *
 * Link shape:
 *   https://<assistant>/auth/callback?code=<one-time>&cohortId=1680
 *
 * The code is traded for an access + refresh pair by the `hope-platform`
 * provider (see src/auth.ts), which also reads the facilitator's identity
 * out of the access token. `cohortId` is optional and only decides where
 * they land.
 *
 * A Route Handler rather than a page, for two reasons: the exchange needs
 * `HOPE_CLIENT_SECRET`, which must never reach the browser, and this is a
 * navigation rather than a fetch — the same reasoning as `/enter`. Note
 * `src/proxy.ts` has to exempt this path, or the sign-in gate redirects
 * it to `/login` before it can create the session it exists to create.
 *
 * On the missing `state` parameter
 * --------------------------------
 * The platform's flow starts on the platform, so there is no earlier
 * request here in which to mint a `state` value and stash it — which
 * means this route cannot verify one, and accepting a `state` it never
 * issued would be security theatre rather than CSRF protection.
 *
 * The consequence is real and worth stating: someone who obtains a valid
 * code can get another person's browser to land here and bind their
 * dashboard session to the wrong Hope identity, with the audit trail
 * agreeing. Closing it properly means the dashboard initiating the flow
 * — a route that sets a state cookie, redirects to Hope, and checks the
 * echo on return. That needs the platform to accept and return the
 * parameter; it has been raised with the platform engineer.
 */
export async function GET(req: NextRequest) {
    const code = req.nextUrl.searchParams.get("code");
    const cohortId = req.nextUrl.searchParams.get("cohortId");
    // Only ever an internal path — never redirect to a caller-supplied
    // absolute URL, which would make this an open redirect.
    const destination =
        cohortId && /^\d+$/.test(cohortId)
            ? `/cohorts/${cohortId}`
            : "/cohorts";

    const fail = (reason: string) =>
        Response.redirect(new URL(`/login?error=${reason}`, req.url));

    if (!code) return fail("no_code");

    if (!hopeConfig()) {
        console.error(
            "HOPE_API_URL / HOPE_CLIENT_ID / HOPE_CLIENT_SECRET are not all " +
                "set — the platform code exchange cannot work",
        );
        return fail("not_configured");
    }

    try {
        // Throws a redirect to `destination` on success.
        await signIn("hope-platform", { code, redirectTo: destination });
    } catch (err) {
        // Next signals a redirect by throwing; that is the success path
        // here and must not be swallowed as an exchange failure.
        if (
            typeof (err as { digest?: unknown }).digest === "string" &&
            (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
        ) {
            throw err;
        }
        // Logged, not shown. The visitor gets one message for every
        // rejection so a probing caller learns nothing about which part
        // failed; the detail is in the server log, where the exchange
        // helpers have already recorded the status.
        console.warn(`hope callback rejected: ${(err as Error).message}`);
        return fail("exchange_failed");
    }

    return fail("exchange_failed");
}
