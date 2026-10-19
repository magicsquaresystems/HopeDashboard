# 3. The dashboard (this repository)

The facilitator-facing Next.js application. It holds no models and no
participant database of its own: it reads cohort data from the Hope Move
platform (or from extracted files), calls the two model services through
server-side proxy routes, and keeps a small amount of shared triage state in
Firestore.

Stack: Next.js 16 (App Router, Turbopack), React 19, NextAuth v5 (beta.32),
TanStack Query 5, Zustand 5, Tailwind 4, Vitest 4. Node 22 in CI and on
Vercel.

> **Version floor.** Do not go below Next 16.2.7 / Tailwind 4.3.0. Earlier
> combinations had a Turbopack ↔ Tailwind bug that pinned RAM and disk at
> 100% on `npm run dev`.

---

## 3.1 Code map

```text
src/
  auth.ts                  NextAuth config: the two sign-in providers, token refresh
  proxy.ts                 Page-level sign-in gate (Next 16's name for middleware.ts)
  app/
    page.tsx               → redirect to /cohorts
    login/                 Explainer page shown when a sign-in failed (not a form)
    enter/route.ts         Hand-off sign-in door (/enter?token=…)
    auth/callback/route.ts Platform code-exchange sign-in door (/auth/callback?code=…)
    cohorts/page.tsx       Cohort picker
    cohorts/[cohortId]/    The working screen: queue.tsx · detail.tsx · drafts.tsx
    api/
      auth/[...nextauth]/  NextAuth's own routes (/api/auth/session, csrf, …)
      cohort-bundle/       GET the cohort's participant data (access-checked)
      queue-state/         GET/POST shared snooze / dismiss / contacted markers
      proxy/               Every call to a backend or to the platform — see §3.4
      debug/backends/      Session-gated deployment diagnostic — see 08-operations
  components/              Presentational components (ui/ holds unstyled primitives)
  lib/
    api/                   Typed clients: commentGen.ts, dropout.ts, hope.ts, client.ts
                           types.ts is GENERATED from comment_generation's OpenAPI spec
    auth/                  Hand-off tokens, platform exchange/refresh, session gate, HMAC signer
    server/                Server-only: data loading, access control, Firestore, Azure blob,
                           posting policy, queue-state drivers
    hooks/                 TanStack Query hooks — the only way components reach the server
    store/                 Zustand stores (UI state only, in memory)
    realCohort.ts          Bundle → model-request adapter (the prediction input contract)
    signals.ts, risk.ts    Engagement signals and risk-tier presentation
scripts/
  extract-iih-cohort.mjs   Builds cohort bundles. ALSO imported at runtime — see §3.3
  mint-handoff-token.mjs   Mints a local hand-off sign-in link
  smoke_e2e.sh / .py       End-to-end check against running backends
```

Conventions worth knowing before changing anything:

- **Panels own mutations; components stay presentational.** `drafts.tsx`
  calls the mutation hooks and passes callbacks into `draft-card.tsx`. To
  change what a draft action does, edit the panel; to change how it looks,
  edit the component.
- **Server-only modules guard themselves** (`import "server-only"` or a
  `typeof window` check). Anything holding a secret lives under
  `lib/server/` or `lib/auth/`.
- **Pure logic sits in its own module with a colocated `*.test.ts`** so it
  can be tested without mocks (`posting-policy.ts`, `hope-token.ts`,
  `queue-state-rows.ts`, `blob-url.ts`, …).
- **Errors that a route surfaces are `ApiError(status, detail, code)`**,
  rendered by `withApiErrors` (`src/app/api/proxy/_errors.ts`). The UI
  buckets on `code`, so keep codes stable.
- **Comments record the reason and the failure a line prevents.** Most
  non-obvious lines in this codebase have one; read it before "fixing"
  something that looks odd.

---

## 3.2 Sign-in and sessions

There is no email form and no password. Both ways in start on the Hope Move
platform.

| Door | Provider id | Used by | What the session carries |
| --- | --- | --- | --- |
| `/auth/callback?code=<one-time>[&cohortId=N]` | `hope-platform` | **Production** | Platform access + refresh token pair (inside the encrypted session JWT), `hopeUserId` |
| `/enter?token=<signed>[&cohortId=N]` | `platform-handoff` | Local development; legacy | An email only — no platform API credentials |

### Platform code exchange (production)

```text
Hope Move (staging.poweredbyh4c.org) → facilitator clicks the dashboard card
  → GET  https://facilitator.poweredbyh4c.org/auth/callback?code=<hex>
  → POST {HOPE_API_URL}/api/auth/exchange     headers X-Client-Id / X-Client-Secret, body {code}
  ← { accessToken, refreshToken, expiresIn, user:{userId, screenName, email} }   (PascalCase tolerated)
  → session cookie set; redirect to /cohorts[/<cohortId>]
```

- Code: `src/app/auth/callback/route.ts`, `src/lib/auth/hope-exchange.ts`,
  `src/lib/auth/hope-token.ts` (pure, heavily tested), `src/auth.ts`.
- Tokens live **only** in the JWE-encrypted, HttpOnly session cookie.
  `/api/auth/session` exposes `hopeUserId`, `hopeLinked` and `error`, never
  a token. Server code reads tokens through `lib/auth/hope-session.ts`.
- Access tokens are HS256 JWTs with a **15-minute** life. Refresh happens in
  the `jwt` callback 60 s before expiry; the platform **rotates** refresh
  tokens, so the new pair replaces the old one.
- A failed refresh keeps a still-valid access token and retries on the next
  request. Only when the token is actually past expiry is the pair dropped and
  `error = "hope_refresh_failed"` set, which `proxy.ts` turns into a redirect
  to `/login?error=session_expired`.
- Every server-to-server call sends `Accept-Language: en-GB`. Node's default
  (`*`) crashes the platform's .NET culture parsing with a 500.

### Hand-off token (local development)

`base64url(JSON{email, name?, exp}) + "." + base64url(HMAC-SHA256(HOPE_HANDOFF_SECRET, <that first part>))`,
`exp` at most 5 minutes ahead. Mint one with:

```bash
node scripts/mint-handoff-token.mjs you@example.org 1680
```

It reads `HOPE_HANDOFF_SECRET` (falling back to `AUTH_SECRET`) from
`.env.local` and prints a ready-to-open URL. A hand-off session cannot call
the platform API, so with `HOPE_API_URL` configured it sees no platform
cohorts; it is the normal way in when the platform integration is unset.

### Gates

- `src/proxy.ts` redirects any page request without a named session to
  `/login`. It **excludes `/api/*`, `/enter`, `/auth/callback` and `/login`**.
- API routes gate themselves with `requireFacilitatorEmail()`
  (`lib/auth/facilitator.ts` → `lib/auth/session-gate.ts`), which also
  refuses a session whose platform link has died. Returning a 401 JSON body
  rather than a redirect is deliberate: the UI turns it into a "go back to
  Hope" message.
- `AUTH_SECRET` is mandatory. Without it every `/api/auth/*` route returns 500
  and nobody can sign in. Quick check: `GET /api/auth/csrf` must return 200.

---

## 3.3 Where participant data comes from

`resolveCohortBundle(cohortId)` in `src/lib/server/cohort-data.ts` decides,
per request:

1. **Platform (production path).** If `HOPE_API_URL`/`HOPE_CLIENT_ID`/
   `HOPE_CLIENT_SECRET` are set, the session carries platform tokens, and the
   cohort is in the facilitator's platform cohort list, it fetches four
   documents in parallel with the facilitator's own bearer token:

   ```text
   GET {HOPE_API_URL}/api/dashboard/cohorts/{id}/user-activity
   GET {HOPE_API_URL}/api/dashboard/cohorts/{id}/user-profiles
   GET {HOPE_API_URL}/api/dashboard/cohorts/{id}/facilitator-comments
   GET {HOPE_API_URL}/api/dashboard/cohorts/{id}/discussion-topics
   ```

   and converts them with `buildCohortBundle` from
   `scripts/extract-iih-cohort.mjs` (`src/lib/server/sources/platform.ts`).
   **That script is runtime code**: the same function converts both live
   payloads and raw export files, so there is exactly one implementation of
   the mapping. Treat changes to it as application changes, with tests.
2. **Extracted file (fallback / research).** `local/<slug>.json`, for the
   three historical IIH cohorts only (1600, 1651, 1680 — the slug map is in
   `cohort-data.ts`). Used when the platform is not configured, the session
   is a hand-off, or the platform fetch throws (logged as
   `cohort N: platform fetch failed, falling back to the extracted file`).
   `local/` is gitignored, so **on Vercel this fallback has no files** and a
   failed platform fetch shows an empty "bundle missing" state.

The UI never sees platform JSON; it consumes the `CohortBundle` type defined
in `cohort-data.ts`. That type is the seam: adding fields is safe, removing or
retyping one needs a coordinated change.

Thread comments on a single activity are fetched lazily when a facilitator
opens that post:
`GET /api/dashboard/activities/{Gratitude|GoalSetting|MyHOPE|Post}/{recordId}/conversation`
(proxied by `/api/proxy/hope/conversation`).

Participant photos arrive as Azure Blob paths (`imgs/hope/<guid>/…`).
`/api/proxy/blob` checks that the exact path belongs to a participant in a
cohort the caller may open, then **302-redirects to a 5-minute read-only SAS
URL**. Image bytes never pass through the dashboard. Without
`AZURE_STORAGE_CONNECTION_STRING`/`AZURE_STORAGE_CONTAINER` the dashboard
shows initials instead. Stock avatars (`/assets/hope-v2/img/avatar/NN.png`
on the platform host) load directly.

---

## 3.4 Server routes

Every backend call goes through these routes; the browser never sees a URL
or a credential for a backend.

| Route | Gate | Calls | Notes |
| --- | --- | --- | --- |
| `GET /api/cohort-bundle?cohortId=` | session + cohort access | platform / file | The participant data for one cohort |
| `GET,POST /api/queue-state` | session + cohort access | Firestore | Shared snooze/dismiss/contacted markers (§3.6) |
| `POST /api/proxy/dropout/batch` | session | risk `/batch` | Whole-cohort scoring |
| `POST /api/proxy/dropout/predict` | session | risk `/predict` | One participant |
| `GET /api/proxy/dropout/model-info` | session | risk `/model/info` | Model chip |
| `POST /api/proxy/generate` | session + participant access | comment `/memory/batch` then `/generate` | `maxDuration = 300` s. Reconciles the participant's trusted platform posts into memory first, stamps `facilitator_id` from the session |
| `POST /api/proxy/text/polish` | session | comment `/text/polish` | Rephrase a facilitator's own text |
| `POST /api/proxy/copy` | session | comment `/copy` | Records clipboard adoption only |
| `POST /api/proxy/thumb` | session | comment `/thumb` | Up/down on a draft |
| `POST /api/proxy/event` | session | comment `/event` | Accept/edit/reject/flag research record; `facilitator_id` stamped server-side |
| `GET /api/proxy/memory/[participantId]` | session + cohort scope | comment `/memory/{id}` | Read-only |
| `GET /api/proxy/comment-gen/status` | session | comment `/version` + `/health` | Which adapter is configured, whether loaded. **Wakes the GPU Space** |
| `GET /api/proxy/hope/conversation` | session + cohort access | platform | Existing comments on one activity |
| `POST /api/proxy/hope/comment` | session + posting policy + cohort access | platform `POST /api/dashboard/comment` | **The only route that writes something a participant reads** (§3.5) |
| `GET /api/proxy/blob` | session + image ownership | — (redirect to Azure) | §3.3 |
| `GET /api/debug/backends` | session (404 otherwise) | both `/health` | Deployment diagnostic, see [08-operations](08-operations-runbook.md) |

How the server authenticates to each backend (`src/lib/api/server.ts`):

- **Comment service:** `Authorization: Bearer $HF_TOKEN` (private-Space
  gateway) + `X-HMAC-Signature` = hex HMAC-SHA256 of the exact request body
  with `HOPE_API_SECRET` (signed in `lib/auth/sign.ts`; skipped when
  `HOPE_API_AUTH=disabled`).
- **Risk service:** `Authorization: Bearer $HF_TOKEN` + `X-API-Key: $HOPE_RISK_API_KEY`.
- **Platform:** `Authorization: Bearer <facilitator's access token>`.

`COMMENT_GEN_URL` and `DROPOUT_API_URL` have **no default**. A missing one
returns 503 `backend_not_configured` for that service only.

---

## 3.5 The reply workflow

What happens when a facilitator works a participant:

1. **Score.** The queue builds one `ParticipantHistory` per participant
   (`bundleToHistory` in `realCohort.ts`) and calls `/dropout/batch`. Results
   are cached client-side for a day, keyed on the actual request inputs.
2. **Draft.** "Generate drafts" calls `/api/proxy/generate`. Activity posts
   get 2–3 persona drafts (Gratitude gets 2), forum posts get 1. Each draft
   carries a grounding verdict (whether it was checked against the post).
3. **Use a draft.** Two separate actions, deliberately not conflated
   (`src/lib/draft-recording.ts`):
   - **Copy** calls `/copy` only. It measures clipboard adoption and does
     **not** mark anyone contacted or write memory.
   - **Send to Hope** (only when posting is enabled for the cohort) asks for
     confirmation, calls `/api/proxy/hope/comment`, and requires the route to
     answer `{status: "published"}` or `{status: "dry_run"}`. Only after a
     confirmed `published` does it record `/event` (with the final edited
     text and `delivery_confirmed: true`) and write the shared "contacted"
     marker. A failed or unconfirmed send records nothing.
   - Editing or polishing a draft resets its grounding verdict to
     "unchecked".

### Posting policy — three switches, all in env

`src/lib/server/posting-policy.ts`:

| Variable | Effect |
| --- | --- |
| `HOPE_ENABLE_POST_COMMENT=1` | This deployment may post at all. Anything other than exactly `1` → route answers 503 `posting_disabled` and the Send button is hidden |
| `HOPE_POST_COMMENT_COHORTS` | **Required** when enabled. Comma-separated cohort ids or (preferred) codes. Empty refuses every cohort; `*` opens all and is the deliberate go-live act |
| `HOPE_POST_COMMENT_DRY_RUN=1` | Run every gate, build the real payload, log it, return `dry_run` without calling the platform |

Being assigned to a cohort is not permission to post into it: the shared
support facilitator account is assigned to ~25 cohorts, most of them live.
The safe test cohort is **`MICHAEL-TEST-210826` (id 1743)**, see
[02-environments](02-environments.md#26-test-cohort).

The wire format is a PascalCase JSON body
`{CohortId, ActivityType, RecordId, Comment}` (the platform changed contract
on 2026-08-24; the earlier query-string form is history). `ActivityType` is
one of `Gratitude | GoalSetting | MyHOPE | Post`; `Emotions` has no
platform equivalent and is refused. Comments over 1,000 characters are
refused.

---

## 3.6 Shared triage state (Firestore)

Snooze, dismiss and "contacted by" markers are shared so two facilitators on
one cohort do not message the same person twice.

- Driver selection (`src/lib/server/queue-state.ts`): **Firestore** when
  `FIREBASE_SERVICE_ACCOUNT` (or `FIRESTORE_EMULATOR_HOST`) is set,
  otherwise **JSON files** under `local/state/` — a local-development
  convenience that cannot work on Vercel (read-only filesystem → 503
  `queue_state_not_configured`).
- Document path: `queue_state/{cohortId}/markers/{encodeURIComponent(participantId)}:{kind}`,
  `kind ∈ snooze | dismiss | contact`. Fields: `cohortId, participantId,
  kind, byEmail, atMs, untilMs, action`. Every operation is one addressed
  write or delete (last write wins), so concurrent serverless instances
  cannot lose each other's updates.
- The client polls every 30 s **only while the tab is visible**, and stops
  polling on errors that cannot fix themselves.

Project details, quotas and backups are in
[06-data-and-storage](06-data-and-storage.md#62-firestore).

---

## 3.7 Cohort visibility and access control

`src/lib/server/assignments.ts`, `src/lib/server/hope-cohorts.ts`,
`src/lib/server/participant-access.ts`.

| Situation | Cohorts a facilitator sees |
| --- | --- |
| Platform configured, session linked | Exactly what `GET /api/dashboard/cohorts` returns for their token (scoped by the platform to their assignments; cached 60 s per user) |
| Platform configured, link broken | **None** (fails closed) |
| Platform configured, platform errors | Last cached list, else none (an outage never widens access) |
| No platform (hand-off / local) | `FACILITATOR_COHORTS` JSON if it names the email; else all (`AUTH_MODE=open`) or none (`AUTH_MODE=allowlist`) |

The platform only ever returns **Active** cohorts. Archived cohorts never
appear, by platform design; testing needs an Active cohort.

Enforcement is server-side on every data route: cohort access before reading
any record, participant membership for `/generate`, and exact-path ownership
for images. Hiding a card in the UI is not the control.

---

## 3.8 Scoring weeks and the prediction input contract

Three independent limits decide which weeks can be scored:

1. **Programme shape**: from cohort metadata (`programmeLengthDays`, a
   multiple of 7; platform `startDate`/`endDate` rounded to whole weeks, 42
   assumed and flagged when `endDate` is missing).
2. **Elapsed data**: week N needs 7N days of that participant's history.
3. **Trained horizons**: models exist for days 7–56. Beyond 56 the risk
   service anchors to day 56 and says so (`horizon_used`, `anchored_to_days`);
   the UI shows an "anchored" notice.

The release candidate on branch `fix/training-inputs-and-reply-workflow-20261016`
(not yet on `main`, see [02-environments](02-environments.md#25-release-state))
aligns the request inputs with how the frozen models were trained:

- each participant's clock starts at their **recorded enrolment start**, else
  the earliest recorded start in the full cohort (not the published cohort
  start);
- `cohort_size` counts **all enrolments started by the focal start + horizon**,
  staff included (`predictionRoster`, contract `all_enrolments_v1`), while
  staff stay out of the visible queue;
- a score is withheld until that participant's complete window has elapsed;
- **legacy bundles without `recordedStartedAt`/`predictionRoster` remain
  viewable but unscored** until re-extracted.

This was checked on 2026-10-16 against the live predictor, replaying 216
historical participants at day 7 and day 42. The corrected inputs gave the
same probabilities and tiers as an independent reimplementation of the
training rules. The inputs on `main` changed 14 and 10 tiers respectively.
It was a check that the inputs match training, not a new model evaluation,
and nothing about the model itself changed. If the intended clock, target or
features ever change, that is a new model version and needs retraining and a
new evaluation.

---

## 3.9 Client state

TanStack Query holds all server data (hooks in `src/lib/hooks/`). Zustand
stores in `src/lib/store/` hold UI state only and are in memory:
`uiStore` (selection), `scoringStore` (selected week), `notesStore` (local
notes, never persisted), `sessionStatsStore` (topbar counter),
`noticeStore`, `queueLayoutStore`. `CohortSessionReset` clears
participant-keyed state when the cohort changes, since participant ids can
repeat across cohorts.
