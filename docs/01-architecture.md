# 1. Architecture

## 1.1 Components and responsibilities

| Component | Is | Is not |
| --- | --- | --- |
| **Hope Move platform** | The source of truth: facilitators, cohorts, enrolments, participant activity, comments. Issues sign-in codes and access tokens. Receives published replies. | Owned or deployed by this team. Magic Square runs it. |
| **Dashboard** (Next.js) | The only UI. Fetches cohort data with the facilitator's own platform token, calls the model services through server-side proxy routes, keeps shared triage markers in Firestore. Stateless otherwise. | A database. It stores no participant records of its own. |
| **Risk service** (`engagement_ml`, FastAPI) | Stateless inference. Takes a participant's event history up to a scoring day, returns a calibrated dropout probability, a tier and the top three contributing factors. | A scheduler. Nothing scores cohorts in the background; the dashboard asks on demand. |
| **Comment service** (`comment_generation`, FastAPI) | Drafts replies from a fine-tuned small language model, applies input/output safety checks, keeps participant memory and the human-in-the-loop (HITL) research log in SQLite. | Stateless. It writes, and its state lives on one instance. |
| **Firestore** | Snooze / dismiss / "contacted by" markers shared between facilitators on a cohort. | A participant record store. |
| **Azure Blob Storage** (platform-owned) | Holds participant-uploaded photos. The dashboard only signs short-lived read URLs. | Something the dashboard writes to. |

There is no synchronous chain between the two model services. Each is
called only by the dashboard.

## 1.2 Request flows

### Sign-in

```text
Facilitator on Hope Move → clicks the dashboard card
 → GET  /auth/callback?code=<one-time>[&cohortId=N]           (dashboard)
 → POST {platform}/api/auth/exchange  X-Client-Id/X-Client-Secret, {code}
 ← access token (15 min, HS256 JWT) + rotating refresh token + user
 → encrypted session cookie; redirect to /cohorts[/N]
```

Detail and the local-development alternative (hand-off tokens) are in
[03 §3.2](03-dashboard.md#32-sign-in-and-sessions).

### Opening a cohort

```text
/cohorts           → GET {platform}/api/dashboard/cohorts            (facilitator's bearer; 60 s cache)
/cohorts/N         → GET /api/cohort-bundle?cohortId=N
                       → access check → 4 × GET {platform}/api/dashboard/cohorts/N/{user-activity,
                         user-profiles, facilitator-comments, discussion-topics}
                       → buildCohortBundle() → CohortBundle JSON to the browser
                   → POST /api/proxy/dropout/batch  → risk service /batch      (queue ranking)
                   → GET  /api/queue-state          → Firestore               (every 30 s while visible)
```

### Drafting and replying

```text
Generate  → POST /api/proxy/generate
              → access check (cohort + participant)
              → comment /memory/batch   (reconcile the participant's platform posts)
              → comment /generate       (HMAC-signed; 16 s – 3 min; may 503 generation_busy)
Copy      → POST /api/proxy/copy        → comment /copy        (adoption metric only)
Send      → POST /api/proxy/hope/comment → posting policy → platform POST /api/dashboard/comment
              → on confirmed publish: comment /event (delivery_confirmed) + Firestore "contacted"
```

## 1.3 Trust boundaries and credentials

| Hop | Credential | Held by |
| --- | --- | --- |
| Browser → dashboard | NextAuth session cookie (JWE, HttpOnly) | Browser; signed with `AUTH_SECRET` |
| Dashboard → platform | Facilitator's access token, inside the session cookie | Dashboard server only |
| Dashboard → platform (exchange/refresh) | `HOPE_CLIENT_ID` / `HOPE_CLIENT_SECRET` | Dashboard server only |
| Dashboard → any `*.hf.space` | `HF_TOKEN` bearer (the Spaces are private) | Dashboard server only |
| Dashboard → comment service | `X-HMAC-Signature` over the body, key `HOPE_API_SECRET` | Both sides, must match |
| Dashboard → risk service | `X-API-Key`, dashboard var `HOPE_RISK_API_KEY` = Space secret `API_KEY` | Both sides, must match |
| Dashboard → Firestore | Service-account key, `FIREBASE_SERVICE_ACCOUNT` | Dashboard server only |
| Dashboard → Azure Blob | Storage connection string (signs read-only SAS) | Dashboard server only |
| Spaces → HF model repos | `HF_TOKEN` Space secret | Each Space |

The browser only ever talks to the dashboard's own origin. Every outbound
credential is added server-side in `src/lib/api/server.ts`,
`src/lib/api/hope.ts` or the relevant `lib/server/*` module.

## 1.4 Why it is shaped this way

- **Three services, not one.** The model services have opposite lifecycles.
  Risk scoring is cheap stateless CPU inference that can scale freely.
  Drafting needs a GPU and holds state. The dashboard redeploys without
  touching either.
- **Two auth schemes.** HMAC binds the payload for the service that writes
  state (memory, research log). A static key is enough for pure inference.
- **Server-side proxy for everything.** One place holds secrets and one
  place enforces cohort access. A hidden UI element is never the control.
- **Fail closed on access.** A broken platform link or a platform outage
  shows a facilitator fewer cohorts, never more
  ([03 §3.7](03-dashboard.md#37-cohort-visibility-and-access-control)).
- **One conversion, two sources.** Live platform payloads and research
  export files go through the same `buildCohortBundle` function, so the
  numbers the model sees cannot drift between the two.
- **Per-horizon risk models.** Eight LightGBM models (days 7…56), so an
  early-week score is driven by early-week behaviour.
- **One pinned reply model.** The adapter is fixed per deployment
  (`HOPE_MODEL_LOCKED=1`). A runtime swap is process-wide and would change
  every facilitator's drafts mid-session.
- **Firestore for triage markers.** The reason was governance, not
  technology: the markers record who contacted which participant, so the
  data sits in a Google project the H4C programme owns. One document per
  (cohort, participant, kind) makes every write independent, which is what
  serverless concurrency needs.
- **Sending is opt-in per cohort.** It is the one action that reaches a
  person and cannot be undone, so it ships switched off.

## 1.5 Scaling limits

| Layer | Scales? | Limit |
| --- | --- | --- |
| Dashboard | Yes, stateless | Vercel function max duration 300 s (set on `/api/proxy/generate`) |
| Risk service | Yes, stateless | In-memory rate limit `RATE_LIMIT_PER_MIN` (60) per key, per instance |
| Comment service | **No** | One decode at a time behind a lock; capacity `1 + HOPE_GEN_MAX_QUEUE` = 4, beyond that `503 generation_busy`. SQLite state assumes one instance. Lifting this needs the vLLM backend and a shared database. See [10](10-known-issues.md) |
| Firestore | Yes | Free (Spark) plan: 50k document reads/day. See [06](06-data-and-storage.md#62-firestore) |
