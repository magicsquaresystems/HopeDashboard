# 6. Data and storage

There is no central database in this system. Data lives in five places, and
only one of them is the source of truth.

| Store | Holds | Owner | Rebuildable? |
| --- | --- | --- | --- |
| **Hope Move platform** | Facilitators, cohorts, enrolments, activity, comments, profiles. **Source of truth** | Magic Square | — |
| **Firestore** | Snooze / dismiss / contacted markers | H4C Google account | No, but low value: losing it only resets triage markers |
| **Comment service SQLite**: `memory.sqlite` | Participant posts and facilitator replies used as drafting context | Comment Space | Mostly. Posts are re-sent from the platform before every `/generate` |
| **Comment service SQLite**: `hitl.sqlite` | Every shown draft, thumbs, copies, accept/edit/reject/flag events, sent text | Comment Space | **No.** This is the only record of facilitator feedback, used for research and future preference training |
| **Azure Blob Storage** | Participant-uploaded photos | Platform (Magic Square) | — (read-only to us) |

The model weights on Hugging Face are covered in [05](05-models-and-hugging-face.md).

---

## 6.1 Participant data flows

| Data | From | To | Notes |
| --- | --- | --- | --- |
| Cohort activity, profiles, comments, forum topics | Platform API | Dashboard server → browser | Fetched per request with the facilitator's token; not stored by the dashboard |
| Event histories (timestamps, types, word counts, emotion tags) | Dashboard | Risk Space | Per scoring request; the service stores nothing |
| Post text, recent thread context, participant posts for memory | Dashboard | Comment Space | **Stored** in `memory.sqlite` / `hitl.sqlite` |
| Published reply | Dashboard | Platform | Only when posting is enabled ([03 §3.5](03-dashboard.md#35-the-reply-workflow)) |
| Photos | Azure | Browser directly | Via a 5-minute signed URL; bytes never pass through the dashboard |

**Data residency is an open governance question.** Post text from a health
programme is sent to Hugging Face Spaces, which are US-hosted, and the
dashboard runs on Vercel. Whether participant text must stay in the UK or
the EU is a decision for HOPE-MOVE. If the answer is UK-only, both model
services have to move. See [10](10-known-issues.md).

---

## 6.2 Firestore

The shared triage state described in [03 §3.6](03-dashboard.md#36-shared-triage-state-firestore).

| Setting | Value |
| --- | --- |
| Product | Cloud Firestore, **Native mode**, Standard edition |
| Region | `europe-west2` (London) |
| Database | `(default)` (override with `FIREBASE_DATABASE_ID`) |
| Project | Owned by the H4C Google account; id and owners in `docs/private/` |
| Security rules | `allow read, write: if false`. Only the Admin SDK (service account) can reach it, and it bypasses rules |
| Billing plan | **Spark (free)**: 50,000 document reads/day |
| Credential | One service-account key, base64-encoded into `FIREBASE_SERVICE_ACCOUNT` on Vercel |

**Data model.** One document per marker:

```text
queue_state/{cohortId}/markers/{encodeURIComponent(participantId)}:{kind}
  cohortId: number   participantId: string   kind: "snooze" | "dismiss" | "contact"
  byEmail: string    atMs: number             untilMs: number | null   action: string | null
```

Expired snoozes are filtered on read (`queue-state-rows.ts`). Nothing
deletes old documents.

**Quota risk.** Every poll (30 s, only while a tab is visible) reads every
marker in the cohort. Two facilitators on a cohort with ~30 markers working
a full day exceed 50k reads, and from then until midnight Pacific every queue
read fails. The fixes are to move to the Blaze plan with a small budget
alert (pennies a day at this volume), or to read only markers changed since
the last poll.

**Backups.** None are configured. Scheduled Firestore backups need the Blaze
plan. The data is low-value and self-healing (markers expire or get
re-set), so an export is optional:
`gcloud firestore export gs://<bucket>` once Blaze is on.

**Local development** uses JSON files under `local/state/` automatically
when no Firestore variable is set, or the emulator via
`FIRESTORE_EMULATOR_HOST`. Neither needs a production key.

**Rotating the key.** Create a new key in Google Cloud console → IAM →
Service accounts, base64 it, have Magic Square replace
`FIREBASE_SERVICE_ACCOUNT` and redeploy, confirm `/api/debug/backends`
shows `queueStateBackend: "firestore"` and `parsed: true`, then delete the
old key.

---

## 6.3 Comment service SQLite

Both files are created on first use (`CREATE TABLE IF NOT EXISTS`) at
`$HOPE_STATE_DIR/<file>`, default `<repo>/outputs/`. Both use WAL mode.

### `memory.sqlite`: drafting context

Table `participant_memory`: `id, participant_id, cohort_id, module_id, ts,
activity_id, comment_id, activity_type, role (participant_post |
facilitator_reply), text, embedding, derived_facts, source, facilitator_id,
display_name, ingested_at`. Unique on (role, activity id or comment id,
activity type), so re-sending the same record is a no-op (`deduped`).

`source` tags where a row came from: `json_reconcile` (the dashboard's
pre-generate sync of the participant's platform posts), `hitl` (a confirmed
sent reply), `platform_webhook` / `platform_backfill` (reserved; nothing
sends them today).

### `hitl.sqlite`: facilitator feedback (the research log)

Schema in `comment_generation/src/hitl/schema.sql`, plus additive migrations
in `src/hitl/migrations.py` (release branch):

| Table | One row per |
| --- | --- |
| `hitl_drafts` | Draft shown to a facilitator: text, persona (`draft_variant`), model, safety flags incl. grounding verdict, thumb, whether chosen, sent text, edit distance |
| `hitl_events` | Facilitator decision on a draft set: accept / edit / reject / flag, edited text, latency (plus `delivery_confirmed`, `cohort_id` and an idempotency `event_key` after the release migration) |
| `hitl_pairs` | Derived preference pair for later training |
| `hitl_copy_events` | Draft copied to clipboard (release branch) |

Migrations are `ALTER TABLE ADD COLUMN` for each missing column, plus a
unique index on `event_key`. They run on open, are idempotent, and leave
older builds able to read the file.

### The problem: these files do not survive a restart

On `h4cdev/hope-comment-gen-api` there is **no persistent storage** and
`HOPE_STATE_DIR` is not set. The databases therefore live in the container
at `/app/outputs/` and are **wiped every time the Space restarts, rebuilds
or goes to sleep**. With a 15-minute sleep timer that is most days. So in
practice:

- every piece of facilitator feedback collected on the Space so far has
  been lost, apart from what was copied out by hand;
- memory survives only within one awake period. The dashboard re-sends the
  participant's platform posts before each draft, so drafts still get
  context, but replies sent through the dashboard are forgotten when the
  Space sleeps.

**Fix (open, see [10](10-known-issues.md)):** attach persistent storage to the
Space (HF Spaces paid storage, mounted at `/data`). Then set the Space
variable `HOPE_STATE_DIR=/data/state` and restart. SQLite needs a real
filesystem volume, so do not point it at a network bucket. Alternatively,
move the stores to a managed database. That is also the precondition for
running more than one replica.

### Backups (once storage is persistent)

```bash
# inside the service environment; snapshots both DBs with the SQLite backup API,
# runs integrity_check, refuses to overwrite an existing destination
python scripts/backup_state.py --destination /data/backups/$(date +%F)
```

Nothing schedules this yet and there is no retention policy. Copy the
snapshot off the Space (for example to a private HF dataset repo under
`h4cdev`), since a backup on the same volume does not protect against
losing the volume. `hitl.sqlite` contains facilitator emails and
participant post text: treat it as confidential participant data.

Ad-hoc inspection:

```bash
sqlite3 outputs/hitl.sqlite "SELECT ts, draft_variant, thumb_label, was_chosen, edit_distance FROM hitl_drafts ORDER BY id DESC LIMIT 20;"
sqlite3 outputs/hitl.sqlite "SELECT ts, action, method, latency_ms FROM hitl_events ORDER BY id DESC LIMIT 20;"
```

---

## 6.4 Research bundles (`local/`)

`local/iih-coh10-190325.json`, `iih-coh11-170925.json`,
`iih-coh12-110226.json` are extracted from the platform's historical
research exports for three IIH cohorts (1600, 1651, 1680). They contain
real participant free text with health disclosures. Display names are
pseudonymised (`P1…Pn`).

- **Never committed.** `local/` is gitignored and the repo is public.
  Obtain them out of band, or regenerate them with
  `node scripts/extract-iih-cohort.mjs` from raw exports placed in
  `../engagement_ml/data/` and `../comment_generation/data/` (also
  gitignored there).
- Used only for local development and research replays. **Production
  never reads them**; on Vercel the directory does not exist.
- Bundles extracted before the October release lack `recordedStartedAt` and
  `predictionRoster`. With the release, they still display but are not
  scored until re-extracted.

---

## 6.5 Governance checklist

- Nothing with participant data, a credential or a personal login goes into
  this repository, its issues or its PRs.
- The four `h4cdev` model repos stay private and keep the restricted licence.
- `hitl.sqlite` and `memory.sqlite` copies are confidential participant data.
- The Firestore key, the Azure storage connection string and
  `HOPE_CLIENT_SECRET` are bearer credentials. If one is pasted anywhere
  public, rotate it ([08 §8.6](08-operations-runbook.md#86-rotating-secrets)).
