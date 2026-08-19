"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { HopeMoveLink } from "@/components/hope-move-link";

/**
 * Branded route-level error boundary. Before this existed a client
 * crash rendered Next's stock error page — unstyled, unexplained, and
 * with no way back for a facilitator mid-session.
 *
 * The digest goes behind a disclosure rather than on the card: it means
 * nothing to a facilitator, but it's the correlation id whoever reads
 * the server logs will ask for.
 */
export default function ErrorPage({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    return (
        <main className="flex flex-1 items-center justify-center px-4 py-16">
            <div className="w-full max-w-md space-y-4">
                <EmptyState
                    title="Something went wrong"
                    description="The page hit an unexpected error. Your queue and notes are safe — trying again usually fixes it."
                >
                    <div className="flex items-center justify-center gap-2">
                        <Button type="button" onClick={reset}>
                            Try again
                        </Button>
                        <Link
                            href="/cohorts"
                            className="inline-block rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-text"
                        >
                            Back to your cohorts
                        </Link>
                    </div>
                </EmptyState>
                {error.digest && (
                    <details className="text-center text-xs text-muted">
                        <summary className="cursor-pointer select-none">
                            Technical details
                        </summary>
                        <p className="mt-1 font-mono">
                            Error reference: {error.digest}
                        </p>
                    </details>
                )}
                <div className="text-center">
                    <HopeMoveLink />
                </div>
            </div>
        </main>
    );
}
