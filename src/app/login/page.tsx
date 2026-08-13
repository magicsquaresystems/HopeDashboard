"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState, useTransition } from "react";

/**
 * Not the way in — the way in is `/enter`, which the Hope Move platform
 * links to with a signed identity token (see lib/auth/handoff.ts).
 * Facilitators are already signed in over there; asking them to
 * authenticate again would be friction with no security benefit.
 *
 * This page exists for the two cases where that hasn't happened: a
 * hand-off that failed (expired link, misconfigured secret), and local
 * development, where there is no platform to arrive from. In testing
 * mode it offers the email form so the dashboard is runnable on a
 * laptop; in production posture it explains where to go instead, since
 * a form that can't help anyone is worse than a sentence that can.
 */
const AUTH_OPEN = process.env.NEXT_PUBLIC_AUTH_MODE !== "allowlist";

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
    const nextUrl = params.get("callbackUrl") ?? "/cohorts";
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

                {AUTH_OPEN && <DevSignIn nextUrl={nextUrl} />}
            </div>
        </main>
    );
}

/** Laptop-only fallback: there is no platform to arrive from in dev. */
function DevSignIn({ nextUrl }: { nextUrl: string }) {
    const [email, setEmail] = useState("");
    const [pending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);

    function onSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
            const result = await signIn("dev-allowlist", {
                email,
                redirect: false,
                callbackUrl: nextUrl,
            });
            if (result?.error) setError("Sign-in failed. Try again.");
            else if (result?.url) window.location.href = result.url;
        });
    }

    return (
        <form onSubmit={onSubmit} className="space-y-3 border-t border-border pt-4">
            <p className="text-xs font-medium text-muted">
                Testing mode — sign in directly
            </p>
            <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.org"
                required
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent-2"
            />
            {error && (
                <p className="text-sm text-risk-hi" role="alert">
                    {error}
                </p>
            )}
            <button
                type="submit"
                disabled={pending}
                className="w-full rounded-md border border-border px-4 py-2 text-sm font-medium text-text disabled:opacity-50"
            >
                {pending ? "Signing in…" : "Continue"}
            </button>
        </form>
    );
}
