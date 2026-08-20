"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { LogOut } from "lucide-react";

import { HopeMoveLink } from "@/components/hope-move-link";
import { useCohortScoring } from "@/lib/hooks/useCohortScoring";
import { useQueueState } from "@/lib/hooks/useQueueState";
import { useSessionStatsStore } from "@/lib/store/sessionStatsStore";
import { isHidden } from "@/lib/queue-state-shared";
import type { CohortMeta } from "@/lib/cohorts";

type TopbarProps = {
    cohort: CohortMeta;
};

export function Topbar({ cohort }: TopbarProps) {
    const { batch, isScoring } = useCohortScoring(cohort.id);
    const queueState = useQueueState(cohort.id);
    const sentThisSession = useSessionStatsStore((s) =>
        s.contactedCount(cohort.id),
    );
    // Who am I? Now that every thumb and send is attributed to the
    // signed-in account, the facilitator needs to be able to see which
    // account that is — shared machines are normal in this setting, and
    // silently logging outreach under a colleague's name would poison
    // both the audit trail and the training feedback.
    const { data: session } = useSession();
    const who = session?.user?.name ?? session?.user?.email ?? null;

    // Frozen at mount for the same reason as the queue's clock: snooze
    // expiry compared against a ticking now would move the counts under
    // the facilitator mid-session.
    const [now] = useState(() => Date.now());

    // Derived from the per-participant predictions, not the response's
    // aggregate high/medium fields, for two reasons: snoozed/dismissed
    // participants must not be counted (the queue hides them, and a
    // topbar that keeps counting them contradicts the list beside it),
    // and deriving from the same rows the queue renders means the two
    // can never disagree about who was scored.
    const { high, medium } = useMemo(() => {
        const preds = batch.data?.predictions ?? [];
        const state = queueState.data;
        let high = 0;
        let medium = 0;
        for (const p of preds) {
            if (state && isHidden(state, p.participant_id, now)) continue;
            if (p.risk_level === "high") high += 1;
            else if (p.risk_level === "medium") medium += 1;
        }
        return { high, medium };
    }, [batch.data?.predictions, queueState.data, now]);
    const needsFollowUp = high + medium;

    return (
        <header className="border-b border-border bg-surface">
            {/* The platform's gradient as a hairline, not a header band:
                the one persistent brand echo on the working screen. */}
            <div
                aria-hidden
                className="h-0.5 bg-linear-to-r from-brand-a to-brand-b"
            />
            <div className="flex flex-col gap-3 px-4 py-3 sm:px-5 lg:flex-row lg:flex-wrap lg:items-center lg:gap-4">
            <div className="flex flex-wrap items-center gap-3">
                <Link
                    href="/cohorts"
                    className="flex shrink-0 items-center gap-2.5"
                    aria-label="Participant Insights Hub, back to your cohorts"
                >
                    <span className="grid h-6 w-6 place-items-center rounded-md bg-linear-to-br from-brand-a to-brand-b text-[11px] font-bold text-white">
                        ih
                    </span>
                    <span className="font-semibold tracking-tight text-text">
                        Insights Hub
                    </span>
                </Link>
                <nav
                    aria-label="breadcrumb"
                    className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-muted"
                >
                    <Link
                        href="/cohorts"
                        className="hidden transition-colors hover:text-text sm:inline"
                    >
                        Cohorts
                    </Link>
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
                {/* Leaving the app and identifying yourself are different
                    jobs, so they get a divider rather than sitting in one
                    undifferentiated row. The back link keeps the arrow
                    (it goes somewhere), the account does not. */}
                <span
                    aria-hidden
                    className="mx-0.5 hidden h-5 w-px bg-border sm:block"
                />
                <HopeMoveLink label="Hope Move" className="text-xs" />
                {who && (
                    <div className="flex items-center gap-2 rounded-md border border-border bg-surface py-1 pl-2.5 pr-1">
                        <span
                            className="max-w-[16ch] truncate text-xs text-text-2"
                            title={session?.user?.email ?? undefined}
                        >
                            {who}
                        </span>
                        {/* Labelled, not a bare glyph: an icon-only door
                            out of a clinical tool is one mis-click from
                            ending someone's session mid-draft. */}
                        <button
                            type="button"
                            onClick={() => signOut({ callbackUrl: "/login" })}
                            className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted transition-colors hover:bg-surface-2 hover:text-text"
                            title="Sign out"
                        >
                            <LogOut className="h-3.5 w-3.5" aria-hidden />
                            <span className="hidden sm:inline">Sign out</span>
                            <span className="sr-only sm:hidden">Sign out</span>
                        </button>
                    </div>
                )}
            </div>
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
