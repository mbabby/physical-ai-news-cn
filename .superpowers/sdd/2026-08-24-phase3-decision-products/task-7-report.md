# Task 7 Report: Release Contracts and Generated Assets

## Outcome

- Added adversarial Decision Product release validation for exact artifact schema/rebuild bytes, dashboard identities and order, README marker identities, Feed manifest/RSS bytes and GUID order, company-event ownership, Benchmark-ledger evidence, shared generation time, and recursive private/candidate boundaries.
- Wired the same material validation into daily generation before the shared `FileTransaction` commits and into `pnpm run validate:release` against checked-in public bytes.
- Documented Top Signal evidence gates, company `unknown` semantics, Research Passport limitations, zero-backend subscription privacy, correction behavior, and the one documented health-clock comparison exception.
- Preserved a valid empty Top Signals week without dropping valid company cards, Research Passports, or subscription entries.

## TDD Evidence

RED was observed before implementation:

```text
SyntaxError: ../src/runtime/validation.js does not provide an export named validateDecisionProductPublication
2 test files failed
```

After the smallest validator implementation, the focused adversarial and positive tests passed. The mutation matrix now rejects dashboard reordering, a known company value without evidence, candidate identifiers in a Passport, altered RSS GUIDs, altered README identities, raw model output, wrong company ownership, missing Benchmark-ledger evidence, and generation-time drift.

## Verification

```text
pnpm run check
tsc --noEmit (exit 0)

pnpm test
612 tests, 612 passed, 0 failed

pnpm exec tsx --test tests/decision-products-pipeline.test.ts tests/dual-ledger-pipeline.test.ts
10 tests, 10 passed, 0 failed

git diff --check
exit 0
```

The fixed Decision Product fixture runs twice and compares JSON, dashboard, README, manifest, and Feed bytes. The dual-ledger fixture also runs twice with byte-identical outputs. No fixture writes escaped its temporary repository.

## Release and health status

- `pnpm run validate:release`: **failed closed** because `site/data/decision-products.json` is not present in the checked-in baseline. The Decision Feed directory/manifest is absent for the same reason.
- `pnpm run validate:health`: **degraded but usable** with exact reasons:
  - 最近一次运行存在外部服务或信源降级
  - 运行历史存在 1 天空档：2026-08-16 → 2026-08-18
  - 运行历史存在 1 天空档：2026-08-20 → 2026-08-22
- Public leak scan found no match in `README.md`; the Decision Product JSON and Feed paths could not be scanned because they are absent.

## Real-generation blocker

All of `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`, `OPENALEX_API_KEY`, and `X_BEARER_TOKEN` are unconfigured. A real `pnpm start` also performs network collection and replaces the repository's complete non-fixture publication group. Under the task's safety constraint, no network/secrets were assumed and no hand-written or partially copied generated assets were substituted. Therefore `README.md`, `site/data/decision-products.json`, and `site/feeds/decision/*` remain intentionally unmodified until an explicitly authorized, configured real pipeline run can stage them atomically.

## Self-review

- Added raw byte comparisons for the Decision Product JSON and Feed manifest after noticing that parse-and-reserialize comparison alone would not reject whitespace/key-order drift.
- Confirmed renderers are used only to derive expected Feed bytes; the release validator compares those expectations against files read from disk.
- Confirmed the local generator gate executes before transaction commit and the standalone release gate rebuilds from canonical EventStore, company, ledger, research-card, research-registry, and public Watchlist inputs.
- Confirmed no online workflow, push, merge, manual generated-asset edit, secret value, request body, or unrelated file change was performed.
