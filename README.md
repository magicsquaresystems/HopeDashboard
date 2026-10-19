# hope-dashboard

The facilitator-facing dashboard for the HOPE Programme AI Facilitator
Assistant. Facilitators use it to triage a cohort's participants by
dropout risk, read what each person posted, and reply, starting from an
AI-drafted suggestion they can edit, copy, or send back to Hope Move.

Live at `https://facilitator.poweredbyh4c.org`, deployed by Vercel from
`main`. **Merging to `main` deploys production.**

The dashboard holds no models and no participant database. It is a
Next.js 16 app that:

- signs facilitators in through the Hope Move platform and reads their
  cohorts and participant activity from the platform API with their own
  token;
- calls two FastAPI services through server-side proxy routes that hold
  every credential:

  | Service | Repo | Production home | Does |
  | --- | --- | --- | --- |
  | Risk | `engagement_ml` | `https://h4cdev-hope-dropout-api.hf.space` | Weekly dropout-risk score + contributing factors |
  | Comment | `comment_generation` | `https://h4cdev-hope-comment-gen-api.hf.space` | Reply drafts, safety checks, participant memory, feedback log |

- keeps shared snooze / "contacted by" markers in Firestore.

## Documentation

**Start at [docs/README.md](docs/README.md).** The engineering handbook
covers architecture, environments and deployment, the backends, the models
on Hugging Face, data and storage, every configuration variable, the
operations runbook, and known issues.

## Quickstart (dashboard against the hosted services)

```bash
cp .env.example .env.local     # fill in the backend URLs and secrets; see docs/07-configuration.md
npm install
npm run dev                    # http://localhost:3000
node scripts/mint-handoff-token.mjs you@example.org   # prints a local sign-in link
```

Full local setup, including the Docker Compose stack, is in
[docs/09-development-and-release.md](docs/09-development-and-release.md).

> **Requires Next ≥ 16.2.7 and Tailwind ≥ 4.3.0.** Earlier combinations had
> a Turbopack ↔ Tailwind bug that pinned RAM and disk at 100% on
> `npm run dev`.

## Checks

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

CI runs the same four on every PR and every push to `main`.
`src/lib/api/types.ts` is generated from
`comment_generation/docs/openapi.yaml` with `npm run gen:types`. Commit the
regenerated file after any change to that spec.

## Data and secrets

This repository is **public**. Never commit secrets, participant data,
personal logins or open security findings. `local/` (research cohort
bundles containing real participant writing) and `docs/private/` (operator
notes) are gitignored for that reason, and their contents are shared out of
band.
