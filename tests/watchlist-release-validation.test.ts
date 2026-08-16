import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileTransaction } from "../src/runtime/storage.js";
import type { CompanyProfile, EventRecord } from "../src/types.js";
import type { CompanyThesis, CompanyThesisArtifact, WatchlistSnapshot } from "../src/watchlist/contracts.js";
import {
  validateCurrentWatchlistHistoryFiles,
  mergeWatchlistThesisArtifact,
  stageWatchlistRelease,
  validateWatchlistRelease,
} from "../src/watchlist/release-validation.js";
import { buildWatchlistPublicView, type WatchlistPublicView } from "../src/watchlist/public-view.js";
import { buildWatchlistChangePage, type WatchlistChangePage } from "../src/watchlist/change-page.js";
import { buildWatchlistMetrics } from "../src/watchlist/metrics.js";
import { buildWatchlistFeedManifest } from "../src/watchlist/feeds.js";

const GENERATED_AT = "2026-08-17T01:00:00.000Z";
const FEEDS = { baseUrl: "https://example.test/physical-ai-news-cn" };

function thesis(overrides: Partial<CompanyThesis> = {}): CompanyThesis {
  return {
    thesisId: "thesis-alpha",
    companyId: "company-alpha",
    track: "forward-radar",
    lifecycle: "new",
    thesisVersion: 1,
    whyNow: "AI 研究判断：Alpha Robotics 出现新的规范事实。",
    routeAndDependencies: "AI 研究判断：路线依赖后续真实部署验证。",
    nextValidationPoints: [{ text: "核验后续真实部署。", dueAt: "2026-10-01" }],
    falsifiers: [{ text: "规范事实被撤回。" }],
    factReferenceIds: ["event-alpha"],
    verifiedSensitiveBindings: [],
    inferenceLabels: ["AI 研究判断"],
    confidence: "medium",
    generatedAt: "2026-08-16T01:00:00.000Z",
    expiresAt: "2026-10-15T01:00:00.000Z",
    modelVersion: "model-v1",
    promptVersion: "prompt-v1",
    methodologyVersion: "method-v1",
    ...overrides,
  };
}

function snapshot(overrides: Partial<WatchlistSnapshot> = {}): WatchlistSnapshot {
  return {
    week: "2026-W34",
    snapshotVersion: 1,
    methodologyVersion: "method-v1",
    generatedAt: GENERATED_AT,
    forwardRadar: [{ companyId: "company-alpha", thesisId: "thesis-alpha", thesisVersion: 1, group: "priority-focus" }],
    validatedMomentum: [],
    changesSinceLastWeek: [],
    ...overrides,
  };
}

function artifact(items: CompanyThesis[] = [thesis()]): CompanyThesisArtifact {
  return { schemaVersion: 1, generatedAt: GENERATED_AT, theses: items };
}

function view(overrides: Partial<WatchlistPublicView> = {}): WatchlistPublicView {
  const card: WatchlistPublicView["forwardRadar"][number] = {
    companyId: "company-alpha",
    companyName: "Alpha Robotics",
    thesisId: "thesis-alpha",
    thesisVersion: 1,
    track: "forward-radar",
    group: "priority-focus",
    lifecycle: "new",
    lifecycleLabel: "新进入",
    routes: ["VLA 与具身模型"],
    whyNow: "AI 研究判断：Alpha Robotics 出现新的规范事实。",
    routeAndDependencies: "AI 研究判断：路线依赖后续真实部署验证。",
    nextValidationPoints: [{ text: "核验后续真实部署。", dueAt: "2026-10-01" }],
    falsifiers: [{ text: "规范事实被撤回。" }],
    evidenceLinks: [{ eventId: "event-alpha", title: "Alpha Robotics 发布进展", url: "https://alpha.example/release", source: "Alpha Robotics", grade: "A" }],
    capital: { status: "evidence-insufficient", summary: "证据不足（不代表未融资）" },
  };
  return {
    week: "2026-W34",
    snapshotVersion: 1,
    methodologyVersion: "method-v1",
    lastSuccessfulAt: GENERATED_AT,
    companyIds: ["company-alpha"],
    forwardRadar: [card],
    validatedMomentum: [],
    changes: [],
    ...overrides,
  };
}

function changePage(overrides: Partial<WatchlistChangePage> = {}): WatchlistChangePage {
  return {
    schemaVersion: 1,
    current: { week: "2026-W34", snapshotVersion: 1, generatedAt: GENERATED_AT },
    baseline: null,
    emptyBaseline: true,
    changes: [],
    ...overrides,
  };
}

const canonicalCompanies: CompanyProfile[] = [{
  entityId: "company-alpha",
  entityType: "公司",
  name: "Alpha Robotics",
  region: "美国",
  routes: ["VLA 与具身模型"],
  thesis: "测试公司。",
  officialUrl: "https://alpha.example",
}];

function canonicalEvents(): EventRecord[] {
  return [{
    id: "event-alpha",
    title: "Alpha Robotics 发布进展",
    type: "产品发布",
    entities: ["Alpha Robotics"],
    primaryEntity: "Alpha Robotics",
    routes: ["VLA 与具身模型"],
    status: "已确证",
    occurredAt: "2026-08-16T00:00:00.000Z",
    eventDate: "2026-08-16",
    firstSeenAt: "2026-08-16T00:00:00.000Z",
    lastUpdatedAt: "2026-08-16T00:00:00.000Z",
    lastMaterialChangeAt: "2026-08-16T00:00:00.000Z",
    lastVerifiedAt: "2026-08-16T00:00:00.000Z",
    facts: ["Alpha Robotics 发布进展。"],
    openQuestions: [],
    timeline: [],
    productDeployment: { product: "Atlas-X", customers: [], deployment: "公开发布" },
    evidence: [{ link: "https://alpha.example/release", source: "Alpha Robotics", grade: "A", publishedAt: "2026-08-16T00:00:00.000Z", supports: "Alpha Robotics 发布进展。" }],
  }];
}

function readme(): string {
  return [
    "> 观察名单快照：2026-W34 · v1",
    "",
    "### 前瞻雷达",
    "",
    "- **[Alpha Robotics](https://mbabby.github.io/physical-ai-news-cn/companies.html#company-alpha)** · 重点关注 · 新进入",
    "  - 为什么现在值得看：AI 研究判断：Alpha Robotics 出现新的规范事实。",
    "",
    "### 验证动量",
    "",
    "- 暂无达到公开门槛的公司。",
  ].join("\n");
}

function release(overrides: Partial<Parameters<typeof validateWatchlistRelease>[0]> = {}) {
  const candidate = {
    snapshot: snapshot(),
    theses: artifact(),
    dashboard: { watchlist: view() },
    readme: readme(),
    changePage: changePage(),
    companies: canonicalCompanies,
    events: canonicalEvents(),
    ...overrides,
  };
  let metrics = buildWatchlistMetrics({
    snapshot: snapshot(),
    theses: artifact(),
    view: view(),
    changePage: changePage(),
    feeds: buildWatchlistFeedManifest(view()),
    readme: readme(),
  });
  try {
    metrics = buildWatchlistMetrics({
      snapshot: candidate.snapshot,
      theses: candidate.theses,
      view: (candidate.dashboard as { watchlist: WatchlistPublicView }).watchlist,
      changePage: candidate.changePage,
      feeds: buildWatchlistFeedManifest((candidate.dashboard as { watchlist: WatchlistPublicView }).watchlist),
      readme: candidate.readme,
    });
  } catch {
    // Tests for invalid release inputs need the release validator to expose
    // the targeted public-contract failure before metrics are considered.
  }
  return { ...candidate, metrics: overrides.metrics ?? metrics };
}

function canonicalPeriodRelease() {
  const previous = snapshot({ week: "2026-W33", forwardRadar: [] });
  const current = snapshot();
  const canonical = artifact();
  const events = canonicalEvents();
  const previousView = buildWatchlistPublicView({ snapshot: previous, thesisArtifact: canonical, companies: canonicalCompanies, events });
  const currentView = buildWatchlistPublicView({ snapshot: current, thesisArtifact: canonical, companies: canonicalCompanies, events });
  const changePage = buildWatchlistChangePage({ current, snapshots: [previous, current], views: [previousView, currentView] });
  return {
    ...release({ snapshot: current, theses: canonical, dashboard: { watchlist: currentView }, history: [previous], changePage }),
    companies: canonicalCompanies,
    events,
  };
}

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

test("release validation requires the current immutable history file with identical bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "watchlist-current-history-"));
  const currentPath = join(root, "watchlist", "current.json");
  const historyPath = join(root, "watchlist", "history", "2026-W34-v1.json");
  try {
    await mkdir(join(root, "watchlist", "history"), { recursive: true });
    await writeFile(currentPath, json(snapshot()));
    await assert.rejects(() => validateCurrentWatchlistHistoryFiles(root, snapshot()), /缺少.*不可变历史/);

    await writeFile(historyPath, json({ ...snapshot(), generatedAt: "2026-08-17T00:00:00.000Z" }));
    await assert.rejects(() => validateCurrentWatchlistHistoryFiles(root, snapshot()), /字节.*不一致/);

    await writeFile(historyPath, json(snapshot()));
    await assert.doesNotReject(() => validateCurrentWatchlistHistoryFiles(root, snapshot()));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a week mismatch across snapshot, dashboard and README", () => {
  assert.throws(() => validateWatchlistRelease(release({ dashboard: { watchlist: view({ week: "2026-W33" }) } })), /周.*不一致/);
});

test("requires the change-page baseline to be the immediate immutable predecessor", () => {
  const prior = snapshot({ week: "2026-W33" });
  assert.throws(() => validateWatchlistRelease(release({ history: [prior] })), /基线|相邻/);
  assert.throws(() => validateWatchlistRelease(release({
    history: [snapshot({ week: "2026-W32" }), prior],
    changePage: changePage({ baseline: { week: "2026-W32", snapshotVersion: 1, generatedAt: GENERATED_AT }, emptyBaseline: false }),
  })), /基线|相邻/);
});

test("release validation rejects change items that differ from the canonical adjacent snapshot delta", () => {
  const canonical = canonicalPeriodRelease();
  assert.doesNotThrow(() => validateWatchlistRelease(canonical as Parameters<typeof validateWatchlistRelease>[0]));
  const actual = canonical.changePage.changes[0]!;
  const forged = [
    { ...actual, companyId: "company-forged", companyName: "Forged Robotics" },
    { ...actual, kind: "strengthening" as const },
    { ...actual, evidenceLinks: [{ ...actual.evidenceLinks[0]!, url: "https://forged.example/release" }] },
    { ...actual, evidenceLinks: [{ ...actual.evidenceLinks[0]!, eventId: "event-forged", title: "Forged release", source: "Forged", grade: "B" as const }] },
    { ...actual, evidenceLinks: [{ url: "https://alpha.example/release" }] },
  ];
  for (const change of forged) {
    assert.throws(
      () => validateWatchlistRelease({ ...canonical, changePage: { ...canonical.changePage, changes: [change] } } as Parameters<typeof validateWatchlistRelease>[0]),
      /变化.*规范|变化.*相邻|变化.*快照|变化.*证据/,
    );
  }
});

test("release validation rejects a change page rebuilt from synchronized forged public views", () => {
  const canonical = canonicalPeriodRelease();
  const previous = canonical.history![0]!;
  const forgedCurrent = buildWatchlistPublicView({ snapshot: canonical.snapshot, thesisArtifact: canonical.theses, companies: canonical.companies, events: canonical.events });
  forgedCurrent.forwardRadar[0]!.whyNow = "AI 研究判断：伪造的公开理由。";
  forgedCurrent.forwardRadar[0]!.evidenceLinks[0] = { ...forgedCurrent.forwardRadar[0]!.evidenceLinks[0]!, eventId: "event-forged", title: "伪造事件", url: "https://forged.example/release", source: "Forged", grade: "B" };
  const forgedPrevious = buildWatchlistPublicView({ snapshot: previous, thesisArtifact: canonical.theses, companies: canonical.companies, events: canonical.events });
  const forgedPage = buildWatchlistChangePage({ current: canonical.snapshot, snapshots: [previous, canonical.snapshot], views: [forgedPrevious, forgedCurrent] });
  forgedPage.changes[0]!.whatChanged = forgedPage.changes[0]!.whatChanged.replace("v1", "v99");
  assert.throws(
    () => validateWatchlistRelease({ ...canonical, changePageViews: [forgedPrevious, forgedCurrent], changePage: forgedPage } as Parameters<typeof validateWatchlistRelease>[0]),
    /变化.*规范|变化.*相邻|变化.*快照|变化.*证据/,
  );
});

test("rejects a broken exact thesis reference and methodology version mismatch", () => {
  assert.throws(() => validateWatchlistRelease(release({ theses: artifact([thesis({ thesisVersion: 2 })]) })), /判断版本/);
  assert.throws(() => validateWatchlistRelease(release({ theses: artifact([thesis({ methodologyVersion: "method-v2" })]) })), /方法论版本/);
});

test("rejects company-set mismatches in dashboard and README", () => {
  assert.throws(() => validateWatchlistRelease(release({ dashboard: { watchlist: view({ companyIds: [] }) } })), /公司集合|公开视图结构/);
  assert.throws(() => validateWatchlistRelease(release({ readme: readme().replace("#company-alpha", "#company-beta") })), /公司集合/);
});

test("rejects malformed public cards and cards without qualifying evidence links", () => {
  const baseCard = view().forwardRadar[0]!;
  const malformedCards = [
    { ...baseCard, evidenceLinks: [] },
    { ...baseCard, evidenceLinks: [{ ...baseCard.evidenceLinks[0]!, url: "javascript:alert(1)" }] },
    { ...baseCard, evidenceLinks: [{ ...baseCard.evidenceLinks[0]!, grade: "C" }] },
    { ...baseCard, track: "validated-momentum" },
    { ...baseCard, group: "private" },
    { ...baseCard, lifecycle: "falsified" },
    { ...baseCard, routes: [] },
    { ...baseCard, nextValidationPoints: [] },
    { ...baseCard, falsifiers: [] },
    { ...baseCard, capital: { status: "evidence-insufficient", summary: "unknown" } },
    { ...baseCard, capital: { status: "verified", summary: "" } },
  ];
  for (const card of malformedCards) {
    assert.throws(
      () => validateWatchlistRelease(release({ dashboard: { watchlist: view({ forwardRadar: [card] as typeof baseCard[] }) } })),
      /dashboard.*公开视图结构不合法/,
    );
  }
  assert.throws(() => validateWatchlistRelease(release({
    dashboard: { watchlist: { ...view(), companyIds: ["company-alpha", "company-alpha"], forwardRadar: [baseCard, baseCard] } },
  })), /dashboard.*公开视图结构不合法/);
  const { companyName: _companyName, ...missingCompanyName } = baseCard;
  assert.throws(() => validateWatchlistRelease(release({
    dashboard: { watchlist: view({ forwardRadar: [missingCompanyName as typeof baseCard] }) },
  })), /dashboard.*公开视图结构不合法/);
});

test("dashboard changes exactly match canonical snapshot changes", () => {
  const canonicalChange = [{ companyId: "company-alpha", change: "added" as const }];
  const publicChange = [{ companyId: "company-alpha", companyName: "Alpha Robotics", change: "added" as const }];
  assert.doesNotThrow(() => validateWatchlistRelease(release({
    snapshot: snapshot({ changesSinceLastWeek: canonicalChange }),
    dashboard: { watchlist: view({ changes: publicChange }) },
  })));

  for (const changes of [
    [],
    [...publicChange, { companyId: "company-beta", companyName: "Beta Robotics", change: "added" as const }],
    [{ ...publicChange[0]!, change: "downgraded" as const }],
    [{ ...publicChange[0]!, companyId: "company-beta" }],
    [{ ...publicChange[0]!, companyName: "Forged Robotics" }],
  ]) {
    assert.throws(() => validateWatchlistRelease(release({
      snapshot: snapshot({ changesSinceLastWeek: canonicalChange }),
      dashboard: { watchlist: view({ changes }) },
    })), /dashboard.*变更.*快照.*不一致/);
  }
  assert.throws(() => validateWatchlistRelease(release({
    dashboard: { watchlist: { ...view(), changes: undefined } },
  })), /dashboard.*公开视图结构不合法/);
});

test("rejects public score, rank, candidate id and private diagnostics leakage", () => {
  for (const [target, leaked] of [
    ["snapshot", { ...snapshot(), selectionScore: 99 }],
    ["dashboard", { watchlist: { ...view(), rank: 1 } }],
    ["theses", { ...artifact(), theses: [{ ...thesis(), sentenceCitations: [] }] }],
  ] as const) {
    assert.throws(() => validateWatchlistRelease(release({ [target]: leaked })), /私有诊断|候选标识|分数|排名/);
  }
  assert.throws(() => validateWatchlistRelease(release({
    snapshot: snapshot({ forwardRadar: [{ ...snapshot().forwardRadar[0]!, companyId: "candidate-03950aa949fb" }] }),
  })), /候选标识/);
  assert.throws(() => validateWatchlistRelease(release({ readme: `${readme()}\n内部 rank: 1` })), /私有诊断|分数|排名/);
  assert.throws(() => validateWatchlistRelease(release({
    dashboard: { watchlist: view({ forwardRadar: [{ ...view().forwardRadar[0]!, whyNow: "AI 研究判断：score 99。" }] }) },
  })), /私有诊断|分数|排名/);
});

test("rejects falsified and expired selected theses", () => {
  assert.throws(() => validateWatchlistRelease(release({ theses: artifact([thesis({ lifecycle: "falsified" })]) })), /不可公开/);
  assert.throws(() => validateWatchlistRelease(release({ theses: artifact([thesis({ expiresAt: GENERATED_AT })]) })), /已过期|不可公开/);
});

test("public theses contain exactly the versions referenced by current and history", () => {
  const extras = [
    thesis({ thesisId: "thesis-beta", companyId: "company-beta" }),
    thesis({ thesisId: "thesis-beta", companyId: "company-beta", lifecycle: "falsified" }),
    thesis({ thesisId: "thesis-beta", companyId: "company-beta", lifecycle: "expired", expiresAt: GENERATED_AT }),
  ];
  for (const extra of extras) {
    assert.throws(
      () => validateWatchlistRelease(release({ theses: artifact([thesis(), extra]) })),
      /判断版本集合.*快照引用不一致/,
    );
  }
});

test("requires a visible AI research judgment disclosure", () => {
  assert.throws(() => validateWatchlistRelease(release({ readme: readme().replaceAll("AI 研究判断", "研究观察") })), /AI 研究判断/);
  assert.throws(() => validateWatchlistRelease(release({
    theses: artifact([thesis({ inferenceLabels: ["manual"] })]),
    history: [snapshot()],
  })), /判断标签.*AI 研究判断/);
});

test("rejects a structurally valid metric artifact that was not derived from canonical public inputs", () => {
  const valid = release();
  assert.throws(() => validateWatchlistRelease({
    ...valid,
    metrics: {
      ...valid.metrics,
      productQuality: {
        ...valid.metrics.productQuality,
        citationCoverage: { numerator: 0, denominator: 1, value: 0 },
      },
    },
  }), /指标.*规范|指标.*公开|指标.*不一致/);
});

test("an invalid staged snapshot leaves every public artifact unchanged", async () => {
  const root = await mkdtemp(join(tmpdir(), "watchlist-invalid-stage-"));
  const paths = [
    "watchlist/current.json",
    "watchlist/theses.json",
    "watchlist/history/2026-W34-v1.json",
    "site/data/dashboard.json",
    "README.md",
  ];
  try {
    for (const path of paths) {
      await mkdir(join(root, path, ".."), { recursive: true });
      await writeFile(join(root, path), `last-known-good:${path}\n`);
    }
    const before = await Promise.all(paths.map((path) => readFile(join(root, path), "utf8")));
    const transaction = new FileTransaction("invalid-watchlist-stage");
    await assert.rejects(() => stageWatchlistRelease({
      transaction,
      root,
      ...release({ dashboard: { watchlist: view({ week: "2026-W33" }) } }),
      feeds: FEEDS,
    }), /周.*不一致/);
    await transaction.commit();
    assert.deepEqual(await Promise.all(paths.map((path) => readFile(join(root, path), "utf8"))), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refuses to stage a Watchlist release without its required feeds", async () => {
  const root = await mkdtemp(join(tmpdir(), "watchlist-required-feeds-"));
  try {
    const transaction = new FileTransaction("watchlist-required-feeds");
    await assert.rejects(() => stageWatchlistRelease({ transaction, root, ...release() } as unknown as Parameters<typeof stageWatchlistRelease>[0]), /feeds.*必需|订阅.*必需/);
    assert.equal(transaction.size, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refuses to stage a Watchlist release without its required period-change artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "watchlist-required-changes-"));
  try {
    const transaction = new FileTransaction("watchlist-required-changes");
    await assert.rejects(() => stageWatchlistRelease({ transaction, root, ...release({ changePage: undefined }), feeds: FEEDS } as unknown as Parameters<typeof stageWatchlistRelease>[0]), /变化.*必需|change.*required/i);
    assert.equal(transaction.size, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stages snapshot-identified feeds and their manifest in the release transaction", async () => {
  const root = await mkdtemp(join(tmpdir(), "watchlist-release-feeds-"));
  try {
    const transaction = new FileTransaction("watchlist-release-feeds");
    await stageWatchlistRelease({
      transaction,
      root,
      ...release(),
      feeds: FEEDS,
    });
    assert.equal(transaction.size, 14);
    await transaction.commit();
    assert.deepEqual(JSON.parse(await readFile(join(root, "site", "data", "watchlist-changes.json"), "utf8")), changePage());
    assert.deepEqual(JSON.parse(await readFile(join(root, "metrics", "watchlist.json"), "utf8")), release().metrics);
    assert.deepEqual(JSON.parse(await readFile(join(root, "site", "feeds", "manifest.json"), "utf8")), {
      schemaVersion: 1,
      snapshotWeek: "2026-W34",
      snapshotVersion: 1,
      companyFeedIds: ["company-alpha"],
      companyFeeds: [{ companyId: "company-alpha", path: "feeds/companies/company-alpha.xml" }],
      routeFeeds: [
        { route: "数据与训练", slug: "data-and-training", path: "feeds/routes/data-and-training.xml" },
        { route: "VLA 与具身模型", slug: "vla-and-embodied-models", path: "feeds/routes/vla-and-embodied-models.xml" },
        { route: "世界模型与空间智能", slug: "world-models-and-spatial-intelligence", path: "feeds/routes/world-models-and-spatial-intelligence.xml" },
        { route: "本体与硬件", slug: "embodiment-and-hardware", path: "feeds/routes/embodiment-and-hardware.xml" },
        { route: "部署与商业化", slug: "deployment-and-commercialization", path: "feeds/routes/deployment-and-commercialization.xml" },
      ],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("failure injection rolls back the whole Watchlist public group", async () => {
  const root = await mkdtemp(join(tmpdir(), "watchlist-rollback-"));
  const existingPaths = [
    "watchlist/current.json",
    "watchlist/theses.json",
    "watchlist/history/2026-W34-v1.json",
    "site/data/dashboard.json",
    "site/data/watchlist-changes.json",
    "metrics/watchlist.json",
    "README.md",
  ];
  const newHistoryPath = "watchlist/history/2026-W34-v2.json";
  try {
    for (const path of existingPaths) {
      await mkdir(join(root, path, ".."), { recursive: true });
      await writeFile(join(root, path), `last-known-good:${path}\n`);
    }
    const before = await Promise.all(existingPaths.map((path) => readFile(join(root, path), "utf8")));
    const transaction = new FileTransaction("watchlist-release-rollback", { failAfterSwaps: 3 });
    await stageWatchlistRelease({
      transaction,
      root,
      ...release({
        snapshot: snapshot({ snapshotVersion: 2 }),
        dashboard: { watchlist: view({ snapshotVersion: 2 }) },
        readme: readme().replace("v1", "v2"),
        changePage: changePage({ current: { week: "2026-W34", snapshotVersion: 2, generatedAt: GENERATED_AT } }),
      }),
      feeds: FEEDS,
    });
    await assert.rejects(() => transaction.commit(), /已回滚/);
    assert.deepEqual(await Promise.all(existingPaths.map((path) => readFile(join(root, path), "utf8"))), before);
    await assert.rejects(() => readFile(join(root, newHistoryPath), "utf8"), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("immutable history rejects different bytes and accepts identical bytes idempotently", async () => {
  const root = await mkdtemp(join(tmpdir(), "watchlist-history-collision-"));
  try {
    const historyPath = join(root, "watchlist", "history", "2026-W34-v1.json");
    await mkdir(join(root, "watchlist", "history"), { recursive: true });
    await writeFile(historyPath, json({ ...snapshot(), generatedAt: "2026-08-17T00:00:00.000Z" }));
    await assert.rejects(() => stageWatchlistRelease({ transaction: new FileTransaction("history-different"), root, ...release(), feeds: FEEDS }), /历史快照.*冲突/);

    await rm(historyPath);
    const paths = [
      "watchlist/current.json",
      "watchlist/theses.json",
      "watchlist/history/2026-W34-v1.json",
      "site/data/dashboard.json",
      "site/data/watchlist-changes.json",
      "metrics/watchlist.json",
      "README.md",
    ];
    const first = new FileTransaction("history-first-cycle");
    await stageWatchlistRelease({ transaction: first, root, ...release(), feeds: FEEDS });
    assert.equal(first.size, 14);
    await first.commit();
    const firstBytes = await Promise.all(paths.map((path) => readFile(join(root, path), "utf8")));

    const second = new FileTransaction("history-second-cycle");
    await stageWatchlistRelease({ transaction: second, root, ...release(), feeds: FEEDS });
    assert.equal(second.size, 13);
    await second.commit();
    assert.deepEqual(await Promise.all(paths.map((path) => readFile(join(root, path), "utf8"))), firstBytes);
    assert.equal(await readFile(historyPath, "utf8"), json(snapshot()));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("public thesis merge retains every exact version referenced by current and history", () => {
  const historicThesis = thesis({ thesisVersion: 1 });
  const currentThesis = thesis({ thesisVersion: 2, lifecycle: "strengthening", generatedAt: GENERATED_AT, expiresAt: "2026-10-16T01:00:00.000Z" });
  const history = snapshot({ week: "2026-W33", forwardRadar: [{ companyId: "company-alpha", thesisId: "thesis-alpha", thesisVersion: 1, group: "priority-focus" }] });
  const current = snapshot({ snapshotVersion: 2, forwardRadar: [{ companyId: "company-alpha", thesisId: "thesis-alpha", thesisVersion: 2, group: "priority-focus" }] });
  const merged = mergeWatchlistThesisArtifact({
    snapshot: current,
    histories: [history],
    previous: artifact([historicThesis]),
    candidates: [currentThesis],
  });
  assert.deepEqual(merged.theses.map((item) => [item.thesisId, item.thesisVersion]), [["thesis-alpha", 1], ["thesis-alpha", 2]]);
  assert.throws(() => mergeWatchlistThesisArtifact({
    snapshot: current,
    histories: [history],
    previous: artifact([historicThesis]),
    candidates: [{ ...currentThesis, whyNow: "AI 研究判断：冲突版本。" }, currentThesis],
  }), /判断版本.*冲突/);
});
