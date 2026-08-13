/**
 * Participant detail — middle column of the cohort page.
 *
 * Answers "why is this person flagged, and what have they actually written?"
 * for whoever is selected in the queue. Composed of, top to bottom: risk gauge,
 * recommended actions, engagement metrics, contributing factors, and the full
 * activity timeline.
 *
 * Notes for anyone changing it:
 *
 * - **It scores independently of the queue.** The queue gets its numbers from
 *   the cohort-wide `/batch`; this panel calls `/predict` for one participant.
 *   Both are keyed on `(cohortId, participantId, score_at_day)` and both cache
 *   for a day, so they agree — but they are two different requests, and a
 *   discrepancy means the cache keys diverged, not that the model is unstable.
 *
 * - **Snooze and dismiss deselect on purpose.** Hiding someone while their
 *   detail stays open would leave the panel describing a participant no longer
 *   in the list, so both actions clear the selection and return the facilitator
 *   to an empty panel — the queue is the thing they should look at next.
 *
 * - **Prev/next walk bundle order, not risk order.** Neighbour navigation uses
 *   the participant order in the cohort bundle, so it is stable while the
 *   facilitator works. It deliberately does not follow the queue's risk
 *   ranking, which reshuffles when the week changes.
 */

"use client";

import { useMemo } from "react";
import { ChevronLeft, ChevronRight, Clock, Loader2, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AnchoredWeekNotice } from "@/components/anchored-week-notice";
import { EmptyState } from "@/components/empty-state";
import { ParticipantProfile } from "@/components/participant-profile";
import { RiskGauge } from "@/components/risk-gauge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar } from "@/components/avatar";
import { ActivityTimeline } from "@/components/activity-timeline";
import { MetricGrid, MetricTile } from "@/components/metric-tile";
import { DriverBars } from "@/components/driver-bars";
import { InfoCardRow } from "@/components/info-card-row";
import { useParticipantPrediction } from "@/lib/hooks/api";
import { useCohortBundle } from "@/lib/hooks/useCohortBundle";
import { useCohortScoring } from "@/lib/hooks/useCohortScoring";
import { bundleParticipantIds, bundleToHistory } from "@/lib/realCohort";
import {
    isAnchoredWeek,
    MODEL_MAX_WEEK,
    scoreAtDay as scoreAtDayForWeek,
    useScoringStore,
} from "@/lib/store/scoringStore";
import { useUiStore } from "@/lib/store/uiStore";
import { useQueueOp } from "@/lib/hooks/useQueueState";
import { SNOOZE_DAYS } from "@/lib/queue-state-shared";
import { friendlyStatus, tierExplanation } from "@/lib/risk";
import type { ParticipantHistory } from "@/lib/api/dropout";
import {
    daysSinceLastEvent,
    eventsLastNDays,
    facilitatorContactCount,
} from "@/lib/signals";
import { useBundleDisplayName } from "@/lib/hooks/displayName";

export function Detail({
    cohortId,
}: {
    cohortId: number;
}) {
    const selectedId = useUiStore((s) => s.selectedParticipantId);
    const select = useUiStore((s) => s.selectParticipant);
    const queueOp = useQueueOp(cohortId);
    const bundle = useCohortBundle(cohortId);
    const scoreAtWeek = useScoringStore((s) => s.scoreAtWeek);
    const scoreAt = scoreAtDayForWeek(scoreAtWeek);
    const history = useMemo(() => {
        if (!selectedId || !bundle.data) return null;
        return bundleToHistory(bundle.data, selectedId, scoreAt);
    }, [selectedId, bundle.data, scoreAt]);
    const prediction = useParticipantPrediction(history, cohortId);
    const aliasLabel = useBundleDisplayName(selectedId ?? "", cohortId);
    const { isScoring, total: cohortTotal } = useCohortScoring(cohortId);

    // Neighbour navigation: derive prev/next from the cohort bundle's
    // participant order. Falls back to no-op when the bundle hasn't
    // loaded yet (the arrows just disable in that case).
    const neighbours = useMemo(() => {
        if (!bundle.data || !selectedId) return { prev: null, next: null };
        const ids = bundleParticipantIds(bundle.data);
        const idx = ids.indexOf(selectedId);
        if (idx < 0) return { prev: null, next: null };
        return {
            prev: idx > 0 ? ids[idx - 1] : null,
            next: idx < ids.length - 1 ? ids[idx + 1] : null,
        };
    }, [bundle.data, selectedId]);

    // Snooze hides the participant for a week; dismiss hides them until
    // undone. Both clear the selection so the panel doesn't keep
    // describing someone who has just left the queue. Both are now
    // persisted and shared: a colleague working the same cohort sees the
    // participant disappear from their queue too, with your name on it.
    function onSnooze() {
        if (!selectedId) return;
        queueOp.mutate({
            op: "snooze",
            participantId: selectedId,
            days: SNOOZE_DAYS,
        });
        select(null);
    }
    function onDismiss() {
        if (!selectedId) return;
        queueOp.mutate({ op: "dismiss", participantId: selectedId });
        select(null);
    }

    if (!selectedId) {
        return (
            <Card className="flex items-center justify-center">
                <CardContent>
                    {/* Cohort-wide scoring owns the centre of the page while
                        it runs. It is the page's headline operation — the
                        queue has nothing to show and neither do the topbar
                        counts — so it gets the largest, most central
                        affordance rather than a chip in a corner. Once a
                        participant is selected this branch is gone, and the
                        detail header's "Re-scoring…" chip takes over so the
                        facilitator keeps their context. */}
                    {isScoring ? (
                        <div
                            role="status"
                            aria-live="polite"
                            className="flex flex-col items-center gap-4 px-6 text-center"
                        >
                            <Loader2
                                className="h-9 w-9 animate-spin text-accent-ink"
                                aria-hidden
                            />
                            <div>
                                <p className="text-base font-semibold text-text">
                                    {cohortTotal > 0
                                        ? `Scoring ${cohortTotal} participants…`
                                        : "Loading cohort…"}
                                </p>
                                <p className="mt-1.5 text-sm text-muted">
                                    Ranking the cohort by dropout risk at week{" "}
                                    {scoreAtWeek}. This takes a few seconds.
                                </p>
                            </div>
                        </div>
                    ) : (
                        <EmptyState
                            title="No participant selected"
                            description="Pick someone from the follow-up queue to see their dropout risk, recent activity, and contributing factors."
                        />
                    )}
                </CardContent>
            </Card>
        );
    }

    const name = aliasLabel;
    const status = prediction.data
        ? friendlyStatus(prediction.data.risk_level)
        : null;
    // Where this percentage sits against the model's own cut-offs. Red
    // starts near 21%, not 50%, so the number alone reads as a mistake.
    const bandNote = prediction.data
        ? tierExplanation(
              prediction.data.risk_level,
              prediction.data.threshold_low,
              prediction.data.threshold_high,
          )
        : undefined;

    return (
        <Card className="flex flex-col gap-3">
            <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <Avatar
                            participantId={selectedId}
                            cohortId={cohortId}
                            size="lg"
                        />
                        <div>
                            <CardTitle>{name}</CardTitle>
                            <p className="text-xs text-muted">
                                Cohort {cohortId} ·{" "}
                                <span className="text-text-2">
                                    {selectedId}
                                </span>
                            </p>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                        {/* Re-scoring replaces the status badge rather than
                            sitting beside it — the old label is about to be
                            wrong, so showing it next to a spinner would
                            assert a stale risk tier. */}
                        {prediction.isFetching ? (
                            <span
                                role="status"
                                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border px-2.5 py-0.5 text-xs text-muted"
                            >
                                <Loader2
                                    className="h-3 w-3 animate-spin"
                                    aria-hidden
                                />
                                Re-scoring…
                            </span>
                        ) : status ? (
                            <Badge
                                variant={status.badgeVariant}
                                className="whitespace-nowrap"
                                title={bandNote}
                            >
                                {status.label}
                            </Badge>
                        ) : null}
                        <div className="flex items-center rounded-md border border-border">
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() =>
                                    neighbours.prev && select(neighbours.prev)
                                }
                                disabled={!neighbours.prev}
                                aria-label="Previous participant"
                                title="Previous participant"
                                className="h-8 w-8 rounded-r-none"
                            >
                                <ChevronLeft
                                    className="h-4 w-4"
                                    aria-hidden
                                />
                            </Button>
                            <span className="border-l border-border" />
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() =>
                                    neighbours.next && select(neighbours.next)
                                }
                                disabled={!neighbours.next}
                                aria-label="Next participant"
                                title="Next participant"
                                className="h-8 w-8 rounded-l-none"
                            >
                                <ChevronRight
                                    className="h-4 w-4"
                                    aria-hidden
                                />
                            </Button>
                        </div>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={onSnooze}
                            className="gap-1.5 whitespace-nowrap"
                        >
                            <Clock className="h-3.5 w-3.5" aria-hidden />
                            Snooze 7d
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={onDismiss}
                            className="gap-1.5 whitespace-nowrap text-risk-hi hover:bg-risk-hi-bg"
                        >
                            <X className="h-3.5 w-3.5" aria-hidden />
                            Dismiss
                        </Button>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="space-y-6">
                {/* Who this person is, before what the model thinks of
                    them. Facts only — tenure, counts, self-reported
                    wellbeing, and their own words verbatim. */}
                <ParticipantProfile
                    participantId={selectedId}
                    cohortId={cohortId}
                    history={history}
                />
                {/* Past week 6 the score is frozen (see the component's
                    docblock). Placed above the gauge, not beside it: a
                    facilitator reads top-down and must hit the caveat
                    before the number, not after. */}
                {isAnchoredWeek(scoreAtWeek) && prediction.data && (
                    <AnchoredWeekNotice week={scoreAtWeek} />
                )}
                <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start sm:gap-6">
                    <div className="shrink-0">
                        {prediction.isLoading ? (
                            <Skeleton className="h-24 w-40" />
                        ) : prediction.data ? (
                            <RiskGauge
                                value={prediction.data.dropout_risk}
                                level={prediction.data.risk_level}
                                asOfLabel={
                                    isAnchoredWeek(scoreAtWeek)
                                        ? `as at week ${MODEL_MAX_WEEK}`
                                        : undefined
                                }
                            />
                        ) : null}
                    </div>
                    {prediction.data?.contributing_factors?.length ? (
                        <div className="min-w-0 flex-1">
                            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">
                                {/* Factors are SHAP drivers with per-factor
                                    direction (DriverBars shows ↑ raising / ↓
                                    lowering). The top-3 mix directions even for
                                    a flagged participant, so a flat "why
                                    flagged" header would mislabel the protective
                                    ones. Keep the header neutral for non-low and
                                    let the per-bar arrows carry direction. */}
                                {prediction.data.risk_level === "low"
                                    ? `What's going well for ${name}`
                                    : `What's driving ${name}'s risk`}
                            </h4>
                            <div className="mt-3">
                                <DriverBars
                                    factors={
                                        prediction.data.contributing_factors
                                    }
                                    weights={
                                        prediction.data
                                            .contributing_factor_weights
                                    }
                                    directions={
                                        prediction.data
                                            .contributing_factor_directions
                                    }
                                    tone={prediction.data.risk_level}
                                />
                            </div>
                        </div>
                    ) : prediction.isLoading ? (
                        <div className="min-w-0 flex-1 space-y-2">
                            <Skeleton className="h-4 w-full" />
                            <Skeleton className="h-4 w-3/4" />
                        </div>
                    ) : null}
                </div>

                {/* What to do: the model's recommended actions + wellbeing
                    cue (keyed on risk level). Surfaces the engagement_ml
                    `recommended_actions` playbook that was otherwise computed
                    but never shown. */}
                {prediction.data && (
                    <InfoCardRow prediction={prediction.data} />
                )}

                {history && (
                    <details className="group" open>
                        <summary className="flex cursor-pointer select-none items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted">
                            Engagement signals
                            <span className="text-[10px] text-muted/70 group-open:hidden">
                                expand
                            </span>
                            <span className="hidden text-[10px] text-muted/70 group-open:inline">
                                collapse
                            </span>
                        </summary>
                        <div className="mt-3">
                            <DetailMetrics history={history} />
                        </div>
                    </details>
                )}

                {history && <ActivityTimeline history={history} />}
            </CardContent>
        </Card>
    );
}

function DetailMetrics({
    history,
}: {
    history: ParticipantHistory;
}) {
    const lastActiveDays = daysSinceLastEvent(history);
    const discussion = eventsLastNDays(history, "discussion_post", 14);
    const facilitatorTouches = facilitatorContactCount(history);

    // `null` means no events at all — worse than any "N days ago", so it
    // shares the negative tone with long silences.
    const lastActiveTone =
        lastActiveDays === 0
            ? "positive"
            : lastActiveDays === null || lastActiveDays >= 7
              ? "negative"
              : "neutral";
    const discussionTone =
        discussion.deltaPercent === null
            ? "neutral"
            : discussion.deltaPercent <= -30
              ? "negative"
              : discussion.deltaPercent >= 30
                ? "positive"
                : "neutral";

    // Every tile is measured against the end of the selected scoring
    // week, not the wall clock — so replaying week 3 shows week 3's
    // reality. The window is named in each label because these sit
    // beside all-time counts in the profile strip, and "0 discussion
    // posts" next to "3 forum replies" reads as a contradiction unless
    // the 14-day window is explicit.
    return (
        <MetricGrid>
            <MetricTile
                label="Last active"
                value={
                    lastActiveDays === null
                        ? "Never"
                        : lastActiveDays === 0
                          ? "Today"
                          : `${lastActiveDays} day${lastActiveDays === 1 ? "" : "s"} ago`
                }
                delta={
                    lastActiveDays === null
                        ? "no activity recorded"
                        : "as at selected week"
                }
                tone={lastActiveTone}
            />
            <MetricTile
                label="Discussion posts · 14d"
                value={discussion.count}
                delta={
                    discussion.deltaPercent === null
                        ? "vs prior 14d: n/a"
                        : `${discussion.deltaPercent >= 0 ? "+" : ""}${discussion.deltaPercent}% vs prior 14d`
                }
                tone={discussionTone}
            />
            <MetricTile
                label="Facilitator contact"
                value={facilitatorTouches}
                delta={
                    facilitatorTouches === 0
                        ? "no comments yet"
                        : "to date this programme"
                }
                tone={facilitatorTouches === 0 ? "negative" : "neutral"}
            />
        </MetricGrid>
    );
}
