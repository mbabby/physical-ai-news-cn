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

## Review fix round 1/5

Status: PASS.

- Complete LKG grouping now includes the prior exact-valid `review/evidence-task-seeds.json`. A GitHub-degraded run stages the prior seeds, ledger, accepted evidence, contribution ledger, public tasks, and Issue snapshot unchanged; it never mixes new seeds with an old projection.
- Added projection-level relational validation before prior data can be used for fallback/revalidation and before any fresh projection is staged. It validates exact task/Issue/version/category/subject/target-field bindings, active public-task membership, accepted-evidence attribution, contribution promotion targets, and per-pair append-only lifecycle state.
- Preserved legitimate lifecycle behavior: unreferenced terminal ledger history may outlive the label-filtered snapshot; corrected/withdrawn contribution history may retain URLs removed from the current Issue; ledger-derived successor version/supersession metadata need not be copied into generated seeds; equal-time promotion-before-acceptance serialization remains valid.

RED/green evidence:

- RED: changed valid seeds during GitHub failure replaced the prior seed bytes. GREEN: every LKG artifact remains byte-identical.
- RED: a shape-valid accepted entry bound to the wrong ledger task passed fallback. GREEN: relational validation fails closed and disk bytes remain unchanged.
- RED: legitimate omitted terminal ledger history and corrected history with a removed URL were over-rejected. GREEN: both valid histories pass while current accepted pairs remain strict.
- RED: a valid changed-material successor failed because seed and ledger supersession fields were incorrectly equated. GREEN: stage-level successor projection records version 2 and the ledger-derived predecessor.
- RED: a shape-valid promoted event could target an unrelated public URL. GREEN: promotion is bound exactly to `task.subject.url`.
- RED: orphan accepted contribution history remained active after acceptance was removed. GREEN: per-pair lifecycle validation rejects it.
- Independent adversarial re-review: no remaining Critical or Important findings.

Fresh verification after the final fix:

- Focused daily/atomicity/contribution/lifecycle/publication tests: PASS, 66/66.
- `CI=true pnpm run check`: PASS.
- `CI=true pnpm test`: PASS, 706/706.
- `CI=true pnpm run validate:release`: PASS; 2026-08-24, 6 public items, existing runtime state `degraded`.
- `git diff --check`: PASS.

## Review fix round 2/5

Status: PASS.

- Current Issue/snapshot membership is required only for active accepted/promoted contribution pairs and public open tasks. Accepted entries remain snapshot-bound through both the direct relationship checks and the active lifecycle check.
- Terminal corrected/withdrawn contribution history may outlive the label-filtered Issue snapshot, but every event must still bind exactly to its retained ledger task identity, Issue number and canonical Issue URL, category, subject, target field, and promotion target semantics.
- Added a three-refresh regression covering accepted, then source-withdrawn/corrected, then omission after loss of `two-minute-task`; the third refresh preserves the append-only contribution history and retained ledger identity.

RED/green evidence:

- RED: the third refresh failed with `社区证据任务 ... 缺少当前 Issue 关系` because every historical contribution event forced current snapshot membership.
- GREEN: only active accepted/promoted pairs and public open tasks force current snapshot membership; terminal corrected/withdrawn histories revalidate against their retained ledger identity and survive omission.
- Independent adversarial review: no remaining Critical or Important findings.

Fresh verification:

- Focused daily/atomicity/contribution/lifecycle/publication tests: PASS, 67/67.
- `CI=true pnpm run check`: PASS.
- `CI=true pnpm test`: PASS, 707/707.
- `CI=true pnpm run validate:release`: PASS; 2026-08-24, 6 public items, existing runtime state `degraded`.
- `git diff --check`: PASS.
