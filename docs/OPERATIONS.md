# Operations — deploy, models, runbook

How to deploy the two backing services, manage the models they serve, and
operate them day-to-day. The **API contract** is not duplicated here — that
lives in [INTEGRATION.md](INTEGRATION.md) (wire reference) and the
authoritative `comment_generation/docs/openapi.yaml`. For *why* the system
is shaped this way, see [ARCHITECTURE.md](ARCHITECTURE.md).

| Service | Port | Auth | Serves |
| --- | --- | --- | --- |
| **engagement_ml** (risk) | 8000 | `X-API-Key: $HOPE_RISK_API_KEY` | dropout risk: per-horizon LightGBM + Platt + TreeSHAP |
| **comment_generation** | 8001 | `X-HMAC-Signature` over raw body, key `$HOPE_API_SECRET` | persona reply drafting + memory + HITL |

Read endpoints (`/health`, `/version`, `/model/info`) are always open. Both
services honour `HOPE_API_AUTH=disabled` to bypass app-layer auth for local
smoke tests — never in production. When the services run as **private HF
Spaces**, every request additionally needs `Authorization: Bearer $HF_TOKEN`
(the gateway gate); the dashboard's server-side proxy injects all
credentials so the browser never sees them.

---

## 1. Deployment paths

Two ways the backends run. The dashboard only follows `COMMENT_GEN_URL` /
`DROPOUT_API_URL`, so switching paths is an env change, not a code change.

| Path | When |
| --- | --- |
| **HF Spaces** (Docker SDK, private, `h4cdev` account) | Production |
| **Self-host via Docker Compose** | Own hardware, one command — §1.2 |

### 1.1 Production Spaces

| Space | Hardware | Model delivery |
| --- | --- | --- |
| `h4cdev/hope-dropout-api` | CPU basic | Fetches the risk bundles from the private model repo `h4cdev/hope-move-engagement-ml` at container start. Updating the model = push new bundles to that repo, restart the Space. No image rebuild. |
| `h4cdev/hope-comment-gen-api` | GPU (T4 small class) with auto-sleep | Pulls the pinned adapter `h4cdev/qwen3.5-4b-hope-forum-lora` from the Hub at startup (`HOPE_PRELOAD_MODEL=1`). |

Space secrets each needs:

| Space | Secrets |
| --- | --- |
| dropout-api | `HF_TOKEN` (read access to the model repo), `API_KEY` (matches the dashboard's `HOPE_RISK_API_KEY`) |
| comment-gen-api | `HF_TOKEN` (read access to the adapter repo), `HOPE_API_SECRET` (matches the dashboard's) |

Auto-sleep pauses billing while idle; the first request after a sleep pays
a cold start (container start + model load — 60–90 s for the comment
service, a few seconds for the risk service). Facilitator-facing hours may
justify persistent hardware; tune sleep time in the Space settings.

### 1.2 Self-host with Docker Compose

The whole stack from a clean machine. Needs Docker and sibling checkouts of
`../comment_generation` and `../engagement_ml`.

**Compute floors**

| Service | Floor | Recommended |
| --- | --- | --- |
| engagement_ml | 2 vCPU / 1 GB RAM (CPU only) | 2 vCPU / 4 GB RAM |
| comment_generation | 1× T4 (16 GB) — Qwen3.5-4B in 4-bit | 1× A10G / A100 (24 GB+) for fp16 |

**Get the model artefacts.** Neither repo commits its weights.

```bash
# engagement_ml — the eight per-horizon bundles (~12 MB) go in models/:
#   winner_T{7,14,21,28,35,42,49,56}.pkl   platt_T{...}.pkl
#   feature_medians_T{...}.csv             feature_names_T{...}.csv
#   model_card_T{...}.json
# Fetch from the private model repo (needs a read-scoped HF token):
python -c "from huggingface_hub import snapshot_download; \
  snapshot_download('h4cdev/hope-move-engagement-ml', local_dir='../engagement_ml/models')"

# comment_generation — the adapter is pulled from the HF Hub at startup.
# Just pass a read-scoped HF_TOKEN; nothing to download by hand.
```

**Run.**

```bash
cp .env.example .env              # fill HOPE_API_SECRET, HOPE_RISK_API_KEY, HF_TOKEN
docker compose up --build         # dashboard :3000, comment :8001, risk :8000

# No GPU? Real UI, canned drafts:
HOPE_DISABLE_GENERATION=1 docker compose up --build
```

For a GPU, uncomment the `deploy:` block under `comment-api` in
`docker-compose.yml` (needs the NVIDIA Container Toolkit).

**Persistence.** comment_generation writes two SQLite files under
`outputs/` (mounted by compose):

- `memory.sqlite` — participant posts + facilitator replies. Rebuildable
  from platform events via `/memory/batch`.
- `hitl.sqlite` — facilitator HITL signals (thumbs, accept/edit/reject).
  **Not rebuildable** — losing it loses training signal. Back it up daily.

---

## 2. Comment-generation model

### 2.1 The production adapter

The service serves **one pinned adapter**:

| Setting | Value |
| --- | --- |
| Adapter | `h4cdev/qwen3.5-4b-hope-forum-lora` (Qwen3.5-4B, DoRA r=16, 4-bit base) |
| Pinning | `HOPE_MODEL_LOCKED=1` — runtime swapping is refused |
| Held-out BERTScore | 0.8729 (n = 1,228) |

Runtime model switching was removed from both the service roster and the
dashboard UI: the selection is process-global, so on a shared deployment a
swap would change every facilitator's drafts mid-session after a 15–30 s
stall. Changing the model is an explicit deployment action — set
`HOPE_GEN_MODEL_ID` and restart the Space.

A CPU-capable fallback, `h4cdev/qwen3-0.6b-hope-forum-clean-lora`, exists
for development without a GPU: same corpus, same behaviour contract,
0.0029 BERTScore off the leader. The remaining research adapters were
retired from the production namespace; they live in the programme's
handover archive if ever needed for comparison work.

`/generate` returns **2–3 persona drafts** for activity posts (Gratitude →
2: Empathetic + Goal-oriented; others → 3) and **1 warm reply** for
`Discussion` (forum) posts. `activity_type="Emotions"` is rejected (422) —
no training signal post-clean.

### 2.2 Why this adapter

Measured on the cleaned forum corpus (June 2026 runs):

| Model | BERTScore | ROUGE-L | BLEU-4 |
| --- | ---: | ---: | ---: |
| **Qwen3.5 4B (forum)** — production | **0.8729** | 0.1831 | 0.0171 |
| Qwen3 4B (forum-clean) | 0.8719 | 0.1779 | 0.0165 |
| Qwen3 8B (forum-clean) | 0.8710 | 0.1815 | **0.0177** |
| Qwen3 1.7B (forum-clean) | 0.8707 | 0.1808 | 0.0169 |
| Qwen3 0.6B (forum-clean) | 0.8700 | 0.1738 | 0.0160 |
| Gemma-4 E4B (forum) | 0.8452 | 0.1332 | 0.0137 |

The Qwen models are a near-tie (spread 0.0029, bootstrap CIs on comparable
deltas ±0.001–0.0016); only Gemma-4 separates clearly, downward. The 8B
costs roughly double the VRAM for third place, which is why it is not the
production choice.

---

## 3. Dropout-risk models (engagement_ml)

Per-horizon LightGBM, one model per trained horizon
`T ∈ {7, 14, 21, 28, 35, 42, 49, 56}`, each with a Platt calibrator. Five
files per horizon, forty files, ~12 MB total:

```text
models/
  winner_T7.pkl          … winner_T56.pkl     # LightGBM per horizon
  platt_T7.pkl           … platt_T56.pkl      # calibration
  feature_names_T7.csv   … feature_names_T56.csv
  feature_medians_T7.csv … feature_medians_T56.csv   # imputation
  model_card_T7.json     … model_card_T56.json       # metrics + fit metadata
```

The service reads them from `MODEL_DIR` and **fail-fasts at startup if any
file is missing**. Held-out AUC by horizon: 0.845 (T=7) rising to 0.910
(T=56) — temporal hold-out (`effective_start >= 2025-09-01`). Exact
per-horizon metrics, hyperparameters, and the feature list are in each
`model_card_T{T}.json`.

### 3.1 Getting the bundles

The authoritative copy is the private HF model repo
**`h4cdev/hope-move-engagement-ml`** — the production Space fetches from it
at container start, and self-hosting fetches from it via
`snapshot_download` (§1.2). The training pipeline writes bundles to
`engagement_ml/models/`; publishing an update means uploading that
directory's serving set to the model repo and restarting the Space.

Sanity-check any copy before trusting it:

```bash
python -c "import json;print(json.load(open('models/model_card_T7.json'))['model_family'])"
# must print: lightgbm
```

The comment-gen engagement-fingerprint prompt path also reads
`cumulative_features_panel.parquet` (path set by `HOPE_DROPOUT_PANEL_PATH`);
if absent, `/generate` returns `engagement_used: false` and proceeds.

---

## 4. Required env vars

| Var | Service | Purpose |
| --- | --- | --- |
| `HOPE_API_AUTH` | both | `enabled` (prod) or `disabled` (local smoke) |
| `HOPE_RISK_API_KEY` | engagement_ml | 32-byte hex `X-API-Key` |
| `HOPE_API_SECRET` | comment-gen | 32-byte hex HMAC secret |
| `HOPE_GEN_MODEL_ID` | comment-gen | adapter to load. Default `h4cdev/qwen3.5-4b-hope-forum-lora` |
| `HOPE_MODEL_LOCKED` | comment-gen | `1` on any shared deployment — refuses runtime swaps |
| `HF_TOKEN` | both | HF read token — private adapter/bundle downloads and the private-Space gateway |
| `HOPE_DROPOUT_URL` | comment-gen | optional; engagement_ml `/health` for the engagement-aware prompt path |
| `HOPE_DROPOUT_PANEL_PATH` | comment-gen | optional; path to `cumulative_features_panel.parquet` |
| `HOPE_DASHBOARD_ORIGIN` | comment-gen | CORS allowlist on `/generate` |

The dashboard's matching env keys (`COMMENT_GEN_URL`, `DROPOUT_API_URL`,
`HOPE_API_SECRET`, `HOPE_RISK_API_KEY`, `HF_TOKEN`, `AUTH_SECRET`,
`HOPE_HANDOFF_SECRET`) must align with whatever the services run with. See
[README → Configuration](../README.md).

Note the two names for the risk-service key: the dashboard sends
`HOPE_RISK_API_KEY`, and engagement_ml reads it as `API_KEY`. Same value,
different variable name on each side.

### Generating and rotating secrets

```bash
openssl rand -hex 32   # HOPE_API_SECRET  (comment-gen HMAC)
openssl rand -hex 32   # API_KEY          (engagement_ml X-API-Key)
npx auth secret        # AUTH_SECRET      (dashboard NextAuth)
```

Neither service supports two acceptable values at once, so there is no
dual-secret grace window: deploy a new secret to the service and every
caller in lockstep, and plan brief downtime for the cutover.

---

## 5. Runbook

### Restart / reload

- **HF Space:** Settings → Restart (re-fetches models, re-reads env).
  Factory reboot forces a full image rebuild.
- **Docker Compose:** `docker compose restart comment-api` (or `risk-api`).

### Health & smoke

```bash
# Production Spaces need the HF bearer + the per-service key:
curl -s -H "Authorization: Bearer $HF_TOKEN" \
  https://h4cdev-hope-dropout-api.hf.space/health
# {"status":"ok","horizons":[7,14,21,28,35,42,49,56],...}

curl -s -H "Authorization: Bearer $HF_TOKEN" \
  https://h4cdev-hope-comment-gen-api.hf.space/health
# {"status":"healthy","model_loaded":true,...}

# Local compose:
curl -s http://localhost:8001/health
curl -s http://localhost:8000/health
```

For a signed `/generate` smoke, drive it through the dashboard's
`/api/proxy/generate` route (it signs server-side) rather than hand-rolling
HMAC.

### Inspect HITL signals (local)

```bash
sqlite3 comment_generation/outputs/hitl.sqlite \
  "SELECT ts, action, edit_distance FROM hitl_drafts ORDER BY id DESC LIMIT 20;"
```

### Error reference

| Symptom | Cause | Fix |
| --- | --- | --- |
| 401 `invalid HMAC signature` (comment-gen) | `HOPE_API_SECRET` mismatch dashboard ↔ service | align the secret, or run both with `HOPE_API_AUTH=disabled` for dev |
| 401 from a `*.hf.space` host | missing/invalid `HF_TOKEN` (private-Space gateway) | set a read-scoped `HF_TOKEN` for the `h4cdev` account |
| 500 from `/api/auth/*` on the dashboard | `AUTH_SECRET` not set in the deployment env | set it (`npx auth secret`) and redeploy |
| 404 on `/event` | `chosen_draft_id` not logged (service restarted between generate and event) | re-issue `/generate`, use the new ids |
| 422 on `/generate` | Pydantic validation — missing `post_text`, bad `activity_type` (e.g. `Emotions`) | fix the payload per the response detail |
| `dropout_api: unreachable` in `/health` | comment-gen can't reach `HOPE_DROPOUT_URL` | only affects engagement enrichment; risk panel reads engagement_ml directly |
| `engagement_used: false` always | panel parquet missing / wrong `HOPE_DROPOUT_PANEL_PATH` | re-vendor the parquet; generation still works |
| `memory_used: false` for a known participant | no memory rows for `(participant_id, cohort_id)` | backfill via `/memory/batch` or the backfill CLI |
| First request after idle hangs 60–90 s | Space waking from auto-sleep (cold start + model load) | expected; use persistent hardware if unacceptable |

---

## 6. Observability

| What | Where |
| --- | --- |
| Liveness | `GET /health` on both services |
| Model audit | `GET /model/info` on engagement_ml; `GET /version` on comment-gen |
| Prometheus metrics | `GET /metrics` on comment-gen (request latency, generate-time histogram, memory-hit rate) |
| Application logs | stdout — both use uvicorn's access log + Python `logging`; Space logs stream in the HF UI |

In production, scrape `/metrics` into Prometheus/Grafana and alert on
`hope_generate_latency_seconds{quantile="0.95"} > 8`.

---

## 7. Swapping in your own model

The interfaces are stable and the implementations are swappable. Keep the
FastAPI surface intact and the dashboard needs no change:

- **engagement_ml** — any model taking a `ParticipantHistory` and
  returning a `PredictResponse` works. Replace `_load_one` / `score_one`
  in `deploy/api/inference.py`.
- **comment_generation** — any backend taking a `RichGenerateRequest`
  and returning a `GenerateResponse` works. Replace
  `GenerationService.generate` in `service/generation_service.py`; the
  routers, memory layer, and MI safety gate stay in front of it.

The Pydantic schemas in `comment_generation/service/models.py` and
`engagement_ml/deploy/api/schemas.py` are the source of truth.

---

## 8. Related docs

- [HANDOVER.md](HANDOVER.md) — onboarding: access, hosting, known gaps
- [INTEGRATION.md](INTEGRATION.md) — API wire contract for platform callers
- [ARCHITECTURE.md](ARCHITECTURE.md) — why the system is shaped this way
- `comment_generation/docs/openapi.yaml` — authoritative OpenAPI spec
