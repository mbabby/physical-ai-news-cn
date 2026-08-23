# Phase 2 Dual Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build evidence-bound, field-level company and benchmark ledgers with explicit unknown/conflict states and deterministic correction history.

**Architecture:** A shared ledger contract owns field states, evidence bindings, validation, and correction diffs. The existing company claim ledger becomes a backward-compatible projection over field-level financing/deployment facts, while a new benchmark ledger materializes research-result facts from gated research records and decision cards. Both artifacts are rebuilt by the daily transaction and validated before release; neither creates a new public ranking in Phase 2.

**Tech Stack:** TypeScript 5.9, Node.js test runner, pnpm, JSON artifacts, existing `FileTransaction` and GitHub Actions release pipeline.

## Global Constraints

- Field status is exactly `verified | developing | conflicted | unknown`.
- Missing evidence is `unknown`, never a negative assertion.
- Candidate/discovery-only evidence never becomes a ledger fact.
- Existing Watchlist consumers continue to receive only the compatibility `verified` projection.
- Corrections are deterministic, evidence-bound, and exclude verification-clock-only changes.
- No database, new external API, public ranking, subscription UI, or Phase 3 product surface is introduced.
- Every behavior change follows TDD RED/GREEN.

---

### Task 1: Define the shared field-evidence and correction contract

**Files:**
- Create: `src/ledger-contracts.ts`
- Create: `tests/ledger-contracts.test.ts`

**Interfaces:**
- Produces `LedgerFieldStatus`, `LedgerField<T>`, `LedgerCorrectionReason`, `LedgerCorrection`, `unknownLedgerField()`, `ledgerField()`, `deriveLedgerCorrections()`, and `validateLedgerField()`.
- Consumed by both ledger builders and release validation.

- [ ] **Step 1: Write failing field-state tests**

Add tests proving that `unknown` has no evidence/value, `verified` has a value and evidence, `developing` retains its provisional value internally, and `conflicted` records at least two distinct values.

```ts
test("requires evidence for known fields and explicit alternatives for conflicts", () => {
  assert.throws(() => validateLedgerField({ value: "10M", status: "verified", evidenceIds: [], evidenceUrls: [] }));
  assert.doesNotThrow(() => validateLedgerField(unknownLedgerField<string>()));
  assert.throws(() => validateLedgerField({ value: "unknown", status: "conflicted", evidenceIds: ["e1"], evidenceUrls: ["https://a.example"], conflictingValues: [] }));
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `pnpm exec tsx --test tests/ledger-contracts.test.ts`

Expected: FAIL because `src/ledger-contracts.ts` does not exist.

- [ ] **Step 3: Implement the minimal contract and validators**

Use stable code-unit sorting for evidence and conflicting values. Reject non-absolute URLs, duplicate evidence IDs, known fields without evidence, unknown fields with a value, and conflict fields with fewer than two distinct values.

- [ ] **Step 4: Add failing correction-diff tests**

Cover `new-evidence`, `conflict-detected`, `conflict-resolved`, `source-withdrawn`, and `metadata-correction`. Assert that reordered evidence and changed `verifiedAt` alone do not create a correction.

- [ ] **Step 5: Implement deterministic correction derivation**

`deriveLedgerCorrections()` compares stable subject/field keys, hashes material before/after state into `correctionId`, preserves prior corrections, and appends only a new material transition.

- [ ] **Step 6: Run focused tests and typecheck**

Run: `pnpm exec tsx --test tests/ledger-contracts.test.ts && pnpm run check`

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/ledger-contracts.ts tests/ledger-contracts.test.ts
git commit -m "feat: define dual-ledger field contracts"
```

### Task 2: Upgrade financing and deployment claims to field-level evidence

**Files:**
- Modify: `src/company-claim-ledger.ts`
- Modify: `tests/company-claim-ledger.test.ts`
- Modify: `tests/review-ledger-integration.test.ts`
- Modify only for compatible type fixtures: `tests/watchlist-*.test.ts`

**Interfaces:**
- Consumes shared ledger contracts.
- Extends `CompanyClaim` with stable `claimId`, `eventIds`, `fields`, and `corrections` while retaining `value`, `evidenceState`, and existing evidence arrays.
- Extends `CompanyClaimLedgerOptions` with `previous?: CompanyClaimLedger`.

- [ ] **Step 1: Write failing tests for the four field states**

Test A-grade funding fields as verified, one independent B as developing, an event marked with conflicting evidence as conflicted, and absent customer/amount as unknown. Assert the compatibility `value` remains `unknown` unless the relevant fields are verified.

- [ ] **Step 2: Verify RED**

Run: `pnpm exec tsx --test tests/company-claim-ledger.test.ts`

Expected: FAIL because claims do not expose `fields` or four-state semantics.

- [ ] **Step 3: Implement financing and deployment field projections**

Materialize these exact fields:

```ts
type CompanyClaimFields = {
  eventDate: LedgerField<string>;
  round: LedgerField<string>;
  amount: LedgerField<string>;
  valuation: LedgerField<string>;
  investors: LedgerField<string[]>;
  product: LedgerField<string>;
  customer: LedgerField<string[]>;
  deployment: LedgerField<string>;
  productionStage: LedgerField<string>;
};
```

An A source verifies present fields. Two independent B sources verify matching fields. One B makes present fields developing. Explicit event conflict makes supported fields conflicted. Missing fields remain unknown independently.

- [ ] **Step 4: Add failing correction-history tests**

Build once with a developing amount, rebuild with two matching B sources, then rebuild with a corrected amount. Assert stable claim identity, `new-evidence` followed by `metadata-correction` or conflict transitions, preserved old/new field snapshots, and no duplicate correction on rerun.

- [ ] **Step 5: Implement previous-ledger migration and corrections**

Legacy claims without fields are accepted as migration input but do not fabricate correction history. New claims compare against the previous claim with the same `claimId`.

- [ ] **Step 6: Verify company and Watchlist compatibility tests**

Run: `pnpm exec tsx --test tests/company-claim-ledger.test.ts tests/review-ledger-integration.test.ts tests/watchlist-seeds.test.ts tests/watchlist-preview.test.ts tests/watchlist-validation.test.ts && pnpm run check`

Expected: all pass; Watchlist still accepts only the compatibility verified projection.

- [ ] **Step 7: Commit**

```bash
git add src/company-claim-ledger.ts tests/company-claim-ledger.test.ts tests/review-ledger-integration.test.ts tests/watchlist-seeds.test.ts tests/watchlist-preview.test.ts tests/watchlist-validation.test.ts
git commit -m "feat: add field-level company claim evidence"
```

### Task 3: Build the Benchmark Result Ledger

**Files:**
- Create: `src/benchmark-result-ledger.ts`
- Create: `tests/benchmark-result-ledger.test.ts`
- Reuse: `src/research-registry.ts`
- Reuse: `src/research-decision-card.ts`

**Interfaces:**
- Produces `BenchmarkResultLedger`, `BenchmarkResultEntry`, `buildBenchmarkResultLedger()`, and `validateBenchmarkResultLedger()`.
- Consumes `ResearchRecord[]`, `ResearchDecisionCard[]`, optional previous ledger, and a fixed `now`.

- [ ] **Step 1: Write failing benchmark materialization tests**

Cover a verified LIBERO result with exact source URL, metric/result/baseline/delta parsing, verified real-robot setting, and code URL. Assert every unavailable field is an explicit unknown field.

- [ ] **Step 2: Verify RED**

Run: `pnpm exec tsx --test tests/benchmark-result-ledger.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement deterministic benchmark entries**

Create one stable entry per paper ID plus normalized benchmark. Use only a verified benchmark research claim and evidence-backed decision-card fields. Parse only exact comparison forms such as `from 56.7% to 74.7%`, `74.7% vs 56.7%`, or an explicit `+18 percentage points`; otherwise leave metric/result/baseline/delta unknown.

- [ ] **Step 4: Add failing rejection and correction tests**

Cover related-work benchmark mentions, negated evaluation, simulation-only evaluation, future code release, OpenAlex ambiguity, retraction, version change, result correction, and identical rerun.

- [ ] **Step 5: Implement gates and benchmark correction history**

Ineligible/retracted records may create an internal entry only with unknown result fields and explicit gate codes. Citation-count-only changes do not create a correction. arXiv version or evidence-backed result changes do.

- [ ] **Step 6: Verify benchmark and research suites**

Run: `pnpm exec tsx --test tests/benchmark-result-ledger.test.ts tests/research-registry.test.ts tests/research-decision-card.test.ts tests/research-gold.test.ts && pnpm run check`

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/benchmark-result-ledger.ts tests/benchmark-result-ledger.test.ts
git commit -m "feat: materialize benchmark result ledger"
```

### Task 4: Integrate both ledgers into the daily transaction

**Files:**
- Modify: `src/main.ts`
- Modify: `src/validate-release.ts`
- Modify: `src/runtime/validation.ts`
- Modify: `tests/release-contract.test.ts`
- Modify: `tests/daily-watchlist-release-integration.test.ts`
- Create: `tests/dual-ledger-pipeline.test.ts`

**Interfaces:**
- Reads previous `events/company-claim-ledger.json` and `research/benchmark-result-ledger.json` with strict optional migration validation.
- Writes both ledgers plus `review/dual-ledger-metrics.json` through the existing publication transaction boundary.

- [ ] **Step 1: Write failing pipeline and release tests**

Assert both artifacts are rebuilt from current canonical inputs, contain matching generated timestamps, are staged, survive a fixed-input rerun byte-identically, and leave last-known-good bytes unchanged on corrupt previous JSON or swap failure.

- [ ] **Step 2: Verify RED**

Run: `pnpm exec tsx --test tests/dual-ledger-pipeline.test.ts tests/release-contract.test.ts`

Expected: FAIL because Benchmark ledger and dual-ledger validation are not wired.

- [ ] **Step 3: Wire strict reads, builders, metrics, and writes**

Metrics contain field totals by status, correction counts by reason, evidence coverage, ledger entry counts, and no raw model output. Keep company ledger and Benchmark ledger generation after canonical event/research cards and before publication validation.

- [ ] **Step 4: Add release validation and rollback checks**

Validate field shapes, absolute evidence URLs, canonical company/paper IDs, correction continuity, benchmark-to-decision-card references, and generated timestamp agreement. A corrupt prior ledger raises a safe typed daily-generation failure instead of publishing an empty ledger.

- [ ] **Step 5: Verify focused transaction tests**

Run: `pnpm exec tsx --test tests/dual-ledger-pipeline.test.ts tests/release-contract.test.ts tests/daily-watchlist-release-integration.test.ts && pnpm run check`

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts src/validate-release.ts src/runtime/validation.ts tests/dual-ledger-pipeline.test.ts tests/release-contract.test.ts tests/daily-watchlist-release-integration.test.ts
git commit -m "feat: publish dual ledgers transactionally"
```

### Task 5: Documentation and full release verification

**Files:**
- Modify: `FACTS_POLICY.md`
- Modify: `docs/DEVELOPMENT_STANDARDS.md`
- Modify generated artifacts only through a real generator run.

**Interfaces:**
- Documents field states, correction reasons, unknown semantics, and the Phase 2/Phase 3 boundary.

- [ ] **Step 1: Add documentation assertions**

Extend propagation/release tests to require both ledger names, all four statuses, unknown semantics, and the statement that Benchmark results do not constitute a public ranking.

- [ ] **Step 2: Verify RED, then update documentation**

Run: `pnpm exec tsx --test tests/propagation-assets.test.ts`

Expected before docs: FAIL; after docs: PASS.

- [ ] **Step 3: Run complete verification**

Run:

```bash
pnpm run check
pnpm test
pnpm run validate:release
pnpm run validate:health
git diff --check
```

Expected: zero failures. Health may be `degraded` only for explicitly reported external-source or historical-gap reasons.

- [ ] **Step 4: Review scope and security**

Confirm no `.DS_Store`, secret, raw LLM output, candidate ID, conflicted value, discovery-only source, or Phase 3 UI entered the diff. Confirm generated JSON is deterministic under fixed input.

- [ ] **Step 5: Commit**

```bash
git add FACTS_POLICY.md docs/DEVELOPMENT_STANDARDS.md tests/propagation-assets.test.ts
git commit -m "docs: publish dual-ledger evidence policy"
```

- [ ] **Step 6: Prepare release handoff**

Report commit list, changed contracts, test count, generated artifacts, current health degradation reasons, and the exact commands required for two consecutive online daily runs. Do not push without explicit user authorization.

