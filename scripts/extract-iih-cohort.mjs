#!/usr/bin/env node
/**
 * One-off: extract a small, demo-friendly cohort bundle from the Hope
 * Move platform JSON exports in engagement_ml/data/.
 *
 *   node scripts/extract-iih-cohort.mjs
 *
 * Writes `local/iih-coh12-110226.json` — gitignored. Dashboard reads it
 * at runtime via `src/lib/server/cohort-data.ts` and falls back to
 * synthetic data when the file is absent.
 *
 * Picks 6 participants from cohort 1680 (IIH-COH12-110226) covering the
 * engagement spectrum: top-2 by activity count (richer memory demos),
 * middle-2 (typical), bottom-2 (silent/late starters — the high-risk
 * cases the model flags).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const RAW_ROOT = path.resolve(REPO_ROOT, "..", "comment_generation", "data");
// engagement_ml's copy of the platform export additionally carries
// `questionnaireResults` (SWEMWBS wellbeing scores) per user — absent from
// comment_generation's copies. Audited 2026-08-06: for every registry
// cohort the two exports are otherwise byte-identical on events (same user
// ids, same activity/login/pageVisit/bookmark ids and counts) — this is
// the same platform export, not a divergent one, so preferring it loses
// nothing and gains the questionnaire data.
const ENGAGEMENT_RAW_ROOT = path.resolve(REPO_ROOT, "..", "engagement_ml", "data");

// Per-cohort metadata for the IIH course (module 337). Every cohort in
// this table is bundle-extractable from `UserActivity (2).txt`. Add a
// new cohort by appending here and the dashboard's cohort index will
// pick it up automatically.
const COHORT_REGISTRY = {
    1600: {
        code: "IIH-COH10-190325",
        effectiveStart: "2025-03-19T00:00:00Z",
        programmeLengthDays: 42,
        bundleSlug: "iih-coh10-190325",
    },
    1651: {
        code: "IIH-COH11-170925",
        effectiveStart: "2025-09-17T00:00:00Z",
        programmeLengthDays: 42,
        bundleSlug: "iih-coh11-170925",
    },
    1680: {
        code: "IIH-COH12-110226",
        effectiveStart: "2026-02-11T00:00:00Z",
        programmeLengthDays: 42,
        bundleSlug: "iih-coh12-110226",
    },
};

// CLI: `node scripts/extract-iih-cohort.mjs [cohortId|all]`. Default is
// COH12 (the demo cohort we ship in-tree). Pass `all` to extract every
// cohort in COHORT_REGISTRY in one pass.
function parseCohortIds() {
    const arg = (process.argv[2] || "1680").toString();
    if (arg === "all") return Object.keys(COHORT_REGISTRY).map(Number);
    const id = Number(arg);
    if (!COHORT_REGISTRY[id]) {
        throw new Error(
            `Unknown cohort ${arg}; known: ${Object.keys(COHORT_REGISTRY).join(", ")}, or 'all'.`,
        );
    }
    return [id];
}

const OUTPUT_DIR = path.join(REPO_ROOT, "local");

function loadJson(name, root = RAW_ROOT) {
    const p = path.join(root, name);
    if (!fs.existsSync(p)) {
        throw new Error(`Missing source file: ${p}`);
    }
    console.log(`reading ${p} (${(fs.statSync(p).size / 1_048_576).toFixed(1)} MB)…`);
    return JSON.parse(fs.readFileSync(p, "utf8"));
}

/**
 * Load the richest available activity export. Prefers engagement_ml's
 * `UserActivity_120526.txt` (carries `questionnaireResults`); falls back to
 * comment_generation's `UserActivity (2).txt` when only that sibling repo
 * is checked out, so the script still runs for a comment_generation-only
 * checkout. Either way the underlying event data is the same platform
 * export — see the ENGAGEMENT_RAW_ROOT comment above.
 */
function loadUserActivity() {
    const preferred = path.join(ENGAGEMENT_RAW_ROOT, "UserActivity_120526.txt");
    if (fs.existsSync(preferred)) {
        return loadJson("UserActivity_120526.txt", ENGAGEMENT_RAW_ROOT);
    }
    console.warn(
        "  (engagement_ml/data/UserActivity_120526.txt not found — " +
            "falling back to comment_generation's copy, no wellbeing scores)",
    );
    return loadJson("UserActivity (2).txt");
}

function findCohort(doc, targetCohortId) {
    for (const m of doc.modules ?? []) {
        for (const c of m.cohorts ?? []) {
            if (c.id === targetCohortId) {
                return { module: m, cohort: c };
            }
        }
    }
    return null;
}

function extractUsers(ua, targetCohortId) {
    const hit = findCohort(ua, targetCohortId);
    if (!hit) {
        throw new Error(`Cohort ${targetCohortId} not found in UserActivity`);
    }
    const { module, cohort } = hit;
    return (cohort.users ?? []).map((u) => ({
        userId: u.userId,
        moduleId: module.id,
        moduleName: module.name,
        cohortId: cohort.id,
        cohortName: cohort.name,
        started: u.started ?? null,
        finished: u.finished ?? null,
        activities: u.activities ?? [],
        logins: u.logins ?? [],
        pageVisits: u.pageVisits ?? [],
        bookmarks: u.bookmarks ?? [],
        questionnaireResults: u.questionnaireResults ?? [],
    }));
}

/**
 * Profiles keyed by userId across EVERY module, not just the cohort's own.
 *
 * That breadth matters: `UserProfile (1).txt` has no module 337, so an IIH
 * participant only has a profile if they were on an earlier programme too.
 * A handful are (1 in COH10, 4 in COH11, 0 in COH12) — keying globally is
 * what surfaces them at all. `interview.items` is the self-authored
 * "get to know me" Q&A and is the best profile content the platform has;
 * it was previously read and discarded.
 */
export function buildProfileLookup(up) {
    const out = new Map();
    for (const m of up.modules ?? []) {
        for (const profile of m.userProfiles ?? []) {
            const items = (profile.interview?.items ?? [])
                .filter(
                    (it) =>
                        (it?.question ?? "").trim() &&
                        (it?.answer ?? "").trim(),
                )
                .map((it) => ({
                    question: it.question.trim(),
                    answer: it.answer.trim(),
                }));
            out.set(profile.userId, {
                bio: profile.bio ?? "",
                firstName: profile.firstName ?? null,
                lastName: profile.lastName ?? null,
                interview: items,
            });
        }
    }
    return out;
}

function extractFacilitatorReplies(fc, userIds) {
    const wanted = new Set(userIds);
    const out = new Map();
    for (const m of fc.modules ?? []) {
        for (const ua of m.userActivities ?? []) {
            if (!wanted.has(ua.userId)) continue;
            // Skip facilitator replies anchored to Emotions activities —
            // those parent activities are dropped from the bundle (see
            // main()), so the reply would orphan in the timeline.
            if (ua.typeName === "Emotions") continue;
            for (const fcEntry of ua.facilitatorComments ?? []) {
                if (!out.has(ua.userId)) out.set(ua.userId, []);
                out.get(ua.userId).push({
                    activityId: ua.id,
                    activityType: ua.typeName,
                    text: fcEntry.comment ?? "",
                    recordedAt: fcEntry.recorded
                        ? normaliseTimestamp(fcEntry.recorded)
                        : null,
                });
            }
        }
    }
    return out;
}

function picks0Module(users) {
    return users[0]?.moduleId ?? null;
}

/**
 * Set of facilitator user ids, derived from FacilitatorComments.txt.
 * Each `facilitatorComments[].userId` is the FACILITATOR who authored
 * that reply (confirmed against the raw export — e.g. uid 6785, 1238).
 * We use this to label authorship in forum threads: a DiscussionTopics
 * reply whose `userId` is in this set is a facilitator post, otherwise
 * a participant post. This is the authoritative signal (low-vs-high
 * user-id heuristics are unreliable).
 */
export function buildFacilitatorIdSet(fc) {
    const ids = new Set();
    for (const m of fc.modules ?? []) {
        for (const ua of m.userActivities ?? []) {
            for (const c of ua.facilitatorComments ?? []) {
                if (c.userId != null) ids.add(c.userId);
            }
        }
    }
    return ids;
}

/**
 * Reconstruct forum threads for a module from DiscussionTopics.txt.
 *
 * Forum topics are MODULE-level (shared by every cohort of the module),
 * so replies come from many cohorts + facilitators. We:
 *   - order each topic's replies chronologically,
 *   - label each reply's author role (facilitator vs participant) via
 *     the facilitator-id set,
 *   - alias the author: the focal cohort's own members get their bundle
 *     alias (P26 etc.); facilitators show as "Facilitator"; everyone
 *     else (other cohorts) shows as "A participant" — never invent an
 *     alias for a non-cohort author or we'd risk cross-cohort identity
 *     leakage.
 *
 * Returns:
 *   - eventsByUser: Map<uid, discussion_post event[]> for THIS cohort's
 *     participants only (these become timeline events).
 *   - threads: { [topicId]: { title, replies: [{alias, role, text,
 *     recordedAt}] } } — only topics with >=1 reply from this cohort,
 *     carrying the FULL ordered thread (all authors) for reply context.
 */
function extractModuleDiscussions(dt, moduleId, cohortUserIds, uidToAlias, facilitatorIds) {
    const eventsByUser = new Map();
    // Annotated because the dashboard imports this module and TypeScript
    // infers a bare `{}` from the literal, which does not satisfy
    // `CohortBundle.discussionThreads`. The annotation states what the
    // loop below actually fills it with.
    /** @type {Record<string, import("../src/lib/server/cohort-data").RealDiscussionThread>} */
    const threads = {};
    const mod = (dt.modules ?? []).find((m) => m.id === moduleId);
    if (!mod) return { eventsByUser, threads };

    for (const topic of mod.topics ?? []) {
        const replies = [...(topic.replies ?? [])]
            .filter((r) => r.recorded && (r.comment ?? "").trim())
            .sort((a, b) => String(a.recorded).localeCompare(String(b.recorded)));
        if (replies.length === 0) continue;

        let cohortAuthored = false;
        const threadReplies = replies.map((r) => {
            const isFacilitator = facilitatorIds.has(r.userId);
            const isCohortMember = cohortUserIds.has(r.userId);
            if (isCohortMember) cohortAuthored = true;
            const alias = isFacilitator
                ? "Facilitator"
                : isCohortMember
                  ? uidToAlias.get(r.userId)
                  : "A participant";
            const text = (r.comment ?? "").trim();
            const recordedAt = normaliseTimestamp(r.recorded);

            // Emit a timeline event for the focal cohort's own posts.
            if (isCohortMember && !isFacilitator) {
                if (!eventsByUser.has(r.userId)) eventsByUser.set(r.userId, []);
                eventsByUser.get(r.userId).push({
                    timestamp: recordedAt,
                    event_type: "discussion_post",
                    activity_type: "Discussion",
                    topicId: topic.id,
                    description: text,
                    words_written: text.split(/\s+/).length,
                });
            }
            return { alias, role: isFacilitator ? "facilitator" : "participant", text, recordedAt };
        });

        // Only keep threads this cohort actually participated in — keeps
        // the bundle lean and avoids shipping unrelated topics.
        if (cohortAuthored) {
            threads[topic.id] = {
                title: topic.pageTitle ?? `Topic ${topic.id}`,
                replies: threadReplies,
            };
        }
    }
    return { eventsByUser, threads };
}

/**
 * All cohort learners, ranked by activity count (descending) so the
 * heaviest-engagement participants appear first in the bundle order.
 * The queue panel re-ranks by risk at render time; this ordering is
 * just a stable initial sort.
 *
 * Previously this picked a 6-person representative slice (top-2 /
 * mid-2 / bot-2) to keep the demo bundle tractable. With pagination
 * in the queue we surface the full cohort — facilitators get a real
 * triage experience.
 */
function pickRepresentative(users) {
    return users
        .map((u) => ({ ...u, activityCount: u.activities.length }))
        .sort((a, b) => b.activityCount - a.activityCount);
}

function shortBio(profile, fallback) {
    const bio = (profile?.bio ?? "").trim();
    if (bio) return bio.length > 320 ? bio.slice(0, 317) + "…" : bio;
    return fallback;
}

/**
 * Platform exports use local datetime strings without a `Z` suffix
 * (e.g. "2026-02-12T07:09:08.477"). engagement_ml's Pydantic model
 * requires ISO-8601 with an explicit UTC designator. Append `Z` when one
 * isn't already present; preserves already-tz-aware values untouched.
 */
function normaliseTimestamp(ts) {
    if (!ts) return ts;
    // already has tz designator (`Z` or `+HH:MM` / `-HH:MM`)?
    if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(ts)) return ts;
    return ts + "Z";
}

function eventFromActivity(a) {
    return {
        timestamp: normaliseTimestamp(a.recorded),
        event_type: "activity",
        activity_type: a.typeName,
        words_written: a.description ? a.description.split(/\s+/).length : 0,
        description: a.description ?? null,
        // Platform activity id. Two consumers: comment-gen's memory store
        // dedupes participant posts on `activity_id` (memory_store.py), and
        // `priorFacilitatorReplies[].activityId` can be joined back to the
        // exact post the facilitator replied to.
        activity_id: a.id,
    };
}


/**
 * The four platform documents in, one `CohortBundle` out.
 *
 * Exported and free of file IO on purpose. The Hope Move platform now
 * serves these same four documents over HTTP — one cohort inside an
 * array of one module — so the dashboard calls this at request time with
 * fetched payloads while this script still calls it with parsed files.
 * One implementation, so the live path cannot drift from the one whose
 * output was reviewed.
 *
 * `meta` supplies what the documents do not carry: the cohort's code,
 * start date and programme length. The CLI reads it from
 * `COHORT_REGISTRY`; the dashboard takes it from
 * `GET /api/dashboard/cohorts`.
 */
export function buildCohortBundle(
    ua,
    up,
    fc,
    dt,
    facilitatorIds,
    profileBy,
    modulesInProfile,
    cohortId,
    meta,
) {
    const users = extractUsers(ua, cohortId);

    if (!modulesInProfile.has(picks0Module(users))) {
        console.warn(
            `⚠  UserProfile (1).txt does not include module ${picks0Module(users)} — ` +
            `bios will fall back to a generic placeholder.`,
        );
    }
    const picks = pickRepresentative(users);
    const moduleId = picks0Module(users);

    const facilitatorByUser = extractFacilitatorReplies(
        fc,
        picks.map((u) => u.userId),
    );

    // Forum threads (module-level). uidToAlias maps this cohort's user
    // ids to their bundle alias (P1..Pn in picks order) so thread views
    // label the focal participant's own posts with their alias.
    const uidToAlias = new Map(picks.map((u, i) => [u.userId, `P${i + 1}`]));
    const cohortUserIds = new Set(picks.map((u) => u.userId));
    const { eventsByUser: discussionEventsByUser, threads: discussionThreads } =
        extractModuleDiscussions(
            dt,
            moduleId,
            cohortUserIds,
            uidToAlias,
            facilitatorIds,
        );

    const participants = picks.map((u, i) => {
        const profile = profileBy.get(u.userId);

        // Combine activities, logins, page-visits, bookmarks into a unified
        // event stream — engagement_ml's risk model uses all of these.
        // Facilitator-comment events are derived from FacilitatorComments.txt
        // so they appear in the participant's timeline (the activity export
        // doesn't always inline them for older comments).
        const events = [];
        for (const a of u.activities ?? []) {
            if (!a.recorded) continue;
            // Emotions activities (tag selections like
            // "Scared;Irritable;Determined") ARE kept. An earlier revision
            // dropped them because comment-gen rejects them as draft
            // targets (no training pairs — RETRAIN.md §1.2), but that
            // conflated two consumers: the risk model has Emotions-specific
            // features (`has_emotions_to_horizon`,
            // `n_distinct_emotion_tags` — engagement_ml feature_builder §5
            // and §6) and dropping the rows silently under-fed /predict.
            // The UI already handles them: drafts.tsx and the timeline
            // filter Emotions out of draft targets and badge them
            // "no AI draft".
            events.push(eventFromActivity(a));
        }
        for (const l of u.logins ?? []) {
            // Platform schema uses `signedIn` for the login timestamp.
            const ts = l.signedIn ?? l.loggedIn ?? l.recorded ?? l.timestamp;
            if (!ts) continue;
            events.push({ timestamp: normaliseTimestamp(ts), event_type: "login" });
        }
        for (const v of u.pageVisits ?? []) {
            // pageVisits are rollups (one row per URL with `hits` count and
            // `latest` timestamp). Emit one `page_visit` event at `latest`.
            //
            // engagement_ml's feature builder only needs the timestamp, but
            // the dashboard timeline shows *what* was read — "Being
            // self-compassionate ×3" is a far better follow-up cue than
            // "viewed 12 pages". Carry the title/url/hits through; the risk
            // service ignores unknown event fields (page visits feed no
            // feature), same as `topicId` on discussion posts.
            const ts = v.latest ?? v.recorded ?? v.timestamp;
            if (!ts) continue;
            const pageTitle = (v.pageTitle ?? "").trim();
            events.push({
                timestamp: normaliseTimestamp(ts),
                event_type: "page_visit",
                ...(pageTitle ? { page_title: pageTitle } : {}),
                ...(v.url ? { page_url: v.url } : {}),
                ...(Number.isFinite(v.hits) && v.hits > 0
                    ? { hits: v.hits }
                    : {}),
                // Per-URL average dwell from the platform rollup. Carried
                // as an opaque number: the export doesn't document the
                // unit (values run 4..46472 — likely ms, unconfirmed), so
                // the UI must not render it as a duration until the
                // platform confirms. Preserved so we don't have to
                // re-extract when they do.
                ...(Number.isFinite(v.avgDuration)
                    ? { avg_duration: v.avgDuration }
                    : {}),
            });
        }
        for (const b of u.bookmarks ?? []) {
            // Platform schema stores the bookmark timestamp under
            // `bookmarked` (not `recorded`). The earlier `b.recorded ?? b.timestamp`
            // probe always missed and silently dropped every bookmark —
            // the IIH cohort lost 245 bookmark events that way. Probe
            // the canonical field first, keep the legacy fallbacks for
            // safety in case the export shape ever changes.
            const ts = b.bookmarked ?? b.recorded ?? b.timestamp;
            if (!ts) continue;
            // Bookmarks name what was saved (url + pageTitle, 100% filled
            // in the export). "Bookmarked: Activity: Thought leaves" is a
            // follow-up cue; a bare "Bookmarked content" row is not.
            const bTitle = (b.pageTitle ?? "").trim();
            events.push({
                timestamp: normaliseTimestamp(ts),
                event_type: "bookmark",
                ...(bTitle ? { page_title: bTitle } : {}),
                ...(b.url ? { page_url: b.url } : {}),
            });
        }
        // Discussion / forum posts come from the module-level
        // DiscussionTopics.txt (not the per-user activity record), so
        // they're prepared up front in `discussionEventsByUser` and just
        // attached here. Each carries its `topicId` so the dashboard can
        // pull the full thread for context when drafting a reply.
        for (const de of discussionEventsByUser.get(u.userId) ?? []) {
            events.push(de);
        }
        for (const fc of facilitatorByUser.get(u.userId) ?? []) {
            if (!fc.recordedAt) continue;
            events.push({
                timestamp: normaliseTimestamp(fc.recordedAt),
                event_type: "facilitator_comment",
                description: fc.text,
            });
        }
        events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

        // SWEMWBS (Short Warwick-Edinburgh Mental Well-being Scale) results,
        // when the source export carries `questionnaireResults` (only
        // engagement_ml's UserActivity_120526.txt does — see
        // loadUserActivity()). `metricTotalScore` is the calibrated 7-35
        // scale value; `rawTotalScore` is the unweighted sum of the 7 items.
        // Chronological so the dashboard can show a trend, not just a
        // latest value.
        const wellbeing = [...(u.questionnaireResults ?? [])]
            .filter((q) => q.finished && q.metricTotalScore != null)
            .map((q) => ({
                recordedAt: normaliseTimestamp(q.finished),
                format: q.format ?? "SWEMWBS",
                rawScore: q.rawTotalScore ?? null,
                metricScore: q.metricTotalScore,
            }))
            .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));

        return {
            participant_id: String(u.userId),
            displayName: `P${i + 1}`,
            bio: shortBio(
                profile,
                `Joined ${meta.code}. No profile bio submitted yet.`,
            ),
            firstName: profile?.firstName ?? null,
            // Self-authored profile Q&A. Empty for most IIH participants
            // (their module has no profile export) — the dashboard treats
            // absence as normal, not as an error.
            interview: profile?.interview ?? [],
            startedAt: normaliseTimestamp(u.started ?? meta.effectiveStart),
            finishedAt: u.finished ? normaliseTimestamp(u.finished) : null,
            events,
            priorFacilitatorReplies: facilitatorByUser.get(u.userId) ?? [],
            // Counted from `events` so the displayed activityCount always
            // matches what actually ships in the bundle (now including
            // Emotions).
            activityCount: events.filter((e) => e.event_type === "activity").length,
            wellbeing,
        };
    });

    return {
        cohort: {
            id: cohortId,
            code: meta.code,
            moduleId: picks[0].moduleId,
            moduleName: picks[0].moduleName,
            effectiveStart: meta.effectiveStart,
            programmeLengthDays: meta.programmeLengthDays,
        },
        participants,
        // Forum threads this cohort took part in, keyed by topic id.
        // Each holds the full ordered back-and-forth (all authors,
        // aliased) so the dashboard can show the thread + feed it to the
        // model as reply context. Empty {} when the cohort has no forum
        // activity.
        discussionThreads,
    };
}

/** CLI wrapper: build the bundle, write it, report what went in. */
function extractOne(ua, up, fc, dt, facilitatorIds, profileBy, modulesInProfile, cohortId) {
    const meta = COHORT_REGISTRY[cohortId];
    const out = buildCohortBundle(
        ua,
        up,
        fc,
        dt,
        facilitatorIds,
        profileBy,
        modulesInProfile,
        cohortId,
        meta,
    );
    const { participants, discussionThreads } = out;
    console.log(
        `\ncohort ${meta.code} (id=${cohortId}): ${participants.length} learners`,
    );

    const outputPath = path.join(OUTPUT_DIR, `${meta.bundleSlug}.json`);
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(out, null, 2));
    const sizeKb = (fs.statSync(outputPath).size / 1024).toFixed(1);
    console.log(`wrote ${outputPath} (${sizeKb} KB)`);

    const totals = { activity: 0, login: 0, page_visit: 0, facilitator_comment: 0, bookmark: 0, discussion_post: 0 };
    for (const p of participants) {
        for (const e of p.events) {
            totals[e.event_type] = (totals[e.event_type] ?? 0) + 1;
        }
    }
    console.log(`  totals: ${participants.length} participants`);
    console.log(`  events: ${Object.entries(totals).map(([k, v]) => `${k.slice(0, 4)}:${v}`).join(" ")}`);
    console.log(`  forum threads: ${Object.keys(discussionThreads).length}`);
    const wellbeingN = participants.filter((p) => p.wellbeing.length > 0).length;
    console.log(`  wellbeing (SWEMWBS): ${wellbeingN}/${participants.length} participants have >=1 result`);
    const bioN = participants.filter(
        (p) => !p.bio.includes("No profile bio submitted yet"),
    ).length;
    const intN = participants.filter((p) => p.interview.length > 0).length;
    console.log(`  profiles: ${bioN} bio, ${intN} interview Q&A (module ${out.cohort.moduleId} has no profile export — only participants from earlier programmes have one)`);
}


function main() {
    // See loadUserActivity(): prefers engagement_ml's export (adds
    // wellbeing questionnaire results), falls back to comment_generation's
    // "UserActivity (2).txt" — both are the same May-2026 platform export,
    // the first to include module 337 (IIH 2025) where the IIH cohorts
    // live. The older "UserActivity (1).txt" stops at module 332 and also
    // mixes in facilitator-account logins — do not use it as a source.
    const ua = loadUserActivity();
    const up = loadJson("UserProfile (1).txt");
    const fc = loadJson("FacilitatorComments.txt");
    // Module-level forum threads. discussions.csv is derived from this
    // same file; we read the JSON directly to keep one source of truth.
    const dt = loadJson("DiscussionTopics.txt");

    const profileBy = buildProfileLookup(up);
    const modulesInProfile = new Set();
    for (const m of up.modules ?? []) modulesInProfile.add(m.id);
    const facilitatorIds = buildFacilitatorIdSet(fc);
    console.log(`facilitator ids: ${facilitatorIds.size}`);

    const cohortIds = parseCohortIds();
    for (const cid of cohortIds) {
        extractOne(ua, up, fc, dt, facilitatorIds, profileBy, modulesInProfile, cid);
    }
}

// Only when run directly. The dashboard imports `buildCohortBundle` from
// this module at request time, and an import that also ran the CLI would
// try to read 66 MB of local exports on a server that has none.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
    main();
}
