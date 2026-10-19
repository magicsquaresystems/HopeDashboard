# 9. Development and release

## 9.1 Local setup

Clone the three repositories side by side. Docker Compose and the
extraction script both expect sibling folders:

```text
GitHub/
  hope-dashboard/        this repo
  comment_generation/
  engagement_ml/
```

### Dashboard only, against the hosted Spaces

```bash
cp .env.example .env.local
# set COMMENT_GEN_URL / DROPOUT_API_URL to the h4cdev Spaces, plus HF_TOKEN,
# HOPE_API_SECRET, HOPE_RISK_API_KEY, HOPE_API_AUTH=enabled, AUTH_SECRET, HOPE_HANDOFF_SECRET
npm install
npm run dev                                   # http://localhost:3000
node scripts/mint-handoff-token.mjs you@example.org 1680    # prints a sign-in link
```

Without the platform variables you sign in by hand-off and see the cohorts
in `src/lib/cohorts.ts`. Their data comes from `local/*.json`, which you
must obtain separately ([06 §6.4](06-data-and-storage.md#64-research-bundles-local)).
Without those files the cohort pages show "bundle missing", but the app
runs. Snooze and contacted markers go to `local/state/*.json`.

To develop against platform staging instead, you need `HOPE_API_URL`,
`HOPE_CLIENT_ID` and `HOPE_CLIENT_SECRET`, and the platform has to accept
`http://localhost:3000/auth/callback` as a redirect. Arrange both with
Magic Square.

### The whole stack locally

```bash
python -c "from huggingface_hub import snapshot_download; \
  snapshot_download('h4cdev/hope-move-engagement-ml', local_dir='../engagement_ml/models')"
cp .env.example .env
docker compose up --build        # dashboard :3000, comment :8001, risk :8000
```

- The comment service needs a GPU with about 8 GB of free VRAM (uncomment
  the `deploy:` block in `docker-compose.yml`; NVIDIA Container Toolkit).
  There is no CPU-sized production model. On a machine without a GPU, point
  `COMMENT_GEN_URL` at the hosted Space instead.
- `HOPE_DISABLE_GENERATION=1` makes `/generate` return 503, which is useful
  for UI work on the "offline" path. It does not produce canned drafts.
- `docker compose --profile vllm up` adds the optional vLLM server (needs
  a GPU with compute capability ≥ 8.0, about 16 GB of VRAM). Set
  `VLLM_BASE_URL=http://vllm:8000`.

Port 3000 is often already taken by another `next dev`. Check before
starting a second server, and run a production build on another port
(`npx next start -p 3001`).

## 9.2 Checks

```bash
npm run lint
npm run typecheck        # if routes were deleted: rm -rf .next first
npm test                 # Vitest, 345 tests on the release branch
npm run build
```

CI (`.github/workflows/ci.yml`) runs exactly these four, on Node 22, on
every PR and every push to `main`.

**Regenerating API types.** `src/lib/api/types.ts` is generated from
`../comment_generation/docs/openapi.yaml`. After any change to that spec:

```bash
npm run gen:types        # then commit the regenerated file
```

**UI changes** should be checked in a real browser (Playwright or by hand)
against a running app, not only by tests: sign in with a minted hand-off
link and click through the flow you changed.

For the backend repos: `pytest tests -q` (comment) in a venv holding only
CI's install, and `python -m unittest discover -s tests` (risk). See
[04](04-backend-services.md).

## 9.3 Working conventions

- Branch from `main`, open a PR, and merge only with green CI. **Merging
  deploys production.**
- Commit messages follow `type(scope): what changed and why` (see
  `git log`). The body records the reason.
- No secrets, participant data, personal logins or open security findings
  in commits, PR text or `docs/`. The repo is public. `docs/private/` and
  `local/` are gitignored for exactly this.
- Match the existing idiom before inventing one. Look at
  [03 §3.1](03-dashboard.md#31-code-map) for the conventions, and at the
  colocated tests for the expected standard (edge cases, not only the happy
  path).
- `scripts/extract-iih-cohort.mjs` is runtime code (it converts live
  platform data). Changes to it need tests in `src/lib/server/cohort-extract.test.ts`.

## 9.4 Cutting a release

Use this checklist for any release that touches more than the dashboard,
and in particular for the pending October release ([02 §2.5](02-environments.md#25-release-state)).

1. **Record the current state.** Save `/health`, `/version` and
   `/model/info` output from both Spaces and the commit shown by
   `/api/debug/backends`. These are your rollback targets.
2. **Back up the comment service's SQLite files** if anything worth
   keeping is in them ([06 §6.3](06-data-and-storage.md#63-comment-service-sqlite)).
3. **Comment service first.** Merge its release branch to `main`, run its
   tests, then `bash space/deploy.sh`. Wait for `RUNNING`, check `/version`
   and `/health` (`model_loaded: true`, `grounding_check: "on"`).
4. **Then the dashboard.** Merge the PR to `main`. Vercel deploys. Check
   `/api/debug/backends` shows the new commit.
5. **Verify on the test cohort.** Scores appear for elapsed weeks, a draft
   generates, Copy works, a dry-run send returns "dry run". Then, if
   posting is enabled for the test cohort, do one real send and confirm it
   on the platform.
6. **Re-extract any local research bundles** you still use. Bundles made
   before this release are not scored until they are rebuilt.
7. If anything fails, roll back both ([08 §8.5](08-operations-runbook.md#85-rollback)).
