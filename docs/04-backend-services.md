# 4. Backend services

Two FastAPI services in their own repositories. The dashboard is their only
caller. Both run as private Docker Spaces under the `h4cdev` Hugging Face
account and listen on **7860** there. Locally they listen on **8001**
(comment) and **8000** (risk).

The request and response schemas are owned by the services:
`comment_generation/docs/openapi.yaml` (the dashboard's `src/lib/api/types.ts`
is generated from it with `npm run gen:types`) and
`engagement_ml/deploy/api/schemas.py`.

---

## 4.1 Risk service (`engagement_ml`)

**Purpose:** weekly dropout-risk score for one participant or a whole cohort.

**Entry point:** `deploy/api/main.py` (FastAPI app, version 3.0.0). At
startup `prime_artefact_cache()` loads all eight horizons and a TreeSHAP
explainer per horizon. A missing or unreadable bundle file stops startup.

### Routes

| Method | Path | Auth | Returns |
| --- | --- | --- | --- |
| GET | `/health` | none | `{status, horizons, winner_architecture}` |
| GET | `/model/info` | `X-API-Key` | Horizons, thresholds, metrics and versions from the model cards |
| POST | `/predict` | `X-API-Key` | One `PredictResponse` |
| POST | `/batch` | `X-API-Key` | `{total, high, medium, low, predictions[]}`, 1–2,000 participants, **sorted by descending probability**, not request order |

Auth: `X-API-Key` compared in constant time against the `API_KEY`
environment variable. If `API_KEY` is unset the protected routes return
**500** (fail closed) unless `ALLOW_UNAUTHENTICATED=1`. The dashboard's name
for the same value is `HOPE_RISK_API_KEY`. In-memory rate limiting:
`RATE_LIMIT_PER_MIN` (default 60) per key, 429 beyond it.

### Request (`ParticipantHistory`)

| Field | Rule |
| --- | --- |
| `participant_id` | 1–128 chars |
| `effective_start` | datetime, the start of this participant's clock |
| `events[]` | `{timestamp, event_type, activity_type?, words_written?, description?}`. `event_type` ∈ `activity, login, page_visit, bookmark, discussion_post, facilitator_comment`. `page_visit` is accepted but does not affect the score |
| `cohort_size` | 1–500 |
| `programme_length_days` | ≥ 7 |
| `score_at_day` | ≥ 7 and **≤ `programme_length_days`**, otherwise 422 |
| `cohort_facilitator_density` | deprecated, ignored |

Every event must fall in `[effective_start, effective_start + score_at_day)`,
otherwise 422. **Send timezone-aware timestamps everywhere.** Mixing a naive
`effective_start` with `Z` events raises an unhandled error (500), not a
422. The dashboard normalises every platform timestamp with `ensureUtc()`.

### Response highlights

`dropout_probability` (Platt-calibrated; alias `dropout_risk`),
`raw_probability`, `risk_tier` (alias `risk_level`: low / medium / high),
`threshold_low` / `threshold_high` (calibrated scale), `threshold_used`
(raw scale, for audit), `model_version` (`lightgbm_T{T}@<12 hex of md5(winner pkl)>`),
`horizon_used`, `anchored_to_days`, `note`, `contributing_factors` (≤ 3),
`contributing_factor_weights`, `contributing_factor_directions`,
`recommended_actions`.

**Horizons.** The service uses the largest trained horizon ≤ `score_at_day`.
Above 56 it uses 56, sets `anchored_to_days` and explains in `note`.

### Environment

`API_KEY`, `RATE_LIMIT_PER_MIN` (60), `ALLOW_UNAUTHENTICATED` (unset),
`CORS_ALLOW_ORIGINS` (empty), `MODEL_DIR` (code default `<repo>/models`;
`/app/deploy/models` in both images). The `h4cdev` Space adds `HF_TOKEN`
(or `ml_model`), `MODEL_REPO_ID` (`h4cdev/hope-move-engagement-ml`) and
optional `MODEL_REVISION` for `fetch_models.py`.

### Tests and CI

`python -m unittest discover -s tests -v` (6 feature-contract tests, no
weights needed); CI also runs `ruff check deploy/api src` on Python 3.11.

---

## 4.2 Comment service (`comment_generation`)

**Purpose:** persona-conditioned reply drafts for a participant's post, plus
the memory and research log around them.

**Entry point:** `service/main.py`. Routers: `ops`, `drafts`, `memory`,
`hitl`, `text`. With `HOPE_PRELOAD_MODEL=1` (the default) the model loads in
a background thread at startup, and `/health` reports `model_loaded`.

### Routes

"HMAC" means header `X-HMAC-Signature` = hex HMAC-SHA256 of the **raw
request body** with `HOPE_API_SECRET`. It is skipped only when
`HOPE_API_AUTH=disabled`. Any other value, including unset, enforces it.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/`, `/health`, `/version`, `/metrics` | none | Liveness; `/health` has `model_loaded`, `grounding_check` (off/on/unavailable), `memory_db`, queue depth; `/version` has `model_version`, `service_version`, `GIT_COMMIT` |
| GET | `/admin/models` | none | The hosted roster and whether it is pinned |
| POST | `/admin/model` | HMAC | Hot-swap the adapter. **409 when `HOPE_MODEL_LOCKED=1`** (production) |
| POST | `/generate` | HMAC | Draft replies |
| POST | `/memory/post`, `/memory/reply`, `/memory/batch` | HMAC | Write participant memory (idempotent) |
| DELETE | `/memory/post/{activity_id}` | HMAC | Remove a post from memory |
| GET | `/memory/{participant_id}` | HMAC | Debug read |
| POST | `/thumb`, `/event`, `/copy`* | HMAC | Facilitator feedback (research log) |
| POST | `/text/summary`, `/text/coaching`, `/text/polish` | HMAC | Short non-draft text |
| POST | `/sync/backfill-from-json` | HMAC | Always 501 |

\* `/copy` and the feedback ownership checks exist only on the release
branch ([02 §2.5](02-environments.md#25-release-state)).

### The `/generate` pipeline

1. **Kill switch.** `HOPE_DISABLE_GENERATION=1` returns **503
   `generation_disabled`** immediately. It is not a stub that returns canned
   drafts, whatever older docs say.
2. **Input safety** (`src/safety/input_filter.py`, regex). Self-harm,
   harm-to-others or medical-emergency language hard-blocks the request: it
   returns two fixed acknowledgement drafts plus UK signposting, with
   `model_version: "safety-block"`. Crisis-distress language is only
   soft-flagged.
3. **Context.** Participant memory (cohort-scoped, activity-type boosted,
   top 3), the engagement fingerprint from the request body, thread context,
   the goal form fields.
4. **Persona selection.** Discussion (forum) posts get 1 reply, Gratitude
   gets 2 (Empathetic, Goal-oriented), other activity types get 3.
   `Emotions` is rejected (422).
5. **Decode.** The adapter on Qwen3.5-4B, 4-bit nf4 on GPU, thinking mode
   off, temperature 0.7. Each decode is capped at `HOPE_DECODE_MAX_TIME_S`
   (90 s) and the whole set at `HOPE_GENERATE_BUDGET_S` (180 s).
6. **Output safety** (`output_filter.py`, `mi_scorer.py`). Scrubs names,
   fills the `[name]` slot, rejects reasoning traces. A motivational
   interviewing (MI) policy hard-fails diagnostic language,
   medication/dosage advice and URLs, and soft-flags too many imperatives,
   "why" questions, or a low reflection-to-question ratio. Up to 2 retries
   keep the draft with the fewest violations. Leftovers are returned in
   `mi_violations`.
7. **Grounding check** (`src/safety/grounding.py`, on when
   `HOPE_GROUNDING_CHECK=1`, which **is set on the live Space**). The same
   base model, with the adapter disabled, judges YES/NO whether each draft
   is supported by the post. An "ungrounded" draft gets one repair within
   the shared budget (max 3 repairs per set). The verdict comes back as
   `draft.grounding` and is logged.
8. **Log** every shown draft to `hitl.sqlite` and return
   `{draft_set_id, drafts[], memory_used, engagement_used, model_version, …}`.

### Concurrency

One decode at a time (`DECODE_LOCK` in `service/concurrency.py`). Up to
`HOPE_GEN_MAX_QUEUE` (3) requests wait. Beyond that the service answers
**503 `generation_busy`** with `Retry-After` (20 s × queue depth), and the
dashboard retries on a 15/30/45 s ladder. Measured on the T4: 20 simultaneous
requests → 4 served, 16 refused. A single forum reply takes ~16 s warm; an
activity draft set takes 25–94 s (59 s mean). A cold start adds ~63 s to
load the model, plus container start if the Space was asleep.

Setting `VLLM_BASE_URL` sends decodes to a vLLM server instead, which
serves a merged checkpoint (adapter folded into the base with
`scripts/merge_adapter.py`). Measured on a 16 GB Blackwell card, 20
concurrent drafts were all served in under 10 s. Two catches. vLLM needs an
Ampere or newer GPU (L4 at minimum, not T4). On that backend the grounding
check reports `unavailable`, since there is no separate base model to judge
with. `space/Dockerfile.vllm` packages it as a Space
(`HOPE_SPACE_NAME=<name> HOPE_SPACE_DOCKERFILE=space/Dockerfile.vllm bash space/deploy.sh`).
No vLLM deployment is live.

### Persistence

Two SQLite files, path `$HOPE_STATE_DIR/<file>` (default `<repo>/outputs/`).
Schemas, the data-loss problem on the Space, and backups are in
[06 §6.3](06-data-and-storage.md#63-comment-service-sqlite).

### Environment

Full list in [07 §7.3](07-configuration.md#73-comment-service). The ones
that matter in production: `HOPE_API_SECRET`, `HOPE_API_AUTH=enabled`,
`HF_TOKEN`, `HOPE_GEN_MODEL_ID`, `HOPE_MODEL_LOCKED=1`,
`HOPE_GROUNDING_CHECK=1`, `HOPE_GEN_MAX_QUEUE=3`, `HOPE_STATE_DIR`.

### Tests and CI

`pytest tests -q` from the repo root. CI installs only `pytest pydantic
fastapi httpx numpy nltk` and runs `ruff check service src` on Python 3.11,
so tests never load real weights. Run them before pushing in a fresh venv
with exactly that install. A test that imports something heavier passes
locally and fails in CI.

### Doc drift inside `comment_generation`

That repo's own `space/README.md`, `space/DEPLOY.md` and `docs/hf_backup.md`
are partly out of date. They mention Qwen3-4B 8-bit, the retired
`michaelajao` namespace, copying SQLite files into the Space, and a "stub"
kill switch. Trust this handbook and the code over them. The list is in
[10](10-known-issues.md).
