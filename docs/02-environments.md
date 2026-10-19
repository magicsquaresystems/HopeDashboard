# 2. Environments and deployment

## 2.1 What exists

There is **one live environment**. It is labelled Production on Vercel but
is wired to the Hope Move platform's **staging** system. There is no
separate dashboard staging deployment.

| Environment | Dashboard | Platform it talks to | Model services | Used for |
| --- | --- | --- | --- | --- |
| **Live ("Production")** | Vercel project (Magic Square), `https://facilitator.poweredbyh4c.org`, built from `main` | `https://staging.poweredbyh4c.org` (`HOPE_API_URL`) | The two `h4cdev` HF Spaces | Facilitator testing and pilots on the staging platform |
| **Vercel Preview** | Automatic per-branch/PR builds | Whatever Preview env vars hold | **None.** Backend URLs are set for Production only, so scoring and drafting answer 503 `backend_not_configured` | Checking UI changes only |
| **Local** | `npm run dev` on `localhost:3000` | None by default (hand-off sign-in, `local/` research bundles), or staging if you have client credentials | Hosted Spaces, or the Docker Compose stack | Development |

"Staging" in this project therefore means the **platform's** staging
environment, which holds real test and pilot cohorts. When the platform
gets a production environment, the switch is a Vercel change made by Magic
Square: `HOPE_API_URL`, `HOPE_CLIENT_ID`, `HOPE_CLIENT_SECRET`, and possibly
the Azure storage values. No code changes.

### Hostnames

| Host | What |
| --- | --- |
| `facilitator.poweredbyh4c.org` | The dashboard (Vercel custom domain) |
| `staging.poweredbyh4c.org` | Hope Move platform, staging. API under `/api/auth/*` and `/api/dashboard/*` |
| `h4cdev-hope-dropout-api.hf.space` | Risk service (private Space, needs an HF bearer) |
| `h4cdev-hope-comment-gen-api.hf.space` | Comment service (private Space, needs an HF bearer) |

## 2.2 Who controls what

| Thing | Controlled by | How you change it |
| --- | --- | --- |
| Dashboard code | This repo (`magicsquaresystems/HopeDashboard`, public). HOPE team has push access | PR into `main` |
| Dashboard deployment and env vars | Magic Square (Vercel project) | Ask Magic Square. Env changes need a redeploy |
| Platform API, platform staging | Magic Square | Ask Magic Square |
| HF Spaces and model repos | The `h4cdev` Hugging Face account (shared programme login) | HF web UI, `huggingface_hub`, or the deploy scripts in each service repo |
| Comment / risk service code | `comment_generation`, `engagement_ml` repos | PR, then deploy to the Space (§2.4) |
| Firestore project | H4C Google account | Firebase console |

Who holds which credential, and the personal contacts, are in
`docs/private/`.

## 2.3 How the dashboard deploys

```text
PR → CI (lint · typecheck · test · build) → merge to main → Vercel builds and deploys to production
```

- Every push to `main` deploys. There is no manual gate after merge.
- CI (`.github/workflows/ci.yml`) runs on pushes to `main` and on PRs, on
  Node 22.
- Vercel bakes environment variables into a build. After Magic Square
  changes one, it does nothing until the next deployment. An empty commit
  is the usual way to trigger one.
- To see which commit and deployment are answering, and which variables
  they hold, sign in and open `/api/debug/backends`
  ([08](08-operations-runbook.md#is-the-deployment-configured)).
- **Rollback:** in Vercel, promote the previous deployment (Magic Square),
  or revert the commit on `main` and let it redeploy.

## 2.4 How the model services deploy

Both Spaces are Docker Spaces. Their repos on Hugging Face hold a
**generated copy** of the service code, pushed by a script in the source
repo. Do not edit them by hand. The next deploy overwrites them.

| Space | Source | Deploy | Live revision (2026-10-19) |
| --- | --- | --- | --- |
| `h4cdev/hope-comment-gen-api` | `comment_generation` | `space/deploy.sh` (preferred; defaults to `h4cdev/hope-comment-gen-api`) or `space/deploy.ps1`. Clones the Space repo, mirrors `service/` and `src/`, commits `deploy: sync from comment_generation@<rev>`, pushes. The Space rebuilds | `comment_generation@2565f4e` (2026-09-02, `main`) |
| `h4cdev/hope-dropout-api` | `engagement_ml` for the API code. Its `Dockerfile`, `entrypoint.sh` and `fetch_models.py` exist **only in the Space repo** | See the warning below | Space commit `2f18426` (2026-08-12) |

> **Warning: the risk service's deploy script is stale.**
> `engagement_ml/space/deploy.ps1` and `engagement_ml/space/Dockerfile`
> still target the retired `michaelajao/hope-dropout-api` Space and bake the
> models into the image. The live `h4cdev` Space does neither. It downloads
> the models from `h4cdev/hope-move-engagement-ml` at container start
> (`fetch_models.py`). Running that script as-is would deploy to the wrong
> Space. To change the risk service's **code**, clone the `h4cdev` Space
> repo, copy in `deploy/api/` and `src/` from `engagement_ml`, and push.
> Keep the Space's own `Dockerfile`, `entrypoint.sh` and `fetch_models.py`.
> To change only the **model**, see [05 §5.4](05-models-and-hugging-face.md#54-updating-a-model).
> Porting the Space's three files back into `engagement_ml/space/` is open
> work ([10](10-known-issues.md)).

Before any deploy to the comment Space, check the HF CLI is authenticated
as `h4cdev` (`hf auth whoami`). This machine's token file can be silently
switched to another account. `deploy.sh` refuses a mismatched token, but
`deploy.ps1` only warns.

## 2.5 Release state

As of 2026-10-19 there is a coordinated release waiting. It is reviewed
locally but **not deployed**.

| Repo | Live | Release candidate | What the candidate changes |
| --- | --- | --- | --- |
| `hope-dashboard` | `main` @ `0fcedc7` | branch `fix/training-inputs-and-reply-workflow-20261016` | Prediction inputs aligned with training ([03 §3.8](03-dashboard.md#38-scoring-weeks-and-the-prediction-input-contract)); Copy and Send recorded separately; memory reconciled from platform posts before generation |
| `comment_generation` | `main` @ `2565f4e` | branch `fix/reply-safety-memory-feedback-20261016` @ `e8937ca` | Adds `/copy`, `delivery_confirmed`, owner and cohort checks on feedback, additive SQLite migrations, `HOPE_STATE_DIR`, `scripts/backup_state.py` |
| `engagement_ml` | Space as above | branch `fix/cohort-reporting-and-input-validation-20261016` | Docs and reporting corrections. **No model or threshold change** |

The dashboard candidate calls endpoints that only exist on the comment
service candidate. **Deploy the comment service first, then merge the
dashboard.** Rolling back means rolling back both. The comment service's
SQLite migrations are additive (new columns and an index), so an older
build still reads a migrated database.

Release checklist: [09 §9.4](09-development-and-release.md#94-cutting-a-release).

## 2.6 Test cohort

Test against **`MICHAEL-TEST-210826`, cohort id 1743** (module 344 "HOPE
MOVE", 49-day programme, started 2026-08-21). It holds three dummy
participant accounts and one support facilitator. It is the only cohort
that should ever be in `HOPE_POST_COMMENT_COHORTS` before go-live.

- Facilitators only see **Active** cohorts. The platform hides archived
  ones by design, so a test cohort has to stay Active.
- A cohort cannot be risk-scored until one full week has elapsed. Drafting
  works from day one.
- The test logins are in `docs/private/`.
