/**
 * The triage queue — left column of the cohort page.
 *
 * Turns a cohort bundle into a risk-ranked worklist. The pipeline is:
 *
 *   bundle (local JSON)
 *     → bundleToHistory() per participant, truncated at the selected week
 *     → useCohortBatch() scores them all in one call
 *     → filter by risk level, then by search text
 *     → partition into visible vs hidden (snoozed / dismissed)
 *     → paginate
 *
 * Two things about this file are easy to get wrong:
 *
 * 1. **Ordering is the service's, not ours.** `/batch` returns predictions
 *    sorted by descending risk, and that order is preserved straight through
 *    to render. There is no client-side sort to find — if the queue looks
 *    mis-ordered, the scores changed, not the sorting.
 *
 * 2. **The week selector is an input to scoring, not a display filter.**
 *    Changing the week rebuilds every `ParticipantHistory` with events
 *    truncated to that day, which changes the cache key and re-scores the
 *    whole cohort. It does not filter an existing list.
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import {
    ChevronDown,
    ChevronsLeft,
    ChevronsRight,
    CloudOff,
} from "lucide-react";

const PAGE_SIZE = 10;

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AnchoredWeekNotice } from "@/components/anchored-week-notice";
import { QueueItem } from "@/components/queue-item";
import { Skeleton } from "@/components/ui/skeleton";
import { useCohortScoring } from "@/lib/hooks/useCohortScoring";
import { useQueueLayoutStore } from "@/lib/store/queueLayoutStore";
import { isAnchoredWeek, useScoringStore } from "@/lib/store/scoringStore";
import { useUiStore } from "@/lib/store/uiStore";
import { useQueueOp, useQueueState } from "@/lib/hooks/useQueueState";
import { friendlyLoadError, type FriendlyLoadError } from "@/lib/load-error";
import { HopeMoveLink } from "@/components/hope-move-link";
import { agoLabel, shortActor } from "@/lib/queue-state-shared";
import { QUEUE_PILL_LABELS } from "@/lib/risk";
import { lastActiveLabel } from "@/lib/signals";
import { useBundleDisplayName } from "@/lib/hooks/displayName";
import type { CohortMeta } from "@/lib/cohorts";
import type {
    ParticipantHistory,
    RiskLevel,
} from "@/lib/api/dropout";

const FILTERS: Array<RiskLevel | "all"> = ["all", "high", "medium", "low"];

/**
 * A row in the queue, scored or not.
 *
 * The risk fields are optional so the same list, filtering, snoozing and
 * pagination serve a cohort in its first week, where the model is
 * withheld and rows come from the roster. A prediction satisfies this
 * shape as it stands, so the scored path is unchanged.
 */
type QueueRow = {
    participant_id: string;
    risk_level?: RiskLevel;
    dropout_risk?: number;
    threshold_low?: number;
    threshold_high?: number;
};

/**
 * "Now", frozen at mount.
 *
 * Snooze expiry is compared against this rather than a live clock so the
 * comparison stays stable across re-renders. A ticking `Date.now()` would make
 * the visible/hidden partition a moving target and could pop a participant back
 * into the list mid-interaction. The page is re-mounted per cohort, so the
 * value is fresh whenever it matters.
 */
function useMountTime(): number {
    const [t] = useState(() => Date.now());
    return t;
}

export function Queue({ cohort }: { cohort: CohortMeta }) {
    const scoreAtWeek = useScoringStore((s) => s.scoreAtWeek);
    // Histories and the batch come from the shared scoring hook — the
    // same instance the topbar reads, so the two can never disagree on
    // what was scored. The hook also withholds scoring entirely while
    // the cohort is under a week old (`notStarted`).
    const { batch, bundle, histories, notStarted, roster } = useCohortScoring(
        cohort.id,
    );

    // In a cohort's first week the model is withheld, so rows come from
    // the roster instead of from predictions and carry no tier. Derived
    // from the roster rather than from `notStarted` so the list and its
    // labelling can never disagree about which one is on screen.
    const unscored = roster.length > 0;

    const histLookup = useMemo(() => {
        const m = new Map<string, ParticipantHistory>();
        for (const h of histories) m.set(h.participant_id, h);
        return m;
    }, [histories]);

    const { data, isLoading, error } = batch;
    const selectedId = useUiStore((s) => s.selectedParticipantId);
    const select = useUiStore((s) => s.selectParticipant);
    // Shared across facilitators — see useQueueState. Another
    // facilitator's snooze appears here within one poll interval.
    const queueState = useQueueState(cohort.id);
    const queueOp = useQueueOp(cohort.id);
    const snoozes = queueState.data?.snoozes;
    const dismissals = queueState.data?.dismissals;
    const contacted = queueState.data?.contacted;
    const now = useMountTime();

    const [filter, setFilter] = useState<RiskLevel | "all">("all");
    const [query, setQuery] = useState("");
    const [showHidden, setShowHidden] = useState(false);
    const [page, setPage] = useState(0);

    // Reset to page 0 whenever filter/query change so the user isn't
    // stuck on a page that no longer exists for the new result set.
    // Legitimate side-effect (sync external prop change to local state).
    useEffect(() => {
        /* eslint-disable react-hooks/set-state-in-effect */
        setPage(0);
        /* eslint-enable react-hooks/set-state-in-effect */
    }, [filter, query]);

    const { visible, hidden } = useMemo(() => {
        // One row shape for both states. Predictions already satisfy it;
        // roster rows simply have no risk fields, which is what makes
        // "Not scored yet" the honest rendering rather than a default
        // tier standing in for a score nobody produced.
        const rows: QueueRow[] =
            roster.length > 0
                ? roster.map((h) => ({ participant_id: h.participant_id }))
                : (data?.predictions ?? []);
        const q = query.trim().toLowerCase();
        // Risk filtering is meaningless without risk, and silently
        // matching nothing would read as "everyone left". The chips are
        // disabled in that state; this keeps the list whole regardless.
        const matchesFilter = rows.filter((p) =>
            filter === "all" || p.risk_level === undefined
                ? true
                : p.risk_level === filter,
        );
        const matchesQuery = matchesFilter.filter((p) =>
            q ? p.participant_id.toLowerCase().includes(q) : true,
        );
        const visible: typeof matchesQuery = [];
        const hidden: typeof matchesQuery = [];
        for (const p of matchesQuery) {
            const isDismissed = Boolean(dismissals?.[p.participant_id]);
            const snoozed = snoozes?.[p.participant_id];
            const isSnoozed = snoozed !== undefined && snoozed.until > now;
            if (isDismissed || isSnoozed) hidden.push(p);
            else visible.push(p);
        }
        return { visible, hidden };
    }, [data?.predictions, roster, filter, query, snoozes, dismissals, now]);

    // Paginate the visible list. With 51 cohort participants and a page
    // size of 10, you get 6 pages; smaller filtered sets land on a
    // single page. Currently active participant always lands on its
    // page when selected from elsewhere — clamp here so the nav never
    // points past the end.
    const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
    const safePage = Math.min(page, totalPages - 1);
    const pageStart = safePage * PAGE_SIZE;
    const pageEnd = Math.min(pageStart + PAGE_SIZE, visible.length);
    const pageItems = visible.slice(pageStart, pageEnd);

    const collapsed = useQueueLayoutStore((s) => s.collapsed);
    const toggleCollapsed = useQueueLayoutStore((s) => s.toggle);

    // The badge counts rows in the list, which under an unfiltered view
    // is the whole cohort — a different number from the topbar's "need
    // follow-up" (high + medium only). Both are correct; side by side
    // they look like a contradiction, so the badge says which it is.
    const needingFollowUp = visible.filter(
        (p) => p.risk_level === "high" || p.risk_level === "medium",
    ).length;
    const listedLabel =
        `${visible.length} participant${visible.length === 1 ? "" : "s"} listed` +
        // "0 need follow-up" would be a claim the model never made: in
        // the first week nothing has been scored, so nothing is known
        // to need follow-up rather than nothing needing it.
        (filter === "all" && !unscored
            ? ` · ${needingFollowUp} need follow-up`
            : "");

    // Collapsed rail: a thin vertical card that preserves the count
    // (situational awareness) and lets the facilitator re-expand with
    // one click. Only renders at lg+ — at smaller breakpoints the queue
    // is a full-width row above the detail panel and collapsing it
    // would just create empty space.
    //
    // The full queue still renders below `lg` even when collapsed, and
    // that pairing is load-bearing: the collapse flag is persisted to
    // localStorage, so a facilitator who collapsed the queue on a
    // laptop and later opened the page on a phone used to get no queue
    // at all — and no control to bring it back, because the expand
    // button lives inside the hidden rail.
    const rail = collapsed ? (
        <Card className="hidden flex-col items-center gap-3 py-3 lg:flex">
            <button
                type="button"
                onClick={toggleCollapsed}
                aria-label="Expand follow-up queue"
                title="Expand follow-up queue"
                className="rounded p-1 text-muted hover:bg-surface-2 hover:text-text"
            >
                <ChevronsRight className="h-4 w-4" aria-hidden />
            </button>
            <Badge variant="neutral" title={listedLabel}>
                {visible.length}
            </Badge>
            <span className="rotate-180 text-xs font-semibold uppercase tracking-wide text-muted [writing-mode:vertical-rl]">
                Follow-up queue
            </span>
        </Card>
    ) : null;

    return (
        <>
        {rail}
        <Card
            className={
                "flex flex-col" + (collapsed ? " lg:hidden" : "")
            }
        >
            <CardHeader>
                <div className="flex items-center justify-between">
                    <CardTitle>Follow-up queue</CardTitle>
                    <div className="flex items-center gap-2">
                        <Badge variant="neutral" title={listedLabel}>
                            {visible.length}
                        </Badge>
                        <button
                            type="button"
                            onClick={toggleCollapsed}
                            aria-label="Collapse follow-up queue"
                            title="Collapse follow-up queue"
                            className="hidden rounded p-1 text-muted hover:bg-surface-2 hover:text-text lg:inline-flex"
                        >
                            <ChevronsLeft className="h-4 w-4" aria-hidden />
                        </button>
                    </div>
                </div>
                <div className="space-y-2 pt-2">
                    <Input
                        type="search"
                        placeholder="Search participants…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        aria-label="Search participants"
                    />
                    <div
                        className="flex flex-wrap gap-1"
                        role="group"
                        aria-label="Filter queue by status"
                    >
                        {/* Disabled rather than hidden while nothing
                            is scored: hiding the controls would leave a
                            facilitator hunting for filters that had
                            silently vanished, and the tooltip says when
                            they come back. */}
                        {FILTERS.map((f) => (
                            <Button
                                key={f}
                                size="sm"
                                variant={filter === f ? "primary" : "ghost"}
                                aria-pressed={filter === f}
                                disabled={unscored && f !== "all"}
                                title={
                                    unscored && f !== "all"
                                        ? "Filtering by risk starts once this cohort's first week completes and the model can score it."
                                        : undefined
                                }
                                onClick={() => setFilter(f)}
                            >
                                {QUEUE_PILL_LABELS[f]}
                            </Button>
                        ))}
                    </div>
                </div>
            </CardHeader>
            <CardContent className="flex-1 space-y-1 overflow-y-auto">
                {/* Past the trained horizons every score — and therefore
                    the whole ranking — is the week-6 one. Said once here
                    rather than on 51 rows. */}
                {isAnchoredWeek(scoreAtWeek) && !isLoading && (
                    <AnchoredWeekNotice
                        week={scoreAtWeek}
                        variant="compact"
                        className="mb-2"
                    />
                )}
                {/* The bundle's load counts as loading too. `isLoading`
                    is the BATCH's, and the batch is disabled until
                    histories exist, so keying skeletons on it alone left
                    the body completely empty for the whole bundle fetch
                    — and indefinitely when the query is paused offline,
                    where nothing is loading, failing or absent. */}
                {(isLoading || bundle.isLoading) && (
                    <div className="space-y-2">
                        {[0, 1, 2, 3, 4].map((i) => (
                            <Skeleton key={i} className="h-14 w-full" />
                        ))}
                    </div>
                )}
                {/* Failure and absence are different facts and must not
                    share the "No participants match" line — a facilitator
                    reading an outage as an over-filtered list widens their
                    search instead of retrying. Precedence: bundle failed →
                    scores failed → cohort has no data → genuinely no
                    matches. Raw messages live in a collapsed disclosure
                    for whoever operates the deployment. */}
                {bundle.isError && (
                    // Routed through friendlyLoadError like the batch
                    // branch: /api/cohort-bundle is the route that 401s
                    // on an expired session and 403s on a removed cohort
                    // assignment, and telling either of those to "try
                    // again in a moment" offers a retry that can never
                    // succeed instead of "sign in again".
                    <LoadErrorNotice
                        {...friendlyLoadError(
                            String((bundle.error as Error)?.message ?? ""),
                        )}
                        onRetry={() => bundle.refetch()}
                    />
                )}
                {error && !bundle.isError && (
                    <LoadErrorNotice
                        {...friendlyLoadError(String((error as Error).message))}
                        onRetry={() => batch.refetch()}
                    />
                )}
                {/* Snoozes and contact markers are the one thing here
                    set by OTHER people, so their absence is a fact about
                    the list rather than a background error: a colleague's
                    snooze simply will not appear. Only shown when there
                    is no prior copy to fall back on — a blip mid-session
                    keeps showing the last good state, which is honest
                    enough without a warning. */}
                {queueState.isError && !queueState.data && (
                    <p className="px-1 pb-2 text-xs text-muted">
                        Snoozed and contacted markers aren&apos;t available
                        right now, so changes made by colleagues may not
                        show here.
                    </p>
                )}
                {/* Explains the missing SCORES, not a missing list —
                    the people are right below it. The ordering rule and
                    the reason for the wait are on the row badges and the
                    week bar already, so saying them again here was three
                    lines of the facilitator's attention for nothing. */}
                {notStarted && !isLoading && !error && !bundle.isError && (
                    <p className="px-1 pb-3 text-xs text-muted">
                        No scores until the first week completes.
                    </p>
                )}
                {bundle.data === null &&
                    !bundle.isError &&
                    !bundle.isLoading &&
                    !notStarted && (
                        <p className="px-1 py-4 text-center text-xs text-muted">
                            This cohort isn&apos;t connected yet, so there is
                            no activity data for it here. If that seems wrong,
                            tell the programme team.
                        </p>
                    )}
                {visible.length === 0 &&
                    !isLoading &&
                    !error &&
                    !bundle.isError &&
                    // `!== undefined`, not `!= null`: the null case is
                    // the "not connected yet" state directly above, and
                    // `!= null` also excluded the loaded-but-empty case
                    // this line exists to cover.
                    bundle.data !== undefined && (
                        <p className="px-1 py-4 text-center text-xs text-muted">
                            No participants match the current filter.
                        </p>
                    )}
                {pageItems.map((p) => {
                    const hist = histLookup.get(p.participant_id);
                    if (!hist) return null;
                    // "Already contacted by X" is the whole point of
                    // sharing this state: without it, two facilitators
                    // working the same cohort message the same person.
                    const contact = contacted?.[p.participant_id];
                    return (
                        <QueueItem
                            key={p.participant_id}
                            participantId={p.participant_id}
                            cohortId={cohort.id}
                            riskLevel={p.risk_level}
                            riskScore={p.dropout_risk}
                            thresholdLow={p.threshold_low}
                            thresholdHigh={p.threshold_high}
                            lastActiveLabel={lastActiveLabel(hist, now)}
                            selected={selectedId === p.participant_id}
                            onClick={() => select(p.participant_id)}
                            contactedNote={
                                // "Contacted", not "Replied" — the copy
                                // flow proves the reply was taken to
                                // paste, not that it was posted.
                                contact
                                    ? `Contacted by ${shortActor(contact.by)} · ${agoLabel(contact.at, now)}`
                                    : undefined
                            }
                        />
                    );
                })}
                {totalPages > 1 && (
                    // flex-wrap + whitespace-nowrap: in a narrow column
                    // the label drops below the buttons instead of
                    // wrapping mid-phrase or forcing a horizontal
                    // scrollbar onto the whole queue card.
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 text-xs text-muted">
                        <span className="whitespace-nowrap">
                            Showing {pageStart + 1}–{pageEnd} of{" "}
                            {visible.length}
                        </span>
                        <div
                            className="inline-flex items-center gap-0.5"
                            role="group"
                            aria-label="Queue pagination"
                        >
                            {/* Both arrows step from the CLAMPED page.
                                `page` can sit above the last page after
                                the list shrinks (snoozing rows, say), and
                                stepping from that stale value made an
                                arrow look dead for several clicks while
                                it walked back into range. */}
                            <button
                                type="button"
                                onClick={() =>
                                    setPage(Math.max(0, safePage - 1))
                                }
                                disabled={safePage === 0}
                                className="rounded px-2 py-1 hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
                                aria-label="Previous page"
                            >
                                ←
                            </button>
                            {Array.from({ length: totalPages }, (_, i) => i).map(
                                (i) => (
                                    <button
                                        key={i}
                                        type="button"
                                        onClick={() => setPage(i)}
                                        aria-current={
                                            i === safePage ? "page" : undefined
                                        }
                                        className={
                                            "min-w-7 rounded px-2 py-1 hover:bg-surface-2 " +
                                            (i === safePage
                                                ? "bg-surface-2 font-semibold text-text"
                                                : "")
                                        }
                                    >
                                        {i + 1}
                                    </button>
                                ),
                            )}
                            <button
                                type="button"
                                onClick={() =>
                                    setPage(
                                        Math.min(totalPages - 1, safePage + 1),
                                    )
                                }
                                disabled={safePage >= totalPages - 1}
                                className="rounded px-2 py-1 hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
                                aria-label="Next page"
                            >
                                →
                            </button>
                        </div>
                    </div>
                )}
                {hidden.length > 0 && (
                    <div className="border-t border-border pt-2">
                        <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => setShowHidden((v) => !v)}
                            aria-expanded={showHidden}
                            className="w-full justify-between gap-2 text-xs font-normal text-text-2"
                        >
                            <span>
                                {hidden.length} snoozed / dismissed
                            </span>
                            <span className="inline-flex items-center gap-1 text-muted">
                                {showHidden ? "Hide" : "Show"}
                                <ChevronDown
                                    className={
                                        "h-3.5 w-3.5 transition-transform " +
                                        (showHidden ? "rotate-180" : "")
                                    }
                                    aria-hidden
                                />
                            </span>
                        </Button>
                        {showHidden && (
                            <ul className="mt-2 space-y-1">
                                {hidden.map((p) => {
                                    const dismissal =
                                        dismissals?.[p.participant_id];
                                    const stamp =
                                        dismissal ?? snoozes?.[p.participant_id];
                                    return (
                                        <HiddenRow
                                            key={p.participant_id}
                                            participantId={p.participant_id}
                                            cohortId={cohort.id}
                                            isDismissed={Boolean(dismissal)}
                                            by={stamp?.by}
                                            at={stamp?.at}
                                            now={now}
                                            onUndo={() =>
                                                queueOp.mutate({
                                                    op: dismissal
                                                        ? "undoDismiss"
                                                        : "undoSnooze",
                                                    participantId:
                                                        p.participant_id,
                                                })
                                            }
                                        />
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
        </>
    );
}

/**
 * Calm failure card for the queue: plain words, a retry that targets the
 * failed query, and the raw message behind a disclosure — visible enough
 * for whoever operates the deployment, invisible until asked-for to the
 * facilitator working the list.
 *
 * Deliberately neutral rather than amber. On this page the warm colours
 * are the risk semantics: amber means "check in soon" about a person.
 * Spending that colour on "a service is down" makes the palette say two
 * unrelated things at once, and puts an alarming block beside a list
 * whose whole job is to draw the eye to genuinely worrying participants.
 * A service being unavailable is information, not a risk tier, so it
 * reads as information: surface tone, one muted icon, ordinary text.
 */
function LoadErrorNotice({
    title,
    body,
    detail,
    kind = "outage",
    onRetry,
}: {
    title: string;
    body: string;
    detail?: string;
    /** Drives the way out. A dead session gets a link back to Hope
     *  instead of a retry: the retry cannot succeed, and offering it
     *  makes a working dashboard look broken. */
    kind?: FriendlyLoadError["kind"];
    onRetry: () => void;
}) {
    return (
        <div
            role="status"
            className="space-y-2.5 rounded-lg border border-border bg-surface-2 px-3 py-3 text-xs"
        >
            <div className="flex gap-2">
                <CloudOff
                    className="mt-0.5 h-4 w-4 shrink-0 text-muted"
                    aria-hidden
                />
                <div className="min-w-0">
                    <p className="font-semibold text-text">{title}</p>
                    <p className="mt-1 leading-relaxed text-text-2">{body}</p>
                </div>
            </div>
            {kind === "session" ? (
                <HopeMoveLink
                    variant="prominent"
                    label="Open from Facilitator Dashboard"
                />
            ) : (
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={onRetry}
                    className="w-full"
                >
                    Try again
                </Button>
            )}
            {detail ? (
                <details className="text-muted">
                    <summary className="cursor-pointer select-none hover:text-text-2">
                        Technical details
                    </summary>
                    <p className="mt-1 break-all font-mono text-[10px] leading-relaxed text-muted">
                        {detail}
                    </p>
                </details>
            ) : null}
        </div>
    );
}

function HiddenRow({
    participantId,
    cohortId,
    isDismissed,
    by,
    at,
    now,
    onUndo,
}: {
    participantId: string;
    cohortId: number;
    isDismissed: boolean;
    /** Facilitator who hid this row — may be a colleague, not you. */
    by?: string;
    at?: number;
    now: number;
    onUndo: () => void;
}) {
    const alias = useBundleDisplayName(participantId, cohortId);
    return (
        <li className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-1.5">
            <span className="min-w-0 truncate text-xs text-text-2">
                {alias}
                <span className="ml-1.5 text-muted">
                    {isDismissed ? "dismissed" : "snoozed"}
                    {by && ` by ${shortActor(by)}`}
                    {at !== undefined && ` · ${agoLabel(at, now)}`}
                </span>
            </span>
            <button
                type="button"
                onClick={onUndo}
                className="text-xs text-accent-ink hover:underline"
            >
                Undo
            </button>
        </li>
    );
}
