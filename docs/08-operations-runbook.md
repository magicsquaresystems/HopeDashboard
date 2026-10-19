# 8. Operations runbook

Commands assume `HF_TOKEN` holds a token that can read the `h4cdev` Spaces,
and `KEY` / `SECRET` hold the risk API key and comment HMAC secret. Never
paste real values into tickets or chat.

## 8.1 Health checks

### Is the deployment configured?

Sign in to the dashboard, then open:

```text
https://facilitator.poweredbyh4c.org/api/debug/backends
```

It returns 404 without a session. With one, it reports:

- **`build`**: which commit and Vercel deployment are answering. Compare
  the commit with `main` to spot a variable that was added without a
  redeploy.
- **`env`**: which variables are set (secrets show only `set` and
  `length`), and Firestore `parsed: true`.
- **`queueStateBackend`**: should be `firestore`.
- **`posting`**: enabled, dry-run, and which cohorts may receive replies.
  **Check this before any go-live.**
- **`dropout` / `commentGen`**: each service's `/health`. Calling the
  comment service **wakes the GPU Space** (billing starts).

Quick sign-in check: `curl -s -o /dev/null -w '%{http_code}' https://facilitator.poweredbyh4c.org/api/auth/csrf`
must print `200`. A 500 means `AUTH_SECRET` is missing.

### Are the services up?

```bash
# Risk (free CPU; wakes in ~20 s from sleep)
curl -s -H "Authorization: Bearer $HF_TOKEN" https://h4cdev-hope-dropout-api.hf.space/health
# → {"status":"ok","horizons":[7,14,21,28,35,42,49,56],"winner_architecture":"lightgbm"}
curl -s -H "Authorization: Bearer $HF_TOKEN" -H "X-API-Key: $KEY" \
     https://h4cdev-hope-dropout-api.hf.space/model/info

# Comment (GPU; wakes in 1–3 min, then ~60 s to load the model; bills while awake)
curl -s -H "Authorization: Bearer $HF_TOKEN" https://h4cdev-hope-comment-gen-api.hf.space/health
# → {"status":"healthy","model_loaded":true,"grounding_check":"on",…}
curl -s -H "Authorization: Bearer $HF_TOKEN" https://h4cdev-hope-comment-gen-api.hf.space/version
```

Space state without waking anything:

```bash
python -c "from huggingface_hub import HfApi; a=HfApi(); \
[print(s, a.get_space_runtime(s).stage) for s in ('h4cdev/hope-comment-gen-api','h4cdev/hope-dropout-api')]"
```

`RUNNING`, `SLEEPING` (idle, not billing, wakes on request), `PAUSED`
(stopped, only the owner can restart), `BUILDING`, `RUNTIME_ERROR` (crashed:
read the logs).

### End-to-end smoke test (local stack)

```bash
bash scripts/smoke_e2e.sh                                   # brings up compose, auth disabled
HOPE_API_AUTH=enabled HOPE_API_SECRET=$SECRET bash scripts/smoke_e2e.sh
```

It calls `/health` on both services, a signed `/generate`, `/event` and
`/thumb`, and a `/batch`, then writes a pass/fail table to
`outputs/smoke_summary.md`. It names which credential is wrong when one is.

It sends no Hugging Face bearer, so it **cannot reach the private Spaces**.
Against production, check through the dashboard instead:
`/api/debug/backends` for both services' health, then generate a draft on
the test cohort. Any test generation writes research rows into
`hitl.sqlite`.

## 8.2 Logs

| Component | Where |
| --- | --- |
| Dashboard | Vercel → project → Logs (Magic Square has access). Useful lines: `hope auth: /api/auth/refresh returned <status>`, `hope comment published/rejected/refused/DRY RUN`, `cohort N: platform fetch failed`, `hope cohorts: fetch failed` |
| Spaces | Space page → Logs, or the streaming API below |

```bash
# run logs (startup, model load, requests, crashes); build logs: replace /run with /build
curl -N --max-time 30 -H "Authorization: Bearer $HF_TOKEN" \
  "https://huggingface.co/api/spaces/h4cdev/hope-comment-gen-api/logs/run?tail=100"
```

What to look for in the comment Space's log:
- `loading h4cdev/qwen3.5-4b-hope-forum-lora (base=Qwen/Qwen3.5-4B, cuda=True)`
  then `model ready`. This shows the right model loaded, on the GPU.
- `Started server process` twice within a minute means the container
  restarted. On a CPU tier that is the out-of-memory signature.
- `dropout-api probe … failed` is harmless (`HOPE_DROPOUT_URL` is unset on
  the Space).

## 8.3 Routine tasks

### Before a facilitator session

Wake the comment Space a few minutes ahead (open the dashboard and select
a participant, or `curl …/health`). The first draft after a cold start
otherwise takes 2–4 minutes. The Space sleeps again 15 minutes after the
last request.

### Restart a Space

Space page → Settings → **Restart**. This re-reads variables and secrets.
For the risk Space it also re-downloads the models. **Factory rebuild**
rebuilds the image too. From code: `HfApi().restart_space("h4cdev/<space>")`
(add `factory_reboot=True` to rebuild).

### Stop GPU billing

**Pause** the comment Space (Settings, below the sleep-time control), or
rely on the 15-minute sleep. **Do not downgrade it to a CPU tier.** The 4B
model cannot run there, and the Space crash-loops into `RUNTIME_ERROR`.

### Take drafting offline without breaking the UI

Set the Space variable `HOPE_DISABLE_GENERATION=1` and restart. `/generate`
then answers 503 `generation_disabled`, which the dashboard shows as
"comment generation is offline". Scoring and everything else keep working.
Delete the variable and restart to undo.

### Turn on sending replies for a cohort

Ask Magic Square to set on Vercel, then redeploy:

```text
HOPE_ENABLE_POST_COMMENT=1
HOPE_POST_COMMENT_COHORTS=<cohort CODE, comma-separated>   # codes, not ids: a typo matches nothing
HOPE_POST_COMMENT_DRY_RUN=1                                 # first pass; remove for the real test
```

Confirm in `/api/debug/backends` → `posting`, test on cohort
`MICHAEL-TEST-210826`, check the reply appears on the platform, and only
then widen the list. `*` (all cohorts) is a go-live decision for HOPE-MOVE,
not an engineering one.

### Update a model

See [05 §5.4](05-models-and-hugging-face.md#54-updating-a-model).

## 8.4 Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Every `/api/auth/*` 500s; nobody can sign in | `AUTH_SECRET` unset on Vercel | Set it, redeploy |
| `/login?error=not_configured` | `HOPE_API_URL`/`CLIENT_ID`/`CLIENT_SECRET` incomplete | Set all three |
| `/login?error=exchange_failed` (or redirect to `/api/auth/callback/hope-platform`) | Platform rejected the code exchange | Vercel log `hope auth: /api/auth/exchange returned <status>`. Codes are one-time; client id/secret wrong; platform 500 |
| `/login?error=session_expired` after ~15 min | Access-token refresh failed (rotation race between parallel requests is the leading suspect) | Vercel log `hope auth: /api/auth/refresh returned <status>`. A 401 there confirms the race. See [10](10-known-issues.md) |
| Cohort picker empty | Platform link broken (fails closed), platform outage, or no **Active** cohorts assigned | `/api/auth/session` → `hopeLinked`; Vercel log `hope cohorts: fetch failed`; ask the programme lead to check the assignment |
| Cohort opens with "bundle missing" | Platform fetch for that cohort failed and there is no local file (always the case on Vercel) | Vercel log `cohort N: platform fetch failed`; usually a platform 401/500 |
| Scores missing for a cohort | Cohort started less than 7 days ago (nothing scoreable yet), or a legacy research bundle without start provenance | Expected; wait, or re-extract the bundle |
| "Comment generation is offline" | Space asleep and still waking, crashed, kill switch on, or 503 `backend_not_configured` | `/api/proxy/comment-gen/status`; Space state; Space logs |
| 503 `generation_busy` | More than 4 concurrent generations | Expected on the current build; the dashboard retries 3× at 15/30/45 s. Real fix: vLLM ([10](10-known-issues.md)) |
| A draft set takes 1–3 min | Sequential persona decodes, retries and the grounding check | Expected on T4; prewarm |
| 401 `invalid HMAC signature` | `HOPE_API_SECRET` differs between Vercel and the Space | Set both to the same value |
| 401/404 from `*.hf.space` | `HF_TOKEN` missing, expired, or for an account without access | Replace the token |
| Scoring 401 | `HOPE_RISK_API_KEY` ≠ Space `API_KEY` | Align them |
| Scoring 422 | `score_at_day > programme_length_days`, an event outside the window, or bad field | Read the 422 detail; check the cohort's start/end dates on the platform |
| Snooze/contacted fails with 503 `queue_state_not_configured` | `FIREBASE_SERVICE_ACCOUNT` unset or malformed | `/api/debug/backends` → `FIREBASE_SERVICE_ACCOUNT.parsed` |
| Snooze/contacted start failing mid-afternoon | Firestore free-tier daily read quota exhausted | Move to Blaze ([06 §6.2](06-data-and-storage.md#62-firestore)) |
| Send → 503 `posting_disabled` / 403 `posting_not_allowed_for_cohort` | Posting policy | Intended; see §8.3 |
| Send → 503 `hope_not_linked` | Signed in by hand-off, no platform token | Sign in from the platform |
| Send → platform 4xx/5xx | Platform-side | The card shows the platform's reason; Vercel log `hope comment rejected … detail=` |
| Photos show initials | Azure variables unset, or the blob 404s | Expected without them |
| Comment Space `RUNTIME_ERROR` right after start | Wrong hardware (CPU) or the adapter id is wrong | Logs; restore T4; delete any `HOPE_GEN_MODEL_ID` Space variable |
| Risk Space fails to start | `fetch_models.py`: no token, or a bundle file missing in the model repo | Logs name the missing file; fix the upload or set `MODEL_REVISION` to the last good commit |

## 8.5 Rollback

| Component | How |
| --- | --- |
| Dashboard | Vercel: promote the previous deployment (instant), or revert on `main` |
| Comment service code | Re-run `space/deploy.sh` from the previous good commit of `comment_generation` |
| Reply model | Set `HOPE_GEN_MODEL_ID` back (variable or Dockerfile) and restart |
| Risk model | Space variable `MODEL_REVISION=<previous model-repo commit>`, restart |
| Risk service code | Revert the commit in the `h4cdev/hope-dropout-api` Space repo |

## 8.6 Rotating secrets

No service accepts two values at once, so a rotation is a short coordinated
outage of that one feature. Do it out of facilitator hours.

| Secret | Steps |
| --- | --- |
| `HOPE_API_SECRET` | New value → comment Space secret → restart Space → Vercel `HOPE_API_SECRET` → redeploy |
| `API_KEY` / `HOPE_RISK_API_KEY` | New value → risk Space `API_KEY` → restart → Vercel `HOPE_RISK_API_KEY` → redeploy |
| `HF_TOKEN` (dashboard) | Create a fine-grained read token on `h4cdev` → Vercel → redeploy → revoke the old one |
| `HF_TOKEN` (Spaces) | Replace each Space's secret → restart → revoke the old one |
| `AUTH_SECRET` | Vercel → redeploy. **Signs everyone out** |
| `HOPE_CLIENT_SECRET` | Magic Square issues a new one on the platform → Vercel → redeploy |
| `FIREBASE_SERVICE_ACCOUNT` | [06 §6.2](06-data-and-storage.md#62-firestore) |
| Azure storage | Platform rotates the account key → Vercel → redeploy |
