# Phase 3 Decision Products Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Materialize evidence-gated Top Signals, 30-second company cards, research reproducibility passports, and a zero-backend subscription center from the repository's canonical Phase 2 data.

**Architecture:** A new `src/decision-products/` layer consumes canonical events, the company Claim Ledger, Benchmark Result Ledger, research decision cards, and the public Watchlist. It produces one strict public artifact that is staged transactionally and reused by dashboard JSON, README summaries, static share pages, and stable RSS feeds; browser code renders but never re-ranks or infers facts.

**Tech Stack:** TypeScript 5.9, Node.js 20+, `node:test`, existing `FileTransaction`, static HTML/CSS/JavaScript, RSS 2.0 XML, GitHub Actions and GitHub Pages.

## Global Constraints

- Public facts come only from canonical `EventStore`, `CompanyClaimLedger`, `BenchmarkResultLedger`, `ResearchDecisionCard`, and `WatchlistPublicView` inputs.
- `unknown` is an explicit public state and must never be rewritten as a negative claim.
- Discovery candidates, raw LLM output, private scores, Review Cases, OpenAlex request bodies, and candidate identifiers must not enter public artifacts.
- No database, account system, email collection, recommendation backend, or second fact store.
- README, Pages, feeds, and JSON must render the same materialized item identities and ordering.
- Every new behavior follows RED → GREEN → REFACTOR; each task ends with focused tests and a commit.
- Phase 2 field statuses, evidence grades, correction histories, and immutable Watchlist snapshot semantics remain unchanged.

---

## File Structure

- `src/decision-products/contracts.ts`: exact public schemas, stable identities, private-key scan, and artifact validation.
- `src/decision-products/top-signals.ts`: evidence gate, deduplication, quotas, and explainable signal ordering.
- `src/decision-products/company-card.ts`: company/claim/event/Watchlist projection into 30-second cards.
- `src/decision-products/repro-passport.ts`: research-card and Benchmark-ledger projection into six reproducibility passports.
- `src/decision-products/subscriptions.ts`: subscription catalog, RSS rendering, stable GUIDs, and URL-safe filters.
- `src/decision-products/materialize.ts`: orchestration and transactional staging of the shared artifact and feeds.
- `src/decision-products/markdown.ts`: README marker rendering from the shared artifact only.
- `tests/decision-products-*.test.ts`: focused contracts and behavior tests.
- `site/subscribe.html`: zero-backend subscription page.
- `site/app.js`, `site/share-pages.js`, `site/styles.css`: strict rendering of materialized decision products.

### Task 0: Isolate the Fixed-Clock Integration Fixture

**Files:**
- Modify: `tests/dual-ledger-pipeline.test.ts`
- Test: `tests/dual-ledger-pipeline.test.ts`

**Interfaces:**
- Consumes: existing `copyFixture(target)` and `fixedGenerate(root, transaction?, now?)` test helpers.
- Produces: a deterministic fixture that never imports production `watchlist/current.json`, `watchlist/theses.json`, or `watchlist/history` as test inputs.

- [ ] **Step 1: Add a regression assertion that names the production break**

Extend `copyFixture()` and the first idempotence test so the fixture asserts its Watchlist history starts empty before the first fixed generation:

```ts
import { mkdir, readdir } from "node:fs/promises";

assert.deepEqual(await readdir(join(root, "watchlist", "history")), []);
await fixedGenerate(root);
assert.equal((await readdir(join(root, "watchlist", "history"))).length, 1);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm exec tsx --test tests/dual-ledger-pipeline.test.ts`

Expected: FAIL because copied production history already contains W33/W34/W35 snapshots and the W34 replay collides with `2026-W34-v1`.

- [ ] **Step 3: Remove mutable Watchlist publication outputs from the fixture**

After copying repository paths in `copyFixture()`, add:

```ts
await rm(join(target, "watchlist", "current.json"), { force: true });
await rm(join(target, "watchlist", "theses.json"), { force: true });
await rm(join(target, "watchlist", "history"), { recursive: true, force: true });
await mkdir(join(target, "watchlist", "history"), { recursive: true });
```

Do not change `src/watchlist/change-page.ts` or relax immutable identity validation.

- [ ] **Step 4: Verify GREEN and the repository baseline**

Run:

```bash
pnpm exec tsx --test tests/dual-ledger-pipeline.test.ts
pnpm run check
pnpm test
```

Expected: all dual-ledger tests pass; complete suite reports zero failures.

- [ ] **Step 5: Commit**

```bash
git add tests/dual-ledger-pipeline.test.ts
git commit -m "test: isolate dual ledger fixture from watchlist history"
```

### Task 1: Define Strict Decision Product Contracts

**Files:**
- Create: `src/decision-products/contracts.ts`
- Create: `tests/decision-products-contracts.test.ts`

**Interfaces:**
- Consumes: `ArticleKind`, `TechnicalRoute`, `ValidationStage`, and public evidence grades from existing contracts.
- Produces: `DecisionProductArtifact`, `DecisionTopSignal`, `DecisionCompanyCard`, `ReproducibilityPassport`, `SubscriptionCatalog`, `stableDecisionId()`, and `validateDecisionProductArtifact()`.

- [ ] **Step 1: Write failing exact-schema and private-boundary tests**

Create a minimal valid artifact literal and adversarial mutations:

```ts
test("decision product artifact rejects undeclared and private payloads", () => {
  const valid = validDecisionProductArtifact();
  assert.doesNotThrow(() => validateDecisionProductArtifact(valid));
  for (const mutate of [
    (value: any) => { value.rawModelOutput = "secret"; },
    (value: any) => { value.topSignals[0].internalScore = 99; },
    (value: any) => { value.companyCards[0].companyId = "candidate-hidden"; },
    (value: any) => { value.researchPassports[0].benchmark.result = "74.7%"; value.researchPassports[0].benchmark.evidenceUrls = []; },
  ]) {
    const forged = structuredClone(valid);
    mutate(forged);
    assert.throws(() => validateDecisionProductArtifact(forged));
  }
});

test("stable decision identities ignore generation clocks", () => {
  assert.equal(stableDecisionId("signal", "evt-1"), stableDecisionId("signal", "evt-1"));
  assert.notEqual(stableDecisionId("signal", "evt-1"), stableDecisionId("company", "evt-1"));
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm exec tsx --test tests/decision-products-contracts.test.ts`

Expected: FAIL because the module and exported contracts do not exist.

- [ ] **Step 3: Implement the public contracts**

Define the following core shapes, using exact-key validation for every nested object:

```ts
export interface DecisionEvidence {
  evidenceId: string;
  url: string;
  source: string;
  grade: "A" | "B" | "学术";
}

export interface DecisionTopSignal {
  signalId: string;
  eventId: string;
  entityId: string;
  entityName: string;
  titleZh: string;
  factsZh: [string, string];
  kind: ArticleKind;
  routes: TechnicalRoute[];
  occurredAt: string;
  verifiedAt: string;
  changedThisWeek: boolean;
  evidenceState: "official" | "multi-source";
  evidence: DecisionEvidence[];
  impact: Array<"company" | "capital" | "product-deployment" | "research">;
  whyItMatters: string;
  rankReasons: string[];
}

export interface DecisionCompanyCard {
  cardId: string;
  companyId: string;
  companyName: string;
  officialUrl: string;
  region: string;
  stage: string;
  routes: TechnicalRoute[];
  capital: { status: "verified" | "developing" | "unknown" | "conflicted"; summary: string; evidence: DecisionEvidence[] };
  validationStage: ValidationStage;
  productDeployment: { status: "verified" | "developing" | "unknown" | "conflicted"; summary: string; evidence: DecisionEvidence[] };
  recentChanges: Array<{ eventId: string; title: string; occurredAt: string; type: ArticleKind }>;
  watchlist: { track: "forward-radar" | "validated-momentum" | "unknown"; lifecycle: string; whyNow: string; nextValidationPoints: Array<{ text: string; dueAt: string }> };
  unknownFields: string[];
  updatedAt: string;
}

export interface ReproducibilityPassport {
  passportId: string;
  paperId: string;
  titleZh: string;
  factsZh: [string, string];
  sourceUrl: string;
  task: string[] | "unknown";
  embodiment: string[] | "unknown";
  methods: string[] | "unknown";
  benchmark: { name: string | "unknown"; metric: string | "unknown"; result: string | "unknown"; baseline: string | "unknown"; delta: string | "unknown"; evidenceUrls: string[] };
  realRobotTrials: number | "unknown";
  assets: { code: string | "unknown"; data: string | "unknown"; weights: string | "unknown" };
  reproducibilityCost: { level: "low" | "medium" | "high" | "unknown"; rationale: string | "unknown" };
  authority: { authors: string[]; labs: string[]; citedByCount: number | "unknown"; checkedAt: string | "unknown" };
  limitations: string[] | "unknown";
  gaps: string[];
  whyWorthAttention: string;
  rankReasons: string[];
}

export interface SubscriptionCatalog {
  generatedAt: string;
  entries: Array<{ subscriptionId: string; label: string; description: string; cadence: "daily" | "weekly"; format: "github" | "rss" | "share-link"; url: string; route: TechnicalRoute | "all" | "watchlist" }>;
}

export interface DecisionProductArtifact {
  schemaVersion: 1;
  generatedAt: string;
  periodStart: string;
  topSignals: DecisionTopSignal[];
  companyCards: DecisionCompanyCard[];
  researchPassports: ReproducibilityPassport[];
  subscriptions: SubscriptionCatalog;
}
```

`stableDecisionId(namespace, canonicalIdentity)` must be `decision-${namespace}-${sha256(...).slice(0, 20)}`. The validator must reject extra keys, relative URLs, noncanonical timestamps, duplicate identities, candidate IDs, `rawModelOutput`, `internalScore`, `rankScore`, and known fact values with empty evidence.

- [ ] **Step 4: Run tests and refactor only after GREEN**

Run:

```bash
pnpm exec tsx --test tests/decision-products-contracts.test.ts
pnpm run check
```

Expected: contract tests and typecheck pass.

- [ ] **Step 5: Commit**

```bash
git add src/decision-products/contracts.ts tests/decision-products-contracts.test.ts
git commit -m "feat: define decision product contracts"
```

### Task 2: Materialize Explainable Weekly Top Signals

**Files:**
- Create: `src/decision-products/top-signals.ts`
- Create: `tests/decision-products-top-signals.test.ts`
- Modify: `src/decision-products/contracts.ts`

**Interfaces:**
- Consumes: `EventRecord[]`, canonical `CompanyProfile[]`, `Date`, and `DecisionTopSignal`.
- Produces: `buildDecisionTopSignals(events, companies, now, limit?): DecisionTopSignal[]` and `validateTopSignalSource()`.

- [ ] **Step 1: Write failing gate, deduplication, quota, and order tests**

Use literal event fixtures and assert public behavior:

```ts
test("Top Signals accepts A or independent B+B and rejects weaker events", () => {
  const result = buildDecisionTopSignals([
    officialFundingEvent(), independentDeploymentEvent(), singleBEvent(), conflictedEvent(), discoveryOnlyEvent(),
  ], companies, NOW);
  assert.deepEqual(result.map((item) => item.eventId), ["evt-official-funding", "evt-bb-deployment"]);
  assert.deepEqual(result[0]!.rankReasons, ["本周发生实质变化", "官方一手证据", "资本事件"]);
});

test("Top Signals deduplicates events and caps each kind at three", () => {
  const result = buildDecisionTopSignals(manyCanonicalEvents(), companies, NOW, 10);
  assert.equal(result.length, 10);
  const counts = new Map<ArticleKind, number>();
  for (const item of result) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  assert.ok([...counts.values()].every((count) => count <= 3));
  assert.equal(new Set(result.map((item) => item.eventId)).size, result.length);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm exec tsx --test tests/decision-products-top-signals.test.ts`

Expected: FAIL because `buildDecisionTopSignals` does not exist.

- [ ] **Step 3: Implement deterministic gating and ordering**

Implement this comparison pipeline without exporting a numeric score:

```ts
const IMPACT_ORDER: Record<ArticleKind, number> = {
  "投融资": 5, "产品发布": 4, "部署案例": 4, "公司商业": 3, "开源项目": 2, "研究与数据": 1,
};

const ordered = eligible
  .sort((a, b) => Number(b.changedThisWeek) - Number(a.changedThisWeek)
    || Number(b.evidenceState === "official") - Number(a.evidenceState === "official")
    || IMPACT_ORDER[b.kind] - IMPACT_ORDER[a.kind]
    || b.evidence.length - a.evidence.length
    || b.occurredAt.localeCompare(a.occurredAt)
    || a.eventId.localeCompare(b.eventId));
```

Derive `rankReasons` from the same branches used in the comparator. Build exactly two factual Chinese sentences from `event.facts`/`timeline`; reject incomplete Chinese copy. Resolve the canonical company by `primaryEntity` and `CompanyProfile.entityId`; reject unresolved subjects. Use `derivePublication()` and exclude Google News, HN and X discovery evidence.

- [ ] **Step 4: Verify GREEN, idempotence, and compatibility**

Run:

```bash
pnpm exec tsx --test tests/decision-products-top-signals.test.ts tests/site-data.test.ts tests/facts-contract.test.ts
pnpm run check
```

Expected: focused tests pass and fixed input returns deep-equal arrays across reruns.

- [ ] **Step 5: Commit**

```bash
git add src/decision-products/top-signals.ts src/decision-products/contracts.ts tests/decision-products-top-signals.test.ts
git commit -m "feat: materialize explainable top signals"
```

### Task 3: Build 30-Second Company Cards

**Files:**
- Create: `src/decision-products/company-card.ts`
- Create: `tests/decision-products-company-card.test.ts`

**Interfaces:**
- Consumes: `CompanyProfile[]`, `CompanyClaimLedger`, `EventRecord[]`, `WatchlistPublicView`, `Date`.
- Produces: `buildDecisionCompanyCards(input): DecisionCompanyCard[]` with a default limit of 20.

- [ ] **Step 1: Write failing complete, unknown, conflict, ownership, and stale tests**

```ts
test("company card keeps absent financing unknown rather than negative", () => {
  const [card] = buildDecisionCompanyCards({ companies: [alpha], claimLedger: unknownFundingLedger(), events: [], watchlist: emptyWatchlist(), now: NOW });
  assert.deepEqual(card.capital, { status: "unknown", summary: "证据不足（不代表未融资）", evidence: [] });
  assert.ok(card.unknownFields.includes("capital.amount"));
});

test("company card rejects an event attributed to another canonical company", () => {
  assert.throws(() => buildDecisionCompanyCards({ companies: [alpha, beta], claimLedger: alphaLedgerWithBetaEvent(), events: [betaEvent()], watchlist: emptyWatchlist(), now: NOW }), /归属/);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm exec tsx --test tests/decision-products-company-card.test.ts`

Expected: FAIL because the company-card materializer does not exist.

- [ ] **Step 3: Implement field-level projection**

Index companies by `entityId`, claims by `companyId`, events by `eventId`, and Watchlist cards by `companyId`. For capital and product/deployment, select the newest canonical claim by event date, then map Phase 2 field status directly:

```ts
function publicStatus(status: LedgerFieldStatus): "verified" | "developing" | "unknown" | "conflicted" {
  return status;
}

function unknownCapital() {
  return { status: "unknown" as const, summary: "证据不足（不代表未融资）", evidence: [] };
}
```

The card ID is `stableDecisionId("company", companyId)`. `recentChanges` contains at most two events sorted by occurrence date. `updatedAt` is the newest material event/claim timestamp, never the generator clock. Populate `unknownFields` with stable field paths such as `capital.amount`, `capital.valuation`, `product.customer`, and `product.deployment`. A conflicting field exposes no compatibility value.

- [ ] **Step 4: Verify GREEN and mutation-sensitive behavior**

Run:

```bash
pnpm exec tsx --test tests/decision-products-company-card.test.ts tests/company-ledger-validation.test.ts tests/watchlist-public-view.test.ts
pnpm run check
```

Expected: all focused tests pass; swapping event ownership or changing unknown to a negative breaks at least one test.

- [ ] **Step 5: Commit**

```bash
git add src/decision-products/company-card.ts tests/decision-products-company-card.test.ts
git commit -m "feat: add 30 second company cards"
```

### Task 4: Build Research Reproducibility Passports

**Files:**
- Create: `src/decision-products/repro-passport.ts`
- Create: `tests/decision-products-repro-passport.test.ts`

**Interfaces:**
- Consumes: `ResearchRecord[]`, `ResearchDecisionCard[]`, `BenchmarkResultLedger`, limit defaulting to 6.
- Produces: `buildReproducibilityPassports(input): ReproducibilityPassport[]`.

- [ ] **Step 1: Write failing complete, unknown, retraction, and OpenAlex-degradation tests**

```ts
test("passport binds benchmark numbers only from the benchmark ledger", () => {
  const [passport] = buildReproducibilityPassports({ records: [liberoRecord()], cards: [completeCard()], benchmarkLedger: liberoLedger(), limit: 6 });
  assert.deepEqual(passport.benchmark, {
    name: "LIBERO", metric: "success rate", result: "74.7%", baseline: "56.7%", delta: "+18 percentage points",
    evidenceUrls: ["https://arxiv.org/abs/2608.00001v1"],
  });
});

test("passport keeps ambiguous comparison unknown and blocks retracted work", () => {
  const ambiguous = buildReproducibilityPassports({ records: [recordWithoutExactComparison()], cards: [completeCard()], benchmarkLedger: unknownBenchmarkLedger(), limit: 6 });
  assert.equal(ambiguous[0]!.benchmark.result, "unknown");
  assert.deepEqual(buildReproducibilityPassports({ records: [retractedRecord()], cards: [retractedCard()], benchmarkLedger: emptyBenchmarkLedger(), limit: 6 }), []);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm exec tsx --test tests/decision-products-repro-passport.test.ts`

Expected: FAIL because the passport builder does not exist.

- [ ] **Step 3: Implement conservative passport projection**

Match records and cards by canonical paper ID; match Benchmark entries by `paperId`. Reject cards unless `eligibleForTopResearch`, `gates.length === 0`, complete Chinese facts exist, OpenAlex match is `matched`, retraction is `false`, and freshness is `fresh`.

Select at most one canonical benchmark entry for the compact passport using this order: real-robot/mixed evaluation, number of verified numeric fields, benchmark name. Copy metric/result/baseline/delta only from ledger fields whose status is `verified`; otherwise return `unknown` and empty evidence URLs. Derive `gaps` from unknown assets, benchmark fields, real-robot trials, limitations, and OpenAlex metadata. Use the existing decision-card rank order but publish only string `rankReasons` such as `真实机器人证据`, `精确基准比较`, `代码已公开`, and `重点实验室`.

- [ ] **Step 4: Verify GREEN and compatibility**

Run:

```bash
pnpm exec tsx --test tests/decision-products-repro-passport.test.ts tests/benchmark-result-ledger.test.ts tests/research-decision-card.test.ts
pnpm run check
```

Expected: six or fewer complete passports; all known benchmark fields have direct evidence URLs.

- [ ] **Step 5: Commit**

```bash
git add src/decision-products/repro-passport.ts tests/decision-products-repro-passport.test.ts
git commit -m "feat: add research reproducibility passports"
```

### Task 5: Add the Zero-Backend Subscription Center

**Files:**
- Create: `src/decision-products/subscriptions.ts`
- Create: `tests/decision-products-subscriptions.test.ts`
- Create: `site/subscribe.html`
- Modify: `site/app.js`
- Modify: `site/styles.css`
- Test: `tests/site-ui.test.ts`

**Interfaces:**
- Consumes: `DecisionProductArtifact`, canonical five `TechnicalRoute` values, existing Watchlist URL encoding, repository base URL.
- Produces: `buildSubscriptionCatalog()`, `renderDecisionFeed()`, `stageDecisionFeeds()`, and a static subscription page.

- [ ] **Step 1: Write failing catalog, GUID, filter, and UI tests**

```ts
test("subscription catalog exposes global, five route, watchlist and GitHub entries", () => {
  const catalog = buildSubscriptionCatalog(artifact, { repositoryUrl: REPO, pagesUrl: PAGES });
  assert.deepEqual(catalog.entries.map((entry) => entry.subscriptionId), [
    "github-watch", "github-releases", "feed-all", "feed-data-and-training", "feed-vla-and-embodied-models",
    "feed-world-models-and-spatial-intelligence", "feed-embodiment-and-hardware", "feed-deployment-and-commercialization", "feed-watchlist",
  ]);
});

test("feed bytes and GUIDs are stable for fixed decision products", () => {
  assert.equal(renderDecisionFeed(artifact, "all", OPTIONS), renderDecisionFeed(artifact, "all", OPTIONS));
  assert.match(renderDecisionFeed(artifact, "all", OPTIONS), /urn:physical-ai:signal:decision-signal-/);
});
```

Add a UI behavior assertion that `subscribe.html` contains no form, email input, remote script, or analytics tracker and links to all catalog entries.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm exec tsx --test tests/decision-products-subscriptions.test.ts tests/site-ui.test.ts`

Expected: FAIL because subscription builders and page do not exist.

- [ ] **Step 3: Implement deterministic subscription artifacts**

Build exact catalog entries in the order asserted above. Render RSS items from already ordered Top Signals and Watchlist changes; do not re-score. Use stable GUIDs:

```ts
const guid = `urn:physical-ai:signal:${signal.signalId}`;
const routeGuid = `urn:physical-ai:route:${routeSlug}:${signal.signalId}`;
const watchlistGuid = `urn:physical-ai:watchlist:${view.week}:v${view.snapshotVersion}:${change.companyId}:${change.change}`;
```

Stage files under:

```text
site/feeds/decision/all.xml
site/feeds/decision/data-and-training.xml
site/feeds/decision/vla-and-embodied-models.xml
site/feeds/decision/world-models-and-spatial-intelligence.xml
site/feeds/decision/embodiment-and-hardware.xml
site/feeds/decision/deployment-and-commercialization.xml
site/feeds/decision/watchlist.xml
site/feeds/decision/manifest.json
```

The static page explains cadence and evidence gates, links GitHub Watch/Releases, lists feeds, and reuses the current Watchlist share-link encoder. It stores no state outside the URL.

- [ ] **Step 4: Verify GREEN and browser-safe output**

Run:

```bash
pnpm exec tsx --test tests/decision-products-subscriptions.test.ts tests/site-ui.test.ts tests/watchlist-config.test.ts
pnpm run check
```

Expected: all focused tests pass; XML escapes titles and URLs; fixed input bytes are identical.

- [ ] **Step 5: Commit**

```bash
git add src/decision-products/subscriptions.ts tests/decision-products-subscriptions.test.ts site/subscribe.html site/app.js site/styles.css tests/site-ui.test.ts
git commit -m "feat: add zero backend subscription center"
```

### Task 6: Materialize, Stage, and Render the Unified Product

**Files:**
- Create: `src/decision-products/materialize.ts`
- Create: `src/decision-products/markdown.ts`
- Create: `tests/decision-products-pipeline.test.ts`
- Modify: `src/main.ts`
- Modify: `src/site-data.ts`
- Modify: `site/app.js`
- Modify: `site/share-pages.js`
- Modify: `site/index.html`
- Modify: `site/companies.html`
- Modify: `site/research.html`
- Modify: `site/weekly.html`
- Modify: `README.md`
- Test: `tests/site-data.test.ts`
- Test: `tests/propagation-assets.test.ts`

**Interfaces:**
- Consumes: builders from Tasks 2–5 and the existing daily `FileTransaction`.
- Produces: `buildDecisionProductArtifact(input)`, `stageDecisionProducts(input)`, `formatDecisionProductReadme(artifact)`, `site/data/decision-products.json`, dashboard projections, and four product surfaces with identical IDs/order.

- [ ] **Step 1: Write failing same-source and rollback tests**

```ts
test("one artifact drives JSON, dashboard, README and feeds without reorder", async () => {
  const root = await fixedRepository();
  await generateFixed(root);
  const artifact = await readJson<DecisionProductArtifact>(join(root, "site/data/decision-products.json"));
  const dashboard = await readJson<any>(join(root, "site/data/dashboard.json"));
  const readme = await readFile(join(root, "README.md"), "utf8");
  assert.deepEqual(dashboard.decisionProducts.topSignals.map((item: any) => item.signalId), artifact.topSignals.map((item) => item.signalId));
  assert.ok(artifact.topSignals.every((item) => readme.includes(item.signalId)));
});

test("a decision feed swap failure rolls back all decision surfaces", async () => {
  const before = await decisionProductBytes(root);
  await assert.rejects(() => generateFixed(root, new FileTransaction("decision-failure", { failAfterPath: join(root, "site/feeds/decision/all.xml") })));
  assert.deepEqual(await decisionProductBytes(root), before);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm exec tsx --test tests/decision-products-pipeline.test.ts tests/site-data.test.ts tests/propagation-assets.test.ts`

Expected: FAIL because the unified artifact is not staged and dashboard/README do not reference it.

- [ ] **Step 3: Implement orchestration and atomic staging**

Define:

```ts
export interface BuildDecisionProductInput {
  generatedAt: Date;
  events: EventRecord[];
  companies: CompanyProfile[];
  companyClaimLedger: CompanyClaimLedger;
  researchRecords: ResearchRecord[];
  researchDecisionCards: ResearchDecisionCard[];
  benchmarkResultLedger: BenchmarkResultLedger;
  watchlist: WatchlistPublicView;
}

export function buildDecisionProductArtifact(input: BuildDecisionProductInput): DecisionProductArtifact;

export function stageDecisionProducts(input: {
  root: string;
  transaction: FileTransaction;
  artifact: DecisionProductArtifact;
  readme: string;
  repositoryUrl: string;
  pagesUrl: string;
}): string;
```

Call the builder in `src/main.ts` after Phase 2 ledgers and Watchlist are valid, but before `buildDashboard()` and final publication validation. Stage `site/data/decision-products.json`, all decision feeds, README marker content, and dashboard JSON through the existing transaction. Do not write directly with `writeFile()`.

Add `decisionProducts: DecisionProductArtifact` to `DashboardData`. Keep existing `topSignals`, `companyRadar`, and `research` only as compatibility projections copied from the artifact; they must not call separate sorting logic.

The README marker renderer emits one stable `<!-- decision-signal:<signalId> -->` comment immediately before each visible Top Signal line. This gives release validation an identity/order boundary without exposing internal scores or candidate IDs.

- [ ] **Step 4: Render compact and expanded product views**

Update the static UI so:

- homepage Top Signals renders `rankReasons`, evidence state, occurrence/verification dates, and an accessible evidence drawer;
- company cards show five answers in two lines plus an expandable field/evidence section;
- research cards show Passport tags and an expandable gaps/assets section;
- navigation includes `subscribe.html`;
- share pages use the artifact order directly and show an explicit invalid-data state if contract validation fails.

All text is escaped using existing `safe()`/`safeUrl()` helpers; no `innerHTML` receives unescaped source text.

- [ ] **Step 5: Verify GREEN and fixed-input byte stability**

Run:

```bash
pnpm exec tsx --test tests/decision-products-pipeline.test.ts tests/site-data.test.ts tests/site-ui.test.ts tests/propagation-assets.test.ts
pnpm run check
```

Expected: focused tests pass; two fixed runs produce identical artifact/feed/README/dashboard bytes.

- [ ] **Step 6: Commit**

```bash
git add src/decision-products/materialize.ts src/decision-products/markdown.ts src/main.ts src/site-data.ts site/app.js site/share-pages.js site/index.html site/companies.html site/research.html site/weekly.html README.md tests/decision-products-pipeline.test.ts tests/site-data.test.ts tests/propagation-assets.test.ts
git commit -m "feat: publish unified decision products"
```

### Task 7: Enforce Release Contracts and Publish Generated Assets

**Files:**
- Modify: `src/validate-release.ts`
- Modify: `src/runtime/validation.ts`
- Modify: `FACTS_POLICY.md`
- Modify: `docs/DEVELOPMENT_STANDARDS.md`
- Modify: `README.en.md`
- Test: `tests/release-contract.test.ts`
- Test: `tests/publication-robustness.test.ts`
- Generated: `site/data/decision-products.json`
- Generated: `site/feeds/decision/*.xml`
- Generated: `site/feeds/decision/manifest.json`
- Generated: `README.md`

**Interfaces:**
- Consumes: `validateDecisionProductArtifact()`, deterministic builders, current canonical repository files, and staged public bytes.
- Produces: release failure on schema, source, ordering, date, evidence, feed, README, dashboard, or private-boundary drift.

- [ ] **Step 1: Write failing adversarial release tests**

Mutate one public surface at a time:

```ts
for (const mutate of [
  forgeDashboardSignalOrder,
  forgeCompanyKnownValueWithoutEvidence,
  injectCandidateIdIntoPassport,
  alterFeedGuid,
  alterReadmeSignalIdentity,
  addRawModelOutputToArtifact,
]) {
  const root = await generatedFixture();
  await mutate(root);
  await assert.rejects(() => validateRelease(root));
}
```

Add a positive test that a valid empty Top Signals week still preserves valid company cards, passports, and subscription entries.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm exec tsx --test tests/release-contract.test.ts tests/publication-robustness.test.ts`

Expected: at least the new mutation cases pass through the old validator and fail the test.

- [ ] **Step 3: Implement cross-file release validation**

Read `site/data/decision-products.json` with `readJsonStrict()`, validate exact schema, rebuild the artifact from canonical sources, and compare material bytes while ignoring no field except an explicitly documented health check timestamp. Assert:

- dashboard IDs/order equal the artifact;
- README marker IDs/order equal the artifact;
- feed manifest and RSS GUID/order equal `renderDecisionFeed()`;
- every company event belongs to the card company;
- every known Benchmark field has ledger evidence;
- no candidate/private keys appear recursively;
- artifact `generatedAt` equals the run manifest and dashboard generation.

Wire this validator into both local publication validation and `validate:release`.

- [ ] **Step 4: Document public semantics and run local release validation**

Document Top Signal evidence gates, company unknown semantics, Passport limitations, subscription privacy, and correction behavior. Run:

```bash
pnpm run check
pnpm test
pnpm run validate:release
pnpm run validate:health
git diff --check
```

Expected: typecheck and full suite pass; release validation passes; health may be `degraded` only for explicitly reported external-source or historical-gap reasons.

- [ ] **Step 5: Run two fixed-input generations and inspect public gates**

Run the integration fixture twice and compare bytes:

```bash
pnpm exec tsx --test tests/decision-products-pipeline.test.ts tests/dual-ledger-pipeline.test.ts
rg -n "暂无中文简介|中文简介暂未生成|rawModelOutput|candidate[-_:]" README.md site/data/decision-products.json site/feeds/decision || true
```

Expected: tests pass; the scan returns no public leakage matches.

- [ ] **Step 6: Generate real local assets once and review the diff**

Run `pnpm start` with configured environment variables without printing them. Inspect generated decision products for complete Chinese copy, canonical company ownership, direct evidence links, six research passports, stable feed URLs, and no private fields.

- [ ] **Step 7: Commit**

```bash
git add src/validate-release.ts src/runtime/validation.ts FACTS_POLICY.md docs/DEVELOPMENT_STANDARDS.md README.en.md README.md site/data/decision-products.json site/feeds/decision tests/release-contract.test.ts tests/publication-robustness.test.ts
git commit -m "docs: publish phase 3 decision products"
```

- [ ] **Step 8: Online release gate after explicit push approval**

After the branch is reviewed, merged and explicitly authorized for push:

```bash
gh workflow run daily-digest.yml --repo mbabby/physical-ai-news-cn
gh run watch --repo mbabby/physical-ai-news-cn --exit-status
gh workflow run daily-digest.yml --repo mbabby/physical-ai-news-cn
gh run watch --repo mbabby/physical-ai-news-cn --exit-status
```

Verify both runs complete generation, release validation, commit reporting, Pages deployment, homepage date synchronization, and duplicate-free second-run output. Never print secret values or request bodies.
