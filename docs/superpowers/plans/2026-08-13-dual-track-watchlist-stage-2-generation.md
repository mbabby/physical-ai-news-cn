# Dual-Track Watchlist Stage 2: AI Generation and Quality Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate evidence-bound Chinese company theses, score the two tracks, apply blocking quality gates, and publish only an internal weekly preview.

**Architecture:** Deterministic scoring selects eligible seeds before the LLM runs. A dedicated generator emits strict JSON; an independent validator reconstructs allowed claims from canonical facts and blocks conflicts, missing citations, unsafe investment language, invalid lifecycle fields, or expired drafts. Passing cards go to `review/watchlist-preview.json`; public consumers remain unchanged.

**Tech Stack:** TypeScript, OpenAI-compatible HTTP endpoint through existing `fetchWithRetry`, `node:test`, Git review artifacts.

## Global Constraints

- All Stage 1 constraints remain binding.
- LLM output cannot promote evidence or set sensitive fields.
- Public-style prose must contain `AI 研究判断`, an expiry, next validation points, and falsifiers.
- No buy/sell/target-price/return language.
- Default expiry is exactly 60 days after generation.
- A failed or malformed generation keeps the previous still-valid thesis; it never emits partial copy.
- This stage writes only review artifacts.

---

### Task 1: Implement deterministic two-track scoring and quota selection

**Files:**
- Create: `src/watchlist/scoring.ts`
- Test: `tests/watchlist-scoring.test.ts`

**Interfaces:**
- Consumes: `ThesisSeed[]`.
- Produces: `scoreThesisSeed(seed, context): ScoredThesisSeed` and `selectWatchlistSeeds(scored, options): SelectedWatchlistSeeds`.

- [ ] **Step 1: Write failing weight, evidence, exclusivity, and quota tests**

```ts
test("momentum cannot pass with one B source", () => {
  assert.equal(scoreThesisSeed(singleBMomentum, CONTEXT).eligible, false);
});

test("selection is elastic, mutually exclusive, and route-diverse", () => {
  const selected = selectWatchlistSeeds(scored, { totalLimit: 10, perTrackTarget: 5, maxRouteShare: 0.4 });
  assert.ok(selected.forwardRadar.length + selected.validatedMomentum.length <= 10);
  assert.equal(new Set([...selected.forwardRadar, ...selected.validatedMomentum].map((item) => item.companyId)).size,
    selected.forwardRadar.length + selected.validatedMomentum.length);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm test -- tests/watchlist-scoring.test.ts`

Expected: FAIL because scoring does not exist.

- [ ] **Step 3: Implement the confirmed weights**

Forward: route differentiation 25, team/history 20, capital/partnership/talent 15, value-chain position 15, novelty 15, verifiability 10. Momentum: customer/deployment/revenue/production 30, technology/product 20, capital 15, 30/90-day continuity 15, evidence strength 15, diversity 5. Represent unknown components as zero with `unknown: true`, never as negative facts.

- [ ] **Step 4: Run tests**

Run: `pnpm test -- tests/watchlist-scoring.test.ts tests/company-boards.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/watchlist/scoring.ts tests/watchlist-scoring.test.ts
git commit -m "feat: score dual-track watchlist candidates"
```

### Task 2: Add a strict structured thesis generator

**Files:**
- Create: `src/watchlist/generator.ts`
- Test: `tests/watchlist-generator.test.ts`

**Interfaces:**
- Consumes: `SelectedWatchlistSeeds`, `LlmSettings`, and canonical fact excerpts keyed by reference ID.
- Produces: `WatchlistGenerator.generate(seed): Promise<ThesisGenerationResult>` and `status(): RuntimeStatus`, where `ThesisGenerationResult` is `{ ok: true; draft: CompanyThesisDraft } | { ok: false; code: "llm-unavailable" | "invalid-json" | "invalid-shape" }`.

- [ ] **Step 1: Write failing parser and outage tests**

```ts
test("parses JSON only and preserves company/product names", async () => {
  const result = await generator.generate(seed);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.draft.companyId, seed.companyId);
    assert.match(result.draft.whyNow, /AI 研究判断/);
  }
});

test("malformed or unavailable output returns a typed failure, not placeholder prose", async () => {
  const result = await failingGenerator.generate(seed);
  assert.deepEqual(result, { ok: false, code: "llm-unavailable" });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm test -- tests/watchlist-generator.test.ts`

Expected: FAIL because generator is missing.

- [ ] **Step 3: Implement bounded generation**

Post to `/chat/completions` with a 30-second timeout and one retry. The prompt must state: use only supplied facts; output JSON; `whyNow <= 120` Chinese characters; `routeAndDependencies <= 160`; 1–3 dated validation points; 1–3 falsifiers; preserve official company/product/model names; prefix directional text with `AI 研究判断`; prohibit recommendations and return forecasts. Parse exact JSON without regex-repairing unsupported fields.

- [ ] **Step 4: Run tests**

Run: `pnpm test -- tests/watchlist-generator.test.ts && pnpm run check`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/watchlist/generator.ts tests/watchlist-generator.test.ts
git commit -m "feat: generate structured company theses"
```

### Task 3: Build blocking thesis validation and citation coverage

**Files:**
- Create: `src/watchlist/validation.ts`
- Test: `tests/watchlist-validation.test.ts`

**Interfaces:**
- Consumes: draft, seed, canonical events, prior thesis.
- Produces: `validateThesisDraft(input): ThesisValidationResult` and `validateTrackEvidence(seed): ValidationIssue[]`.

- [ ] **Step 1: Write a table of failing gate tests**

Include cases for unknown company, missing reference, reference outside the seed, single-B momentum, unverified amount/valuation/customer/revenue/order, conflict, missing Chinese copy, missing validation point, missing falsifier, invalid expiry, stale material change, and `/买入|卖出|目标价|回报率|收益率|建议配置/`.

```ts
for (const scenario of blockedScenarios) {
  test(`blocks ${scenario.name}`, () => assert.equal(validateThesisDraft(scenario.input).publishable, false));
}
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm test -- tests/watchlist-validation.test.ts`

Expected: FAIL because validation is missing.

- [ ] **Step 3: Implement deterministic gates**

Return `{ publishable, issues, citationCoverage, sensitiveFields }`. Require 100% sentence-level fact references; allow only the five confirmed sensitive-field names when their ledger claim is `verified` and fresh; set expiry to generation plus 60 days; treat any conflict as blocking. Validation must not call the LLM.

- [ ] **Step 4: Run focused tests**

Run: `pnpm test -- tests/watchlist-validation.test.ts tests/company-claim-ledger.test.ts tests/facts-contract.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/watchlist/validation.ts tests/watchlist-validation.test.ts
git commit -m "feat: gate company thesis publication"
```

### Task 4: Implement lifecycle transitions and last-known-good fallback

**Files:**
- Create: `src/watchlist/lifecycle.ts`
- Test: `tests/watchlist-lifecycle.test.ts`

**Interfaces:**
- Produces: `resolveThesisLifecycle(previous, current, now): ThesisLifecycleDecision` and `selectLastKnownGood(previous, attempted, validation, now): CompanyThesis | undefined`.

- [ ] **Step 1: Write failing transition tests**

Test `new → strengthening`, `new → awaiting-validation`, `momentum → downgraded`, `forward → momentum`, prohibited `momentum → forward`, `falsified` removal, 60-day expiry, and a failed generation retaining a still-valid previous version.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm test -- tests/watchlist-lifecycle.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement the transition table**

Use an explicit map rather than nested conditionals. A falsified or expired card is never returned as last-known-good. Re-entry after falsification receives a new thesis ID with version 1.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm test -- tests/watchlist-lifecycle.test.ts && pnpm run check`

```bash
git add src/watchlist/lifecycle.ts tests/watchlist-lifecycle.test.ts
git commit -m "feat: manage thesis lifecycle transitions"
```

### Task 5: Generate an internal weekly preview in the daily transaction

**Files:**
- Modify: `src/main.ts`
- Create: `src/watchlist/preview.ts`
- Test: `tests/watchlist-preview.test.ts`
- Modify: `src/validate-release.ts`
- Modify: `.github/workflows/daily-digest.yml`

**Interfaces:**
- Produces: `review/watchlist-preview.json`, `review/watchlist-preview.md`, and a `Watchlist` runtime status in the run manifest.

- [ ] **Step 1: Write failing preview and status tests**

Assert previews contain only validated theses, failures preserve prior valid cards, the runtime status exposes attempted/succeeded/failed counts, and no public file consumes the preview.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm test -- tests/watchlist-preview.test.ts tests/release-contract.test.ts`

Expected: FAIL.

- [ ] **Step 3: Integrate generation after canonical event and ledger materialization**

Generate only changed selected seeds. Enforce the six-hour per-company cooldown using the previous draft timestamp. Stage preview JSON/Markdown and status in the same `FileTransaction`; add workflow summary output for `Watchlist`. Do not modify README markers, dashboard data, `site/app.js`, or feeds.

- [ ] **Step 4: Run all gates and release validation**

Run: `pnpm run check && pnpm test && pnpm run validate:release && pnpm run validate:health`

Expected: PASS.

- [ ] **Step 5: Run the physical-ai release-validation skill and commit**

```bash
git add src/main.ts src/validate-release.ts src/watchlist/preview.ts .github/workflows/daily-digest.yml tests/watchlist-preview.test.ts tests/release-contract.test.ts review/watchlist-preview.json review/watchlist-preview.md
git commit -m "feat: build gated watchlist preview"
```

### Stage 2 acceptance gate

- [ ] Run two fixed-clock preview generations; the second must be idempotent.
- [ ] Corrupt one LLM response and prove the prior valid card remains while the new draft is review-only.
- [ ] Inject a sensitive-field conflict and prove that company is absent from the preview.
- [ ] Confirm README, Pages dashboard, company feeds, and share pages remain byte-for-byte unchanged.
