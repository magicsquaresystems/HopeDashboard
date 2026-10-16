# Dashboard and training input comparison

Historical baseline audit, captured before the correction. The final section
and `CANDIDATE_VALIDATION_20261016.md` describe the subsequently validated local
candidate; production has not been updated by this work.

Checked 16 October 2026 against the local `hope-dashboard` and `engagement_ml`

repositories. The start-origin and roster-count mismatch is **not fixed in

the local dashboard code**. This is a source and local-data finding, not a

verification of the revision running in production.

## What was executed

The audit transpiles and executes the actual `bundleToHistory` function in

`hope-dashboard/src/lib/realCohort.ts`; it does not merely reproduce the

function from its comments. It compares the requests for all three local IIH

cohort bundles with the effective-start and roster rules in the ML repository.

All 216 bundle participants match enrolment records in the frozen training

export. The audit checks all eight horizons and writes aggregate counts only.

No model pickle was loaded, no risk probability was recomputed, no live endpoint

was called, and no dashboard behaviour or deployed bundle was changed. The local

Python has scikit-learn 1.9.0 while the saved cards specify 1.8.0, so model-score

comparisons should run in the pinned training environment rather than loading

those pickles under a different version.

## Start origins

Training uses `started_at` for an enrolment where present; otherwise

`add_effective_start` substitutes the earliest recorded start in the cohort.

The dashboard always sends `bundle.cohort.effectiveStart`, the published cohort

start. The adapter's claim that training uses a common cohort-relative clock

for everyone is therefore inaccurate.

The shared bundle extractor also fills missing `startedAt` with the published

cohort start. Simply switching the adapter to `p.startedAt` would fix only part

of the problem: missing-start provenance has already been lost. A complete

candidate fix needs to preserve the nullable recorded start and use the same

fallback definition as training, or define and validate a different cohort-clock

prediction task. Do not silently change the trained clock.

| Local cohort | Participants matched | Different start origins | Different first-week model event windows | Different training-rule roster counts |

| --- | ---: | ---: | ---: | ---: |

| IIH cohort 10 | 62 | 62 | 27 | 61 |

| IIH cohort 11 | 103 | 103 | 38 | 102 |

| IIH cohort 12 | 51 | 51 | 21 | 48 |

| Total | 216 | 216 | 86 | 211 |

The model event-window comparison includes activity, login, bookmark,

discussion and facilitator-comment events from the same bundle. It excludes

page visits, which the model ignores. It isolates how different clocks select

events; it is not a complete audit of event-extraction parity or of predicted

probabilities. Six participants have an empty dashboard first-week model stream

but a non-empty stream under the training clock; nineteen show the reverse.

A synthetic late-starter counterexample also executes the real adapter. With

cohort start 1 January, individual start 10 January and a writing event on

10 January, training's day-7 window includes the event. The dashboard uses

1 January and drops it. The current adapter fails this alignment check.

## Cohort size and elapsed time

Training counts cohort members whose recorded or imputed start is at or before

the focal participant's effective start plus the horizon. The dashboard sends

`bundle.participants.length`, a full roster after its own staff filtering. The

211 mismatches above establish a difference in supplied counts, but do not

attribute the whole difference to future membership: staff filtering and roster

definitions also differ. A corrected design must settle both the timing cutoff

and the eligible roster definition.

The week selector currently uses elapsed cohort weeks. If a future adapter uses

individual starts, it must also ensure the full individual window has elapsed

and avoid reinterpreting cohort week 2 as every participant's second completed

week. A wire-compatible payload alone does not establish valid timing.

## What is already fixed or compatible

- The local API and dashboard both support eight horizons through day 56.

- The returned displayed score and `threshold_low`/`threshold_high` use the same

  Platt-transformed scale. `threshold_used` remains raw for audit. The dashboard

  risk explanation already distinguishes these scales.

- All eight local model cards reference label hash `00e432f11042a6df`, matching

  the audited saved label table.

- Existing cards without a feature-definition field retain the historical

  `all_activities_v1` activity-word mean. The newer authored-only calculation is

  explicitly versioned. All six feature-contract tests passed again on 16 October. In the

   dashboard, 32 existing tests for risk thresholds, scoring weeks and cohort

   extraction passed. Neither suite covers the unresolved start-origin and

   roster alignment demonstrated above.

## Next implementation and release decision

Preserve the current live release and record its `/health` and `/model/info`

responses before any deployment change. Implement an isolated candidate that

preserves raw nullable start information, applies the chosen training-aligned

clock and roster rules, and gates scoring by elapsed individual time. Include

late-starter, missing-start, pre-course-event, retrospective-roster and partial-

week regression cases.

In the pinned model environment, compare the candidate with the current adapter

using the same frozen models: changes in model features, probability, tier and

outreach volume, stratified by recorded versus missing starts. This does not

initially require retraining. If the intended product task instead requires a

published-cohort clock or a new endpoint, rebuild and evaluate a separate model

version for that task. Any release should ship compatible code and artifacts

together and retain rollback. None of those production changes is included in

the reporting-only corrections.

Reproducible input audit: `textEngagement/doc/internal/reporting_update_20261016/`

contains `audit_dashboard_inputs.cjs` and `dashboard_input_audit.json`. It reads

the sibling repositories and writes only aggregate audit results in that folder.

## Subsequent live check on 16 October

The live predictor and local dashboard proxy have now been exercised. All eight

served models match the audited local files. Paired real-data replay changed

14/216 support tiers at day 7 and 10/216 at day 42 when the training timing and

roster rules were substituted. The hosted authenticated UI session was not

retested; production settings and the sleeping SLM were left unchanged.

See [the live check report](LIVE_PREDICTOR_CHECK_20261016.md) for scope and results.

## Validated correction candidate

A separate local candidate now preserves raw nullable starts and the full source
enrolment roster, uses the frozen training start/fallback/roster definitions, and
gates predictions on elapsed individual observation time. Old bundles without
that provenance remain viewable but unscored until rebuilt. Against the unchanged
live model, the candidate and an independent training-rule reference produced
identical probabilities and tiers for all 216 participants at both day 7 and day
42. No model, threshold or production configuration was changed. See the release
candidate notes for the coordinated rollout and remaining storage/data checks.
