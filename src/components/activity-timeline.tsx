"use client";

import { useMemo, useState } from "react";
import {
    Activity,
    Bookmark,
    FileText,
    LogIn,
    MessageCircle,
    MessageSquare,
    type LucideIcon,
} from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import type { EventRecord, ParticipantHistory } from "@/lib/api/dropout";
import { DAY_MS, scoreWindowEnd } from "@/lib/signals";
import { useUiStore } from "@/lib/store/uiStore";

/**
 * Chronological activity feed for the detail panel.
 *
 * Two modes:
 *  - Compact (default): 5 most-recent non-page-visit events as narrative
 *    one-liners ("10d ago — Posted Gratitude: 'For Spring...'"). Quick
 *    skim for the facilitator.
 *  - Expanded: day-bucketed feed with icons + content snippets +
 *    page-visit aggregations. Shows up to MAX_EXPANDED events.
 *
 * Page visits are collapsed in both modes — a heavily-engaged
 * participant generates 100+ page-visits and per-row entries would
 * drown out the substantive events (posts, replies, logins). In the
 * expanded view they collapse into one "Read N pages" row per day that
 * names the pages, which is the part a facilitator can act on ("she
 * read Being self-compassionate three times but never posted").
 */

const COMPACT_ROWS = 5;
const MAX_EXPANDED = 15;
/** Distinct page titles shown per day before spilling into "+N more". */
const MAX_PAGE_TITLES = 6;

type DayBucket = {
    dayKey: string;
    label: string;
    events: EventRecord[];
    pageVisits: EventRecord[];
};

const ICONS: Record<EventRecord["event_type"], LucideIcon> = {
    activity: Activity,
    login: LogIn,
    page_visit: Activity, // unused — page visits are aggregated
    bookmark: Bookmark,
    discussion_post: MessageCircle,
    facilitator_comment: MessageSquare,
};

const ACCENTS: Record<EventRecord["event_type"], string> = {
    activity: "text-accent-ink bg-accent/20",
    login: "text-text-2 bg-surface-2",
    page_visit: "text-muted bg-surface-2",
    bookmark: "text-text-2 bg-surface-2",
    discussion_post: "text-accent-ink bg-accent/20",
    facilitator_comment: "text-risk-md bg-risk-md-bg",
};

/**
 * All day math and labels here use UTC deliberately. Programme days —
 * the score window, `score_at_day`, the bundle's day semantics — are
 * UTC-anchored, and the bucket keys below slice the ISO string (a UTC
 * day). Labelling with local dates while keying on UTC days split
 * midnight-straddling events into duplicate date headers on any
 * non-UTC browser.
 */
const startOfUtcDay = (d: Date) =>
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

function dayLabel(date: Date, now: Date): string {
    const diffDays = Math.round(
        (startOfUtcDay(now) - startOfUtcDay(date)) / DAY_MS,
    );
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) {
        return date.toLocaleDateString(undefined, {
            weekday: "long",
            timeZone: "UTC",
        });
    }
    return date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
    });
}

function timeOnly(date: Date): string {
    return date.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
        timeZone: "UTC",
    });
}

/** Compact relative time for the narrative rows. "Today", "Yesterday",
 * "3d ago" up to a week; date otherwise. */
function relativeTime(date: Date, now: Date): string {
    const diffDays = Math.round(
        (startOfUtcDay(now) - startOfUtcDay(date)) / DAY_MS,
    );
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 14) return `${diffDays}d ago`;
    return date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
    });
}

function eventLabel(e: EventRecord): string {
    switch (e.event_type) {
        case "activity":
            return `Posted ${e.activity_type ?? "an activity"}`;
        case "login":
            return "Logged in";
        case "bookmark":
            // Bundles carry the bookmarked page's title since the
            // page-metadata extractor change; older bundles fall back to
            // the unnamed row.
            return e.page_title
                ? `Bookmarked: ${e.page_title}`
                : "Bookmarked content";
        case "discussion_post":
            return "Posted in discussion";
        case "facilitator_comment":
            return "Facilitator replied";
        default:
            return "Activity";
    }
}

function snippet(e: EventRecord, max = 120): string | null {
    let text = (e.description ?? "").trim();
    if (!text) return null;
    // Emotions posts are `;`-separated tag selections
    // ("Scared;Irritable;Determined") — render as a readable list.
    if (e.event_type === "activity" && e.activity_type === "Emotions") {
        text = text
            .split(";")
            .map((t) => t.trim())
            .filter(Boolean)
            .join(", ");
    }
    if (text.length <= max) return text;
    return text.slice(0, max - 1) + "…";
}

/** A reply-draftable post: a content-carrying activity or forum/discussion
 * post. Emotions activities are excluded (no training pairs — /generate
 * 422s), matching the drafts.tsx target filter. Used to decide which
 * timeline rows are clickable to set the Drafts panel's target post. */
function isDraftablePost(e: EventRecord): boolean {
    return (
        (e.event_type === "activity" || e.event_type === "discussion_post") &&
        typeof e.description === "string" &&
        e.description.trim().length > 0 &&
        e.activity_type !== "Emotions"
    );
}

/** One-line narrative for the compact mode. Combines the event label
 * with a short snippet for content-carrying events; for logins the
 * most-recent one becomes "Last login" so the row reads naturally. */
function narrativeLine(
    e: EventRecord,
    isMostRecentLogin: boolean,
): string {
    if (e.event_type === "login") {
        return isMostRecentLogin ? "Last login" : "Logged in";
    }
    const snip = snippet(e, 80);
    const label = eventLabel(e);
    if (!snip) return label;
    return `${label}: “${snip}”`;
}

function bucketEvents(
    events: EventRecord[],
    now: Date,
): { buckets: DayBucket[]; omitted: number } {
    const sorted = [...events].sort((a, b) =>
        b.timestamp.localeCompare(a.timestamp),
    );

    const buckets = new Map<string, DayBucket>();
    let kept = 0;
    let omitted = 0;
    for (const e of sorted) {
        const d = new Date(e.timestamp);
        const dayKey = d.toISOString().slice(0, 10);
        let bucket = buckets.get(dayKey);
        if (!bucket) {
            bucket = {
                dayKey,
                label: dayLabel(d, now),
                events: [],
                pageVisits: [],
            };
            buckets.set(dayKey, bucket);
        }
        if (e.event_type === "page_visit") {
            bucket.pageVisits.push(e);
            continue;
        }
        if (kept >= MAX_EXPANDED) {
            // Counted rather than silently dropped — "Full history" must
            // not imply completeness it doesn't have.
            omitted += 1;
            continue;
        }
        bucket.events.push(e);
        kept += 1;
    }

    return {
        buckets: Array.from(buckets.values()).filter(
            (b) => b.events.length > 0 || b.pageVisits.length > 0,
        ),
        omitted,
    };
}

/**
 * Platform chrome (dashboard, profile, newsfeed) vs. programme content.
 *
 * Every session opens with a dashboard hit, so an unranked list is mostly
 * navigation noise. Content pages sort first and chrome fills whatever
 * slots are left — nothing is dropped, it just queues behind the pages a
 * facilitator would actually mention.
 */
function isContentPage(v: EventRecord): boolean {
    const url = (v.page_url ?? "").toLowerCase();
    if (!url) return false;
    if (url.startsWith("/modules/dashboard")) return false;
    if (url.startsWith("/modules/session-")) return true;
    if (url.startsWith("/activities/") && !url.includes("newsfeed")) return true;
    return false;
}

type PageRow = { title: string; url?: string; hits: number; content: boolean };

/**
 * One day's page reads, as named pages rather than a bare count.
 *
 * Page visits arrive as a per-URL rollup (one record carrying a `hits`
 * count), so two records for the same title in one day are summed rather
 * than listed twice. Bundles extracted before page metadata existed carry
 * no title — those fall back to the old count-only line.
 */
function PagesRead({ visits }: { visits: EventRecord[] }) {
    const rows = useMemo<PageRow[]>(() => {
        const merged = new Map<string, PageRow>();
        for (const v of visits) {
            const title = (v.page_title ?? "").trim();
            if (!title) continue;
            const existing = merged.get(title);
            if (existing) {
                existing.hits += v.hits ?? 1;
            } else {
                merged.set(title, {
                    title,
                    url: v.page_url,
                    hits: v.hits ?? 1,
                    content: isContentPage(v),
                });
            }
        }
        return Array.from(merged.values()).sort(
            (a, b) =>
                Number(b.content) - Number(a.content) || b.hits - a.hits,
        );
    }, [visits]);

    const shown = rows.slice(0, MAX_PAGE_TITLES);
    const rest = rows.length - shown.length;
    const totalReads = rows.reduce((sum, r) => sum + r.hits, 0);

    return (
        <li className="rounded-md border border-border bg-surface-2">
            <div className="flex gap-2.5 px-2.5 py-2">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted">
                    <FileText className="h-3.5 w-3.5" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                    <span className="text-sm text-text">
                        {rows.length === 0
                            ? `Viewed ${visits.length} ${
                                  visits.length === 1 ? "page" : "pages"
                              }`
                            : `Read ${rows.length} ${
                                  rows.length === 1 ? "page" : "pages"
                              }`}
                        {totalReads > rows.length && (
                            <span className="ml-1.5 text-xs text-muted">
                                · {totalReads} views
                            </span>
                        )}
                    </span>
                    {shown.length > 0 && (
                        <ul className="mt-1.5 flex flex-wrap gap-1">
                            {shown.map((r) => (
                                <li
                                    key={r.title}
                                    title={r.url ?? r.title}
                                    className={
                                        "rounded-full border px-2 py-0.5 text-[11px] " +
                                        (r.content
                                            ? "border-accent/40 bg-accent/10 text-accent-ink"
                                            : "border-border bg-surface text-text-2")
                                    }
                                >
                                    {r.title}
                                    {r.hits > 1 && (
                                        <span className="ml-1 text-muted">
                                            ×{r.hits}
                                        </span>
                                    )}
                                </li>
                            ))}
                            {rest > 0 && (
                                <li className="px-1 py-0.5 text-[11px] text-muted">
                                    +{rest} more
                                </li>
                            )}
                        </ul>
                    )}
                </div>
            </div>
        </li>
    );
}

/** One event row in the expanded "Full history" feed. Post rows (draftable
 * activities + forum/discussion posts) are clickable to set the Drafts
 * panel's target, mirroring the compact view; everything else renders as a
 * static row. Extracted so the inline JSX isn't a lexical child of the
 * <ul> (keeps the list-children lint rule happy). */
function ExpandedEventRow({
    event: e,
    draftedTs,
    onSelect,
}: {
    event: EventRecord;
    draftedTs: string | undefined;
    onSelect: (ts: string) => void;
}) {
    const Icon = ICONS[e.event_type] ?? Activity;
    const accent = ACCENTS[e.event_type] ?? ACCENTS.login;
    const text = snippet(e);
    const isEmotions =
        e.event_type === "activity" && e.activity_type === "Emotions";
    const isPost = isDraftablePost(e);
    const isDrafted = isPost && e.timestamp === draftedTs;

    const row = (
        <div className="flex w-full gap-2.5">
            <div
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${accent}`}
            >
                <Icon className="h-3.5 w-3.5" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm text-text">{eventLabel(e)}</span>
                    <span className="flex shrink-0 items-center gap-1.5">
                        {isDrafted && (
                            <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-medium text-accent-ink">
                                drafting
                            </span>
                        )}
                        {isEmotions && (
                            <span
                                className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-muted"
                                title="Emotions posts are not AI-drafted. They call for a human reply."
                            >
                                no AI draft
                            </span>
                        )}
                        <span className="text-xs text-muted">
                            {timeOnly(new Date(e.timestamp))}
                        </span>
                    </span>
                </div>
                {text && (
                    <p className="mt-0.5 line-clamp-2 text-xs text-text-2">
                        {text}
                    </p>
                )}
            </div>
        </div>
    );

    return (
        <li
            className={`rounded-md border ${
                isDrafted
                    ? "border-accent bg-accent/10"
                    : "border-border bg-surface-2"
            }`}
        >
            {isPost ? (
                <button
                    type="button"
                    onClick={() => onSelect(e.timestamp)}
                    className="flex w-full rounded-md px-2.5 py-2 text-left transition-colors hover:bg-accent/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    aria-current={isDrafted ? "true" : undefined}
                    title="Draft a reply to this post"
                >
                    {row}
                </button>
            ) : (
                <div className="flex px-2.5 py-2">{row}</div>
            )}
        </li>
    );
}

export function ActivityTimeline({
    history,
}: {
    history: ParticipantHistory;
}) {
    const [expanded, setExpanded] = useState(false);
    // The selected scoring week's clock, not the wall clock — the same
    // anchor every other number on the page measures against. A wall
    // clock here made the timeline say "29d ago" while the detail tile,
    // correctly, called the same participant active that week (the exact
    // bug fixed once already in drafts.tsx for post age).
    const now = useMemo(
        () => new Date(scoreWindowEnd(history)),
        [history],
    );
    const selectedPostTs = useUiStore((s) => s.selectedPostTs);
    const selectPost = useUiStore((s) => s.selectPost);
    // The post the Drafts panel is currently generating against — newest
    // when nothing is explicitly picked. Highlighting it makes the
    // implicit "we're drafting this one" state visible.
    const draftedTs = useMemo(() => {
        if (selectedPostTs) return selectedPostTs;
        return history.events
            .filter(
                (e) =>
                    e.event_type === "activity" &&
                    typeof e.description === "string" &&
                    e.description.trim().length > 0 &&
                    // Mirror the drafts.tsx filter: Emotions is not
                    // AI-drafted, so it shouldn't be the default
                    // "drafting" highlight.
                    e.activity_type !== "Emotions",
            )
            .sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0]
            ?.timestamp;
    }, [selectedPostTs, history.events]);

    // Compact-mode rows: most-recent non-page-visit events as narrative
    // one-liners. Identify the most-recent login so its row reads "Last
    // login" rather than the generic "Logged in".
    const compactRows = useMemo(() => {
        const sorted = [...history.events]
            .filter((e) => e.event_type !== "page_visit")
            .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
        const mostRecentLoginTs = sorted.find(
            (e) => e.event_type === "login",
        )?.timestamp;
        return sorted.slice(0, COMPACT_ROWS).map((e) => ({
            event: e,
            line: narrativeLine(
                e,
                e.event_type === "login" && e.timestamp === mostRecentLoginTs,
            ),
            when: relativeTime(new Date(e.timestamp), now),
        }));
    }, [history.events, now]);

    const { buckets, omitted } = useMemo(
        () => bucketEvents(history.events, now),
        [history.events, now],
    );

    if (compactRows.length === 0 && buckets.length === 0) {
        return (
            <div className="rounded-md border border-border bg-surface-2 px-3 py-6">
                <EmptyState
                    title="No platform activity yet"
                    description="When the participant logs in or posts, their activity will appear here."
                />
            </div>
        );
    }

    // Collapsed by default: the activity feed can carry participant
    // @-mentions / names in post + reply text, which facilitators shouldn't
    // see at a glance. A disclosure (matching the "Engagement signals"
    // pattern) keeps it one click away. The "Full history" toggle lives
    // inside, for when it's open.
    return (
        <details className="group">
            <summary className="flex cursor-pointer select-none items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted">
                Recent activity
                <span className="text-[10px] text-muted/70 group-open:hidden">
                    show
                </span>
                <span className="hidden text-[10px] text-muted/70 group-open:inline">
                    hide
                </span>
            </summary>
            <div className="mt-3">
            <div className="mb-2 flex justify-end">
                <button
                    type="button"
                    onClick={() => setExpanded((v) => !v)}
                    className="text-xs text-accent-ink hover:underline"
                >
                    {expanded ? "Show less" : "Full history →"}
                </button>
            </div>

            {!expanded ? (
                <ol className="divide-y divide-border rounded-md border border-border bg-surface-2">
                    {compactRows.map((r) => {
                        // Emotions is intentionally not in ActivityType
                        // (removed 2026-05-27 — no training pairs). The
                        // event still appears in the timeline as platform
                        // history, but the row is non-clickable since
                        // /generate would 422 for it.
                        const isEmotions =
                            r.event.event_type === "activity" &&
                            r.event.activity_type === "Emotions";
                        // Both structured activities and forum/discussion
                        // posts are draftable reply targets. Forum posts
                        // open the single-reply flow; activities open the
                        // persona flow (handled in drafts.tsx).
                        const isPost =
                            (r.event.event_type === "activity" ||
                                r.event.event_type === "discussion_post") &&
                            typeof r.event.description === "string" &&
                            r.event.description.trim().length > 0 &&
                            !isEmotions;
                        const isDrafted =
                            isPost && r.event.timestamp === draftedTs;
                        const content = (
                            <>
                                <span className="w-16 shrink-0 text-xs text-muted">
                                    {r.when}
                                </span>
                                <span className="min-w-0 flex-1 text-text-2">
                                    {r.line}
                                </span>
                                {isDrafted && (
                                    <span className="shrink-0 rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-medium text-accent-ink">
                                        drafting
                                    </span>
                                )}
                                {isEmotions && (
                                    <span
                                        className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-muted"
                                        title="Emotions posts are not AI-drafted. They call for a human reply."
                                    >
                                        no AI draft
                                    </span>
                                )}
                            </>
                        );
                        if (!isPost) {
                            return (
                                <li
                                    key={r.event.timestamp + r.event.event_type}
                                    className="flex items-start gap-3 px-3 py-2.5 text-sm"
                                >
                                    {content}
                                </li>
                            );
                        }
                        return (
                            <li
                                key={r.event.timestamp + r.event.event_type}
                                className={isDrafted ? "bg-accent/10" : ""}
                            >
                                <button
                                    type="button"
                                    onClick={() => selectPost(r.event.timestamp)}
                                    className="flex w-full items-start gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                    aria-current={isDrafted ? "true" : undefined}
                                    title="Draft a reply to this post"
                                >
                                    {content}
                                </button>
                            </li>
                        );
                    })}
                </ol>
            ) : (
                <ol className="space-y-3">
                    {buckets.map((b) => (
                        <li key={b.dayKey}>
                            <div className="mb-1.5 flex items-baseline gap-2">
                                <span className="text-xs font-semibold text-text-2">
                                    {b.label}
                                </span>
                            </div>
                            <ul className="space-y-1.5">
                                {b.events.map((e) => (
                                    <ExpandedEventRow
                                        key={e.timestamp + e.event_type}
                                        event={e}
                                        draftedTs={draftedTs}
                                        onSelect={selectPost}
                                    />
                                ))}
                                {/* Page reads collapse into a single row per
                                    day so they never crowd out posts. */}
                                {b.pageVisits.length > 0 && (
                                    <PagesRead visits={b.pageVisits} />
                                )}
                            </ul>
                        </li>
                    ))}
                    {omitted > 0 && (
                        <li className="pt-1 text-xs text-muted">
                            Showing the {MAX_EXPANDED} most recent events.{" "}
                            {omitted} earlier{" "}
                            {omitted === 1 ? "event" : "events"} not shown.
                        </li>
                    )}
                </ol>
            )}
            </div>
        </details>
    );
}
