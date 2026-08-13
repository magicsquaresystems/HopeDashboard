/**
 * Adapter layer between the cohort bundle (real Hope Move platform data,
 * committed under `local/` — see `cohort-data.ts`) and the dashboard's
 * dropout-API / profile / memory contracts.
 *
 * Keeping the adapter in one place means the queue / detail / drafts panels
 * stay shape-stable when the platform feed eventually replaces the bundle —
 * they all consume `ParticipantHistory` and `Profile`, regardless of source.
 */

import type {
    CohortBundle,
    RealParticipant,
} from "@/lib/server/cohort-data";
import type { EventRecord, ParticipantHistory } from "@/lib/api/dropout";
import type { Profile } from "@/lib/profile";

/**
 * Score-at-day mirrors engagement_ml's per-horizon training. Eight models
 * are trained for T ∈ {7, 14, 21, 28, 35, 42, 49, 56}; callers pick which
 * one. Default to week 6 so existing callers keep behaviour. The
 * dashboard's week-selector overrides this per call.
 *
 * `programme_length_days` now comes from the cohort bundle, not a
 * hardcoded constant — different cohorts run for different lengths.
 */
const DEFAULT_SCORE_AT_DAY = 42;

/**
 * Platform exports use local datetime strings without a `Z` suffix.
 * engagement_ml's Pydantic model requires explicit timezone designation.
 * Add `Z` when missing; preserve already-tz-aware values untouched.
 *
 * This is defense in depth — the extraction script does the same — so the
 * adapter is robust if anyone hands us a bundle that wasn't normalised.
 */
function ensureUtc(ts: string): string {
    if (!ts) return ts;
    if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(ts)) return ts;
    return ts + "Z";
}

export function bundleParticipantIds(bundle: CohortBundle): string[] {
    return bundle.participants.map((p) => p.participant_id);
}

export function findRealParticipant(
    bundle: CohortBundle,
    participantId: string,
): RealParticipant | undefined {
    return bundle.participants.find((p) => p.participant_id === participantId);
}

/**
 * Convert a real participant's raw events into the `ParticipantHistory`
 * shape engagement_ml expects.
 *
 * effective_start is the cohort's published start (from the platform),
 * NOT the participant's first event. engagement_ml uses cohort-relative
 * timing to compare like-for-like across participants.
 *
 * Events that fall outside `[effective_start, effective_start + score_at_day)`
 * are dropped — those would 422 from the API. Late starters get an empty
 * stream, which the model correctly treats as a high-risk signal.
 */
export function bundleToHistory(
    bundle: CohortBundle,
    participantId: string,
    scoreAtDay: number = DEFAULT_SCORE_AT_DAY,
): ParticipantHistory | null {
    const p = findRealParticipant(bundle, participantId);
    if (!p) return null;

    // `ensureUtc` on the boundary too, not just the events: a bundle with
    // a naive effectiveStart would otherwise shift the whole window by
    // the host's UTC offset while the declared `effective_start` (line
    // below, normalised) wouldn't — either 422ing at the service or
    // silently dropping day-0 events, depending on the offset's sign.
    const effectiveStart = new Date(ensureUtc(bundle.cohort.effectiveStart));
    const windowEndMs =
        effectiveStart.getTime() + scoreAtDay * 24 * 60 * 60 * 1000;

    const events: EventRecord[] = [];
    for (const e of p.events) {
        const ts = ensureUtc(e.timestamp);
        const tsMs = new Date(ts).getTime();
        if (Number.isNaN(tsMs)) continue;
        if (tsMs < effectiveStart.getTime() || tsMs >= windowEndMs) continue;
        events.push({
            timestamp: ts,
            event_type: e.event_type as EventRecord["event_type"],
            activity_type: e.activity_type,
            words_written: e.words_written,
            description: e.description ?? undefined,
            topic_id: e.topicId,
            // Rollup / linkage metadata, when the bundle carries it.
            // Older bundles predate the extractor change and simply
            // leave these undefined — the timeline falls back to a
            // bare "viewed N pages" count and unnamed bookmarks.
            page_title: e.page_title,
            page_url: e.page_url,
            hits: e.hits,
            avg_duration: e.avg_duration,
            activity_id: e.activity_id,
        });
    }

    return {
        participant_id: p.participant_id,
        effective_start: ensureUtc(bundle.cohort.effectiveStart),
        events,
        cohort_size: bundle.participants.length,
        // Real cohort-facilitator-density is computable from the platform's
        // facilitator-event stream; for the bundle we approximate with the
        // share of participants who received any facilitator comment.
        cohort_facilitator_density: facilitatorDensity(bundle),
        // engagement_ml rejects `score_at_day > programme_length_days` with
        // a 422. Programme length has two sources — `COHORTS` in
        // lib/cohorts.ts (drives the week selector) and the bundle's own
        // `cohort.programmeLengthDays` (frozen at extraction time) — and
        // they drift: lengthening a cohort in the registry without
        // re-extracting made every request 422 with the queue showing a
        // raw error dump. Take the larger so the invariant holds by
        // construction; scoring at day 56 means the programme is at least
        // 56 days long regardless of what the stale bundle recorded.
        programme_length_days: Math.max(
            bundle.cohort.programmeLengthDays,
            scoreAtDay,
        ),
        score_at_day: scoreAtDay,
    };
}

export function bundleToProfile(
    bundle: CohortBundle,
    participantId: string,
): Profile | null {
    const p = findRealParticipant(bundle, participantId);
    if (!p) return null;
    return {
        participantId: p.participant_id,
        displayName: p.displayName,
        bio: p.bio,
        startedAt: p.startedAt,
    };
}

function facilitatorDensity(bundle: CohortBundle): number {
    if (bundle.participants.length === 0) return 0;
    const touched = bundle.participants.filter(
        (p) => p.priorFacilitatorReplies.length > 0,
    ).length;
    return Number((touched / bundle.participants.length).toFixed(2));
}

/** How much forum thread feeds the model as `thread_context`. Threads run to
 * ~125 replies, so send two slices: the topic OPENING (facilitator framing
 * posts) and the few replies JUST BEFORE the post being answered. The focal
 * post is excluded here; it's sent in full via `post_text`, so including it
 * would duplicate it and risk the char budget truncating it. */
const THREAD_CONTEXT_OPENING_REPLIES = 2; // topic-framing posts at the top
const THREAD_CONTEXT_PRECEDING_REPLIES = 4; // replies right before the focal
const THREAD_CONTEXT_PER_POST_CHARS = 280; // clip any single reply
const THREAD_CONTEXT_MAX_CHARS = 2000; // overall safety cap (never hits focal)

/**
 * Render a forum topic into a compact text block for the comment-gen
 * `thread_context` field. Includes two slices: the topic OPENING (facilitator
 * framing) and the replies JUST BEFORE the post being answered, each prefixed
 * with the author alias. The focal post is excluded; it reaches the model in
 * full via `post_text`.
 *
 * `focalText` identifies the post being replied to. Matches the LAST reply with
 * that exact text: intro threads contain duplicate texts, and in a chronological
 * thread the most recent occurrence is the live one. On a miss, falls back to a
 * plain tail window. Returns "" when the topic isn't in the bundle or has no
 * usable replies.
 */
export function renderThreadContext(
    bundle: CohortBundle,
    topicId: number | undefined,
    focalText: string,
): string {
    if (topicId == null) return "";
    const thread = bundle.discussionThreads?.[String(topicId)];
    if (!thread || !thread.title.trim()) return "";
    const replies = thread.replies ?? [];
    if (replies.length === 0) return "";

    type Reply = (typeof replies)[number];
    const clip = (s: string) =>
        s.length > THREAD_CONTEXT_PER_POST_CHARS
            ? s.slice(0, THREAD_CONTEXT_PER_POST_CHARS - 1) + "…"
            : s;
    const usable = (r: Reply) => r.text.trim().length > 0;
    const fmt = (r: Reply) => `${r.alias}: ${clip(r.text.trim())}`;

    const focal = focalText.trim();
    // LAST exact match — duplicate intro texts exist; the most recent is live.
    let focalIdx = -1;
    if (focal) {
        for (let i = 0; i < replies.length; i++) {
            if (replies[i].text.trim() === focal) focalIdx = i;
        }
    }

    const lines: string[] = [`Forum topic: "${thread.title}"`];

    if (focalIdx === -1) {
        // No focal match: fall back to a plain tail window of prior context.
        const tail = replies
            .slice(
                -(THREAD_CONTEXT_OPENING_REPLIES +
                    THREAD_CONTEXT_PRECEDING_REPLIES),
            )
            .filter(usable);
        if (tail.length) {
            lines.push("", "Recent replies in the thread:");
            for (const r of tail) lines.push(fmt(r));
        }
    } else {
        // Two disjoint windows by construction: opening [0, openingEnd) and
        // preceding [precStart, focalIdx), where precStart >= openingEnd. The
        // focal index is excluded from both.
        const openingEnd = Math.min(THREAD_CONTEXT_OPENING_REPLIES, focalIdx);
        const precStart = Math.max(
            openingEnd,
            focalIdx - THREAD_CONTEXT_PRECEDING_REPLIES,
        );
        const opening = replies.slice(0, openingEnd).filter(usable);
        const preceding = replies.slice(precStart, focalIdx).filter(usable);

        if (opening.length) {
            lines.push("", "Earlier in the thread:");
            for (const r of opening) lines.push(fmt(r));
        }
        // Gap marker only when replies were actually skipped between windows.
        if (opening.length && preceding.length && precStart > openingEnd) {
            lines.push("…");
        }
        if (preceding.length) {
            lines.push("", "Just before this post:");
            for (const r of preceding) lines.push(fmt(r));
        }
    }

    let block = lines.join("\n").trimEnd();
    if (block.length > THREAD_CONTEXT_MAX_CHARS) {
        block = block.slice(0, THREAD_CONTEXT_MAX_CHARS - 1) + "…";
    }
    return block;
}
