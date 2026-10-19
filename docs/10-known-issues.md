# 10. Known issues and open work

Ordered by impact. Each item says what breaks, why, and what fixing it
involves. Security-sensitive findings are tracked in `docs/private/`, not
here.

## Data and reliability

1. **Comment-service databases are wiped on restart.** The comment Space
   has no persistent storage and `HOPE_STATE_DIR` is unset, so
   `hitl.sqlite` (all facilitator feedback) and `memory.sqlite` reset
   whenever the Space sleeps (after 15 idle minutes), restarts or rebuilds.
   *Fix:* attach persistent storage, set `HOPE_STATE_DIR=/data/state`,
   schedule `scripts/backup_state.py` with an off-Space copy and a retention
   rule. Or move both stores to a managed database, which is also needed for
   replicas. [06 §6.3](06-data-and-storage.md#63-comment-service-sqlite)

2. **Facilitators are signed out at about the 15-minute mark in some
   sessions.** The platform rotates refresh tokens. Several parallel
   requests can each try to refresh with the same token, the losers are
   rejected, and a losing response can overwrite the winner's cookie. The
   code already tolerates a failed refresh while the old token is valid.
   *Diagnose* with the Vercel log line `hope auth: /api/auth/refresh
   returned <status>` (a 401 confirms it). *Fix:* single-flight refresh
   (needs shared state across serverless instances), or a platform-side
   grace period for the previous refresh token.

3. **Firestore free-tier quota.** 50k reads/day can be exhausted by two
   facilitators working a busy cohort all day. Triage markers then fail
   until midnight Pacific. *Fix:* Blaze plan with a budget alert, or
   incremental polling. [06 §6.2](06-data-and-storage.md#62-firestore)

4. **The October release is staged, not deployed.** The dashboard and
   comment-service release branches must go out together.
   [02 §2.5](02-environments.md#25-release-state), checklist in
   [09 §9.4](09-development-and-release.md#94-cutting-a-release).

## Capacity and cost

5. **The comment service serves 4 requests at a time and refuses the rest**
   (503 `generation_busy`). Drafts take 16 s to about 3 minutes on the T4.
   This is a software limit (one in-process decode behind a lock), so
   bigger hardware does not lift it. *Fix:* serve decodes through vLLM.
   The `VLLM_BASE_URL` path is in the code, `space/Dockerfile.vllm`
   packages it, and `scripts/merge_adapter.py` builds the merged checkpoint
   vLLM needs (a pilot Space ran this in August and was removed as unused).
   Still needed: an Ampere+ GPU (L4 or
   better; the T4 cannot run vLLM), persona batching through vLLM, and a
   grounding check that works without a separate base model. With vLLM the
   grounding check currently reports `unavailable`.

6. **Hosting decision outstanding.** The comment Space bills $0.40/h while
   awake on a T4, and an always-on vLLM deployment needs an L4-class GPU.
   The options (HF Spaces, rented GPU, fixed-price dedicated server, owned
   hardware) depend on the data-residency answer below. The costed
   comparison is kept in `docs/private/`.

## Governance

7. **Data residency is undecided.** Participant post text is processed on
   US-hosted Hugging Face Spaces and Vercel. If HOPE-MOVE requires UK or EU
   residency, both model services, and possibly the dashboard, must move.

8. **Participant memory only knows what the dashboard sends it.** The
   platform does not push new posts or replies to `/memory/*`, so replies
   facilitators write directly on the platform never reach memory. The
   dashboard's pre-generate reconciliation covers participant posts only.

## Platform-side requests (Magic Square)

9. **Participant profiles carry no role field.** The dashboard infers
   facilitators from who has posted facilitator comments.
10. **Activity images are not passed to the model.** Replies about a photo
    are the category most often flagged as unsupported, since the model
    never sees it.
11. **Production platform environment.** The live dashboard talks to the
    platform's staging system. Moving to a production platform is a Vercel
    configuration change ([02 §2.1](02-environments.md#21-what-exists)).
12. **Server-to-server calls need `Accept-Language`.** Without a real
    locale the platform 500s (`CultureNotFoundException`). The dashboard
    sends `en-GB` as a workaround; the platform should tolerate `*`.

## Repository hygiene

13. **The risk service's deploy files live only in the Space repo.**
    `engagement_ml/space/deploy.ps1` and `space/Dockerfile` target the
    retired `michaelajao` Space and bake models into the image. Copy the
    live Space's `Dockerfile`, `entrypoint.sh` and `fetch_models.py` back
    into `engagement_ml/space/` and repoint the script at `h4cdev`.
14. **Stale docs in the backend repos.** In `comment_generation`:
    `space/README.md` (Qwen3-4B 8-bit, "three drafts", stub kill switch,
    `HOPE_API_AUTH` default), `space/DEPLOY.md` (copies SQLite and `data/`
    into the Space; "HF_TOKEN auto-populated"), `docs/hf_backup.md` and
    `.env.example` (`michaelajao` namespace), `/sync/backfill-from-json`
    pointing at a `hope-memory backfill` CLI that does not exist. In
    `engagement_ml`: "empty `API_KEY` disables auth" (it returns 500),
    six-horizon / 30-file references (it is 8 / 40), bundle size "~50 MB"
    (it is ~5 MB). This repo's `.env.example` and `docker-compose.yml` also
    describe `HOPE_DISABLE_GENERATION` as producing canned drafts. It returns
    503.
15. **`scripts/push_to_hf.py` defaults to research adapters**, not the
    production one. Always pass `--owner h4cdev` and the explicit target.
16. **The engagement panel parquet is configured but never shipped** into
    the comment image. Generation works without it, because the dashboard
    sends engagement in the request.
17. **The risk service returns 500, not 422, on a naive datetime** mixed
    with timezone-aware ones. The dashboard always sends UTC, so this only
    affects other callers.

## Not built

18. **No scheduled scoring or score history.** Scores are computed on
    demand and cached for a day in the browser. Week-over-week trajectories
    would need a weekly batch job and a store.
19. **No facilitator-facing user guide.** This handbook is for engineers.
20. **Vercel Preview deployments have no backends** (variables are set for
    Production only), so previews cannot score or draft.
