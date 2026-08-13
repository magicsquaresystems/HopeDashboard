"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { LogOut } from "lucide-react";

import { useCohortScoring } from "@/lib/hooks/useCohortScoring";
import { useSessionStatsStore } from "@/lib/store/sessionStatsStore";
import type { CohortMeta } from "@/lib/cohorts";

type TopbarProps = {
    cohort: CohortMeta;
};

export function Topbar({ cohort }: TopbarProps) {
    const { batch, isScoring } = useCohortScoring(cohort.id);
    const sentThisSession = useSessionStatsStore((s) => s.sentThisSession);
    // Who am I? Now that every thumb and send is attributed to the
    // signed-in account, the facilitator needs to be able to see which
    // account that is — shared machines are normal in this setting, and
    // silently logging outreach under a colleague's name would poison
    // both the audit trail and the training feedback.
    const { data: session } = useSession();
    const who = session?.user?.name ?? session?.user?.email ?? null;
    const isTestingMode = process.env.NEXT_PUBLIC_AUTH_MODE !== "allowlist";

    // While a re-score is in flight there are no counts. Rendering `0`
    // would state — confidently and wrongly — that nobody needs follow-up,
    // so the pills show a placeholder until real numbers land.
    const data = batch.data;
    const high = data?.high ?? 0;
    const medium = data?.medium ?? 0;
    const needsFollowUp = high + medium;

    return (
        <header className="flex flex-col gap-3 border-b border-border bg-surface px-4 py-3 sm:px-5 lg:flex-row lg:flex-wrap lg:items-center lg:gap-4">
            <div className="flex flex-wrap items-center gap-3">
                <Link
                    href="/cohorts"
                    className="flex shrink-0 items-center gap-2.5"
                    aria-label="hope·move home"
                >
                    <span className="grid h-6 w-6 place-items-center rounded-md bg-text text-[11px] font-bold text-surface">
                        h·
                    </span>
                    <span className="font-semibold tracking-tight text-text">
                        hope·move
                    </span>
                </Link>
                <nav
                    aria-label="breadcrumb"
                    className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-muted"
                >
                    <span className="hidden sm:inline">Participant support</span>
                    <span
                        className="hidden opacity-40 sm:inline"
                        aria-hidden
                    >
                        /
                    </span>
                    <span className="truncate rounded border border-border px-1.5 py-0.5 text-xs text-text-2 font-mono">
                        {cohort.code}
                    </span>
                </nav>
            </div>
            <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
                <StatPill
                    value={needsFollowUp}
                    label="need follow-up"
                    loading={isScoring}
                />
                <StatPill
                    value={high}
                    label="high priority"
                    loading={isScoring}
                />
                {/* Session counter is local state — never in flight. */}
                <StatPill value={sentThisSession} label="contacted this session" />
                {isTestingMode && (
                    <span
                        className="rounded-md border border-risk-md/40 bg-risk-md-bg px-2 py-1 text-[11px] font-medium text-risk-md"
                        title="AUTH_MODE=open — any email can sign in. Set AUTH_MODE=allowlist for production."
                    >
                        Testing mode
                    </span>
                )}
                {who && (
                    <div className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5">
                        <span
                            className="max-w-[14ch] truncate text-xs text-text-2"
                            title={session?.user?.email ?? undefined}
                        >
                            {who}
                        </span>
                        <button
                            type="button"
                            onClick={() => signOut({ callbackUrl: "/login" })}
                            className="text-muted transition-colors hover:text-text"
                            title="Sign out"
                            aria-label="Sign out"
                        >
                            <LogOut className="h-3.5 w-3.5" aria-hidden />
                        </button>
                    </div>
                )}
            </div>
        </header>
    );
}

function StatPill({
    value,
    label,
    loading = false,
}: {
    value: number;
    label: string;
    loading?: boolean;
}) {
    return (
        <div
            className="flex items-baseline gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5"
            aria-busy={loading || undefined}
        >
            {/* Deliberately not a spinner. The week bar already owns the
                one "scoring…" affordance; three spinners racing in the same
                header read as three separate operations. A dash simply says
                "no number yet" — which beats publishing a confident `0`. */}
            <span
                className={
                    "text-sm font-semibold tracking-tight tabular-nums " +
                    (loading ? "text-muted/50" : "text-text")
                }
            >
                {loading ? "—" : value}
            </span>
            <span className="text-xs text-muted">{label}</span>
        </div>
    );
}
