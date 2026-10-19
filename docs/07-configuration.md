# 7. Configuration reference

Every environment variable, per component. **Values are never written
here.** Secrets live in Vercel (dashboard), in Space settings (services)
and in `.env.local` / `.env` locally. `.env.example` in this repo is the
annotated starting point for local setup.

Generate fresh secrets with:

```bash
openssl rand -hex 32     # HOPE_API_SECRET, HOPE_RISK_API_KEY / API_KEY, HOPE_HANDOFF_SECRET
npx auth secret          # AUTH_SECRET
```

## 7.1 Pairs that must match

A mismatch in any of these looks the same from the UI (drafts or scores
silently fail), so check them first.

| Dashboard variable | Must equal | Where |
| --- | --- | --- |
| `HOPE_API_SECRET` | `HOPE_API_SECRET` | Comment Space secret |
| `HOPE_RISK_API_KEY` | `API_KEY` | Risk Space secret (**different name, same value**) |
| `HOPE_API_AUTH` | `HOPE_API_AUTH` | Comment Space. Both `enabled` in production; `disabled` only for local smoke tests |
| `HOPE_CLIENT_ID` / `HOPE_CLIENT_SECRET` | The client registered on the platform | Magic Square |
| `HOPE_HANDOFF_SECRET` | The platform's hand-off signing secret | Only if hand-off sign-in is used outside local dev |
| `HF_TOKEN` | A token that can read the `h4cdev` Spaces | Hugging Face |

## 7.2 Dashboard

Set on Vercel by Magic Square for **Production**. Preview deployments do not
get the backend variables. After any change, redeploy.

### Required in production

| Variable | Purpose | If missing |
| --- | --- | --- |
| `AUTH_SECRET` | Signs and encrypts the NextAuth session | **Every `/api/auth/*` route 500s; nobody can sign in** |
| `HOPE_API_URL` | Platform base URL, currently `https://staging.poweredbyh4c.org` | No platform sign-in, cohorts or data |
| `HOPE_CLIENT_ID` | Platform client id (sent as `X-Client-Id`) | As above |
| `HOPE_CLIENT_SECRET` | Platform client secret (sent as `X-Client-Secret`) | As above |
| `COMMENT_GEN_URL` | Comment service base URL, `https://h4cdev-hope-comment-gen-api.hf.space` | Drafting 503 `backend_not_configured` |
| `DROPOUT_API_URL` | Risk service base URL, `https://h4cdev-hope-dropout-api.hf.space` | Scoring 503 `backend_not_configured` |
| `HF_TOKEN` | Bearer for the private Spaces' gateway (read scope is enough) | Spaces answer 401/404 |
| `HOPE_API_SECRET` | HMAC key for comment-service calls | 401 `invalid HMAC signature` |
| `HOPE_RISK_API_KEY` | `X-API-Key` for the risk service | 401 on scoring |
| `FIREBASE_SERVICE_ACCOUNT` | Base64 (or raw JSON) service-account key for Firestore | Snooze/contacted fail with 503 `queue_state_not_configured` |

### Optional

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOPE_API_AUTH` | (enabled) | `disabled` stops the dashboard signing comment-service calls. Local only |
| `AUTH_MODE` | `open` | Cohort visibility **only when the platform is not configured**: `open` = all, `allowlist` = only `FACILITATOR_COHORTS` |
| `FACILITATOR_COHORTS` | — | JSON `{"email":[cohortId,…]}`; used only without the platform integration |
| `AUTH_URL` | — | Local only (`http://localhost:3000`). Leave unset on Vercel |
| `HOPE_HANDOFF_SECRET` | falls back to `AUTH_SECRET` in the mint script | Verifies `/enter?token=` hand-off links |
| `HOPE_ENABLE_POST_COMMENT` | off | `1` lets this deployment publish replies to the platform |
| `HOPE_POST_COMMENT_COHORTS` | empty = none | Cohort ids/codes allowed to receive replies; `*` = all (go-live) |
| `HOPE_POST_COMMENT_DRY_RUN` | off | `1` = validate and log the payload, never send |
| `AZURE_STORAGE_CONNECTION_STRING` | — | Platform's storage account; signs read-only photo URLs. Unset = initials instead of photos |
| `AZURE_STORAGE_CONTAINER` | — | Container holding participant photos |
| `FIREBASE_DATABASE_ID` | `(default)` | Non-default Firestore database |
| `FIRESTORE_EMULATOR_HOST` | — | Local only; takes precedence over the service account |
| `FIREBASE_PROJECT_ID` | `hope-dashboard-dev` | Emulator only |
| `NEXT_PUBLIC_HOPE_MOVE_URL` | — | Shows a "Back to Hope Move" link; **baked in at build time** |

`VERCEL_DEPLOYMENT_ID`, `VERCEL_GIT_COMMIT_SHA` and `VERCEL_ENV` are
provided by Vercel and reported by `/api/debug/backends`.

## 7.3 Comment service

Defaults are the code defaults. "Space" shows what the production image or
Space settings set.

| Variable | Default | Space | Purpose |
| --- | --- | --- | --- |
| `HOPE_API_SECRET` | — | **secret** | HMAC key. Auth enabled with no secret → 500 |
| `HOPE_API_AUTH` | enforce | `enabled` (Dockerfile) | `disabled` skips HMAC |
| `HF_TOKEN` | — | **secret** | Pulls the private adapter (read by `huggingface_hub`) |
| `HOPE_GEN_MODEL_ID` | `h4cdev/qwen3.5-4b-hope-forum-lora` | Dockerfile; keep the Space variable **unset** | Adapter to serve |
| `HOPE_MODEL_LOCKED` | off | `1` | Refuse `/admin/model` swaps |
| `HOPE_PRELOAD_MODEL` | `1` | `1` | Load weights at startup |
| `HOPE_GEN_MAX_QUEUE` | `3` | `3` | Requests allowed to wait behind the running decode |
| `HOPE_DECODE_MAX_TIME_S` | `90` | — | Per-decode cap (0 = none) |
| `HOPE_GENERATE_BUDGET_S` | `180` | — | Whole draft-set cap (0 = none) |
| `HOPE_GROUNDING_CHECK` | off | **`1`** (Space variable) | Check drafts against the post; exactly `1` to enable |
| `HOPE_DISABLE_GENERATION` | off | — | `1` → `/generate` answers 503 `generation_disabled` (kill switch) |
| `HOPE_STATE_DIR` | `<repo>/outputs` | **unset (should be set, see [06 §6.3](06-data-and-storage.md#63-comment-service-sqlite))** | Where the SQLite files live |
| `HOPE_DASHBOARD_ORIGIN` | `http://localhost:3000` | — | Single CORS origin (irrelevant to server-to-server calls) |
| `HOPE_DROPOUT_URL` | `http://dropout-api:8000/health` | — | Optional risk-service probe shown in `/health` |
| `HOPE_DROPOUT_PANEL_PATH` | `/data/dropout_artifacts/cumulative_features_panel.parquet` | path set, **file not shipped** | Optional engagement panel; dashboard sends engagement in the request instead |
| `HOPE_PROMPT_VARIANT` | `paper` | — | Prompt template (`paper` or `grounded`) |
| `HOPE_TEMPERATURE`, `HOPE_MAX_NEW_TOKENS`, `HOPE_PRESENCE_PENALTY`, `HOPE_QWEN3_ENABLE_THINKING` | per call / off | — | Decoding overrides; leave unset |
| `VLLM_BASE_URL` | — | unset (no vLLM deployment) | Send decodes to a vLLM server |
| `VLLM_MODEL`, `VLLM_PORT`, `VLLM_MAX_MODEL_LEN`, `VLLM_GPU_MEMORY_UTILIZATION` | — / 8000 / 4096 / 0.85 | `Dockerfile.vllm` only | vLLM server settings |
| `HOPE_MODEL_VERSION`, `GIT_COMMIT` | — | — | Reported by `/version` |
| `HF_HOME` | — | `/data/.cache/huggingface` | Hub cache |

## 7.4 Risk service

| Variable | Default | Space | Purpose |
| --- | --- | --- | --- |
| `API_KEY` | — | **secret** | `X-API-Key`. Unset → protected routes 500 |
| `ALLOW_UNAUTHENTICATED` | unset | — | `1` disables the key check. Local only |
| `RATE_LIMIT_PER_MIN` | `60` | — | Per-key, per-instance |
| `CORS_ALLOW_ORIGINS` | empty | — | Comma-separated allowlist |
| `MODEL_DIR` | `<repo>/models` | `/app/deploy/models` | Where bundles are read from |
| `HF_TOKEN` (or `ml_model`) | — | **secret** | `fetch_models.py` reads the private model repo |
| `MODEL_REPO_ID` | `h4cdev/hope-move-engagement-ml` | Dockerfile | Model repo to fetch |
| `MODEL_REVISION` | `main` | — | Pin a model repo commit (rollback lever) |

## 7.5 Hugging Face Space secrets and variables

| Space | Secrets (names) | Variables (as of 2026-10-19) |
| --- | --- | --- |
| `h4cdev/hope-comment-gen-api` | `HOPE_API_SECRET`, `HF_TOKEN` | `HOPE_GROUNDING_CHECK=1` |
| `h4cdev/hope-dropout-api` | `API_KEY`, `HF_TOKEN` (older name `ml_model` also accepted) | none |

Secret values cannot be read back from Hugging Face. To verify one, compare
behaviour: a signed call that 401s means the pair in §7.1 differs.
