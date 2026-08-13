# Hope Facilitator System — architecture & API reference

This doc is the "how the pieces fit together" map for the Hope facilitator-assist system. It complements [INTEGRATION.md](INTEGRATION.md) (platform integration recipe) and [OPERATIONS.md](OPERATIONS.md) (deploy + models + runbook) — read those for the *what to call when* and *how to deploy*. This doc is the *why it is shaped this way*.

---

## 1. System overview

Three services, no shared database, no synchronous chain:

```
┌─────────────────────────┐
│  Hope Move platform     │  ← cohorts, posts, replies, participant profile (Source of Truth)
└────────────┬────────────┘
             │  webhook / cron
             ▼
┌─────────────────────────┐    ┌───────────────────────────┐
│  hope-dashboard         │───▶│  comment_generation       │  Qwen3.5-4B + DoRA (HF Space)
│  (Next.js 16, Vercel)   │    │  FastAPI / port 8001      │  → drafts + memory + HITL
│                         │    └───────────────────────────┘
│  Server proxy layer     │    ┌───────────────────────────┐
│  signs HMAC, forwards   │───▶│  engagement_ml            │  LightGBM @ T∈{7,14,21,28,35,42,49,56}
│  HF_TOKEN, hides keys   │    │  FastAPI / port 8000      │  → dropout risk + SHAP factors
└─────────────────────────┘    └───────────────────────────┘
```

**Why three services, not one.** Each owns a different lifecycle:

- `engagement_ml` is read-heavy stateless inference (LightGBM pickle, no writes).
- `comment_generation` is read+write — drafts are inference, but the memory store and HITL log are persistent.
- `hope-dashboard` is the only UI surface — facilitators interact here; it never serves to the public Hope Move platform.

Splitting them means we scale and deploy each on its own cadence. The dashboard can be redeployed without restarting the GPU Space; the served adapter can be changed (an env change + Space restart) without touching the dropout models.

---

## 2. The dashboard (Next.js)

### 2.1 Routes

| Route | Source | Renders |
| --- | --- | --- |
| `/` | `src/app/page.tsx` | redirect to `/cohorts` |
| `/cohorts` | `src/app/cohorts/page.tsx` | cohort list (one card per `CohortMeta` in [src/lib/cohorts.ts](../src/lib/cohorts.ts)) |
| `/cohorts/[cohortId]` | `src/app/cohorts/[cohortId]/page.tsx` (server) | 3-column dashboard: Queue • Detail • Drafts |
| `/api/proxy/*` | `src/app/api/proxy/**/route.ts` | server-side proxies that sign + forward to backend services |
| `/api/auth/*` | NextAuth v5 | platform hand-off Credentials provider — sign-in is hand-off-token only |

The cohort page is a **Server Component**. The three columns (Queue, Detail, Drafts) are client components reading from Zustand stores.

### 2.2 State (Zustand stores)

State is split by *concern*, not by component. Each store lives in [src/lib/store/](../src/lib/store/) and is in-memory only — refresh wipes it. Persistent state (notes, snooze) lives on the backend in production; the dashboard mirrors it for the session.

| Store | Owns | Reset on |
| --- | --- | --- |
| [`uiStore`](../src/lib/store/uiStore.ts) | `selectedParticipantId`, `selectedPostTs` | cohort change, participant change (post id) |
| [`scoringStore`](../src/lib/store/scoringStore.ts) | `scoreAtWeek` (programme-derived weeks), helpers `availableWeeks()` + `clampToAvailable()` | never (week selector is global per session) |
| [`notesStore`](../src/lib/store/notesStore.ts) | local facilitator notes (per participant) | cohort change |
| [`sessionStatsStore`](../src/lib/store/sessionStatsStore.ts) | `sentThisSession` counter for the topbar | never |

Cohort-change reset is centralised in [`CohortSessionReset`](../src/components/cohort-session-reset.tsx), mounted on the cohort page. It fires once per `cohortId` change so participant-keyed state never leaks across cohorts (a participant can re-enrol under the same `user_id`).

### 2.3 Data flow per panel

```
src/lib/server/cohort-data.ts       (server-only)
    │  reads local/iih-coh*.json bundle (committed, per-cohort)
    ▼
useCohortBundle hook (TanStack Query, staleTime: ONE_DAY)
    │
    ├─▶ bundleToHistory(bundle, pid, scoreAtDay) → ParticipantHistory
    │       feeds /api/proxy/dropout/predict, /api/proxy/dropout/batch
    │       and /api/proxy/generate
    │
    └─▶ daysSinceLastEvent, facilitatorContactCount, etc. (src/lib/signals.ts)
            feeds the engagement-signals tile
```

All TanStack queries cache by `(cohortId, participantId, scoreAtDay)` — see [src/lib/hooks/api.ts](../src/lib/hooks/api.ts). Missing `cohortId` would otherwise let the same participant id from two cohorts collide on cache.

### 2.4 Proxy layer

Every external API call goes through `/api/proxy/*`. This is the **only** place where secrets exist:

```
client component → fetch('/api/proxy/generate')
                          │
                          ▼  (server-only)
                  src/app/api/proxy/generate/route.ts
                          │
                          ├─ auth() → NextAuth session check
                          ├─ commentGen() returns a client with
                          │    HOPE_API_SECRET (HMAC) + HF_TOKEN
                          │    (Bearer for the private Space)
                          └─ POST https://...hf.space/generate
                                with X-HMAC-Signature header
```

This means:

- `HOPE_API_SECRET` and `HF_TOKEN` never leave the Node runtime.
- The browser only sees `/api/proxy/*` paths — never the upstream URLs or credentials.
- A 5xx from upstream is classified by [`classifyGenerateError`](../src/app/cohorts/[cohortId]/drafts-helpers.ts) into a friendly "Comment generation is offline" card; raw stack traces never reach facilitators.

### 2.5 Component map

Where to make a UI change. Components live in [src/components/](../src/components/); the three panel files that compose them are in `src/app/cohorts/[cohortId]/`.

**Page chrome** — mounted by `page.tsx`

| Component | Renders | Reads from |
| --- | --- | --- |
| [`topbar`](../src/components/topbar.tsx) | cohort name, at-risk counts (hidden participants excluded), contacted-this-session counter | `useCohortScoring`, `useQueueState`, `sessionStatsStore` |
| [`week-selector`](../src/components/week-selector.tsx) | programme-week selector; disables weeks that haven't elapsed, discloses anchored weeks | `scoringStore` (`scoreAtWeek`, `clampToAvailable`) |
| [`risk-model-chip`](../src/components/risk-model-chip.tsx) | which horizon model produced the current scores | `useRiskModelInfo`, `scoringStore` |
| [`cohort-session-reset`](../src/components/cohort-session-reset.tsx) | nothing — clears participant-keyed stores on `cohortId` change | all stores (§2.2) |

**Queue column** — `queue.tsx`

| Component | Renders | Reads from |
| --- | --- | --- |
| [`queue-item`](../src/components/queue-item.tsx) | one participant row: alias, risk badge, last-active label | props + `useBundleDisplayName`. Presentational — snooze/dismiss state is server-shared (`useQueueState`), read by `queue.tsx` |

**Detail column** — `detail.tsx`

| Component | Renders | Reads from |
| --- | --- | --- |
| [`risk-gauge`](../src/components/risk-gauge.tsx) | the circular probability dial | props only |
| [`driver-bars`](../src/components/driver-bars.tsx) | contributing factors with per-factor SHAP direction | props (`contributing_factors` + weights) |
| [`info-card-row`](../src/components/info-card-row.tsx) | recommended actions / first-contact guidance | props (`prediction`) |
| [`metric-tile`](../src/components/metric-tile.tsx) | single stat + `MetricGrid` wrapper | props only |
| [`activity-timeline`](../src/components/activity-timeline.tsx) | day-bucketed post history; click sets the draft target | `uiStore` (`selectedPostTs`, `selectPost`) |
| [`avatar`](../src/components/avatar.tsx) | initials bubble from the pseudonymised alias | `useBundleDisplayName` |

**Drafts column** — `drafts.tsx`

| Component | Renders | Reads from |
| --- | --- | --- |
| [`draft-card`](../src/components/draft-card.tsx) | one persona draft: edit, polish, thumb, accept/send. The HITL surface | `usePolishText` only. `onThumb` / `onSend` / `onRegenerate` arrive as props |
| [`discussion-thread`](../src/components/discussion-thread.tsx) | forum thread context, auto-scrolled to the focal post | props only |
| [`follow-up-activity`](../src/components/follow-up-activity.tsx) | participant memory + local facilitator notes | `useMemory`, `notesStore` |

**Shared** — [`empty-state`](../src/components/empty-state.tsx) (detail, drafts, activity-timeline), and [src/components/ui/](../src/components/ui/): `badge`, `button`, `card`, `input`, `skeleton`, `textarea` — unstyled primitives, no app logic.

**The wiring convention worth knowing:** the *panel* files own the mutation hooks and pass callbacks down; components stay presentational. `drafts.tsx` calls `useGenerate`, `useThumb`, and `useEvent`, then hands `draft-card` an `onThumb`/`onSend` pair. Only `usePolishText` (in `draft-card`) and `useMemory` (in `follow-up-activity`) break that rule, both because the request is scoped to something the component already holds. So **to change what a draft action does, edit `drafts.tsx`; to change how it looks, edit `draft-card.tsx`.**

All data hooks live in [src/lib/hooks/api.ts](../src/lib/hooks/api.ts): `useCohortBatch`, `useParticipantPrediction`, `useMemory`, `useGenerate`, `usePolishText`, `useThumb`, `useEvent`, `useRiskModelInfo`. Every one calls a `/api/proxy/*` route (§2.4) — no component talks to a backend directly.


---

## 3. comment_generation (the SLM service)

### 3.1 Pipeline

```
POST /generate
  │
  ├─ assess(post_text)              ← input safety (src/safety/input_filter.py)
  │    └─ hard block? → return acknowledgement-only drafts + signposting
  │
  ├─ memory_store.retrieve(...)     ← cohort-scoped, activity-type boosted
  │    sqlite at /app/outputs/memory.sqlite
  │
  ├─ engagement fingerprint         ← from request body OR panel.parquet
  │
  ├─ participant_context             ← future hook for profile data
  │
  ├─ persona selection              ← {Gratitude → 2 personas, else → 3}
  │
  ├─ HopeGenerator.generate_personas(...)
  │    │ system: SYSTEM_INSTRUCTION (8 rules, see src/config.py)
  │    │ user:   participant_context + memory + engagement + post + persona_suffix
  │    │ decode: Qwen3-4B + LoRA, 4-bit nf4 quant, sdpa attn, n-gram blocked
  │    │ post:   strip @mentions, fill [name] slot, collapse consecutive slots
  │
  ├─ output_filter.filter_output(...)  ← per draft: MI policy, score open-question / reflection / prescriptive density
  │
  ├─ HITLStore.log_drafts(...)         ← sqlite at /app/outputs/hitl.sqlite
  │
  └─ return GenerateResponse {drafts, draft_set_id, memory_used, engagement_used,
                              safety_signposting, model_version, generated_at}
```

### 3.2 The served adapter

Production serves **one pinned adapter** — `h4cdev/qwen3.5-4b-hope-forum-lora`, selected by `HOPE_GEN_MODEL_ID` and locked with `HOPE_MODEL_LOCKED=1`. There is no runtime model switching: the selection is process-global, so a swap would change every facilitator's drafts mid-session after a 15–30 s reload. Changing the model is a deployment action (set the env var, restart the Space).

The id resolves two ways: a Hub id with a slash goes through `snapshot_download` and caches to `/data/.cache/huggingface`; a local registry id (no slash) looks up `MODEL_ID_TO_DIR` in `generation_service.py`. Weights load once at startup (`HOPE_PRELOAD_MODEL=1`); cold boot is ~60–90 s on a T4, warm requests are seconds.

### 3.3 Safety surfaces

- **Input filter** (`src/safety/input_filter.py`) — assesses post_text for crisis content. `blocked=True` short-circuits to acknowledgement-only drafts + a `safety_signposting` string.
- **Output filter** (`src/safety/output_filter.py`) — every persona draft passes through. Substitutes `[name]` slot, strips `@mentions`, scores MI signature, may rewrite if policy violations exceed threshold.
- **Kill switch** — `HOPE_DISABLE_GENERATION=1` returns the safe-stub drafts with `model_version: "stub-disabled"`. Use this to take the SLM offline without taking the service down.

### 3.4 Memory store

SQLite, idempotent on `(activity_id, role)`. Two tables — `post` and `reply`. Retrieval is cohort-scoped + activity-type boosted, top-K with K=3 by default.

Why SQLite, not Postgres: single-machine inference service, no distributed locks needed. Mounted on `/data` for the HF Space (persistent volume). Backfillable from JSON exports via `hope-memory backfill` CLI.

### 3.5 HITL store

SQLite, table per signal kind: `drafts` (every shown draft), `thumbs` (up/down), `events` (accept/edit/reject/flag/send), `safety_decisions`. Used downstream for DPO/KTO preference training and quality auditing.

---

## 4. engagement_ml (the dropout service)

### 4.1 Pipeline

```
POST /predict (or /batch)
  │
  ├─ feature builder: cumulative event history to the horizon → 50+ engineered features
  │    (cumulative logins, inactive streaks, activity ranges, page visits,
  │     bookmark count, reply rate, facilitator contact count, ...)
  │
  ├─ load_winner(score_at_day) → models/winner_T{T}.pkl
  │    one LightGBM per horizon; T ∈ {7,14,21,28,35,42,49,56}
  │
  ├─ Platt calibration → models/platt_T{T}.pkl
  │    raw probability → calibrated dropout_risk
  │
  ├─ risk_tier classification: low / medium / high (per per-cohort cutoffs)
  │
  ├─ TreeSHAP → top-3 contributing factors with weights (recommended_actions
  │    look up tier-keyed playbook strings)
  │
  └─ return PredictionResponse {dropout_probability, dropout_risk,
                                risk_tier, risk_level,
                                contributing_factors[], contributing_factor_weights[],
                                recommended_actions[], model_version,
                                threshold_used, threshold_low, threshold_high}
```

### 4.2 Why per-horizon models

A single end-of-programme model would weight late-engagement features too heavily for early-week scoring. Eight smaller models (one per horizon) means a W1 score has W1-relevant features dominate; a W8 score has the late-engagement features dominate. Held-out AUC runs 0.845 (T=7) → 0.910 (T=56) — measured on a temporal hold-out (`effective_start >= 2025-09-01`), per the `model_card_T*.json` shipped with each bundle.

The dashboard's week selector maps each programme week to one trained horizon (`score_at_day = week * 7`), rendering the programme's full shape and disabling weeks that haven't elapsed. Weeks past the last trained horizon (W9+ on a longer cohort) still score, but the service anchors them to T=56 and discloses it (`horizon_used`, `anchored_to_days`); the UI surfaces that with the anchored-week notice.

### 4.3 Cadence

Production should run a **weekly batch** per cohort and store results in a `weekly_predictions` table. The dashboard renders from that table; on-demand `/predict` calls are for new/manual refresh only. See INTEGRATION.md §2 for the full recipe.

---

## 5. Request lifecycles

### 5.1 Generate a draft

```
Facilitator clicks "Generate drafts" on a participant post
  │
  │ Drafts panel → useGenerate.mutate({participant_id, cohort_id, post_text, ...})
  ▼
POST /api/proxy/generate                      (Next.js server, NodeJS runtime)
  │
  │  auth() → session check (NextAuth)
  │  commentGen() builds an HMAC-signing client with HF_TOKEN bearer
  │  forward POST to https://...hf.space/generate
  ▼
HF Space FastAPI
  │
  │  require_hmac() validates the X-HMAC-Signature
  │  drafts router runs the pipeline (see §3.1)
  ▼
return GenerateResponse → /api/proxy/generate passthrough → Drafts panel renders DraftCard
```

End-to-end: cold ~30s (model load on first call), warm 1–3s per generation.

### 5.2 Score a cohort

```
Cohort page mounts → Queue useMemo builds ParticipantHistory[] from cohort bundle
  │
  │ useCohortBatch(histories, cohort.id)  ← TanStack, staleTime: ONE_DAY
  ▼
POST /api/proxy/dropout/batch              (Next.js server)
  │
  │  X-API-Key: HOPE_RISK_API_KEY (NOT HMAC — different service)
  │  forward POST to engagement_ml
  ▼
engagement_ml FastAPI
  │
  │  Per participant: feature builder → load_winner(T) → Platt calibrate → TreeSHAP
  ▼
return BatchResponse → /api/proxy/dropout/batch → Queue renders ranked list
```

### 5.3 Send a draft

```
Facilitator clicks "Send"
  │
  │ useEvent.mutate({draft_id, action: "accept" | "edit", sent_text})
  ▼
POST /api/proxy/event → comment_generation
  │
  │  HITLStore writes events row
  │  memory_store writes a reply row (for next call's retrieval)
  ▼
onSuccess: queryClient.invalidateQueries(["memory", ...])
           sessionStatsStore.incrementSent()
```

---

## 6. Auth surfaces

Two schemes, by design:

| Service | Scheme | Why |
| --- | --- | --- |
| comment_generation | HMAC-SHA256 over raw body | Mutates state (memory, HITL); signature binds payload to caller. |
| engagement_ml | `X-API-Key: $HOPE_RISK_API_KEY` | Pure inference; simple bearer is enough. |

Both services accept `HOPE_API_AUTH=disabled` in dev/smoke. Production sets it to anything else (`enabled` is conventional).

The dashboard's `/api/proxy/*` routes are the only HMAC signers — they read `HOPE_API_SECRET` from server env, sign the outbound body, and forward. No client-side code ever sees the secret.

The HF Space layer adds another auth gate: the Space is **Private**, so every request to `https://...hf.space/*` needs `Authorization: Bearer $HF_TOKEN`. The dashboard's [createCommentGenClient](../src/lib/api/commentGen.ts) forwards `authToken` for this. See INTEGRATION.md §1 for the HMAC example.

---

## 7. API surface

The route list is **not** duplicated here. It is a contract with exactly two
sources of truth, and a third copy in this file would drift silently:

- `comment_generation/docs/openapi.yaml` — authoritative machine-readable spec; the dashboard's `src/lib/api/types.ts` is generated from it via `npm run gen:types`
- [INTEGRATION.md §2–§3](INTEGRATION.md) — the same contract written for a platform engineer, with payloads and worked examples

What belongs here is the *shape* of that surface, which the route list does not
convey:

- **comment_generation (`:8001`)** splits into four groups — generation (`/generate`), HITL capture (`/thumb`, `/event`), participant memory (`/memory/*`), and ops (`/health`, `/version`, `/metrics`). Everything that mutates state is HMAC-signed; everything that only reports is open. See §6.
- **engagement_ml (`:8000`)** is deliberately narrow: two scoring routes (`/predict`, `/batch`) behind `X-API-Key`, plus open health/version. There is no write surface at all — the service holds no state to write to (§10).

The asymmetry in auth between the two services is a decision, not an accident —
see §12.1.

---

## 8. Data sources

| Item | Location | Owner | Notes |
| --- | --- | --- | --- |
| Cohort bundle | `local/iih-coh*.json` (**committed** — see below) | dashboard | extracted by [`scripts/extract-iih-cohort.mjs`](../scripts/extract-iih-cohort.mjs) from raw txt exports; pseudonymised |
| Memory store | `/app/outputs/memory.sqlite` | comment_generation | created on first connect via `CREATE TABLE IF NOT EXISTS`; persistent on `/data` for HF Space |
| HITL store | `/app/outputs/hitl.sqlite` | comment_generation | same lifecycle as memory; sole source for DPO/KTO training data |
| Adapter | `h4cdev/qwen3.5-4b-hope-forum-lora` (pinned) | HF Hub (private) | selected by `HOPE_GEN_MODEL_ID`, locked in production; downloads to the HF cache at startup. See [OPERATIONS.md](OPERATIONS.md) §2 |
| Base model | `Qwen/Qwen3-4B` | HF Hub (public) | downloaded by `transformers.from_pretrained` |
| Dropout models | `h4cdev/hope-move-engagement-ml` → `winner_T{7..56}.pkl` | HF Hub (private) | per-horizon LightGBM; Platt calibration files alongside; fetched by the Space at container start |
| Engagement panel | `cumulative_features_panel.parquet` | engagement_ml | optional; comment_generation falls back to request-body engagement when missing |

**The cohort bundles in `local/` are committed and contain real Hope Move
platform data.** Direct identifiers (names, emails, phones) are stripped
before export and display names are pseudonymised to `P1`, `P2`, … — but
the post free-text is genuine participant writing and includes health
disclosures. Treat this repository as confidential.

Anything added downstream (the dashboard, the LoRA training) must not
re-introduce identifiers — see the name-scrub path in
`comment_generation/src/generation_utils.py`
for the training-side guard.

The raw platform exports the bundles are built from (`data/` in
`comment_generation` and `engagement_ml`) are **gitignored** in those
repos and must stay that way.

---

## 9. Failure modes & observability

| Failure | Where it's caught | What the facilitator sees |
| --- | --- | --- |
| Space down / 5xx | [`classifyGenerateError`](../src/app/cohorts/[cohortId]/drafts-helpers.ts) | "Comment generation is offline" card |
| 401 from upstream | same classifier | "Sign in again" card |
| Input safety block | comment_generation pipeline | 2 acknowledgement-only drafts + `safety_signposting` string |
| Kill switch (`HOPE_DISABLE_GENERATION=1`) | comment_generation `/generate` | safe-stub drafts with `model_version: "stub-disabled"` |
| Memory store unreachable | dashboard memory proxy | empty memory rows; generation still runs |
| risk-api unreachable | TanStack `error` state | inline "predictions unavailable" + retry |

Container logs are the authoritative trace — `print(traceback)` is the runtime, plus the `/health` endpoint reports `model_loaded`, `memory_db`, and `dropout_api` status. Future work: forward HITL signals to a metrics pipeline.

---

## 10. Scaling properties

Where each layer actually runs is an operational choice, not an architectural one — see [OPERATIONS.md §1](OPERATIONS.md). What the architecture fixes is how far each layer can scale:

- **Dashboard — stateless.** Every request either reads a cohort bundle from disk or proxies to a backend. Run as many instances as you like.
- **comment_generation — pinned to one instance per adapter.** One model sits behind an in-process lock, and memory + HITL state lives in a sqlite volume beside it. A second instance would fork that state. Going horizontal means moving sqlite to Postgres and the draft cache to Redis first.
- **engagement_ml — fully stateless.** Pure LightGBM inference over a request-supplied event history; the bundles are read-only. Scale freely.

The asymmetry is deliberate: the expensive, stateful component is the one facilitators touch a handful of times per session, and the cheap stateless one absorbs the per-page traffic.

---

## 11. Where to look first

| If you're investigating… | Start in |
| --- | --- |
| A wrong draft showed up | container log on the Space + `model_version` in the response |
| A participant's risk score looks off | `/api/proxy/dropout/predict` response in browser network tab + `model_version` |
| Queue not re-ranking after week change | scoringStore + `useCohortBatch` cache key (must include `scoreAtDay` + `cohortId`) |
| "Memory not used" but should be | `/memory/{participant_id}` via the proxy + `memory_used` in `/generate` response |
| Send action silently failed | `events` table in `hitl.sqlite` on the Space |
| Adding a new persona | `Persona` enum in `comment_generation/service/models.py` + `_PERSONA_SUFFIX` in `generation_service.py` + persona routing in `drafts.py` |
| Adding a new cohort | `src/lib/cohorts.ts` + bundle export at `local/iih-coh*.json` + cohort metadata (programmeLengthDays) |
| Swapping the LoRA | set `HOPE_GEN_MODEL_ID` on the Space; factory-reboot |

---

## 12. Architectural decisions worth knowing

1. **Two auth schemes, not one.** HMAC binds the payload (right for state-mutating writes); X-API-Key is enough for pure inference. Unifying would push complexity onto the simpler service for no gain.
2. **SQLite, not Postgres.** Single-instance LoRA service; no distributed locks needed. Easy to back up (one file). Swap to Postgres only when scale demands replicas.
3. **LoRA, not full fine-tune.** ~5–10MB swappable weights vs 8GB full model. Faster iteration, cheaper cold boot, DPO/KTO-friendly.
4. **Server proxies, not direct browser calls.** `HOPE_API_SECRET` and `HF_TOKEN` never reach the client. Single auth surface to audit. Lets us add caching/transform layers without touching client code.
5. **mailto:, not server-side email.** Cheap-path outreach for disengaged participants. Server-side SMTP via NextAuth/Resend lands when the workflow demands tracking.
6. **Activity-aware persona selection.** Gratitude posts get 2 personas (Empathetic + Goal-oriented); everything else gets 3. Nudging next steps in response to gratitude reads as tone-deaf — the heuristic respects the Hope handbook.
7. **Cohort-scoped session state.** Stores reset when the `cohortId` route param changes ([CohortSessionReset](../src/components/cohort-session-reset.tsx)). Participant ids can repeat across cohorts (re-enrolment); the reset prevents state bleed.
8. **`[name]` slot, not name interpolation.** Training data substitutes raw first names with `[name]`; inference fills it with the live display_name. Combined with the system-prompt naming rule (config.py rule 8) and the data-prep scrubber, this is the three-layer defence against PII leakage from the training set.
9. **Weekly batch + on-demand refresh** for risk scoring. Consistent numbers across facilitators, cheap (~1 batch/cohort/week), historical trajectory available. See INTEGRATION.md §2.

---

## Index of related docs

- [INTEGRATION.md](INTEGRATION.md) — for platform engineers integrating Hope Move with the two backing services
- [OPERATIONS.md](OPERATIONS.md) — deploy paths, model roster + swap/retrain, runbook
- `comment_generation/docs/openapi.yaml` — authoritative OpenAPI spec
- `comment_generation/space/README.md` — HF Space deployment specifics
- `engagement_ml/README.md` — model research pipeline + evaluation
