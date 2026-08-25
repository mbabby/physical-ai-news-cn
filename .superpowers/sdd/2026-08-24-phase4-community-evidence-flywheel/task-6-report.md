# Task 6 Report: Daily Transaction Integration and Revalidation Queue

## Status

PASS — daily generation now stages the community evidence group atomically, accepted evidence enters a revalidation-only queue, GitHub degradation preserves LKG projections, and normal canonical publication gates remain unchanged.

## Implementation

- Added strict daily projection for:
  - `review/evidence-task-seeds.json`
  - `review/evidence-issue-snapshot.json` (internal LKG snapshot)
  - `review/evidence-task-ledger.json`
  - `review/accepted-evidence.json`
  - `community/contributions.json`
  - `site/data/community-tasks.json`
- Added `buildAcceptedEvidenceEnrichmentTargets`, preserving the accepted URL/domain, subject, target field, acceptance identity, and an explicit five-check revalidation gate. Targets are `revalidation-only`, `mayPublish: false`, and `mayUpgradeFactGrade: false`.
- Wired accepted evidence into `review/evidence-enrichment.json` only after canonical events, company profiles, and research cards have already been derived from their existing inputs.
- Added strict prior-artifact reads and complete-projection checks. A configured GitHub failure reuses the full previous projection; without an LKG it fails closed. An unconfigured bootstrap creates an empty internal projection and records `GitHub · 未配置`.
- Preserved pending GitHub lifecycle actions: persisted `ready`, stale, and terminal projections re-emit their remote actions until the Issue snapshot proves application, while respecting both the requested creation limit and five-Issue hard cap.
- Added `GITHUB_TOKEN` and `GITHUB_REPOSITORY` only to the daily generation step; workflow permissions are `contents: write` and `issues: read`.
- Added `community/` to the generated-publication staging boundary so the workflow commit cannot strand the contribution ledger.

## TDD and review evidence

- RED: the new integration test first failed because `buildAcceptedEvidenceEnrichmentTargets` was missing.
- RED: the next run failed because `stageCommunityEvidenceArtifacts` was missing.
- RED: configured GitHub failure without LKG incorrectly succeeded; it now fails closed.
- RED: publication staging rejected `community/contributions.json`; `community/` is now included.
- RED: persisted lifecycle projections suppressed weekly actions; planner regressions now cover retry behavior.
- RED: persisted ready retries exceeded requested/hard WIP limits; slot accounting now enforces both.
- Independent code review: no remaining Critical or Important findings after three fix/re-review cycles.

## Verification

- `CI=true pnpm run check` — PASS.
- Focused daily/community/planner/storage/publication tests — PASS, 42/42.
- `CI=true pnpm test` — PASS, 700/700.
- `CI=true pnpm run validate:release` — PASS: 2026-08-24, 6 public items, existing runtime state `degraded`.
- `git diff --check` — PASS.

## Publication boundary

- Accepted evidence is a pending revalidation input, not fetched proof and not a source-tier decision.
- It cannot modify canonical records until a later fetch enters the existing entity, source-tier, field-consistency, conflict, and date gates.
- The full daily integration test proves the accepted URL is present in enrichment targets and absent from canonical events, company profiles, research decision cards, and README.

## Concerns / follow-up

- The brief names `tests/file-transaction.test.ts`, but this repository has no such file; the canonical transaction coverage is `tests/runtime-storage.test.ts`, which was included in focused verification.
- No live GitHub API call, Actions run, commit push, Pages deployment, LLM call, or OpenAlex call was performed. Those remain online acceptance steps.
