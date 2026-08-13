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

- Commit hash: `dea66888dff59f8a3291470dc86951bdc7db1d37`

---

# Fix round 3 — add explicit raw-input assertions for invalid timestamps

## RED

- New tests added: raw-input assertions for `2026-13-01` and `2026-01-01T00:00:60Z`
- Confirmed red evidence: none in production code; the existing validator already returned `false` and did not throw for these inputs.

## GREEN

- Command: `node --import tsx --test tests/watchlist-contracts.test.ts`
- Result: passed with 6/6 tests
- Command: `pnpm run check`
- Result: passed

## Coverage added

- Explicit raw string `2026-13-01` is rejected without throwing.
- Explicit raw string `2026-01-01T00:00:60Z` is rejected without throwing.

## Commit

- Commit hash: `dea66888dff59f8a3291470dc86951bdc7db1d37`

## Self-review

- The contract module exports the requested types and validators.
- The validators enforce non-empty falsifiers, validation points, fact references, version strings, ISO timestamps, and snapshot thesis ID uniqueness.
- The test coverage matches the brief and now passes cleanly.
- TypeScript strict checking passes.

## Concerns

- The repo’s default `pnpm test` runner is IPC-restricted in this sandbox, so the failing red command had to be corroborated with the direct `node --import tsx --test` invocation.

---

# Fix round 2 — make invalid timestamps non-throwing

## RED

- New test added: `rejects invalid calendar timestamps without throwing`
- Confirmed red evidence: `node --import tsx --test tests/watchlist-contracts.test.ts`
  - Result before fix: failed with `RangeError: Invalid time value` when validating `2026-13-01T00:00:00Z`.

## GREEN

- Command: `node --import tsx --test tests/watchlist-contracts.test.ts`
- Result: passed with 6/6 tests
- Command: `pnpm run check`
- Result: passed

## Coverage added

- Non-string timestamps return false and do not throw.
- Natural-language timestamps return false and do not throw.
- Invalid calendar timestamps such as month 13 and leap second values return false and do not throw.
- Invalid `dueAt` dates on validation points return false and do not throw.

## Commit

- Commit hash: `dea66888dff59f8a3291470dc86951bdc7db1d37`

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

- Commit hash: `dea66888dff59f8a3291470dc86951bdc7db1d37`
