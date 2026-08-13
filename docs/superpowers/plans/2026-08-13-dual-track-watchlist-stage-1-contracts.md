# Dual-Track Watchlist Stage 1: Contracts and Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce versioned company-thesis and weekly-snapshot contracts, migrate existing evidence-backed company data into internal drafts, and leave every current public surface unchanged.

**Architecture:** Add a focused `watchlist/` domain beside the existing event center. The domain consumes canonical `EventRecord`, `CompanyProfile`, `CompanyClaimLedger`, and `CompanyBoards`; it writes review-only JSON through the existing `FileTransaction`. No README, Pages, feed, or public dashboard consumer reads these artifacts in this stage.

**Tech Stack:** TypeScript 5.5, Node.js 24, `node:test`, Git JSON artifacts, existing `FileTransaction` and GitHub Actions pipeline.

## Global Constraints

- Candidate news must never be an input to a public or thesis-generation path.
- Company identity must resolve to a canonical `companyId` before a thesis draft exists.
- The same company cannot occupy both tracks in one period.
- Forward radar requires at least one independent B-grade evidence item; validated momentum requires A or independent B+B evidence.
- Sensitive fields remain unknown unless field-level verification succeeds.
- Existing daily digest, candidate isolation, company resolution, financing verification, research refresh, README, and Pages output must remain behaviorally unchanged.
- Do not add runtime dependencies.

---

### Task 1: Define the watchlist domain contract

**Files:**
- Create: `src/watchlist/contracts.ts`
- Test: `tests/watchlist-contracts.test.ts`

**Interfaces:**
- Consumes: `TechnicalRoute` from `src/types.ts`.
- Produces: `CompanyThesis`, `CompanyThesisArtifact`, `WatchlistSnapshot`, `WatchlistTrack`, `ThesisLifecycle`, `validateCompanyThesisShape(value: unknown): value is CompanyThesis`, and `validateWatchlistSnapshotShape(value: unknown): value is WatchlistSnapshot`.

- [ ] **Step 1: Write the failing contract tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { validateCompanyThesisShape, validateWatchlistSnapshotShape } from "../src/watchlist/contracts.js";

test("accepts a complete versioned thesis and rejects missing falsifiers", () => {
  const thesis = {
    thesisId: "thesis-company-alpha-2026-W33-v1", companyId: "company-alpha",
    track: "forward-radar", lifecycle: "new", thesisVersion: 1,
    whyNow: "Alpha 本期新增一项可追溯合作信号。", routeAndDependencies: "路线依赖真实机器人数据。",
    nextValidationPoints: [{ text: "确认客户试点", dueAt: "2026-10-01" }],
    falsifiers: [{ text: "合作方撤回公告" }], factReferenceIds: ["event-alpha"],
    inferenceLabels: ["AI 研究判断"], confidence: "medium", generatedAt: "2026-08-13T01:00:00Z",
    expiresAt: "2026-10-12T01:00:00Z", modelVersion: "model", promptVersion: "v1", methodologyVersion: "v1",
  };
  assert.equal(validateCompanyThesisShape(thesis), true);
  assert.equal(validateCompanyThesisShape({ ...thesis, falsifiers: [] }), false);
});

test("snapshot contains references, not copied thesis prose", () => {
  assert.equal(validateWatchlistSnapshotShape({
    week: "2026-W33", snapshotVersion: 1, methodologyVersion: "v1", generatedAt: "2026-08-13T01:00:00Z",
    forwardRadar: [{ thesisId: "thesis-a", thesisVersion: 1 }], validatedMomentum: [], changesSinceLastWeek: [],
  }), true);
});
```

- [ ] **Step 2: Run the tests and confirm the module is missing**

Run: `pnpm test -- tests/watchlist-contracts.test.ts`

Expected: FAIL because `src/watchlist/contracts.ts` does not exist.

- [ ] **Step 3: Implement explicit contracts and structural validators**

```ts
export type WatchlistTrack = "forward-radar" | "validated-momentum";
export type ThesisLifecycle = "new" | "strengthening" | "awaiting-validation" | "downgraded" | "falsified" | "expired";
export interface CompanyThesis {
  thesisId: string; companyId: string; track: WatchlistTrack; lifecycle: ThesisLifecycle; thesisVersion: number;
  whyNow: string; routeAndDependencies: string;
  nextValidationPoints: Array<{ text: string; dueAt: string }>;
  falsifiers: Array<{ text: string }>;
  factReferenceIds: string[]; inferenceLabels: string[]; confidence: "high" | "medium" | "low";
  generatedAt: string; expiresAt: string; modelVersion: string; promptVersion: string; methodologyVersion: string;
}
export interface CompanyThesisArtifact { schemaVersion: 1; generatedAt: string; theses: CompanyThesis[]; }
export interface WatchlistSnapshot {
  week: string; snapshotVersion: number; methodologyVersion: string; generatedAt: string;
  forwardRadar: Array<{ thesisId: string; thesisVersion: number }>;
  validatedMomentum: Array<{ thesisId: string; thesisVersion: number }>;
  changesSinceLastWeek: Array<{ companyId: string; change: string }>;
}
```

Validators must require non-empty references, validation points, falsifiers, version strings, valid ISO dates, and mutually exclusive snapshot thesis IDs.

- [ ] **Step 4: Run focused and type tests**

Run: `pnpm test -- tests/watchlist-contracts.test.ts && pnpm run check`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/watchlist/contracts.ts tests/watchlist-contracts.test.ts
git commit -m "feat: define watchlist domain contracts"
```

### Task 2: Convert canonical facts into deterministic internal thesis seeds

**Files:**
- Create: `src/watchlist/seeds.ts`
- Test: `tests/watchlist-seeds.test.ts`

**Interfaces:**
- Consumes: `CompanyProfile[]`, `EventRecord[]`, `CompanyClaimLedger | undefined`, and `CompanyBoards`.
- Produces: `ThesisSeed` and `buildThesisSeeds(input: ThesisSeedInput): ThesisSeed[]`.

- [ ] **Step 1: Write failing seed-isolation tests**

```ts
test("seeds use canonical events and never unresolved candidate records", () => {
  const seeds = buildThesisSeeds({ companies: [company], events: [verifiedEvent], boards, claimLedger, generatedAt: NOW });
  assert.deepEqual(seeds.map((seed) => seed.companyId), ["company-alpha"]);
  assert.deepEqual(seeds[0]?.factReferenceIds, ["event-alpha"]);
});

test("a company is assigned to only one track and momentum wins", () => {
  const seeds = buildThesisSeeds({ companies: [company], events: [verifiedEvent], boards: bothBoards, generatedAt: NOW });
  assert.deepEqual(seeds.map((seed) => seed.track), ["validated-momentum"]);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm test -- tests/watchlist-seeds.test.ts`

Expected: FAIL because `buildThesisSeeds` is missing.

- [ ] **Step 3: Implement the seed boundary**

```ts
export interface ThesisSeed {
  companyId: string; companyName: string; track: WatchlistTrack; routes: TechnicalRoute[];
  factReferenceIds: string[]; evidenceGrade: "A" | "B+B" | "B";
  verifiedSensitiveFields: string[]; unknownSensitiveFields: string[];
  evidenceSummary: string[];
}
```

Use `CompanyBoards.momentum.entries` for validated momentum. Use strategic entries only when their company has at least one qualifying independent B event. Deduplicate by `companyId`, prefer momentum, sort by track then `companyId`, and never synthesize missing amount, valuation, customer, revenue, or order fields.

- [ ] **Step 4: Run focused tests**

Run: `pnpm test -- tests/watchlist-seeds.test.ts tests/company-boards.test.ts`

Expected: PASS, including all existing company-board semantics.

- [ ] **Step 5: Commit**

```bash
git add src/watchlist/seeds.ts tests/watchlist-seeds.test.ts
git commit -m "feat: derive internal watchlist seeds"
```

### Task 3: Add version-preserving internal artifact migration

**Files:**
- Create: `src/watchlist/migration.ts`
- Test: `tests/watchlist-migration.test.ts`

**Interfaces:**
- Consumes: `ThesisDraftArtifact | undefined`, `ThesisSeed[]`, ISO timestamp, methodology version.
- Produces: `migrateThesisSeeds(previous, seeds, options): ThesisDraftArtifact`; seeds remain structured data and contain no public-facing prose before Stage 2 generation.

- [ ] **Step 1: Write failing idempotency and version tests**

```ts
test("rerunning identical seeds does not create a new version", () => {
  const first = migrateThesisSeeds(undefined, [seed], OPTIONS);
  const second = migrateThesisSeeds(first, [seed], OPTIONS);
  assert.deepEqual(second, first);
});

test("material evidence changes increment the draft version", () => {
  const first = migrateThesisSeeds(undefined, [seed], OPTIONS);
  const second = migrateThesisSeeds(first, [{ ...seed, factReferenceIds: ["event-a", "event-b"] }], OPTIONS);
  assert.equal(second.drafts[0]?.draftVersion, 2);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm test -- tests/watchlist-migration.test.ts`

Expected: FAIL because migration is missing.

- [ ] **Step 3: Implement stable hashes and migration**

Hash only canonical input fields with SHA-256. Preserve `createdAt`; update `updatedAt` and increment `draftVersion` only when the hash changes. The artifact contract is:

```ts
export interface ThesisDraftArtifact {
  schemaVersion: 1; generatedAt: string;
  drafts: Array<{ seed: ThesisSeed; inputHash: string; draftVersion: number; draftStatus: "needs-generation"; createdAt: string; updatedAt: string }>;
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test -- tests/watchlist-migration.test.ts && pnpm run check`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/watchlist/migration.ts tests/watchlist-migration.test.ts
git commit -m "feat: version internal watchlist drafts"
```

### Task 4: Integrate review-only artifacts into the daily transaction

**Files:**
- Modify: `src/main.ts`
- Modify: `.github/workflows/daily-digest.yml`
- Test: `tests/watchlist-pipeline.test.ts`
- Test: `tests/release-contract.test.ts`

**Interfaces:**
- Consumes: `buildCompanyBoards`, `buildThesisSeeds`, `migrateThesisSeeds`, `readJsonStrict`, `FileTransaction.stage`.
- Produces: `review/watchlist-seeds.json` and `review/watchlist-drafts.json`; neither path is referenced by `site/data/dashboard.json` or README.

- [ ] **Step 1: Write failing integration assertions**

```ts
test("daily generation stages watchlist artifacts as review-only files", async () => {
  const source = await readFile(join(root, "src/main.ts"), "utf8");
  assert.match(source, /review.*watchlist-seeds\.json/);
  assert.match(source, /review.*watchlist-drafts\.json/);
});

test("public dashboard does not consume stage-one drafts", async () => {
  const siteData = await readFile(join(root, "src/site-data.ts"), "utf8");
  assert.doesNotMatch(siteData, /watchlist-drafts/);
});
```

- [ ] **Step 2: Run and verify the first assertion fails**

Run: `pnpm test -- tests/watchlist-pipeline.test.ts`

Expected: FAIL because artifacts are not staged.

- [ ] **Step 3: Stage artifacts after company ledger creation**

Read the previous draft artifact with `readJsonStrict(..., { optional: true })`, derive boards using the same canonical event store and claim ledger already used by the dashboard, then stage both JSON files. Add `review/watchlist-*.json` to the existing `git add` command by relying on the already staged `review` directory; do not add a new workflow or public marker.

- [ ] **Step 4: Run the full release suite**

Run: `pnpm run check && pnpm test && pnpm run validate:release && pnpm run validate:health`

Expected: all commands PASS; README and `site/data/dashboard.json` remain compatible.

- [ ] **Step 5: Run the project release-validation skill**

Follow `/Users/lijie/.codex/skills/physical-ai-release-validation/SKILL.md` because the daily generator and workflow changed. Record its required evidence before committing.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts .github/workflows/daily-digest.yml tests/watchlist-pipeline.test.ts tests/release-contract.test.ts review/watchlist-seeds.json review/watchlist-drafts.json
git commit -m "feat: materialize review-only watchlist drafts"
```

### Stage 1 acceptance gate

- [ ] Run `pnpm run check && pnpm test && pnpm run validate:release && pnpm run validate:health` twice without changing inputs; the second run must not change draft versions.
- [ ] Verify `git diff -- README.md site/data/dashboard.json` is empty when only draft generation logic is exercised with fixed fixtures.
- [ ] Verify every seed references a canonical company and one or more canonical event IDs.
- [ ] Verify no candidate-verification ID appears in either stage-one artifact.
