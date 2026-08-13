# HOPE Facilitator Assistant — handover

What the HOPE-MOVE engineer needs in order to run, change, and redeploy this
system without access to the research machines.

> **This is an onboarding document, not a living reference.** It was verified
> against the system on **2026-08-06** and describes where things stood then —
> notably which namespace hosts the models. Once they are re-hosted under your
> own accounts, most of §2 no longer applies.
>
> **Delete this file once you have re-hosted.** Anything still true by then
> belongs in [README.md](../README.md), [ARCHITECTURE.md](ARCHITECTURE.md), or
> [OPERATIONS.md](OPERATIONS.md) — the three docs that are maintained.

---

## 1. What the system is

Three components. The dashboard is the only thing a facilitator opens; it holds
no models and no participant database.

| Component | Repo | Port | What it does |
| --- | --- | --- | --- |
| Dashboard (Next.js 16) | `hope-dashboard` | 3000 | Facilitator UI. Server-side proxy routes inject every credential; the browser never sees a secret. |
| Comment service (FastAPI) | `comment_generation` | 8001 | Persona reply drafts from a fine-tuned SLM, participant memory, MI safety gate, HITL capture. |
| Risk service (FastAPI) | `engagement_ml` | 8000 | Weekly dropout-risk score + contributing factors. |

Deeper reading: [ARCHITECTURE.md](ARCHITECTURE.md) (why it is shaped this way),
[INTEGRATION.md](INTEGRATION.md) (wire contract),
[OPERATIONS.md](OPERATIONS.md) (deploy paths, model roster, runbook).

---

## 2. The models — where they are and how to get them

This is the part that is **not** solved by cloning the repos. Neither repo
commits weights, and the two model families are distributed completely
differently.

### 2.1 Comment service — LoRA/DoRA adapters (HF Hub)

At runtime nothing is copied by hand: the service calls `snapshot_download` on
first `/generate` and caches to the HF cache volume, so a running deployment only
needs an HF token with read access. **To own the models outright** — hosting them
on your own servers or your own HF account with no external dependency — take the
weight directories themselves; see below.

Nine private repos under `michaelajao/` on huggingface.co; eight are in the
picker (`HOSTED_MODELS` in `comment_generation/service/generation_service.py`):

| Adapter repo | Picker label |
| --- | --- |
| `michaelajao/qwen3.5-4b-hope-forum-lora` | Qwen3.5 4B (forum) — **production default** |
| `michaelajao/qwen3-4b-hope-forum-clean-lora` | Qwen3 4B (forum) |
| `michaelajao/qwen3-1.7b-hope-forum-clean-lora` | Qwen3 1.7B (forum) |
| `michaelajao/qwen3-0.6b-hope-forum-clean-lora` | Qwen3 0.6B (forum) — runs on CPU |
| `michaelajao/qwen3-8b-hope-forum-clean-lora` | Qwen3 8B (forum) |
| `michaelajao/smollm3-3b-hope-only-lora` | SmolLM3 3B (activities) |
| `michaelajao/llama-3.2-3b-instruct-hope-only-lora` | Llama 3.2 3B (activities) |
| `michaelajao/gemma-4-e4b-it-hope-forum-lora` | Gemma-4 E4B (forum) |

They are **adapters, not full models** — tens of MB each. The base weights
(`Qwen/Qwen3.5-4B`, `Qwen/Qwen3-*`, `HuggingFaceTB/SmolLM3-3B`,
`meta-llama/Llama-3.2-3B-Instruct`, `google/gemma-4-E4B-it`) are pulled from
their public upstream repos at load time. **The Llama and Gemma bases are
license-gated**: whoever owns the HF token must have accepted those licenses, or
those two picker entries will 403. The six Qwen entries have no such gate.

**Getting the raw weights** (so you can host them on your own servers or your
own HF account, with no external dependency):

An adapter is just a directory: `adapter_config.json`,
`adapter_model.safetensors`, `tokenizer.json`, `tokenizer_config.json`,
`chat_template.jinja`, `training_meta.json`. Copy it and it works anywhere.

**The simplest export path is to download all eight from the Hub** — this works
uniformly and does not need HPC access:

```bash
for r in qwen3.5-4b-hope-forum-lora qwen3-4b-hope-forum-clean-lora \
         qwen3-1.7b-hope-forum-clean-lora qwen3-0.6b-hope-forum-clean-lora \
         qwen3-8b-hope-forum-clean-lora smollm3-3b-hope-only-lora \
         llama-3.2-3b-instruct-hope-only-lora gemma-4-e4b-it-hope-forum-lora; do
  hf download "michaelajao/$r" --local-dir "export/$r"
done
```

Total ≈ **734 MB** for all eight — small enough for a drive or a direct transfer.

Original training outputs live on the Coventry HPC (Brosnan) under
`~/Research/comment_generation/models/<BASE>_<corpus>/final/`, if you need the
pre-publication artefacts (`training_log.json`, intermediate checkpoints):

| HPC directory | Publishes as |
| --- | --- |
| `Qwen--Qwen3.5-4B_hope-forum` | `qwen3.5-4b-hope-forum-lora` (default) |
| `Qwen--Qwen3-4B_hope-forum_clean` | `qwen3-4b-hope-forum-clean-lora` |
| `Qwen--Qwen3-1.7B_hope-forum_clean` | `qwen3-1.7b-hope-forum-clean-lora` |
| `Qwen--Qwen3-0.6B_hope-forum_clean` | `qwen3-0.6b-hope-forum-clean-lora` |
| `Qwen--Qwen3-8B_hope-forum_clean` | `qwen3-8b-hope-forum-clean-lora` |
| `google--gemma-4-E4B-it_hope-forum` | `gemma-4-e4b-it-hope-forum-lora` |

Note that `smollm3-3b-hope-only-lora` and `llama-3.2-3b-instruct-hope-only-lora`
have no HPC copy — for those two the published repo is the only source, so take
them from the Hub.

**Re-hosting.** Upload the folders to your own HF namespace with
`scripts/push_to_hf.py --owner <your-org>`, then update `HOSTED_MODELS` and
`DEFAULT_MODEL_ID` in `service/generation_service.py`. After that the system runs
entirely on your own accounts.

Two constraints worth knowing before you plan serving:

- These are **DoRA** adapters (`use_dora: true`, r=16, α=32). PEFT/transformers
  loads them fine; **vLLM, TGI, SGLang and llama.cpp cannot load DoRA adapters
  directly.** To serve on any of those, merge first with
  `PeftModel.merge_and_unload()`, which produces a standalone full-weight
  checkpoint (~8 GB fp16 for a 4B). Merging is also what makes the model fully
  self-contained.
- The base weights are pulled from their public upstream repos at load time, so
  the runtime needs outbound access to HF (or a local mirror of the bases).

### 2.2 Risk service — per-horizon bundles

Thirty files, ~30 MB, six horizons `T ∈ {7,14,21,28,35,42}`, five files each:

```text
winner_T{T}.pkl           LightGBM classifier
platt_T{T}.pkl            calibrator
feature_names_T{T}.csv    column order
feature_medians_T{T}.csv  imputation values
model_card_T{T}.json      metrics, hyperparameters, provenance
```

The service reads them from `MODEL_DIR` and **refuses to start if any of the 30
is missing** — deliberate, so a misconfigured deploy crashes visibly instead of
serving nonsense.

`models/` is gitignored in `engagement_ml`, so **cloning the repo gets you
none of them.** Two copies exist, both current (verified 2026-08-06):

| Location | State |
| --- | --- |
| Training box: `engagement_ml/models/` | LightGBM, post-leakage-fix, `git_commit: 57db1b7` |
| Space repo `michaelajao/hope-dropout-api` → `deploy/models/` | Same set, LFS-tracked, Space commit `98e1cc8`. Live endpoint reports `winner_architecture: lightgbm`. |

Sanity-check any copy before trusting it — an older archive may hold the
superseded RandomForest generation:

```bash
python -c "import json;print(json.load(open('models/model_card_T7.json'))['model_family'])"
# must print: lightgbm    (winner_T7.pkl ~2.4 MB; the old RF bundle was ~5.1 MB)
```

**To hand them to an engineer who will host on their own infrastructure,** copy
the 30 files directly — they are ~30 MB and self-describing (each
`model_card_T{T}.json` carries metrics, hyperparameters, feature list, library
versions, and the training commit). The receiving side sets `MODEL_DIR` to
wherever they land. Note the pickles are scikit-learn/LightGBM artefacts and
**will not load across a scikit-learn major version** — pin to the versions in
the model card's `provenance` block.

### 2.3 Retraining

The engineer cannot retrain either model from what is in the repos — both
pipelines need the raw HOPE platform export (real participant data, never
committed). Retraining requires the export from the HOPE-MOVE data controller
plus a GPU box. Running and swapping models needs neither.

---

## 3. What you should have

Check you have all of this before starting — a missing item blocks a specific
thing rather than failing vaguely.

| Item | Needed for | Missing it means |
| --- | --- | --- |
| `hope-dashboard` repo | the facilitator UI | — |
| `comment_generation` repo | the comment service | you can run against a hosted endpoint, but cannot self-host or change it |
| `engagement_ml` repo | the risk service | same |
| SLM adapter folders (§2.1) | reply generation | `/generate` cannot load a model |
| Risk bundles, all 30 files (§2.2) | risk scoring | the risk service refuses to start |
| `HOPE_API_SECRET` | signing comment-service writes | 401 on `/generate` |
| `HOPE_RISK_API_KEY` | the risk service `X-API-Key` | 401 on `/predict` and `/batch` |
| `AUTH_SECRET` | dashboard login | generate your own with `npx auth secret` |
| An HF token with read access to the model repos | pulling adapters and base weights | model download fails |

Each secret is documented in [OPERATIONS.md §4](OPERATIONS.md), and
`.env.example` in each repo is the copy-paste starting point. Generate fresh
values for anything you control — `openssl rand -hex 32` for the two API
secrets.

Retraining additionally needs the raw platform export, which only the HOPE-MOVE
data controller can release (§2.3).

---

## 4. Hosting tiers

| Tier | Shape | Cost / notes |
| --- | --- | --- |
| **1 — managed** | Comment service on an HF T4 Space, risk service on a free CPU Space, dashboard on Vercel | ~$0.40/hr for the T4 and **there is no auto-shutoff** — pause it after every demo or it bills ~$288/mo. Set `AUTH_SECRET` on Vercel; do **not** set `AUTH_URL` or `AUTH_TRUST_HOST`. |
| **2 — own GPU box (recommended steady state)** | `docker compose up --build` from `hope-dashboard`, 16 GB+ GPU, Linux | One command, no per-hour cost. Needs sibling checkouts of both service repos and the risk bundles present at `../engagement_ml/models/`. |
| **3 — cloud GPU** | RunPod / Lambda running the same compose stack | Use when Tier 2 hardware is unavailable. |

No-GPU demo path, any tier: `HOPE_DISABLE_GENERATION=1 docker compose up --build`
gives the real UI with canned drafts.

### Acceptance check — run this on every tier before calling it done

```bash
bash scripts/smoke_e2e.sh          # brings the stack up, then verifies it
```

It drives both live services end to end — `/health` on each, an HMAC-signed
`/generate`, `/event`, `/thumb`, and a `/batch` — and writes a pass/fail table
with latencies to `outputs/smoke_summary.md`.

**Run it before you trust a deployment.** The two services use *different* auth
schemes (HMAC for comment-gen, `X-API-Key` for risk), and a mismatch on either
looks identical from the UI: drafts silently fail to appear. This script names
which credential is wrong. It is the only functional verification in the repo —
CI runs lint, typecheck, and build, which prove the dashboard compiles, not that
it can reach anything.

Point it at whichever tier you are testing:

```bash
# hosted Spaces (Tier 1) — skip the local compose bring-up
SKIP_COMPOSE=1 \
COMMENT_GEN_URL=https://<owner>-hope-comment-gen-api.hf.space \
DROPOUT_API_URL=https://<owner>-hope-dropout-api.hf.space \
HOPE_API_AUTH=enabled HOPE_API_SECRET=<secret> \
  bash scripts/smoke_e2e.sh
```

Expect the first `/generate` after a cold Space or a model swap to take 60–90 s
while the adapter loads; the script allows for it.

---

## 5. Data governance

`local/iih-coh*.json` in this repo are **real HOPE cohort bundles**. Display
names are pseudonymised (`P1`, `P2`, …) but the post free-text is genuine
participant writing including health disclosures. They ship with the repo
deliberately, so HOPE-MOVE can demo against real content — HOPE-MOVE owns this
data. Treat the repo as confidential and do not put raw bundles on a shared
screen.

`comment_generation/outputs/hitl.sqlite` holds facilitator accept/edit/reject
signals and is **not rebuildable** — losing it loses training signal. Back it up
daily. `memory.sqlite` next to it is rebuildable from platform events via
`/memory/batch`.

---

## 6. Known limitations

Real constraints in the system as delivered, so none of them is a surprise.

- **The comment service serves one model at a time, behind a lock.** No
  streaming, no concurrent generation, and switching adapters costs a 15–30 s
  unload/reload that stalls every caller. This is fine for demos and one or two
  facilitators; it is the first thing to address if you expect several at once.
  The fix is a vLLM (or TGI) backend behind the same FastAPI surface — but the
  adapters are DoRA, which those engines cannot load, so they must be merged
  into their bases first (§2.1). The dashboard needs no change either way: it
  only talks to `/generate` and `/admin/models`.
- **Cold starts are slow.** The first `/generate` after a restart or a model
  swap downloads and loads the adapter — expect 60–90 s. Warm requests are
  seconds. On a sleeping HF Space, add the container boot on top. Prewarm before
  a live session.
- **No facilitator-facing guide exists.** The documentation set assumes an
  engineer. If facilitators need written instructions, that has to be written.
- **`npm run typecheck` can fail on a stale `.next/`** if routes were deleted
  since the last build — `rm -rf .next && npm run typecheck` clears it. CI is
  unaffected, since it always builds from a clean checkout.
- **There is no unit-test suite.** CI runs lint, typecheck, and build. The
  functional check is the end-to-end smoke in §4.
