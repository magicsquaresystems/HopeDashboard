# Operations — deploy, models, runbook

How to deploy the two backing services, manage the models they serve, and
operate them day-to-day. The **API contract** is not duplicated here — that
lives in [INTEGRATION.md](INTEGRATION.md) (wire reference) and the
authoritative [`comment_generation/docs/openapi.yaml`](../../comment_generation/docs/openapi.yaml).
For *why* the system is shaped this way, see [ARCHITECTURE.md](ARCHITECTURE.md).

| Service | Repo | Port | Auth | Serves |
| --- | --- | --- | --- | --- |
| **engagement_ml** | [`engagement_ml`](https://github.com/michaelajao/engagement_ml) | 8000 | `X-API-Key: $HOPE_RISK_API_KEY` | dropout risk: per-horizon LightGBM + Platt + TreeSHAP |
| **comment_generation** | [`comment_generation`](https://github.com/michaelajao/comment_generation) | 8001 (8011 on Brosnan HPC — `:8001` is held by JupyterHub) | `X-HMAC-Signature` over raw body, key `$HOPE_API_SECRET` | persona reply drafting + memory + HITL |

Read endpoints (`/health`, `/version`, `/model/info`, `/admin/models`) are
always open. Both services honour `HOPE_API_AUTH=disabled` to bypass app-layer
auth for local smoke tests — never in production. When the services run as
**private HF Spaces**, every request additionally needs
`Authorization: Bearer $HF_TOKEN` (the gateway gate); the dashboard's
server-side proxy injects all three credentials so the browser never sees them.

---

## 1. Deployment paths

Three ways the backends run. The dashboard only follows `COMMENT_GEN_URL` /
`DROPOUT_API_URL`, so switching paths is an env change, not a code change.

| Path | When | Reference |
| --- | --- | --- |
| **HF Space** (Docker SDK, private) | shareable always-on endpoint | [`comment_generation/space/DEPLOY.md`](../../comment_generation/space/DEPLOY.md) — authoritative |
| **Self-host via Docker Compose** | own hardware, one command | §1.1 below + [`docker-compose.yml`](../docker-compose.yml) |
| **HPC + SSH tunnel** (maintainer-only) | freshest weights, no Space rebuild; demo/dev | §1.2 below |

**Where each layer runs.** The three paths above cover the two backends; the
dashboard and the stateful bits are hosted independently of them.

| Layer | Today | Production target |
| --- | --- | --- |
| Dashboard | local `next dev`, or a container from this repo's Dockerfile | Vercel |
| comment_generation | HF Space (Docker SDK, T4 small) | same, or self-hosted GPU via compose |
| engagement_ml | HF Space (free CPU) | same, or self-hosted via compose |
| Memory + HITL sqlite | `/data` on the HF Space volume | persistent volume on the self-host box — see Persistence in §1.1 |
| Secrets | `.env.local` on the dev box + HF Space settings | host env or the platform's secret manager — see §4 |

### 1.1 Self-host with Docker Compose

The whole stack from a clean machine. Needs Docker and sibling checkouts of
`../comment_generation` and `../engagement_ml`.

**Compute floors**

| Service | Floor | Recommended |
| --- | --- | --- |
| engagement_ml | 2 vCPU / 1 GB RAM (CPU only) | 2 vCPU / 4 GB RAM |
| comment_generation | 1× T4 (16 GB) — Qwen3-4B class in 4-bit | 1× A10G / A100 (24 GB+) for fp16 |

**Get the model artefacts.** Neither repo commits its weights.

```bash
# engagement_ml — the six per-horizon bundles (~50 MB) go in models/:
#   winner_T{7,14,21,28,35,42}.pkl   platt_T{...}.pkl
#   feature_medians_T{...}.csv       feature_names_T{...}.csv
#   model_card_T{...}.json
# Copy them from the HF Space repo or the training box; the service
# fail-fasts at startup if any are missing.
ls ../engagement_ml/models/

# comment_generation — adapters are pulled from the HF Hub on first
# /generate call. Just pass a read-scoped HF_TOKEN; nothing to download
# by hand.
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

### 1.2 HPC + SSH tunnel (maintainer-only)

Not part of the HOPE-MOVE handover — it needs Coventry HPC credentials.
The comment service runs on **Brosnan** (`bronan` SSH alias, reached via
the `zeus` login node) bound to `:8011` because `:8001` is held by
JupyterHub there:

```bash
# on bronan
cd ~/Research/comment_generation
HOPE_API_AUTH=disabled \
HOPE_GEN_MODEL_ID=michaelajao/qwen3.5-4b-hope-forum-lora \
uvicorn service.main:app --host 0.0.0.0 --port 8011

# on the laptop — forward the port, then point COMMENT_GEN_URL at it
ssh -N -L 8011:localhost:8011 bronan
```

The tunnel is per-terminal: close it (or sleep the laptop) and the
backend goes offline until you reopen it.

---

## 2. Comment-generation models (the SLM)

### 2.1 Roster

The runtime resolves the adapter from `HOPE_GEN_MODEL_ID`. The dashboard's
model picker lists the **published Hub adapters** (`HOSTED_MODELS` in
[`service/generation_service.py`](../../comment_generation/service/generation_service.py),
surfaced by `GET /admin/models`); local on-disk ids in `MODEL_ID_TO_DIR` are
resolvable by env but intentionally hidden from the picker.

| `HOPE_GEN_MODEL_ID` (Hub id) | Picker label | Corpus |
| --- | --- | --- |
| `michaelajao/qwen3.5-4b-hope-forum-lora` | Qwen3.5 4B (forum) | **Default.** Production selection (paper B_nlp, 2026-07); best BERTScore in the roster |
| `michaelajao/qwen3-4b-hope-forum-clean-lora` | Qwen3 4B (forum) | previous keeper; second on BERTScore, same memory class as the default |
| `michaelajao/qwen3-1.7b-hope-forum-clean-lora` | Qwen3 1.7B (forum) | forum + activities |
| `michaelajao/qwen3-0.6b-hope-forum-clean-lora` | Qwen3 0.6B (forum) | economy; **runs on CPU**, 0.003 BERTScore off the leader |
| `michaelajao/qwen3-8b-hope-forum-clean-lora` | Qwen3 8B (forum) | heaviest; ~2× the VRAM and the slowest cold load, for **third**-place BERTScore. Not the quality choice — see §2.2 |
| `michaelajao/smollm3-3b-hope-only-lora` | SmolLM3 3B (activities) | cross-arch; activities-only corpus |
| `michaelajao/llama-3.2-3b-instruct-hope-only-lora` | Llama 3.2 3B (activities) | cross-arch; activities-only corpus |
| `michaelajao/gemma-4-e4b-it-hope-forum-lora` | Gemma-4 E4B (forum) | cross-family; omits `[name]` slot; clearly behind on BERTScore |

Older adapter repos (`michaelajao/qwen3-4b-hope-only-v5-lora`,
`michaelajao/qwen3-*-hope-only-lora`, `michaelajao/qwen3-{4,8}b-hope-forum-lora`)
still exist on the Hub and remain resolvable by `HOPE_GEN_MODEL_ID`, but they are
deliberately **not** in `HOSTED_MODELS`, so the picker does not offer them.

`/generate` returns **2–3 persona drafts** for activity posts (Gratitude → 2:
Empathetic + Goal-oriented; others → 3) and **1 warm reply** for `Discussion`
(forum) posts. `activity_type="Emotions"` is rejected (422) — no training signal
post-clean.

### 2.2 Which adapter to actually pick

Measured on the cleaned forum corpus, June 2026 runs
(`outputs/experiments/*/results/*_summary.json` in comment_generation):

| Model | BERTScore | ROUGE-L | BLEU-4 |
| --- | ---: | ---: | ---: |
| **Qwen3.5 4B (forum)** — default | **0.8729** | 0.1831 | 0.0171 |
| Qwen3 4B (forum-clean) | 0.8719 | 0.1779 | 0.0165 |
| Qwen3 8B (forum-clean) | 0.8710 | 0.1815 | **0.0177** |
| Qwen3 1.7B (forum-clean) | 0.8707 | 0.1808 | 0.0169 |
| Qwen3 0.6B (forum-clean) | 0.8700 | 0.1738 | 0.0160 |
| Gemma-4 E4B (forum) | 0.8452 | 0.1332 | 0.0137 |

Read this as a **near-tie among the Qwen models**: the whole spread is 0.0029
BERTScore, and `outputs_v5/bootstrap_vs_lead.csv` puts bootstrap CIs on
comparable deltas at ±0.001–0.0016. Only Gemma-4 separates clearly, downward.

Two practical conclusions:

- **The 8B is not the quality option.** It places third here for roughly double
  the VRAM and the slowest cold load. If you want headroom above the default,
  take Qwen3 4B (forum-clean) — second place, same memory class.
- **The 0.6B is a real option, not just a toy.** It is 0.0029 BERTScore off the
  leader and runs on CPU, so a GPU-less machine can still exercise the whole
  generation path rather than falling back to `HOPE_DISABLE_GENERATION=1` stubs.

> An earlier version of this roster described the 8B as "top-roster BERTScore".
> That held for the **pre-clean** 8B (0.8730 on the 2026-06-01 forum run). After
> the corpus clean it scores 0.8710 and both 4B models pass it. The claim is void.

**Shipping a subset?** If a deployment carries only some adapters, trim
`HOSTED_MODELS` to match — the picker reads that dict, and any entry whose
weights are unreachable fails at load time rather than being hidden.

### 2.3 Swap the adapter

- **At runtime, per workshop:** the dashboard topbar `ModelPicker` → `POST /admin/model`.
  The Space/process unloads the current adapter and loads the new one (~15–30 s).
  Selection is server-side global state — it affects every concurrent caller.
- **By env:** set `HOPE_GEN_MODEL_ID` and restart (Space factory-reboot, or re-run
  uvicorn on the HPC). Re-pushed weights to an **existing** Hub repo need a restart
  to re-fetch; new repos/ids are picked up on next load. No rebuild for either.

### 2.4 Retrain (HPC, GPU)

```bash
cd comment_generation
pytest tests/test_splits.py                 # confirm splits are leakage-clean
python -m src.finetune_dora --base_model <hf-id> --augmentation hope-forum ...
python -m src.evaluate --run-dir outputs/experiments/<new-run>
python scripts/push_to_hf.py --owner michaelajao --only <id>   # → private Hub repo
# then restart/swap (§2.3). See comment_generation/docs/hf_backup.md.
```

The recipe is DoRA (4-bit nf4 + DoRA), not plain QLoRA. Weights pushed to a repo
— not its name — set the corpus, so several `-hope-only`/`-v5` repo ids now host
forum-trained adapters.

---

## 3. Dropout-risk models (engagement_ml)

Per-horizon LightGBM, one model per trained horizon `T ∈ {7,14,21,28,35,42}`,
each with a Platt calibrator. Five files per horizon, ~30 MB total:

```text
models/
  winner_T7.pkl          … winner_T42.pkl     # LightGBM per horizon
  platt_T7.pkl           … platt_T42.pkl      # calibration
  feature_names_T7.csv   … feature_names_T42.csv
  feature_medians_T7.csv … feature_medians_T42.csv   # imputation
  model_card_T7.json     … model_card_T42.json       # metrics + provenance
```

The service reads them from `MODEL_DIR` (default `/app/deploy/models` in both
images) and **fail-fasts at startup if any of the 30 files is missing**. How they
get there differs by path:

| Path | How the bundles arrive |
| --- | --- |
| Docker Compose (`deploy/Dockerfile`) | **mounted** — compose maps `../engagement_ml/models` → `/app/deploy/models:ro`. They are gitignored, so a clean clone has none; see §3.1. |
| HF Space (`space/Dockerfile`) | **baked** — committed into the Space repo under `deploy/models/` and `COPY`d at build |

Held-out AUC by horizon: 0.84 (T=7), 0.88 (T=14), 0.90 (T=21–42) — temporal
hold-out (`effective_start >= 2025-09-01`), not LOCO. Exact per-horizon metrics,
hyperparameters, feature list, and the training git commit are in each
`model_card_T{T}.json`. The dashboard's week selector (W1–W6) maps each week to
one horizon; weeks are capped at `min(programmeLengthDays/7, 6)` (no T=49 model).

### 3.1 Getting the bundles

They are **not** on GitHub — `models/` is gitignored in engagement_ml, so a clean
clone has none. Two copies exist, both current as of 2026-08-06:

| Source | How to get it |
| --- | --- |
| Training box | `engagement_ml/models/` — where `optuna_runner.py narrow` writes them |
| `hope-dropout-api` Space repo | `git clone https://huggingface.co/spaces/michaelajao/hope-dropout-api` → `deploy/models/` (LFS; needs read access) |

Both hold the post-leakage-fix LightGBM set (Space commit `98e1cc8`, bundle
provenance `git_commit: 57db1b7`). Before trusting any copy — including an older
archive — check that it is the LightGBM generation and not the superseded
RandomForest one:

```bash
python -c "import json;print(json.load(open('models/model_card_T7.json'))['model_family'])"
# must print: lightgbm    (winner_T7.pkl ~2.4 MB; the old RF bundle was ~5.1 MB)
```

Re-push after any retrain with `engagement_ml/space/deploy.ps1`, which mirrors
`models/` into the Space and refuses to push unless all six `winner_T*.pkl` are
present.

**Update:** drop new `winner_T{T}.pkl` + `platt_T{T}.pkl` (plus the matching
`feature_*`/`model_card_*`) into the mounted `models/` and restart — bundles load
on startup, not per-request. **Retrain** on
the HPC; see [`engagement_ml`](https://github.com/michaelajao/engagement_ml). The
comment-gen engagement-fingerprint prompt path also reads
`cumulative_features_panel.parquet` (path set by `HOPE_DROPOUT_PANEL_PATH`); if
absent, `/generate` returns `engagement_used: false` and proceeds.

---

## 4. Required env vars

| Var | Service | Purpose |
| --- | --- | --- |
| `HOPE_API_AUTH` | both | `enabled` (prod) or `disabled` (local smoke) |
| `HOPE_RISK_API_KEY` | engagement_ml | 32-byte hex `X-API-Key` |
| `HOPE_API_SECRET` | comment-gen | 32-byte hex HMAC secret |
| `HOPE_GEN_MODEL_ID` | comment-gen | adapter to load. Default `michaelajao/qwen3.5-4b-hope-forum-lora` |
| `HF_TOKEN` | comment-gen | HF read token — needed to `snapshot_download` private adapters and to hit a private Space |
| `HOPE_DROPOUT_URL` | comment-gen | optional; engagement_ml `/health` for the engagement-aware prompt path |
| `HOPE_DROPOUT_PANEL_PATH` | comment-gen | optional; path to `cumulative_features_panel.parquet` |
| `HOPE_DASHBOARD_ORIGIN` | comment-gen | CORS allowlist on `/generate` |

The dashboard's matching `.env.local` keys (`COMMENT_GEN_URL`, `DROPOUT_API_URL`,
`HOPE_API_SECRET`, `HOPE_RISK_API_KEY`, `HF_TOKEN`) must align with whatever the
services run with. See [README → Configuration](../README.md).

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

- **HF Space:** Settings → Factory reboot (reloads adapter + re-reads env).
- **Docker Compose:** `docker compose restart comment-api` (or `risk-api`).
- **HPC:** stop and re-run the `uvicorn` command (§1).

### Health & smoke

```bash
curl -s http://localhost:8011/health        # comment-gen: {"status":"healthy","model_loaded":true,...}
curl -s http://localhost:8011/version       # {"model_version":"michaelajao/qwen3.5-4b-hope-forum-lora",...}
curl -s http://localhost:8011/admin/models  # the picker roster (current + options)
curl -s http://localhost:8000/health        # engagement_ml: {"status":"ok","horizons":[7,14,...]}
```

For a signed `/generate` smoke, drive it through the dashboard's
`/api/proxy/generate` route (it signs server-side) rather than hand-rolling HMAC.

### Inspect HITL signals (local)

```bash
sqlite3 comment_generation/outputs/hitl.sqlite \
  "SELECT ts, action, edit_distance FROM hitl_drafts ORDER BY id DESC LIMIT 20;"
```

### Error reference

| Symptom | Cause | Fix |
| --- | --- | --- |
| 401 `invalid HMAC signature` (comment-gen) | `HOPE_API_SECRET` mismatch dashboard ↔ service | align the secret, or run both with `HOPE_API_AUTH=disabled` for dev |
| 401 from a `*.hf.space` host | missing/invalid `HF_TOKEN` (private-Space gateway) | set a read-scoped `HF_TOKEN` |
| 404 on `/event` | `chosen_draft_id` not logged (service restarted between generate and event) | re-issue `/generate`, use the new ids |
| 422 on `/generate` | Pydantic validation — missing `post_text`, bad `activity_type` (e.g. `Emotions`) | fix the payload per the response detail |
| `dropout_api: unreachable` in `/health` | comment-gen can't reach `HOPE_DROPOUT_URL` | only affects engagement enrichment; risk panel reads engagement_ml directly |
| `engagement_used: false` always | panel parquet missing / wrong `HOPE_DROPOUT_PANEL_PATH` | re-vendor the parquet; generation still works |
| `memory_used: false` for a known participant | no memory rows for `(participant_id, cohort_id)` | backfill via `/memory/batch` or the backfill CLI |

---

## 6. Observability

| What | Where |
| --- | --- |
| Liveness | `GET /health` on both services |
| Model audit | `GET /model/info` on engagement_ml; `GET /version` on comment-gen |
| Prometheus metrics | `GET /metrics` on comment-gen (request latency, generate-time histogram, memory-hit rate) |
| Application logs | stdout — both use uvicorn's access log + Python `logging` |

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

- [HANDOVER.md](HANDOVER.md) — onboarding: model access, hosting tiers, known gaps
- [INTEGRATION.md](INTEGRATION.md) — API wire contract for platform callers
- [ARCHITECTURE.md](ARCHITECTURE.md) — why the system is shaped this way
- [comment_generation/space/DEPLOY.md](../../comment_generation/space/DEPLOY.md) — HF Space deploy (authoritative)
- [comment_generation/docs/openapi.yaml](../../comment_generation/docs/openapi.yaml) — authoritative OpenAPI spec
