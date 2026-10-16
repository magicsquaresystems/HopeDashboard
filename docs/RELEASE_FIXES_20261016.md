# Dashboard release candidate — 16 October 2026

This branch corrects predictor inputs and reply-workflow reporting. It does not replace or retrain the predictor, alter thresholds, deploy code, wake the SLM, or send messages.

## Prediction input contract

The extractor preserves `recordedStartedAt: null` rather than losing missing-start provenance in a display fallback. `predictionRoster` retains all source enrolments, including staff, solely to reproduce the frozen model's cohort-context feature. Facilitators remain excluded from the visible follow-up queue.

The adapter uses each recorded enrolment start, else the earliest recorded start in the full source cohort. It counts enrolments whose effective starts are at or before the focal start plus the model horizon. Events use the same half-open individual window as training. The selector describes participant-relative weeks; each score is withheld until that person's complete selected window has elapsed. Unsupported programme horizons are withheld, rather than extending the declared programme length. The model's existing anchoring beyond day 56 remains explicit.

Legacy bundles without trustworthy nullable-start/full-roster metadata remain viewable and unscored until refreshed. The live platform builder emits the new metadata; re-extract old local bundles before expecting scores. Do not infer a missing recorded start from an old `startedAt` display fallback. Prediction cache keys include the actual request inputs so a corrected clock or roster cannot reuse an old score.

Against the unchanged hosted predictor, 216 historical participants at day 7 and day 42 matched an independent training-rule reference exactly: zero clock/roster/event-window mismatches and zero probability or tier differences. The earlier published-cohort/full-visible-roster adapter had changed 14/216 and 10/216 tiers relative to that reference. These are paired input checks, not outcome validation. Models used were `lightgbm_T7@d1887c802c7d` and `lightgbm_T42@01b06326307b`.

## Reply workflow

Copies call `/copy` and measure clipboard adoption only. They do not consume the publication latch, mark someone contacted or write sent-text memory. Successful publication records the actual final edited text and marks contact once. A dry run, failed send or absent publication confirmation records no delivery. Polishing failures preserve the current text, and any edit/polish invalidates the original grounding verdict.

The generation proxy stamps facilitator identity from the session and reconciles trusted platform participant posts via `/memory/batch`. Backend replies and feedback are scoped to the same cohort/type and owner. The matching backend must be released with these client changes; see the comment-generation repository's `docs/RELEASE_FIXES_20261016.md` for additive database migrations, backup/retention, legacy feedback quarantine and local GPU evidence.

## Validation and release

Installed-candidate validation passed: **345 tests**, TypeScript, ESLint and the Next.js production build. The matching SLM candidate passed **139 tests** and Ruff. Regression cases cover late/missing starts, pre-course and cutoff events, future roster members, incomplete individual weeks, nullable-start preservation, copy followed by edited publication, missing send confirmation, post-edit grounding and trusted memory ingestion. Tests use synthetic records; private exports, credentials, weights and databases are excluded from commits.

Review this candidate before a coordinated backend/dashboard rollout. Production settings, deployments, participant decisions and hosted GPU resources were not changed by validation. No predictor retraining is needed while these frozen definitions remain the intended task. A changed clock, target or feature definition requires a separate model version and evaluation.
