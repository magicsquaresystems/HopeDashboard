# 5. Models and Hugging Face

The **`h4cdev`** Hugging Face account belongs to the programme and holds
**only what production serves**: the reply adapter, the risk models, and the
two Spaces that serve them. Research artefacts, including every other
adapter trained during the study and the CPU-sized 0.6B adapter, live on the
researcher's own `michaelajao` account. That account is private and is not
part of the handover, and nothing in production may point at it.

Every repo below is **private**, and every model repo carries the
`hope-move-restricted` licence (`license: other`, text in each repo's
`LICENSE.md`). The weights derive from participant data: no redistribution,
no commercial use, no use outside the HOPE-MOVE programme without written
agreement. The `apache-2.0` tag on the Space cards covers only the Spaces'
own code, not the weights they load.

## 5.1 Inventory (checked 2026-10-19)

### Model repositories

| Repo | What | Size | Used by |
| --- | --- | --- | --- |
| `h4cdev/qwen3.5-4b-hope-forum-lora` | **Production reply adapter.** DoRA, r=16, α=32, all attention + MLP projections, on `Qwen/Qwen3.5-4B`. Trained 4-bit (QDoRA), 3 epochs, 4,193 train / 756 val pairs | 108 MB | Comment Space, pulled at start |
| `h4cdev/hope-move-engagement-ml` | **Risk model.** One model trained at 8 horizons, 5 files each (below), plus README and LICENSE. All 8 are needed: each programme week is scored by its own horizon | 5 MB | Risk Space, pulled at start |
| `h4cdev/qwen3.5-4b-hope-forum` | The production adapter **merged** into its base (float16, one safetensors file), for vLLM, which cannot load DoRA. Merged 2026-08-14 from adapter revision `bd22913`. **Not served by anything; due to move to the research account** | 8.4 GB | Nothing |

Removed from `h4cdev` on 2026-10-19 as research-only:
`qwen3-0.6b-hope-forum-clean-lora` (byte-identical copy on the research
account) and the paused `hope-comment-gen-vllm` Space (rebuildable from
`comment_generation` with `space/deploy.sh`). The merged checkpoint can
always be rebuilt from the production adapter with
`comment_generation/scripts/merge_adapter.py`.

### Spaces

| Space | Hardware | Sleep after | State on 2026-10-19 | Variables set |
| --- | --- | --- | --- | --- |
| `h4cdev/hope-comment-gen-api` | Nvidia **T4 small** | 15 min idle | SLEEPING (wakes on request) | `HOPE_GROUNDING_CHECK=1` |
| `h4cdev/hope-dropout-api` | CPU basic (free) | 48 h idle | RUNNING; `/health`, `/model/info` and a synthetic `/predict` all 200, the 8 versions match §5.3 | none |

The comment Space last started on 2026-09-14 and has not been used since.
No Space has persistent storage attached. Secret names each Space expects
are in [07 §7.5](07-configuration.md#75-hugging-face-space-secrets-and-variables).
Secret values are not readable through the API. Check them in the Space
settings.

The base model `Qwen/Qwen3.5-4B` is public and is downloaded from the Hub
by the comment Space at start.

## 5.2 The reply model

- **Selection.** `HOPE_GEN_MODEL_ID`, default
  `h4cdev/qwen3.5-4b-hope-forum-lora` (`DEFAULT_MODEL_ID` in
  `service/generation_service.py`; the same value is baked into
  `space/Dockerfile`). A **Space variable overrides the Dockerfile `ENV`**
  and needs only a restart. Keep `HOPE_GEN_MODEL_ID` **unset** on the
  production Space so the Dockerfile stays the single source of truth. A
  leftover variable once silently served the wrong model.
- **Pinning.** `HOPE_MODEL_LOCKED=1` makes `POST /admin/model` answer 409.
  It stops runtime swaps, not the startup choice above.
- **How it loads.** A Hub id goes through `snapshot_download` into
  `HF_HOME=/data/.cache/huggingface`. The base model named in
  `adapter_config.json` loads in 4-bit nf4 on CUDA (fp16 compute on Turing
  cards such as the T4, bf16 on Ampere and newer), then the adapter is
  applied. On CPU it loads fp32, about 16 GB, which **does not fit** CPU
  basic. That is why the comment Space must stay on a GPU tier.
- **Confirm what loaded.** `GET /version` → `model_version`; the Space log
  prints `loading <adapter> (base=…, cuda=True)` then `model ready` (about
  63 s on the T4). `cuda=True` confirms the GPU path.

Why this adapter: on the cleaned forum corpus (June 2026 runs) the Qwen
family was a near-tie on BERTScore (0.8700–0.8729), and the 3.5-4B led at a
manageable VRAM cost. Gemma-4 E4B was clearly worse. The evaluation-set
caveats are in `comment_generation/docs/EVAL_SETS.md`.

## 5.3 The risk models

Per horizon `T ∈ {7, 14, 21, 28, 35, 42, 49, 56}`:

```text
winner_T{T}.pkl          LightGBM classifier
platt_T{T}.pkl           Platt calibration (fit on 5-fold out-of-fold training scores)
feature_names_T{T}.csv   feature order (26 features at T7, 30 at T14, 31 from T21)
feature_medians_T{T}.csv imputation values
model_card_T{T}.json     metrics, thresholds, provenance
```

- **Target.** Programme non-completion, one fixed outcome per enrolment.
  The weekly models use cumulative behaviour up to the horizon.
- **Evaluation.** Temporal hold-out (`effective_start ≥ 2025-09-01`). AUC
  by horizon, as served live on 2026-10-19: T7 0.845, T14 0.877, T21 0.893,
  T28 0.895, T35 0.898, T42 0.901, T49 0.906, T56 0.910. PR-AUC and Brier
  scores are in each card and in `/model/info`.
- **Tiers.** "High" from the card's `decision_threshold_raw`, fit for recall
  ≥ 0.90. "Low" cut-off is half of it. Both are mapped through Platt, so the
  thresholds the API returns are on the calibrated scale.
- **Version string.** `lightgbm_T{T}@<md5(winner pkl)[:12]>`. Live versions:
  T7 `d1887c802c7d`, T14 `e2838c66a7b5`, T21 `5a6295333dba`, T28
  `cf19b000a325`, T35 `34d942a5389f`, T42 `01b06326307b`, T49
  `87190fe0c748`, T56 `3bf51eab3081`. They match the files in the model repo
  (verified 2026-10-16).
- **Provenance.** Every card records `git_commit "b284afe"` (a clean
  `engagement_ml` tree), label hash `00e432f11042a6df`, scikit-learn 1.8.0.
  Load the pickles only with the pinned versions in
  `engagement_ml/deploy/requirements.txt`.
- **Feature contract.** Cards with no `feature_definitions` field are served
  as `all_activities_v1`, which is all eight live cards
  (`src/feature_contract.py`).

## 5.4 Updating a model

### Risk model (no image rebuild)

1. Retrain in `engagement_ml` (`python src/optuna_runner.py narrow`, see that
   repo's README) and check the new cards.
2. Upload the 40 serving files to `h4cdev/hope-move-engagement-ml`, in a
   **single commit** so the Space never sees a mix of old and new files:
   ```bash
   hf upload h4cdev/hope-move-engagement-ml engagement_ml/models . \
       --include "*_T*.pkl" "*_T*.csv" "*_T*.json" --commit-message "Refit at <commit>"
   ```
3. Restart `h4cdev/hope-dropout-api`. `fetch_models.py` downloads the files
   at start and **refuses to start if any of the 40 is missing**.
4. Check `GET /model/info` shows the new versions, then score a known
   participant through the dashboard.

To pin a known-good set, set the Space variable `MODEL_REVISION` to a model
repo commit and restart. To roll back, set it to the previous commit.

### Reply adapter

1. Train and evaluate in `comment_generation` (`src/finetune_dora.py`,
   `scripts/evaluate_adapters.py`). `scripts/push_to_hf.py` uploads an
   adapter as a private repo. Pass `--owner h4cdev`, because its default
   targets are research adapters.
2. Publish under a **new repo name**, rather than overwriting the
   production repo, so rollback is a variable change.
3. Point production at it: change `ENV HOPE_GEN_MODEL_ID` in
   `comment_generation/space/Dockerfile` **and** `DEFAULT_MODEL_ID` in
   `service/generation_service.py` (keep the two equal), then deploy
   ([02 §2.4](02-environments.md#24-how-the-model-services-deploy)).
   A Space variable works too for a trial, but delete it afterwards.
4. Confirm with `/version` and a test draft on the test cohort.
5. If vLLM is ever adopted, build a merged checkpoint of the new adapter
   with `scripts/merge_adapter.py` (fp32 merge arithmetic; it also fixes the
   Qwen3.5 weight-key layout vLLM rejects), check it with
   `scripts/verify_merge.py`, and publish it under `h4cdev` only once it is
   actually served.

Retraining either model needs the raw platform export (participant data,
never committed, released only by the HOPE-MOVE data controller) and, for
the reply model, a GPU. Running and swapping models needs neither.

## 5.5 Accessing the account

`h4cdev` is a programme-owned account used through a shared login, which
H4C controls (details in `docs/private/`). For automation, prefer a
**fine-grained token scoped to these repos**:

| Use | Scope needed |
| --- | --- |
| Dashboard `HF_TOKEN` (reaches the private Spaces) | Read |
| Space `HF_TOKEN` secrets (pull weights) | Read on the model repo(s) |
| Deploying Spaces, uploading models, pausing/restarting | Write |

Check which account a CLI is using before any upload: `hf auth whoami`.
