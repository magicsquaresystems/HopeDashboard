"use client";

import { useEffect, useMemo, useState } from "react";

import { RefreshCcw, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { DraftCard, type DraftContext } from "@/components/draft-card";
import { DiscussionThread } from "@/components/discussion-thread";
import { CommentGenChip } from "@/components/comment-gen-chip";
// Follow-up activity panel temporarily disabled — it surfaced participant
// @-handles in the facilitator's past replies. Re-enable once those are
// scrubbed/de-identified.
// import { FollowUpActivity } from "@/components/follow-up-activity";
import {
    useEvent,
    useGenerate,
    useParticipantPrediction,
    useThumb,
} from "@/lib/hooks/api";
import { demoEngagementContext, weekNumber } from "@/lib/demo-events";
import { getProfile } from "@/lib/profile";
import { useCohortBundle } from "@/lib/hooks/useCohortBundle";
import { useQueueOp } from "@/lib/hooks/useQueueState";
import { bundleToHistory, renderThreadContext } from "@/lib/realCohort";
import { usePublishComment } from "@/lib/hooks/api";
import {
    scoreAtDay as scoreAtDayForWeek,
    useScoringStore,
} from "@/lib/store/scoringStore";
import { useSessionStatsStore } from "@/lib/store/sessionStatsStore";
import { useUiStore } from "@/lib/store/uiStore";
import { daysSinceLastEvent } from "@/lib/signals";
import type { CohortMeta } from "@/lib/cohorts";
import type {
    ActivityType,
    Draft,
    GenerateRequest,
    GenerateResponse,
    Persona,
} from "@/lib/api/commentGen";

/**
 * Short, facilitator-friendly tab labels keyed by SLM persona. Replaces
 * the longer PersonaLabel ("Warm personal check-in") so the tabs stay
 * compact on the drafts column.
 */
const PERSONA_TAB_LABEL: Record<Persona, string> = {
    Empathetic: "Warm check-in",
    "Action-oriented": "Next-step nudge",
    "Goal-oriented": "Goal-focused",
};

// Pure helpers extracted to ./drafts-helpers.ts so Vitest can import
// them in a Node environment without dragging in the React/Next tree.
import {
    canPublishReply,
    classifyGenerateError,
    firstContactTemplate,
    formatModelLabel,
    pickReplyTarget,
    publishBlockedReason,
} from "./drafts-helpers";

export function Drafts({
    cohort,
    publishEnabled = false,
}: {
    cohort: CohortMeta;
    /** Resolved on the server for THIS cohort — the deployment allows
     *  posting, this cohort is allowlisted, and the session is linked to
     *  the platform. Defaults false so a caller that forgets to pass it
     *  gets copy-only rather than a live Send. */
    publishEnabled?: boolean;
}) {
    const selectedId = useUiStore((s) => s.selectedParticipantId);
    const bundle = useCohortBundle(cohort.id);
    // With the other hooks, above every early return: the drafts column
    // returns placeholders when nobody is selected, and a hook called
    // after that renders in a different order on the next pass.
    const publish = usePublishComment();
    const scoreAtWeek = useScoringStore((s) => s.scoreAtWeek);
    const scoreAt = scoreAtDayForWeek(scoreAtWeek);
    const history = useMemo(() => {
        if (!selectedId || !bundle.data) return null;
        return bundleToHistory(bundle.data, selectedId, scoreAt);
    }, [selectedId, bundle.data, scoreAt]);
    const prediction = useParticipantPrediction(history, cohort.id);

    const [response, setResponse] = useState<GenerateResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    // Active persona tab — null means "first draft in response.drafts".
    // Reset whenever a new generation lands so the focus snaps to the
    // first persona for the new post.
    const [activePersona, setActivePersona] = useState<Persona | null>(null);
    // "Write my own" mode: facilitator types from scratch and (optionally)
    // polishes with AI. Bypasses the persona generator entirely; the
    // existing DraftCard is reused with a synthesized blank draft so
    // Polish + Send wiring stays consistent.
    const [writeMode, setWriteMode] = useState(false);

    // Derive the participant's most recent post within the current
    // scoring window. The dashboard is read-only on the participant
    // side — production fires /generate via webhook when a participant
    // posts; here we mirror that by picking the newest `activity` event
    // with a non-empty description. Facilitators never paste; the
    // platform (or bundle stand-in) is the source.
    const selectedPostTs = useUiStore((s) => s.selectedPostTs);
    // Target-picking lives in drafts-helpers (pure, unit-tested). It
    // owns the Emotions filter — for explicit timeline picks too — and
    // the `typeKnown` flag that keeps a defaulted activity type off the
    // screen.
    const recentPost = useMemo(
        () => (history ? pickReplyTarget(history, selectedPostTs) : null),
        [history, selectedPostTs],
    );

    // Drafts column reads its inputs directly from the most recent
    // platform post — no facilitator pasting. activityType comes from
    // the post itself; postText is the post's description.
    const postText: string = recentPost?.text ?? "";
    const activityType: ActivityType =
        recentPost?.activityType ?? "GoalSetting";
    const isDiscussionTarget = recentPost?.isDiscussion ?? false;
    const currentThread =
        isDiscussionTarget && recentPost?.topicId != null
            ? bundle.data?.discussionThreads?.[String(recentPost.topicId)]
            : undefined;

    // Switching participants clears the response, active tab, and any
    // errors. These are legitimate side effects (not derived state) —
    // we're tearing down a previous-participant's generation result
    // when the user clicks a different participant.
    useEffect(() => {
        /* eslint-disable react-hooks/set-state-in-effect */
        setResponse(null);
        setActivePersona(null);
        setError(null);
        /* eslint-enable react-hooks/set-state-in-effect */
    }, [selectedId]);

    const generate = useGenerate();
    const thumb = useThumb();
    const event = useEvent();
    const queueOp = useQueueOp(cohort.id);

    if (!selectedId) {
        return (
            <Card className="flex items-center justify-center">
                <CardContent>
                    <EmptyState
                        title="Drafts appear here"
                        description="Pick a participant to see their latest post and get suggested replies you can copy into Hope."
                    />
                </CardContent>
            </Card>
        );
    }

    function onGenerate() {
        if (!selectedId) return;
        setError(null);
        const profile = getProfile(selectedId, bundle.data ?? null);
        // For a forum-reply target, feed the reconstructed thread so the
        // model replies in context. Empty string for activity targets.
        const threadContext =
            isDiscussionTarget && bundle.data
                ? renderThreadContext(
                      bundle.data,
                      recentPost?.topicId,
                      postText,
                  )
                : "";
        const body: GenerateRequest = {
            participant_id: Number(
                String(selectedId).replace(/[^0-9]/g, "") || "0",
            ),
            cohort_id: cohort.id,
            module_id: cohort.moduleId,
            week_number: weekNumber(history),
            activity_type: activityType,
            post_text: postText,
            display_name: profile.displayName,
            engagement: prediction.data
                ? {
                      dropout_risk: prediction.data.dropout_risk,
                      risk_level: prediction.data.risk_level,
                      ...demoEngagementContext(history),
                  }
                : undefined,
            ...(threadContext ? { thread_context: threadContext } : {}),
            ...(recentPost?.activityId != null
                ? { activity_id: recentPost.activityId }
                : {}),
        };
        generate.mutate(body, {
            onSuccess: (res) => {
                setResponse(res);
                // Reset focus to the first draft on each new generation.
                setActivePersona(res.drafts[0]?.persona ?? null);
            },
            onError: (err) => setError((err as Error).message),
        });
    }

    // `facilitator_id` is stamped by the proxy route from the signed-in
    // session — deliberately not sent from here, so the browser can't
    // claim someone else's identity in the HITL record.
    function onThumb(draftId: string, label: "up" | "down") {
        thumb.mutate({ draft_id: draftId, label });
    }

    // Fires when a draft has actually been copied to the clipboard —
    // DraftCard guarantees the copy succeeded first, so "contacted"
    // means "has the reply in hand to paste", never "clicked a button
    // that failed".
    function onUse(
        draftId: string,
        sentText: string,
        action: "accept" | "edit",
    ) {
        const participantId = selectedId;
        // Mark the participant as contacted so colleagues on this
        // cohort see it and don't message them again, and record the
        // contact for the topbar's session stat. Fired here rather than
        // inside `useEvent` because EventRequest carries neither
        // participant nor cohort id — only this component knows who the
        // reply is for. Unconditional on `response`: a hand-written
        // "write my own" reply is a contact too, and the old
        // early-return silently dropped it.
        const markContacted = () => {
            if (!participantId) return;
            queueOp.mutate(
                { op: "contacted", participantId, action },
                {
                    // The counter moves only once the SHARED marker is
                    // written. It is a count of "colleagues can see I
                    // handled this", so incrementing it on a failed
                    // write reported outreach nobody else could see —
                    // the exact confusion the shared marker exists to
                    // prevent. A failure now leaves the count alone and
                    // raises a notice instead.
                    onSuccess: () =>
                        useSessionStatsStore
                            .getState()
                            .recordContact(cohort.id, participantId),
                },
            );
        };
        // The HITL research record needs a real draft_set_id AND a real
        // draft id. `writeMode` has neither: its draft is synthesised
        // locally with a fabricated uuid, and `response` may still hold
        // the last AI generation for this participant because toggling
        // "Write my own" does not clear it. Without the writeMode guard
        // a hand-written reply is filed against that earlier draft set
        // under an id no set contains — and per the /event contract that
        // also drives a memory write, so the corruption outlives the
        // row. Contact marking is separate and must not depend on the
        // research write, so it runs either way once the copy is real.
        if (response && !writeMode) {
            event.mutate({
                draft_set_id: response.draft_set_id,
                chosen_draft_id: draftId,
                action,
                sent_text: sentText,
            });
        }
        markContacted();
    }

    const profile = getProfile(selectedId, bundle.data ?? null);
    const displayName = profile.displayName;
    const firstName = displayName.split(/\s+/)[0] ?? displayName;

    const gate = { publishEnabled, writeMode, target: recentPost };
    const canPublish = canPublishReply(gate);
    const blockedReason = publishBlockedReason(gate);

    /**
     * Send a reply to the participant's post on Hope.
     *
     * Re-checks the gate rather than trusting the button: the target can
     * change under a card while a confirm strip is open — switching the
     * selected post is one click away — and this is the one action with
     * no undo.
     *
     * Deliberately does NOT call `recordUse`. DraftCard fires that
     * through its own latch, so there is exactly one research record per
     * draft whichever action happened first.
     */
    async function onPublish(text: string) {
        if (!canPublish || !recentPost?.activityId) return undefined;
        // Returns the route's status so the card can tell a real send
        // from a dry run. They must not look alike: a dry run delivers
        // nothing, and a card claiming otherwise is the same lie the
        // old Send button told.
        return publish.mutateAsync({
            cohortId: cohort.id,
            activityType: recentPost.activityType,
            recordId: recentPost.activityId,
            comment: text,
        });
    }

    return (
        <Card className="flex flex-col">
            <CardHeader>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <CardTitle className="text-base">
                        Outreach
                        <span className="ml-2 font-normal text-muted">
                            · {firstName}
                        </span>
                    </CardTitle>
                    {/* Once drafts exist, attribute them to the model that
                        actually wrote them. Before that, name the model
                        that will — and say whether it is loaded, so a
                        60–90 s wait (or a service with no GPU) is
                        legible instead of an unexplained spinner. */}
                    {response?.model_version ? (
                        <span
                            className="inline-flex items-center gap-1.5 text-xs text-accent-ink"
                            title={response.model_version}
                        >
                            <Sparkles className="h-3.5 w-3.5" aria-hidden />
                            Drafted by {formatModelLabel(response.model_version)}
                        </span>
                    ) : (
                        <CommentGenChip />
                    )}
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                {recentPost ? (
                    <div className="space-y-2">
                        <div className="flex items-baseline justify-between gap-2">
                            <label className="text-xs font-semibold uppercase tracking-wide text-muted">
                                {isDiscussionTarget ? "Forum post" : "Participant post"}
                            </label>
                            <span className="text-xs text-muted">
                                from{" "}
                                {recentPost.daysAgo === 0
                                    ? "today"
                                    : `${recentPost.daysAgo}d ago`}
                            </span>
                        </div>
                        {isDiscussionTarget && currentThread ? (
                            // Forum target: show the whole thread with the
                            // focal post highlighted, instead of the bare
                            // post card. The model gets the same thread as
                            // context via thread_context.
                            <DiscussionThread
                                thread={currentThread}
                                focalText={recentPost.text}
                            />
                        ) : (
                            <div className="rounded-md border border-border bg-surface-2 px-3 py-2.5">
                                <div className="mb-1.5 flex items-center gap-1.5">
                                    <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-medium text-accent-ink">
                                        {/* Never show the defaulted wire
                                            value as if the platform said
                                            it — see pickReplyTarget. */}
                                        {recentPost.typeKnown
                                            ? recentPost.activityType
                                            : "Activity"}
                                    </span>
                                </div>
                                <p className="whitespace-pre-wrap text-sm leading-relaxed text-text">
                                    {recentPost.text}
                                </p>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="rounded-md border border-border bg-surface-2 px-3 py-6 text-center">
                        <p className="text-sm font-medium text-text-2">
                            {/* Explicit {" "} — the compiler strips the plain
                                space between an expression and text that
                                carries an HTML entity, rendering
                                "P17hasn't posted yet". */}
                            {firstName}{" "}
                            hasn&apos;t posted yet
                        </p>
                        <p className="mt-1 text-xs text-muted">
                            No activity in the current scoring window. A warm
                            first check-in is often the most helpful early
                            step for someone who has gone quiet.
                        </p>
                        {!writeMode && (
                            <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={() => setWriteMode(true)}
                                className="mt-3 gap-1.5"
                            >
                                <Sparkles
                                    className="h-3.5 w-3.5"
                                    aria-hidden
                                />
                                Write a first check-in
                            </Button>
                        )}
                    </div>
                )}
                <div className="flex gap-2">
                    <Button
                        onClick={onGenerate}
                        loading={generate.isPending}
                        loadingText="Generating…"
                        disabled={!postText.trim() || writeMode}
                        className="flex-1 gap-1.5"
                    >
                        {response ? (
                            <RefreshCcw className="h-3.5 w-3.5" aria-hidden />
                        ) : null}
                        {response
                            ? "Regenerate"
                            : isDiscussionTarget
                              ? "Generate reply"
                              : "Generate drafts"}
                    </Button>
                    <Button
                        type="button"
                        variant={writeMode ? "primary" : "secondary"}
                        onClick={() => setWriteMode((v) => !v)}
                        disabled={generate.isPending}
                        title={
                            writeMode
                                ? "Back to AI-drafted personas"
                                : "Write your own reply from scratch (still gets the Polish button)"
                        }
                        className="whitespace-nowrap gap-1.5"
                    >
                        {writeMode ? "Use AI drafts" : "Write my own"}
                    </Button>
                </div>

                {/* Retrying after a busy 503. Without this the button
                    just says "Generating…" for up to 45 s and looks
                    hung — the facilitator needs to know they're waiting
                    on a colleague's draft, not on a broken service. */}
                {generate.isPending && generate.failureCount > 0 && (
                    <div
                        role="status"
                        aria-live="polite"
                        className="rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-text-2"
                    >
                        <span className="font-medium">
                            Waiting for the reply model
                        </span>
                        <p className="mt-1 leading-relaxed">
                            A colleague&apos;s draft is generating — the model
                            handles one at a time. Retrying automatically
                            (attempt {generate.failureCount + 1} of 4).
                        </p>
                    </div>
                )}

                {response?.safety_signposting && (
                    <div className="rounded-md border border-risk-md bg-risk-md-bg px-3 py-2 text-xs text-risk-md">
                        {response.safety_signposting}
                    </div>
                )}
                {error && (() => {
                    const state = classifyGenerateError(error);
                    // Neutral for every tone. The risk palette belongs to
                    // participants, not to service status: a red card
                    // here reads at a glance like a high-risk person
                    // rather than a model that needs a retry. The title
                    // carries the difference in words instead.
                    const tone = "border-border bg-surface-2 text-text-2";
                    return (
                        <div
                            role="status"
                            className={`rounded-md border px-3 py-2 text-xs ${tone}`}
                        >
                            <div className="font-semibold text-text">
                                {state.title}
                            </div>
                            <p className="mt-1 leading-relaxed">{state.body}</p>
                            {state.detail && (
                                <details className="mt-1.5 opacity-80">
                                    <summary className="cursor-pointer select-none">
                                        Technical details
                                    </summary>
                                    <p className="mt-1 break-all font-mono text-[10px] leading-relaxed">
                                        {state.detail}
                                    </p>
                                </details>
                            )}
                        </div>
                    );
                })()}

                {/* Skeletons only on the FIRST generation (no response yet).
                    During a regenerate the existing DraftCard stays mounted and
                    shows its own spinning refresh icon — rendering skeletons too
                    would double up (3 shimmer blocks pushing the old card down).
                    role=status + sr-only text announces the wait to screen
                    readers, which the bare skeletons wouldn't. The Generate
                    button right above already carries the visible "Generating…"
                    label + spinner (Button's `loading` prop) — a second caption
                    down here was a stale duplicate, not a distinct signal. */}
                {generate.isPending && !response && (
                    <div
                        className="space-y-3"
                        role="status"
                        aria-busy="true"
                        aria-live="polite"
                    >
                        <span className="sr-only">Generating drafts…</span>
                        {[0, 1, 2].map((i) => (
                            <Skeleton key={i} className="h-32 w-full" />
                        ))}
                    </div>
                )}

                {writeMode && (() => {
                    // Synthesize a blank Draft so DraftCard's existing
                    // textarea + Polish + Send wiring is reused as-is.
                    // The "AI persona" framing is hidden by giving the
                    // synthetic draft a neutral label and rendering
                    // without persona tabs above.
                    const blankDraft: Draft = {
                        persona: "Empathetic",
                        label: "Warm personal check-in",
                        // No post to reply to → seed a warm first-contact
                        // message the facilitator can edit (act on a silent
                        // at-risk participant). With a post, start blank —
                        // they're writing a custom reply to it.
                        body: recentPost
                            ? ""
                            : firstContactTemplate(firstName),
                        draft_id: ("00000000-0000-0000-0000-" +
                            String(selectedId)
                                .padStart(12, "0")
                                .slice(-12)) as unknown as Draft["draft_id"],
                    };
                    const ctx: DraftContext = {
                        topFactors: prediction.data?.contributing_factors ?? [],
                        lastActiveDays: history
                            ? daysSinceLastEvent(history)
                            : null,
                        memoryUsed: false,
                        engagementUsed: false,
                        displayName: profile.displayName,
                    };
                    return (
                        <div className="space-y-3">
                            <div className="flex items-center gap-1.5 text-xs text-muted">
                                <Sparkles
                                    className="h-3 w-3 text-accent-ink"
                                    aria-hidden
                                />
                                Write your reply below. Click the wand to
                                polish spelling, grammar, and tone.
                            </div>
                            <DraftCard
                                key={`writemode-${selectedId}`}
                                draft={blankDraft}
                                canPublish={false}
                                onThumb={() => {
                                    /* no AI to rate */
                                }}
                                onUse={onUse}
                                pending={event.isPending}
                                context={ctx}
                                recipientName={displayName}
                                participantId={Number(
                                    String(selectedId).replace(/[^0-9]/g, "") ||
                                        "0",
                                )}
                            />
                        </div>
                    );
                })()}

                {!writeMode && response && (() => {
                    const drafts = response.drafts;
                    if (drafts.length === 0) return null;
                    const current: Draft =
                        drafts.find((d) => d.persona === activePersona) ??
                        drafts[0];
                    const ctx: DraftContext = {
                        topFactors: prediction.data?.contributing_factors ?? [],
                        lastActiveDays: history
                            ? daysSinceLastEvent(history)
                            : null,
                        memoryUsed: Boolean(response.memory_used),
                        engagementUsed: Boolean(response.engagement_used),
                        displayName: profile.displayName,
                    };
                    return (
                        <div className="space-y-3">
                            {/* Persona tabs only when the model returned
                                multiple drafts. Forum replies come back as
                                a single warm reply — no tone choice. */}
                            {drafts.length > 1 && (
                                <div className="space-y-1.5">
                                    <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                                        Suggested tone
                                    </span>
                                    <div
                                        role="tablist"
                                        aria-label="Draft tone"
                                        className="flex flex-wrap gap-1 rounded-md bg-surface-2 p-1"
                                    >
                                        {drafts.map((d) => {
                                            const isActive =
                                                d.persona === current.persona;
                                            return (
                                                <button
                                                    key={String(d.draft_id)}
                                                    role="tab"
                                                    aria-selected={isActive}
                                                    type="button"
                                                    onClick={() =>
                                                        setActivePersona(
                                                            d.persona,
                                                        )
                                                    }
                                                    className={
                                                        "flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors " +
                                                        (isActive
                                                            ? "bg-surface text-text shadow-sm"
                                                            : "text-muted hover:text-text-2")
                                                    }
                                                >
                                                    {PERSONA_TAB_LABEL[
                                                        d.persona
                                                    ] ?? d.persona}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                            <DraftCard
                                key={String(current.draft_id)}
                                draft={current}
                                onThumb={onThumb}
                                onUse={onUse}
                                onRegenerate={onGenerate}
                                regenerating={generate.isPending}
                                pending={event.isPending}
                                context={ctx}
                                canPublish={canPublish}
                                onPublish={onPublish}
                                publishBlockedReason={blockedReason}
                                recipientName={displayName}
                                participantId={Number(
                                    String(selectedId).replace(/[^0-9]/g, "") || "0",
                                )}
                            />
                        </div>
                    );
                })()}
            </CardContent>
            {/* Follow-up activity panel temporarily disabled (showed participant
                @-handles in past replies). Re-enable once de-identified:
            <div className="px-6 pb-6">
                <FollowUpActivity
                    participantId={selectedId}
                    cohortId={cohort.id}
                />
            </div>
            */}
        </Card>
    );
}
