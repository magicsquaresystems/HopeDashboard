"use client";

import { useSearchParams } from "next/navigation";

/**
 * The `?error=` explanation, and nothing else.
 *
 * `useSearchParams` forces a client-render bailout for whatever
 * component calls it, so it is isolated here. When the whole page was
 * the client component, that bailout emptied the prerendered HTML: the
 * heading, the explainer and the way back to the platform were all
 * absent until the JS chunk loaded, on the one page a facilitator
 * reaches when their session has just expired.
 */
const HANDOFF_ERRORS: Record<string, string> = {
    no_token: "That link didn't carry a sign-in token.",
    invalid_token:
        "That link has expired or isn't valid any more. Links from Hope only work once, and only for a short time. Open the Insights Hub again from your Facilitator Dashboard.",
    not_configured:
        "Sign-in from Hope isn't set up on this deployment yet. Contact the programme admin.",
    // The code-exchange door (`/auth/callback`). Worded the same way as
    // the hand-off errors on purpose: the facilitator does not know or
    // care which of the two routes brought them here, and the fix is the
    // same either way, which is to open the Insights Hub again.
    no_code: "That link didn't carry a sign-in code.",
    exchange_failed:
        "We couldn't confirm that sign-in with Hope. The link may have already been used or expired. Open the Insights Hub again from your Facilitator Dashboard.",
    session_expired:
        "Your session with Hope has expired. Open the Insights Hub again from your Facilitator Dashboard to continue.",
};

export function LoginError() {
    const params = useSearchParams();
    const message = HANDOFF_ERRORS[params.get("error") ?? ""] ?? null;
    if (!message) return null;

    return (
        <p
            role="alert"
            className="rounded-md border border-risk-md bg-risk-md-bg px-3 py-2 text-xs leading-relaxed text-risk-md"
        >
            {message}
        </p>
    );
}
