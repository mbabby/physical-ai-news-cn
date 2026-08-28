# Phase 4 Task 8 Report: Release Gates, Metrics, and Documentation

## Status

Local implementation complete on `feat/phase4-community-evidence`; push and online acceptance remain intentionally unauthorized.

## Commit

- `45a3de4 feat: enforce community evidence release gates`

## Delivered

- Added exact cross-artifact release validation for all six community evidence artifacts.
- Rejects private leakage, multiple target fields, subject/reference drift, official aggregator misclassification, duplicate active identity, WIP above five, stale/closed public tasks, removed acceptance, unaccepted credit, lifecycle errors, append-history mutation, and canonical promotion bypass.
- Compares working contribution history with committed `HEAD`, or with `HEAD^` when validating a clean checkout, and requires the previous event list as an exact prefix.
- Binds active accepted records to the exact acceptance event ID and timestamp.
- Extracts accepted URLs from structured data and Markdown before canonical-publication checks.
- Added exact aggregate community metric validation and recomputation for open tasks, category coverage, weekly acceptance/new contributors, stale/invalid ratios, and promotion conversion. Contributor rankings and per-user scores are rejected by the exact contract.
- Preserves prior aggregate values when local flywheel artifacts are temporarily unavailable.
- Updated README, contributor guidance, evidence review, and release standards for the two-minute task contract, accepted-versus-published distinction, co-contributor marker, stale/close lifecycle, contribution center, and append-only correction/withdrawal history.
- No workflows were changed. The checked metric mirrors were upgraded to the new aggregate schema.

## Strict TDD evidence

- Initial release RED: the suite failed because `validateCommunityEvidenceRelease` did not exist.
- Initial metrics RED: the suite failed because `buildFlywheelMetrics` did not exist.
- Review fixes were each driven by failing regressions for clean-checkout predecessor selection, accepted ID/time drift, closed Issues, Markdown URL bypass, metrics forgery/ranking leakage, LKG metric preservation, and aged-out active seeds.
- Final focused release/metrics suite: 44/44 passed.
- Final full suite: 742/742 passed.
- `CI=true pnpm run check`: passed.
- `git diff --check`: passed.

## Local release validation

- Fixed-fixture filesystem release validation: passed, including two generation passes inside the release contract fixture.
- Direct full-suite fixed-clock community/daily idempotence and LKG tests: passed.
- Public-boundary scan: no placeholder Chinese summary, community private fields, contributor ranking, or accepted-evidence bypass was introduced.
- `validate:health` loader fallback: ran successfully and reported degraded because LLM, OpenAlex, and GitHub were unconfigured and historical date gaps remain.

## Command limitations and concerns

- `pnpm test`, `pnpm start`, `pnpm run validate:release`, and `pnpm run validate:health` invoke the `tsx` CLI, whose IPC socket is blocked by this sandbox (`listen EPERM`). Equivalent `node --import tsx` commands were used.
- The documented `--fixture-mode` flag is not parsed by `src/main.ts`; two repository-root CLI runs used wall-clock receipts, so the complete repository diff was not byte-identical. The community evidence artifacts themselves were byte-identical, and the existing fixed-clock integration tests passed. Generated run outputs were removed after validation.
- The real repository-root generated dataset reached health validation but release validation stopped at a pre-existing Decision Product JSON rebuild mismatch. The isolated release fixture passes the same release validator.
- No GitHub Issue was created or changed, no workflow was dispatched, no Pages state was checked, and nothing was pushed. Those steps require explicit authorization.

## Independent review

- Initial review found five Important release-boundary gaps; all received red-first regressions and fixes.
- First rereview found two LKG edge cases; both were fixed with ancestor lookup and independently loaded prior public-task context.
- Final rereview: no remaining Critical or Important findings; ready to merge.

## Fix round 1/5

Status: locally verified; push and online acceptance remain unauthorized.

Commit: `9e85877 fix: add deterministic release fixture mode` plus the current review-fix commit recorded in the final handoff.

### Review findings resolved

1. `src/main.ts` now parses the pnpm argv shape `-- --fixture-mode` and routes only that mode through a deterministic offline adapter. It fixes the clock at `2026-08-24T08:05:05.893Z`, injects empty source/X collectors and an exact empty GitHub snapshot, clears LLM/OpenAlex/X credentials, traps accidental network access, and still uses the production `generate()` transaction/publication path. Normal mode remains unchanged.
2. The repository now tracks the complete exact-valid bootstrap community group: task seeds, Issue snapshot, task ledger, accepted evidence, contribution history, and public tasks. The group was generated by two actual fixture CLI runs and contains no tasks, candidates, private fields, or contributor data.
3. Generation fixtures now treat those six files atomically: they either copy the complete group or remove the complete group before constructing an older fixed-clock projection.
4. Fixture input normalization is failure-safe. The runner recognizes a repository-shaped fixture root before writing, snapshots every directly normalized input, passes an injected transaction into the real generator, and restores exact pre-run bytes if preparation or publication fails.

### RED/GREEN evidence

- CLI RED: `tests/fixture-mode-cli.test.ts` initially failed because `parseCliOptions` did not exist. After routing the fixed seams, it exposed three unstable mutable inputs (`daily/2026-08-24.json`, `research/registry.json`, `sources/registry.json`); fixture-only input normalization made the complete copied tree byte-stable.
- Bootstrap RED: the repository-root regression failed with `ENOENT` for `review/evidence-task-seeds.json`. The production fixture CLI generated the six-file group, after which the same regression passed.
- Compatibility RED: older fixed-clock tests copied five parts of the new group but omitted `community/contributions.json`, and correctly failed closed as an incomplete projection. Fixture copies now handle the group atomically.
- Rollback RED: an injected first-swap transaction failure was not observed because the runner did not pass the transaction seam, while an empty root reached direct fixture preparation writes before failing. The new regressions now prove complete byte restoration after the injected publication failure and zero writes to an unrecognized root.

### Verification

- Fixture CLI suite: 4/4 passed, covering argument parsing, hostile-credential isolation, real transaction staging, fixed clock, complete two-run byte equality, injected-failure rollback, and safe root rejection.
- Focused release/fixture/metrics/pipeline suites: passed after atomic fixture updates.
- Full suite: 747/747 passed.
- `CI=true pnpm run check`: passed.
- Two actual `CI=true pnpm start -- --fixture-mode` runs after the rollback fix: passed; complete git diff hash stayed `9bd3bf39f6720d8476606897a1be0752820639b53402731968f8765a300bf762` and all six artifact hashes were identical.
- Repository-root `CI=true pnpm run validate:release`: passed (`发布校验通过：2026-08-24，公开 6 条，运行状态 degraded。`). This confirms the former missing-community blocker is fixed; the previously observed Decision Product mismatch belonged to the non-deterministic dirty generated state and is not present on the clean bootstrap checkout.
- Repository-root `CI=true pnpm run validate:health`: executed and reported `stale` because the latest committed publication is 2026-08-24, more than 36 hours behind the current 2026-08-28 clock, with pre-existing historical gaps and external degradation.
- `git diff --check`: passed.

### Remaining concerns

- Inside the managed sandbox, direct `tsx` CLI commands still cannot create their IPC socket. The two required pnpm fixture runs and release/health commands were therefore executed with local sandbox escalation; no network service was contacted by fixture mode.
- Health remains stale until a newly authorized real daily publication succeeds.
- No push, live Issue mutation, workflow dispatch, or Pages check was performed.
