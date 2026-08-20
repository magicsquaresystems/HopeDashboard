"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { HopeMoveLink } from "@/components/hope-move-link";

/**
 * Not the way in — the way in is `/enter`, which the Hope Move platform
 * links to with a signed identity token (see lib/auth/handoff.ts).
 * Facilitators are already signed in over there; asking them to
 * authenticate again would be friction with no security benefit.
 *
 * This page exists for the cases where that hasn't happened: a hand-off
 * that failed (expired link, misconfigured secret) or someone opening
 * the URL directly. It explains where to go; it deliberately offers no
 * sign-in form of its own. The direct email form that used to live here
 * was a testing affordance, and testing affordances don't belong on a
 * deployment that fronts real participant data. For local development,
 * mint a hand-off link with `scripts/mint-handoff-token.mjs`.
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
    // same either way — go back and open the Insights Hub again.
    no_code: "That link didn't carry a sign-in code.",
    exchange_failed:
        "We couldn't confirm that sign-in with Hope. The link may have already been used or expired. Open the Insights Hub again from your Facilitator Dashboard.",
    session_expired:
        "Your session with Hope has expired. Open the Insights Hub again from your Facilitator Dashboard to continue.",
};

export default function LoginPage() {
    return (
        <Suspense fallback={null}>
            <LoginBody />
        </Suspense>
    );
}

function LoginBody() {
    const params = useSearchParams();
    const handoffError = HANDOFF_ERRORS[params.get("error") ?? ""] ?? null;

    return (
        <main className="flex flex-1 items-center justify-center px-4">
            <div className="w-full max-w-sm overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
                {/* The platform's magenta-to-purple gradient, as a top
                    edge rather than a whole header band: enough to say
                    "same family as Hope Move" without importing its
                    chrome. */}
                <div
                    aria-hidden
                    className="h-1 bg-linear-to-r from-brand-a to-brand-b"
                />
                <div className="space-y-4 p-6">
                    <div className="flex items-center gap-3">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-linear-to-br from-brand-a to-brand-b text-sm font-bold text-white">
                            ih
                        </span>
                        <div>
                            <h1 className="text-lg font-semibold leading-tight text-text">
                                Participant Insights Hub
                            </h1>
                            <p className="text-xs text-muted">
                                for Hope Programme facilitators
                            </p>
                        </div>
                    </div>

                    <p className="text-sm leading-relaxed text-text-2">
                        There is no password here. Open the Insights Hub from
                        your Facilitator Dashboard on Hope and it signs you in
                        automatically.
                    </p>

                    {handoffError && (
                        <p
                            role="alert"
                            className="rounded-md border border-risk-md bg-risk-md-bg px-3 py-2 text-xs leading-relaxed text-risk-md"
                        >
                            {handoffError}
                        </p>
                    )}

                    <HopeMoveLink
                        variant="prominent"
                        label="Go to Facilitator Dashboard"
                    />
                </div>
            </div>
        </main>
    );
}
