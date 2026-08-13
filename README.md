# hope-dashboard

The facilitator-facing dashboard for the HOPE Programme AI Facilitator
Assistant. Facilitators use it to triage a cohort's participants by
dropout risk, read what each person posted, and send a warm reply —
starting from an AI-drafted suggestion they can edit or discard.

The dashboard holds no models and no participant database. It is a
Next.js app that reads cohort bundles from disk and calls two FastAPI
services:

| Service | Repo | Port | What it does |
| --- | --- | --- | --- |
| comment service | [`comment_generation`](https://github.com/michaelajao/comment_generation) | 8001 | Persona-conditioned reply drafts, participant memory, HITL capture |
| risk service (engagement_ml) | [`engagement_ml`](https://github.com/michaelajao/engagement_ml) | 8000 | Weekly dropout-risk scores + contributing factors |

Every backend call goes through the dashboard's own server-side proxy
routes (`src/app/api/proxy/**`), which inject the credentials. The
browser never sees a secret.

## Quickstart — the whole stack, one command

Needs Docker, plus sibling checkouts of `../comment_generation` and
`../engagement_ml`. See [docs/OPERATIONS.md §1.1](docs/OPERATIONS.md)
for the model bundles the risk service expects.

```bash
cp .env.example .env              # fill in the secrets
docker compose up --build         # dashboard on http://localhost:3000
```

No GPU? Run the comment service in stub mode — real UI, canned drafts:

```bash
HOPE_DISABLE_GENERATION=1 docker compose up --build
```

## Quickstart — dashboard only

Use this when the backends already run somewhere (hosted Spaces, another
box). Set `COMMENT_GEN_URL` / `DROPOUT_API_URL` to point at them.

```bash
cp .env.example .env.local        # set COMMENT_GEN_URL, DROPOUT_API_URL, secrets
npm install
npm run dev                       # http://localhost:3000
```

> **Requires Next ≥ 16.2.7 + Tailwind ≥ 4.3.0.** Earlier combos had a
> Turbopack ↔ Tailwind v4 bug that pinned RAM/disk to 100% on
> `npm run dev`. Don't downgrade below these versions.

## Configuration

Copy `.env.example` to `.env` (compose) or `.env.local` (`next dev`); it
documents every variable. The ones that decide where the backends live:

| Variable | Purpose |
| --- | --- |
| `COMMENT_GEN_URL` | Comment service base URL |
| `DROPOUT_API_URL` | Risk service base URL |
| `HOPE_API_SECRET` | HMAC secret for signing comment-service writes; must match the service |
| `HOPE_RISK_API_KEY` | `X-API-Key` for the risk service; must match the service |
| `HF_TOKEN` | Read-scoped HF token — required when the backends are private HF Spaces |
| `AUTH_SECRET` | NextAuth v5 signing key (`npx auth secret`) |
| `FACILITATOR_EMAILS` | Comma-separated allowlist (empty = allow any email in dev) |

Three ways to point at the backends:

| Setup | `COMMENT_GEN_URL` | When |
| --- | --- | --- |
| Compose stack | `http://comment-api:8001` (set for you) | Default local development |
| Private HF Spaces | `https://<owner>-hope-comment-gen-api.hf.space` | Hosted; also set `HF_TOKEN` |
| HPC + SSH tunnel | `http://localhost:8011` | Maintainer-only — see [docs/OPERATIONS.md](docs/OPERATIONS.md) |

**On ports:** the comment service listens on **8001** and the risk
service on **8000** everywhere — locally, in compose, and in their
container images. The **8011** you see in the HPC path is not a
different service: `:8001` is taken by JupyterHub on that machine, so
the service is bound to `:8011` there and the SSH tunnel maps it to
`localhost:8011`. Hosted HF Spaces front both services on `:443`.

## Auth

NextAuth v5 with the **dev-allowlist Credentials provider**. Set
`FACILITATOR_EMAILS` to a comma-separated allowlist; empty allows any
email in dev. `AUTH_MODE=open` surfaces a "Testing mode" pill in the
topbar — set `AUTH_MODE=allowlist` for a production posture.

Magic-link via Nodemailer is intentionally not wired in this build: it
pulls Node-only modules into the Edge runtime. Re-introduce it through
the documented Auth.js Edge/Node split when configuring SMTP.

For local work without HMAC, run the backends with
`HOPE_API_AUTH=disabled`.

## Participant data

`local/iih-coh*.json` contain **real cohort data** from the HOPE
platform. Display names are pseudonymised (`P1`, `P2`, …) but the post
free-text is genuine participant writing, including health disclosures.
Treat this repository as confidential; do not display raw bundles on a
shared screen. Regenerate bundles from platform exports with
`scripts/extract-iih-cohort.mjs`.

## Development

```bash
npm run lint          # eslint
npm run typecheck     # tsc --noEmit
npm run build         # production build
npm run gen:types     # regenerate src/lib/api/types.ts from the OpenAPI spec
```

CI runs lint, typecheck, and build on every push and pull request
(`.github/workflows/ci.yml`). There is no unit-test suite; the end-to-end
smoke below is the functional check.

The API contract is owned by `comment_generation/docs/openapi.yaml`.
After any change there, run `npm run gen:types` and commit the
regenerated `src/lib/api/types.ts` so the build stays deterministic.

End-to-end smoke test against a running stack:

```bash
bash scripts/smoke_e2e.sh
```

## Demo target

The end-to-end demo uses cohort `IIH-COH12-110226` (id 1680) in module
`People living with IIH 2025 - V1` (id 337).

## Documentation

All deeper docs live in [docs/](docs/):

- [HANDOVER.md](docs/HANDOVER.md) — **start here if you are new to the project**: what to get access to, where the models live, hosting tiers, known gaps. Dated transition doc; delete it once the org transfer lands.
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — why the system is shaped this way
- [INTEGRATION.md](docs/INTEGRATION.md) — API wire contract for platform engineers
- [OPERATIONS.md](docs/OPERATIONS.md) — self-hosting, deploy paths, model roster, runbook
