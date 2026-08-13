# HOPE Facilitator Assistant — handover

What an engineer needs in order to run, change, and redeploy this system.
Verified against the live system on **2026-08-13**.

---

## 1. What the system is

Three components. The dashboard is the only thing a facilitator opens; it
holds no models and no participant database.

| Component | Where | Port | What it does |
| --- | --- | --- | --- |
| Dashboard (Next.js 16) | this repo, deployed at `https://facilitator.poweredbyh4c.org` | 3000 | Facilitator UI. Server-side proxy routes inject every credential; the browser never sees a secret. |
| Comment service (FastAPI) | HF Space `h4cdev/hope-comment-gen-api` | 8001 | Persona reply drafts from a fine-tuned SLM, participant memory, MI safety gate, HITL capture. |
| Risk service (FastAPI) | HF Space `h4cdev/hope-dropout-api` | 8000 | Weekly dropout-risk score + contributing factors. |

Facilitators sign in by **platform hand-off only**: the Hope Move platform
links them to `/enter?token=<signed>` with a short-lived identity token.
There is no email form. For local development, mint a test link with
`node scripts/mint-handoff-token.mjs`.

Deeper reading: [ARCHITECTURE.md](ARCHITECTURE.md) (why it is shaped this
way), [INTEGRATION.md](INTEGRATION.md) (wire contract),
[OPERATIONS.md](OPERATIONS.md) (deploy paths, models, runbook).

---

## 2. The models — where they live

Everything is hosted under the **`h4cdev`** Hugging Face account, which the
programme controls. Nothing model-related depends on any personal or
research account.

| Artefact | Repo | Notes |
| --- | --- | --- |
| Comment adapter (production) | `h4cdev/qwen3.5-4b-hope-forum-lora` | Qwen3.5-4B DoRA; pinned via `HOPE_MODEL_LOCKED=1` |
| Comment adapter (CPU dev fallback) | `h4cdev/qwen3-0.6b-hope-forum-clean-lora` | Same corpus and contract; runs without a GPU |
| Risk bundles (8 horizons × 5 files) | `h4cdev/hope-move-engagement-ml` | The dropout Space fetches these at container start |

All three repos are **private** and carry a restricted licence — the
weights derive from participant data and are not open source. A read-scoped
HF token for `h4cdev` is required to pull any of them; the Spaces have one
as a secret already.

The services need no manual weight copying: the comment Space pulls its
adapter at startup, and the risk Space pulls its bundles at container
start. Self-hosting fetches the same artefacts via `snapshot_download` —
see [OPERATIONS.md §1.2](OPERATIONS.md).

**Retraining** is a different matter: both pipelines need the raw HOPE
platform export (real participant data, never committed anywhere), which
only the HOPE-MOVE data controller can release, plus a GPU box. Running
and swapping models needs neither.

---

## 3. What you should have

A missing item blocks a specific thing rather than failing vaguely.

| Item | Needed for | Missing it means |
| --- | --- | --- |
| This repo | the facilitator UI | — |
| `comment_generation` repo | changing the comment service | you can run against the hosted Space, but not modify it |
| `engagement_ml` repo | changing the risk service | same |
| HF access to the `h4cdev` account | models, Spaces, secrets | cannot pull weights or administer the Spaces |
| `HOPE_API_SECRET` | signing comment-service writes | 401 on `/generate` |
| `HOPE_RISK_API_KEY` | the risk service `X-API-Key` | 401 on `/predict` and `/batch` |
| `AUTH_SECRET` | dashboard sessions | **500 on every `/api/auth/*` route** — nobody can sign in |
| `HOPE_HANDOFF_SECRET` | verifying platform hand-off tokens | facilitators cannot arrive from Hope Move |

Each secret is documented in [OPERATIONS.md §4](OPERATIONS.md), and
`.env.example` is the copy-paste starting point. Generate fresh values for
anything you control — `openssl rand -hex 32` for the two API secrets,
`npx auth secret` for NextAuth.

Deployment note: the `NEXT_PUBLIC_*` variables are baked in **at build
time**. They must be present when CI builds the app, not just at runtime,
or the UI silently keeps its localhost defaults.

---

## 4. Hosting

| Layer | Production | Notes |
| --- | --- | --- |
| Dashboard | `https://facilitator.poweredbyh4c.org`, auto-deployed from this repo's `main` | every push to `main` deploys — prefer PRs with CI green |
| Comment service | HF Space, GPU (T4 small class), auto-sleep | sleeping Space = 60–90 s first request; tune sleep time vs. cost in Space settings |
| Risk service | HF Space, free CPU | sub-second warm requests |

Self-hosted alternative (own GPU box, one command): see
[OPERATIONS.md §1.2](OPERATIONS.md). No-GPU demo path:
`HOPE_DISABLE_GENERATION=1 docker compose up --build` gives the real UI
with canned drafts.

### Acceptance check — run before trusting any deployment

```bash
bash scripts/smoke_e2e.sh          # local: brings the stack up, then verifies it

# hosted Spaces — skip the local compose bring-up
SKIP_COMPOSE=1 \
COMMENT_GEN_URL=https://h4cdev-hope-comment-gen-api.hf.space \
DROPOUT_API_URL=https://h4cdev-hope-dropout-api.hf.space \
HOPE_API_AUTH=enabled HOPE_API_SECRET=<secret> \
  bash scripts/smoke_e2e.sh
```

It drives both live services end to end — `/health` on each, an
HMAC-signed `/generate`, `/event`, `/thumb`, and a `/batch` — and writes a
pass/fail table with latencies to `outputs/smoke_summary.md`. The two
services use *different* auth schemes (HMAC vs `X-API-Key`), and a
mismatch on either looks identical from the UI: drafts silently fail to
appear. This script names which credential is wrong.

Expect the first `/generate` after a cold Space to take 60–90 s while the
adapter loads; the script allows for it.

---

## 5. Data governance

`local/iih-coh*.json` are **real HOPE cohort bundles**. Display names are
pseudonymised (`P1`, `P2`, …) but the post free-text is genuine
participant writing including health disclosures. HOPE-MOVE owns this
data. **The repository must remain private**, its contents treated as
confidential, and raw bundles kept off shared screens.

These bundles are an interim data source; the platform API replacing them
is under construction. The conversion into the bundle shape the UI
consumes happens server-side (`src/lib/server/cohort-data.ts`) — see
[INTEGRATION.md](INTEGRATION.md) for the contract.

`comment_generation/outputs/hitl.sqlite` holds facilitator
accept/edit/reject signals and is **not rebuildable** — losing it loses
training signal. Back it up daily. `memory.sqlite` next to it is
rebuildable from platform events via `/memory/batch`.

The model weights carry a restricted licence (see LICENSE.md in each HF
repo): no redistribution, no commercial use, no use outside the HOPE-MOVE
programme without written agreement.

---

## 6. Known limitations

- **The comment service serves one model at a time, behind a lock.** No
  streaming, no concurrent generation. This is fine for a handful of
  facilitators; it is the first thing to address if you expect many at
  once. The fix is a vLLM (or TGI) backend behind the same FastAPI
  surface — but the adapters are DoRA, which those engines cannot load,
  so they must be merged into their bases first. The dashboard needs no
  change either way: it only talks to `/generate`.
- **Cold starts are slow.** The first `/generate` after a restart
  downloads and loads the adapter — expect 60–90 s. Warm requests are
  seconds. On a sleeping HF Space, add the container boot on top.
  Prewarm before a live session.
- **No facilitator-facing guide exists.** The documentation set assumes
  an engineer. If facilitators need written instructions, that has to be
  written.
- **`npm run typecheck` can fail on a stale `.next/`** if routes were
  deleted since the last build — `rm -rf .next && npm run typecheck`
  clears it. CI is unaffected, since it always builds from a clean
  checkout.
