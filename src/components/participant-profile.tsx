"use client";

import { useMemo } from "react";
import { CalendarDays, HeartPulse, Quote } from "lucide-react";

import { useCohortBundle } from "@/lib/hooks/useCohortBundle";
import { findRealParticipant } from "@/lib/realCohort";
import { DAY_MS, scoreWindowEnd } from "@/lib/signals";
import type { ParticipantHistory } from "@/lib/api/dropout";
import type { RealWellbeingResult } from "@/lib/server/cohort-data";

/**
 * "Who is this person" strip for the detail panel.
 *
 * Everything here is **verifiable fact** — tenure arithmetic, counts from
 * the event stream, self-reported questionnaire scores, and what the
 * participant wrote about themselves in their own profile. Nothing is
 * paraphrased, inferred, or model-generated.
 *
 * That constraint is deliberate rather than incidental. This is a health
 * cohort, and a facilitator reading a generated "picture" of someone has
 * no way to tell a real disclosure from a plausible invention. Reply
 * drafts are safe to generate because a human edits them before sending;
 * a profile summary is read and acted on directly. If an LLM gloss is
 * ever added it belongs *on top* of this card, clearly labelled, never
 * in place of it.
 *
 * It also deliberately does NOT excerpt their posts. The Recent-activity
 * timeline immediately below lists every post in full, so quotes here
 * were the same text twice on one screen. This card earns its space only
 * by showing what the timeline cannot: who they are, not what they did.
 *
 * Numbers respect the week selector — `history` arrives already truncated
 * to the selected scoring week, so replaying an earlier week shows the
 * participant as they looked then.
 */

/** Profile answers shown before spilling into a "+N more" line. */
const MAX_INTERVIEW_ITEMS = 3;

/** The extractor's stand-in when the platform export carries no bio for
 *  this module (true for most IIH participants — `UserProfile (1).txt`
 *  has no module 337). Showing it would be worse than showing nothing. */
function isPlaceholderBio(bio: string): boolean {
    return !bio.trim() || bio.includes("No profile bio submitted yet");
}

function shortDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
    });
}

/**
 * Minimum spacing between the first and latest questionnaire before a
 * delta is shown. Participants sometimes file two questionnaires in one
 * sitting (verified in the shipped bundles: pairs minutes apart), and a
 * first→latest arrow over that gap reads as change across the programme
 * when it is really test–retest noise. A week matches the programme's
 * own cadence.
 */
const WELLBEING_DELTA_MIN_GAP_MS = 7 * DAY_MS;

/** First → latest change, or null when there's nothing to compare or the
 *  administrations are too close together to call a trend. */
function wellbeingDelta(results: RealWellbeingResult[]): number | null {
    if (results.length < 2) return null;
    const first = results[0];
    const last = results[results.length - 1];
    const gap =
        new Date(last.recordedAt).getTime() -
        new Date(first.recordedAt).getTime();
    if (gap < WELLBEING_DELTA_MIN_GAP_MS) return null;
    return last.metricScore - first.metricScore;
}

export function ParticipantProfile({
    participantId,
    cohortId,
    history,
}: {
    participantId: string;
    cohortId: number;
    history: ParticipantHistory | null;
}) {
    const bundle = useCohortBundle(cohortId);
    const participant = bundle.data
        ? findRealParticipant(bundle.data, participantId)
        : undefined;

    const counts = useMemo(() => {
        if (!history) return null;
        const by = (t: string) =>
            history.events.filter((e) => e.event_type === t).length;
        return {
            activities: by("activity"),
            forum: by("discussion_post"),
            bookmarks: by("bookmark"),
            replies: by("facilitator_comment"),
        };
    }, [history]);

    // Only questionnaires completed by the end of the selected scoring
    // week. The bundle carries every result a participant ever filed, so
    // rendering it raw let a week-6 score appear while replaying week 1 —
    // future data leaking backwards, and the one number on this card that
    // wasn't already week-aware. `history.events` is truncated upstream;
    // wellbeing lives on the bundle, so it has to be cut here.
    const wellbeing = useMemo(() => {
        const all = participant?.wellbeing ?? [];
        if (!history) return all;
        const windowEnd = scoreWindowEnd(history);
        return all.filter(
            (w) => new Date(w.recordedAt).getTime() < windowEnd,
        );
    }, [participant, history]);

    if (!participant) return null;

    const latest = wellbeing[wellbeing.length - 1];
    const delta = wellbeingDelta(wellbeing);

    // Days on programme at the *selected* week, not days since they
    // joined in real time — so it agrees with every other number on the
    // page when replaying an earlier week. Late joiners get credit only
    // from their own start date, hence the offset.
    let dayInProgramme: number | null = null;
    if (history) {
        const joinedMs = new Date(participant.startedAt).getTime();
        const startMs = new Date(history.effective_start).getTime();
        const joinOffsetDays = Math.max(
            0,
            Math.floor((joinedMs - startMs) / DAY_MS),
        );
        dayInProgramme = Math.max(0, history.score_at_day - joinOffsetDays);
    }

    const bioShown = !isPlaceholderBio(participant.bio);

    return (
        <section
            aria-label="About this participant"
            className="rounded-lg border border-border bg-surface-2/60 px-3.5 py-3"
        >
            {/* Row 1: tenure left, wellbeing right — the two things that
                frame everything below. */}
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <span className="inline-flex items-center gap-1.5 text-xs text-text-2">
                    <CalendarDays
                        className="h-3.5 w-3.5 shrink-0 text-muted"
                        aria-hidden
                    />
                    <span className="font-medium text-text">
                        Joined {shortDate(participant.startedAt)}
                    </span>
                    {dayInProgramme !== null && (
                        <span className="text-muted">
                            · day {dayInProgramme} of the programme
                        </span>
                    )}
                </span>
                {latest && (
                    <span
                        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-xs"
                        title={
                            "Short Warwick-Edinburgh Mental Well-being Scale — self-reported, range 7–35. " +
                            wellbeing
                                .map(
                                    (w) =>
                                        `${shortDate(w.recordedAt)}: ${w.metricScore.toFixed(1)}`,
                                )
                                .join(" · ")
                        }
                    >
                        <HeartPulse
                            className="h-3.5 w-3.5 shrink-0 text-muted"
                            aria-hidden
                        />
                        <span className="text-muted">Wellbeing</span>
                        <span className="font-semibold tabular-nums text-text">
                            {latest.metricScore.toFixed(1)}
                        </span>
                        <span className="text-muted">/ 35</span>
                        {delta !== null && (
                            <span
                                className={
                                    "font-medium tabular-nums " +
                                    (delta > 0
                                        ? "text-risk-lo"
                                        : delta < 0
                                          ? "text-risk-hi"
                                          : "text-muted")
                                }
                                title={`Change from ${shortDate(
                                    wellbeing[0].recordedAt,
                                )} to ${shortDate(latest.recordedAt)}`}
                            >
                                {delta > 0 ? "↑" : delta < 0 ? "↓" : "→"}
                                {Math.abs(delta).toFixed(1)}
                            </span>
                        )}
                    </span>
                )}
            </div>

            {/* Row 2: engagement counts as discrete stats rather than one
                run-on grey sentence — scannable at a glance. */}
            {counts && (
                <dl className="mt-2.5 flex flex-wrap items-baseline gap-x-5 gap-y-1.5">
                    <Stat n={counts.activities} label="posts" />
                    <Stat n={counts.forum} label="forum replies" />
                    <Stat n={counts.bookmarks} label="saved" />
                    <Stat n={counts.replies} label="replies received" />
                </dl>
            )}

            {/* What they wrote about themselves, from the platform's own
                profile prompts. Deliberately NOT excerpts of their posts:
                the Recent-activity timeline directly below already lists
                every post in full, so quoting them here was the same text
                twice on one screen. This section only earns its space by
                showing something the timeline can't. */}
            {(bioShown || participant.interview.length > 0) && (
                <div className="mt-3 border-t border-border pt-2.5">
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                        <Quote className="h-3 w-3" aria-hidden />
                        Their profile
                    </div>
                    {bioShown && (
                        <p className="mt-2 text-xs leading-relaxed text-text-2">
                            {participant.bio}
                        </p>
                    )}
                    {participant.interview.length > 0 && (
                        <dl className="mt-2 space-y-2">
                            {participant.interview
                                .slice(0, MAX_INTERVIEW_ITEMS)
                                .map((it) => (
                                    <div key={it.question}>
                                        <dt className="text-[11px] text-muted">
                                            {it.question}
                                        </dt>
                                        <dd className="mt-0.5 border-l-2 border-accent/40 pl-2.5 text-xs italic leading-relaxed text-text-2">
                                            {it.answer}
                                        </dd>
                                    </div>
                                ))}
                            {participant.interview.length >
                                MAX_INTERVIEW_ITEMS && (
                                <div className="text-[11px] text-muted">
                                    +{" "}
                                    {participant.interview.length -
                                        MAX_INTERVIEW_ITEMS}{" "}
                                    more in their profile
                                </div>
                            )}
                        </dl>
                    )}
                </div>
            )}

            {/* Absence is itself worth knowing — a facilitator opening a
                blank profile should be able to tell "nothing filled in"
                from "failed to load". */}
            {!bioShown && participant.interview.length === 0 && (
                <p className="mt-2.5 border-t border-border pt-2.5 text-[11px] text-muted">
                    No profile or introduction submitted.
                </p>
            )}
        </section>
    );
}

/** One engagement count. Number first so the row scans vertically. */
function Stat({ n, label }: { n: number; label: string }) {
    return (
        <div className="flex items-baseline gap-1">
            <dt className="sr-only">{label}</dt>
            <dd
                className={
                    "text-sm font-semibold tabular-nums " +
                    (n === 0 ? "text-muted" : "text-text")
                }
            >
                {n}
            </dd>
            <span className="text-[11px] text-muted">{label}</span>
        </div>
    );
}
