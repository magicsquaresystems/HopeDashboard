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
 * - **Snooze and dismiss deselect on purpose, once the write lands.** Hiding
 *   someone while their detail stays open would leave the panel describing a
 *   participant no longer in the list, so both actions clear the selection and
 *   return the facilitator to an empty panel — the queue is the thing they
 *   should look at next. Deselecting before the write confirmed meant a failed
 *   snooze cleared the panel too, so the facilitator lost their place over an
 *   action that never happened.
 *
 * - **Prev/next walk bundle order, not risk order.** Neighbour navigation uses
 *   the participant order in the cohort bundle, so it is stable while the
 *   facilitator works. It deliberately does not follow the queue's risk
 *   ranking, which reshuffles when the week changes.
 */

"use client";

import { useMemo, useState } from "react";
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
    scoreWindowEnd,
    eventsLastNDays,
    facilitatorContactCount,
} from "@/lib/signals";
import { useBundleDisplayName } from "@/lib/hooks/displayName";

export function Detail({
    cohortId,
    cohortCode,
}: {
    cohortId: number;
    /** Programme code shown under the participant's name, in place of
     *  the platform's internal ids. */
    cohortCode: string;
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
    const aliasLabel = useBundleDisplayName(selectedId ?? "", cohortId);
    const {
        isScoring,
        total: cohortTotal,
        batch: cohortBatch,
        notStarted,
    } = useCohortScoring(cohortId);
    // Withheld in the cohort's first week for the same reason the batch
    // is: seven days of window over a cohort three days old reads as
    // disengagement. Scoring one participant from the detail panel would
    // have slipped past that and printed a confident percentage beside a
    // queue row that says "Not scored yet". The profile, metrics and
    // timeline below are facts rather than predictions, so they stay.
    const prediction = useParticipantPrediction(
        notStarted ? null : history,
        cohortId,
    );

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
    //
    // The deselect happens on SUCCESS, not on click. Clearing it up
    // front meant a failed write emptied the panel anyway: the row
    // rolled back into the queue, the facilitator was left staring at
    // "No participant selected", and the two events looked unrelated.
    // Now a failure leaves them exactly where they were, with a notice
    // saying why.
    function onSnooze() {
        if (!selectedId) return;
        queueOp.mutate(
            {
                op: "snooze",
                participantId: selectedId,
                days: SNOOZE_DAYS,
            },
            { onSuccess: () => select(null) },
        );
    }
    function onDismiss() {
        if (!selectedId) return;
        queueOp.mutate(
            { op: "dismiss", participantId: selectedId },
            { onSuccess: () => select(null) },
        );
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
                    ) : cohortBatch.isError ? (
                        /* Scoring failed, so the queue is empty and there
                           is nobody to pick. Inviting the facilitator to
                           choose from it anyway reads as their mistake
                           rather than an outage. The queue panel carries
                           the reason; this says why the page is bare. */
                        <EmptyState
                            title="Risk scores are unavailable"
                            description="The cohort could not be scored, so the follow-up queue has nothing to select. The reason is shown beside the queue."
                        />
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
                            {/* The platform's internal participant id and
                                the numeric cohort id used to sit here.
                                Neither means anything to a facilitator,
                                and an id on screen is one more identifier
                                to leak in a screen-share of a health
                                programme. The alias identifies the person;
                                the cohort code names the programme. */}
                            <p className="text-xs text-muted">
                                {cohortCode}
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
                                Updating score…
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
                            // The write is shared state now, so it is a
                            // round trip rather than a local toggle.
                            // Without this a second click fires a second
                            // op against a row that is already leaving.
                            loading={queueOp.isPending}
                            loadingText="Snoozing…"
                            className="gap-1.5 whitespace-nowrap"
                        >
                            <Clock className="h-3.5 w-3.5" aria-hidden />
                            Snooze 7d
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={onDismiss}
                            loading={queueOp.isPending}
                            loadingText="Dismissing…"
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
                {/* Says why there is no gauge. Without it the panel
                    just ends after the profile, and a missing number
                    reads as a failure rather than a deliberate silence. */}
                {notStarted && (
                    <p className="rounded-md border border-border bg-surface-2/50 px-3 py-2 text-xs text-muted">
                        No risk score yet. This cohort is still in its
                        first week, and the model needs a full week of
                        activity before its score means anything. What
                        {" "}{name} has done so far is shown below.
                    </p>
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
    // Frozen at mount, like the queue's clock. `daysSinceLastEvent`
    // defaults to `Date.now()`, and reading it during render makes the
    // server's HTML and the client's first paint disagree at a day
    // boundary; it would also let the tile tick over mid-visit.
    const [now] = useState(() => Date.now());
    const lastActiveDays = daysSinceLastEvent(history, now);
    // True while the selected week is still running, which only happens
    // in a cohort's first week. The tile then reports where things
    // stand today rather than at a checkpoint that has not arrived.
    const windowStillOpen = scoreWindowEnd(history) > now;
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
                        : windowStillOpen
                          ? "as at today"
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
