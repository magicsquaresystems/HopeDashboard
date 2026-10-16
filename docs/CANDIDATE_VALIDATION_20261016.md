# Training-input candidate validation — 16 October 2026

The dashboard candidate preserves raw nullable enrolment starts, uses each
recorded start or the earliest recorded start in the full cohort, and counts
all enrolments started by the focal model horizon. Staff stay out of the visible
queue but remain in the frozen model's roster-context definition. Complete
individual windows are required before scoring; lost-provenance legacy bundles
must be refreshed. No clock, target, feature, threshold or weight was redefined.

Stateless comparisons against the frozen live predictor returned HTTP 200:

| Horizon | Participants | Probability differences | Tier differences | Model |
| --- | ---: | ---: | ---: | --- |
| day 7 | 216 | 0 | 0 | `lightgbm_T7@d1887c802c7d` |
| day 42 | 216 | 0 | 0 | `lightgbm_T42@01b06326307b` |

The comparator used an independent training-rule reference. Both recorded-start
(100) and missing-start (116) groups matched. Across 432 paired participant/
horizon inputs, start, roster and event-window mismatch counts were all zero.
The earlier adapter had changed 14 and 10 tiers relative to this reference.

Requests used temporary identifiers and excluded authored text except emotion
tag selections. Only aggregates were saved. Internal payload helpers must be
invoked through the audit wrapper, never displayed in a terminal. No messages,
support decisions, hosted generation, memory/feedback writes, deployments or
production settings were changed by these prediction checks. Separate synthetic
SLM weight tests were run on the user's local GPU.

This supports correcting the partner adapter without retraining. A different
intended clock, target or feature contract requires a separately evaluated model
version. Review the coordinated dashboard/SLM release candidate before production
rollout. The internal reproducible scripts and aggregate JSON evidence remain in
the textEngagement audit folder, outside version control.
