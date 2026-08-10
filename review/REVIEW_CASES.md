# Candidate Review Case + SLO

`src/review-cases.ts` provides one internal, auditable work-item contract for candidate articles, companies, sources, and papers. It is intentionally separate from `src/main.ts`: producing a case never creates an Issue and never promotes a candidate to public content.

## Stable case contract

- Identity is `caseId = sha256(type + subjectId)`, not a mutable title, company alias, or source display name.
- Every case writes the same explicit fields: owner is `null` when unassigned; undecided fields are also `null`, never silently absent.
- `createdAt` comes from the source registry when available. `dueAt` is the **first human response** deadline, not an event date and not a publication date.
- `auditTrail` is append-only. Generator re-runs only append an `updated` record for a real normalized source-field change; an unchanged same-day re-run is idempotent.
- Human actions go through `applyReviewCaseActions`. An accepted/rejected decision is terminal and a later generator upsert cannot reopen it.

## Priorities and response SLO

| Priority | First response SLO |
| --- | ---: |
| P0 | 4 hours |
| P1 | 24 hours |
| P2 | 72 hours |
| P3 | 168 hours |

Generators may set an explicit priority. Otherwise `calculateReviewPriority` uses stable type weight, impact score, absence of evidence, and conflicts. An escalation can only tighten the response deadline; it never extends one.

## Generator and artifact boundary

Use `reviewCaseGenerator({ articles, companies, sources, papers })` to adapt the current registries, then call `buildReviewCaseArtifact(previous, generators, now)`. The output can be written with `serializeReviewCaseArtifact(artifact)` when the main job is ready to own `review/review-cases.json`.

The module currently does not write files or invoke external services. This keeps integration opt-in and makes replays testable.

## Operational signals

`reviewCaseAlerts` emits deterministic alerts for active cases that are overdue before a first response, have no explicit owner, or lack a next action. `reviewCaseMetrics` supplies:

- due Top-20 probe coverage: cases that have a `probe` audit action since case creation;
- first-response P90 in hours;
- active backlog age P50/P90/max;
- SLO attainment among cases responded to, due, or terminal.

Use `probe` only for an actual verification attempt (for example, checking an official announcement or an independent source), not merely assigning an owner.
