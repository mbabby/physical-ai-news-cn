# Task 1 report — watchlist domain contract

## RED

- Command: `pnpm test -- tests/watchlist-contracts.test.ts`
- Expected failure: `src/watchlist/contracts.ts` missing
- Actual note: the workspace sandbox blocks `tsx --test` IPC on this command path with `EPERM` before the missing-module assertion can surface.
- Confirmed red evidence: `node --import tsx --test tests/watchlist-contracts.test.ts`
  - Result: failed with `ERR_MODULE_NOT_FOUND` for `../src/watchlist/contracts.js`, which is the expected pre-implementation failure.

## GREEN

- Command: `node --import tsx --test tests/watchlist-contracts.test.ts`
- Result: passed
- Command: `pnpm run check`
- Result: passed

## Modified files

- `src/watchlist/contracts.ts`
- `tests/watchlist-contracts.test.ts`

## Commit

- Commit hash: `bb97e7808c03d3b51bbb639a1dfeff912bef2e2e`

## Self-review

- The contract module exports the requested types and validators.
- The validators enforce non-empty falsifiers, validation points, fact references, version strings, ISO timestamps, and snapshot thesis ID uniqueness.
- The test coverage matches the brief and now passes cleanly.
- TypeScript strict checking passes.

## Concerns

- The repo’s default `pnpm test` runner is IPC-restricted in this sandbox, so the failing red command had to be corroborated with the direct `node --import tsx --test` invocation.

---

# Fix round 1 — stricter timestamp/date validation and route cleanup

## RED

- New test added: `rejects non-string and non-canonical timestamps and dates`
- Confirmed red evidence: `node --import tsx --test tests/watchlist-contracts.test.ts`
  - Result before fix: the new test failed because `generatedAt` accepted non-canonical or non-string values and `dueAt` still accepted normalized invalid calendar dates.

## GREEN

- Command: `node --import tsx --test tests/watchlist-contracts.test.ts`
- Result: passed with 5/5 tests
- Command: `pnpm run check`
- Result: passed

## Coverage added

- Rejects non-string timestamps.
- Rejects natural-language timestamps.
- Rejects non-canonical ISO timestamps such as invalid calendar dates.
- Rejects invalid `dueAt` dates for validation points.

## Commit

- Commit hash: `284bbe294dbbc8c8ec367ce7de3de11727dab18e`
