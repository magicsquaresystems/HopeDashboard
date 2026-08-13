"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

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
        "That link has expired or isn't valid any more. Links from Hope Move are single-use and short-lived — open the assistant again from your dashboard.",
    not_configured:
        "Sign-in from Hope Move isn't configured on this deployment yet. Contact the programme admin.",
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
    const hopeMoveUrl = process.env.NEXT_PUBLIC_HOPE_MOVE_URL;

    return (
        <main className="flex flex-1 items-center justify-center px-4">
            <div className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-surface p-6 shadow-sm">
                <div>
                    <h1 className="text-xl font-semibold text-text">
                        Hope Facilitator Assistant
                    </h1>
                    <p className="mt-1 text-sm text-muted">
                        Open this assistant from your Hope Move dashboard —
                        it signs you in automatically.
                    </p>
                </div>

                {handoffError && (
                    <p
                        role="alert"
                        className="rounded-md border border-risk-md bg-risk-md-bg px-3 py-2 text-xs leading-relaxed text-risk-md"
                    >
                        {handoffError}
                    </p>
                )}

                {hopeMoveUrl && (
                    <a
                        href={hopeMoveUrl}
                        className="block w-full rounded-md bg-text px-4 py-2 text-center text-sm font-medium text-surface"
                    >
                        Go to Hope Move
                    </a>
                )}
            </div>
        </main>
    );
}
