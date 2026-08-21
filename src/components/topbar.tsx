"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useSession } from "next-auth/react";

import { AccountMenu } from "@/components/account-menu";
import { useCohortScoring } from "@/lib/hooks/useCohortScoring";
import { useQueueState } from "@/lib/hooks/useQueueState";
import { useSessionStatsStore } from "@/lib/store/sessionStatsStore";
import { isHidden } from "@/lib/queue-state-shared";
import type { CohortMeta } from "@/lib/cohorts";

type TopbarProps = {
    cohort: CohortMeta;
};

export function Topbar({ cohort }: TopbarProps) {
    const { batch, isScoring, notStarted } = useCohortScoring(cohort.id);
    // A failed score is not a score of zero. `isScoring` now ends on
    // error (so the page stops spinning), which left these pills
    // rendering a confident "0 need follow-up" beside a queue saying
    // the scores could not be loaded. The dash means "no number yet",
    // and that is still the truth after a failure.
    //
    // `notStarted` joins them: in a cohort's first week nothing has
    // been scored, so "0 need follow-up" would report an all-clear the
    // model never gave. It is a settled state rather than a pending
    // one, which is why it drives the dash but not `aria-busy`.
    const noNumbers = isScoring || batch.isError || notStarted;
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
    // `||`, not `??`: an account whose name is the empty string would
    // otherwise keep it, and since the topbar only renders the account
    // menu when `who` is truthy, that facilitator would lose the only
    // in-page route back to the Facilitator Dashboard.
    const who = session?.user?.name || session?.user?.email || null;

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
                    unknown={noNumbers}
                    busy={isScoring}
                    title={
                        notStarted
                            ? "Nobody is scored until this cohort's first week completes, so there is no follow-up count yet."
                            : undefined
                    }
                />
                <StatPill
                    value={high}
                    label="high priority"
                    unknown={noNumbers}
                    busy={isScoring}
                    title={
                        notStarted
                            ? "Nobody is scored until this cohort's first week completes, so there is no priority count yet."
                            : undefined
                    }
                />
                {/* Session counter is local state — never in flight. */}
                <StatPill value={sentThisSession} label="contacted this session" />
                {/* Identity and both ways out live in one menu, the way
                    the platform's own header does it. See AccountMenu. */}
                <span
                    aria-hidden
                    className="mx-0.5 hidden h-5 w-px bg-border sm:block"
                />
                {who && (
                    <AccountMenu name={who} email={session?.user?.email} />
                )}
            </div>
            </div>
        </header>
    );
}

function StatPill({
    value,
    label,
    unknown = false,
    busy = false,
    title,
}: {
    value: number;
    label: string;
    /** No number to show. Covers scoring in flight, a failed score, and
     *  a cohort too new to score — all of which must render the dash. */
    unknown?: boolean;
    /** Of those, only the in-flight one is `aria-busy`: a screen reader
     *  told a settled state is busy waits for an update that is never
     *  coming. */
    busy?: boolean;
    title?: string;
}) {
    return (
        <div
            className="flex items-baseline gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5"
            aria-busy={busy || undefined}
            title={title}
        >
            {/* Deliberately not a spinner. The week bar already owns the
                one "scoring…" affordance; three spinners racing in the same
                header read as three separate operations. A dash simply says
                "no number yet" — which beats publishing a confident `0`. */}
            <span
                className={
                    "text-sm font-semibold tracking-tight tabular-nums " +
                    (unknown ? "text-muted/50" : "text-text")
                }
            >
                {unknown ? "—" : value}
            </span>
            <span className="text-xs text-muted">{label}</span>
        </div>
    );
}
