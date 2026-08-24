# Baseline Fix Report

## Status

Complete. This change fixes only the pre-existing fixed-clock fixture isolation defect and does not start Phase 4.

## Root cause

The four affected integration harnesses recursively copied the repository's `site/data` directory into a temporary fixture root. That copied the checked-in `site/data/decision-products.json`, whose `generatedAt` was `2026-08-24T08:05:05.893Z`, into fixtures whose injected generation clocks were `2026-08-16T08:00:00.000Z` or `2026-08-23T08:00:00.000Z`.

The data flow was:

1. A test helper copied `site/data/decision-products.json` from the repository into its temporary root.
2. `generate({ root, now, ... })` passed that temporary root to `generateDaily` as `outputRoot`.
3. `generateDaily` read `${outputRoot}/site/data/decision-products.json` with `readJsonStrict` and assigned it to `previousDecisionProductArtifact`.
4. `generateDaily` passed it to `buildDecisionProductArtifact` as `previousArtifact`.
5. `buildDecisionProductArtifact` correctly rejected the artifact because its timestamp was later than the injected clock, throwing `Decision Product 历史工件不能晚于当前生成时钟`.

The checked-in current publication is not owned by a newly created fixed-clock fixture. Treating it as fixture history was therefore an input/fixture ownership bug, not a production clock-validation bug.

## TDD red test and failure

Added `fixed-clock fixture does not import repository Decision Product history` to `tests/decision-products-pipeline.test.ts`. The test exercises the real temporary fixture boundary and requires `site/data/decision-products.json` to be absent before generation.

Red command:

```text
./node_modules/.bin/tsx --test --test-name-pattern="fixed-clock fixture" tests/decision-products-pipeline.test.ts
```

Expected red result: 0 passed, 1 failed. Node reported `AssertionError [ERR_ASSERTION]: Missing expected rejection.` because the copied file still existed.

## Implementation

Each of the four affected fixture builders now removes only the copied `site/data/decision-products.json` immediately after recursively copying the repository seed directories. This establishes a new fixture-owned publication timeline. Subsequent generations within the same fixture still read and validate the artifact created by the preceding fixture generation, so last-known-good retention behavior remains covered.

No production source or generated production artifact changed. The future-history invariant and its error remain unchanged in `src/decision-products/materialize.ts`.

## Commands and results

- Focused red regression: 0 passed, 1 failed with the expected missing-rejection assertion.
- Focused green regression: 1 passed, 0 failed.
- `./node_modules/.bin/tsx --test tests/decision-products-pipeline.test.ts`: 5 passed, 0 failed.
- `./node_modules/.bin/tsx --test tests/daily-watchlist-release-integration.test.ts tests/dual-ledger-pipeline.test.ts tests/release-contract.test.ts`: 32 passed, 0 failed.
- `./node_modules/.bin/tsc --noEmit`: exit 0.
- `./node_modules/.bin/tsx --test tests/**/*.test.ts`: 627 passed, 0 failed.
- `git diff --check`: exit 0.

## Files changed

- `tests/decision-products-pipeline.test.ts`
- `tests/daily-watchlist-release-integration.test.ts`
- `tests/dual-ledger-pipeline.test.ts`
- `tests/release-contract.test.ts`
- `.superpowers/sdd/2026-08-24-phase4-community-evidence-flywheel/baseline-fix-report.md`

## Commit hash

Implementation commit: `4ef9c76e172ca38bec846dcd3932fae9cb8ecb4c` (`test: isolate fixed-clock decision fixtures`).

## Self-review

- The change is restricted to test fixture ownership and one regression test.
- The production invariant rejecting genuinely future historical artifacts was neither deleted, ignored, downgraded, nor modified.
- The fixtures still copy the other production inputs required for full release integration coverage.
- A first fixture generation starts without repository-owned Decision Product history; later fixed-clock reruns use history generated inside that same fixture, preserving retention and rollback coverage.
- No generated data, dates, `.DS_Store`, or Phase 4 code changed.
- The regression would fail if the Decision Product publication artifact were accidentally reintroduced into the fixed-clock fixture.

## Concerns

None. The fixture builders remain duplicated across four test files, but consolidating them would be unrelated refactoring and was intentionally avoided to keep this prerequisite fix surgical.
