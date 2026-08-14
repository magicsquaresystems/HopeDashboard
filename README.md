# hope-dashboard

The facilitator-facing dashboard for the HOPE Programme AI Facilitator
Assistant. Facilitators use it to triage a cohort's participants by
dropout risk, read what each person posted, and send a warm reply —
starting from an AI-drafted suggestion they can edit or discard.

The dashboard holds no models and no participant database. It is a
Next.js app that reads cohort bundles and calls two FastAPI services:

| Service | Port | Production home | What it does |
| --- | --- | --- | --- |
| comment service | 8001 | `https://h4cdev-hope-comment-gen-api.hf.space` | Persona-conditioned reply drafts, participant memory, HITL capture |
| risk service | 8000 | `https://h4cdev-hope-dropout-api.hf.space` | Weekly dropout-risk scores + contributing factors |

Both production services run as private Hugging Face Spaces under the
`h4cdev` account. Their source lives in the `comment_generation` and
`engagement_ml` repositories.

Every backend call goes through the dashboard's own server-side proxy
routes (`src/app/api/proxy/**`), which inject the credentials. The
browser never sees a secret.

Cohort data currently ships as extracted bundles under `local/`
(see *Participant data* below). The platform team is building an API
to replace this; when it lands, an adapter in the server data layer
(`src/lib/server/cohort-data.ts`) will convert its payloads into the
same bundle shape the UI already consumes, so the change stays invisible
to components. The expected shape is documented in the INTEGRATION doc (see Documentation below).

## Quickstart — the whole stack, one command

Needs Docker, plus sibling checkouts of `../comment_generation` and
`../engagement_ml`. See the OPERATIONS doc for the model bundles the risk service expects.

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
| `AUTH_SECRET` | NextAuth v5 signing key (`npx auth secret`) — **required in production**; without it every `/api/auth/*` route returns 500 |
| `HOPE_HANDOFF_SECRET` | Verifies the signed hand-off token facilitators arrive with; must match the platform |

Two ways to point at the backends:

| Setup | `COMMENT_GEN_URL` | When |
| --- | --- | --- |
| Compose stack | `http://comment-api:8001` (set for you) | Default local development |
| Private HF Spaces | `https://h4cdev-hope-comment-gen-api.hf.space` | Production; also set `HF_TOKEN` |

**On ports:** the comment service listens on **8001** and the risk
service on **8000** everywhere — locally, in compose, and in their
container images. Hosted HF Spaces front both services on `:443`.

## Auth

Sign-in is **platform hand-off only**. The Hope Move platform links a
facilitator to `/enter?token=<signed>` with a short-lived token carrying
their identity; `HOPE_HANDOFF_SECRET` verifies the signature
(`src/lib/auth/handoff.ts`). There is no email form and no
direct-credentials provider — the login page exists only to explain
where to go when a hand-off failed or the URL was opened directly.

`AUTH_MODE` governs cohort visibility for facilitators with no explicit
assignment: `open` shows every cohort (local development), `allowlist`
shows none until assigned (production). Cohort assignments come from
the `facilitator_cohorts` table when `DATABASE_URL` is set, else from
`FACILITATOR_COHORTS` in the environment.

For local development there is no platform to arrive from — mint a test
hand-off link with `node scripts/mint-handoff-token.mjs`. To run the
backends without HMAC locally, set `HOPE_API_AUTH=disabled` on both
sides.

## Participant data

`local/iih-coh*.json` contain **real cohort data** from the HOPE
platform. Display names are pseudonymised (`P1`, `P2`, …) but the post
free-text is genuine participant writing, including health disclosures.
**This repository must remain private** and its contents treated as
confidential; do not display raw bundles on a shared screen. Regenerate
bundles from platform exports with `scripts/extract-iih-cohort.mjs`.

These bundles are an interim data source. The platform API replacing
them delivers the same underlying records; the conversion into the
bundle shape happens server-side in `src/lib/server/cohort-data.ts`,
and the bundle contract is documented in the INTEGRATION doc.

## Development

```bash
npm run lint          # eslint
npm run typecheck     # tsc --noEmit
npm run build         # production build
npm run gen:types     # regenerate src/lib/api/types.ts from the OpenAPI spec
```

CI runs lint, typecheck, and build on every push and pull request
(`.github/workflows/ci.yml`). Unit tests run with `npm test` (Vitest);
the end-to-end smoke below is the functional check against a live stack.

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

The project documentation is **not kept in this repository** — it is public,
and the docs carry hosting costs, infrastructure detail and Space/model
identifiers. Ask the project owner for the current set:

- **HANDOVER** — start here if you are new: access checklist, where the models
  live, hosting, known gaps
- **ARCHITECTURE** — why the system is shaped this way
- **INTEGRATION** — API wire contract for platform engineers
- **OPERATIONS** — deploy paths, model roster, runbook
- **HOSTING** — what the comment service costs to run, measured latency and
  concurrency, and hardware options

The API contract itself is owned by `comment_generation/docs/openapi.yaml` and
is generated into `src/lib/api/types.ts`, so it stays in the code.
