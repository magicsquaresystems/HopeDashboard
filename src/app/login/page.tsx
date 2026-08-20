import { Suspense } from "react";

import { HopeMoveLink } from "@/components/hope-move-link";
import { LoginError } from "./login-error";

/**
 * Not the way in — the way in is `/enter`, which the Hope platform
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
 *
 * A server component on purpose. It was a client component so it could
 * read `?error=`, and that single call emptied the prerendered HTML —
 * every visitor got a blank page with a footer until hydration. The
 * search-param read now lives in `LoginError` alone.
 */

// Rendered per request so the platform URL comes from the running
// environment rather than whatever was set when the image was built.
// This is the page a facilitator lands on when their session expires,
// so a stale or missing way back is the difference between a dead end
// and a way home; it has nothing to gain from being static.
export const dynamic = "force-dynamic";

export default function LoginPage() {
    return (
        <main className="flex flex-1 items-center justify-center px-4">
            <div className="w-full max-w-sm overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
                {/* The platform's magenta-to-purple gradient, as a top
                    edge rather than a whole header band: enough to say
                    "same family as Hope" without importing its chrome. */}
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

                    <Suspense fallback={null}>
                        <LoginError />
                    </Suspense>

                    <HopeMoveLink
                        variant="prominent"
                        label="Go to Facilitator Dashboard"
                    />
                </div>
            </div>
        </main>
    );
}
