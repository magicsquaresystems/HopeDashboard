# HOPE Facilitator Assistant: engineering handbook

This is the handbook for engineers who run, change or take over the HOPE
Facilitator Assistant: the dashboard, the two model services behind it, the
models on Hugging Face, and the data stores. It replaces every earlier
document set (HANDOVER, ARCHITECTURE, INTEGRATION, OPERATIONS, HOSTING and
the dated October reports). If something here disagrees with the code, the
code wins. Fix the page in the same change.

**Status as of 2026-10-19.** Every live fact in this handbook (Space state,
model repos, versions, hardware) was checked against the running system on
that date unless a section says otherwise.

> This repository is **public**. Nothing in `docs/` may contain a secret, a
> personal login, participant data or an unresolved security finding. Those
> belong in `docs/private/`, which is gitignored and shared directly.

---

## What the system is

Facilitators on the HOPE programme (Hope Move platform) use the dashboard to
see which participants are at risk of dropping out, read what each person
posted, and reply, starting from an AI-drafted suggestion they can edit,
copy, or send back to the platform.

```text
Facilitator signs in on Hope Move
        │
        ▼
┌───────────────────────────────────────────┐
│ Hope Move platform (Magic Square)         │
│ staging.poweredbyh4c.org                  │
│ cohorts · participant activity · comments │
└───────────────────────────────────────────┘
        │ code exchange; cohort data   ▲ published replies
        ▼ (facilitator's own token)    │ (only when enabled)
┌───────────────────────────────────────────┐     ┌─────────────────────┐
│ Dashboard: this repo, Next.js on Vercel   │────▶│ Firestore           │
│ facilitator.poweredbyh4c.org              │     │ shared triage state │
│ server-side proxy holds every credential  │     └─────────────────────┘
└───────────────────────────────────────────┘
        │ X-API-Key + HF bearer        │ HMAC + HF bearer
        ▼                              ▼
┌─────────────────────────────┐  ┌─────────────────────────────┐
│ Risk service (engagement_ml)│  │ Comment service             │
│ h4cdev/hope-dropout-api     │  │ (comment_generation)        │
│ LightGBM, 8 horizons, CPU   │  │ h4cdev/hope-comment-gen-api │
│                             │  │ Qwen3.5-4B + adapter, T4    │
└─────────────────────────────┘  └─────────────────────────────┘
        │ models fetched at start      │ adapter fetched at start
        ▼                              ▼
h4cdev/hope-move-engagement-ml   h4cdev/qwen3.5-4b-hope-forum-lora
        (private model repos on Hugging Face)
```

| Component | Source repo | Runs on | Owner of the running thing |
| --- | --- | --- | --- |
| Dashboard | `magicsquaresystems/HopeDashboard` (this repo) | Vercel, `https://facilitator.poweredbyh4c.org` | Magic Square (Vercel project and env vars); code pushed by the HOPE team |
| Risk service | `engagement_ml` | HF Space `h4cdev/hope-dropout-api`, CPU basic | HOPE (`h4cdev` HF account) |
| Comment service | `comment_generation` | HF Space `h4cdev/hope-comment-gen-api`, Nvidia T4 small | HOPE (`h4cdev` HF account) |
| Models | the two repos above (training code) | HF model repos under `h4cdev` | HOPE |
| Hope Move platform | not in scope | `https://staging.poweredbyh4c.org` | Magic Square |
| Shared triage state | — | Firebase / Firestore, project owned by the H4C Google account | H4C |

---

## Reading order

| # | Page | Read it when |
| --- | --- | --- |
| 1 | [Architecture](01-architecture.md) | First. How the parts fit, the request flows, and why it is shaped this way |
| 2 | [Environments and deployment](02-environments.md) | You need to know what is live, where, how code reaches it, and what is released |
| 3 | [The dashboard](03-dashboard.md) | You are changing this repo: code map, sign-in, data sources, routes, reply workflow |
| 4 | [Backend services](04-backend-services.md) | You are touching the comment or risk service |
| 5 | [Models and Hugging Face](05-models-and-hugging-face.md) | You need to know which model is served, where it lives, or how to replace it |
| 6 | [Data and storage](06-data-and-storage.md) | Anything about data: where it comes from, the databases, backups, governance |
| 7 | [Configuration reference](07-configuration.md) | Every environment variable and Space secret, per component |
| 8 | [Operations runbook](08-operations-runbook.md) | Something is broken, or you need to deploy, restart, check health or rotate a secret |
| 9 | [Development and release](09-development-and-release.md) | Setting up locally, running tests, CI, cutting a release |
| 10 | [Known issues and open work](10-known-issues.md) | Before planning work, and before going live with anything new |

---

## The five things most likely to bite you

1. **Comment-service databases are lost on every restart.** The Space has
   no persistent storage, so participant memory and every facilitator
   feedback record (`hitl.sqlite`) live in the container. They are lost
   each time it sleeps, which is after 15 idle minutes. See
   [06](06-data-and-storage.md#63-comment-service-sqlite).
2. **Pushing to `main` deploys production.** Vercel deploys this repo's
   `main` to the facilitator site straight away. Run lint, typecheck, tests
   and build locally before pushing (or use a PR so CI runs them first).
3. **Env vars on Vercel are set by Magic Square only.** Vercel bakes them in
   at build time, so a new value needs a redeploy before it takes effect.
   Check what the running build actually has with `/api/debug/backends`
   ([08](08-operations-runbook.md#is-the-deployment-configured)).
4. **Sending replies to participants is a live, irreversible action.** It
   is off unless `HOPE_ENABLE_POST_COMMENT=1` and the cohort is in
   `HOPE_POST_COMMENT_COHORTS`. Test only on the test cohort
   ([03 §3.5](03-dashboard.md#35-the-reply-workflow)).
5. **The comment service is one release behind the dashboard.** The
   dashboard's October release is live. The matching comment-service
   branch (`/copy`, `delivery_confirmed`, feedback ownership checks) is not
   deployed yet. Nothing breaks, but those records are dropped until it is
   ([02](02-environments.md#25-release-state)).
