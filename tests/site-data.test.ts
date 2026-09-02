import assert from "node:assert/strict";
import test from "node:test";
import { buildDashboard, projectPublicationHealth } from "../src/site-data.js";
import { materializeResearchDecisionCard } from "../src/research-decision-card.js";
import { buildResearchIndustryRelationEdges, researchIndustryCompanyId } from "../src/research-industry-relations.js";
import type { Article, EventStore } from "../src/types.js";
import type { WatchlistPublicView } from "../src/watchlist/public-view.js";
import type { DecisionProductArtifact } from "../src/decision-products/contracts.js";

const article: Article = { id: "paper", title: "Robotics paper", titleZh: "机器人研究论文", summaryZh: "论文在真实机器人基准上验证了新的视觉语言动作方法。实验报告了跨任务的评测结果。", link: "https://arxiv.org/abs/test", publishedAt: new Date("2026-08-02"), fetchedAt: new Date(), source: "arXiv · Robotics", sourceWeight: 9, excerpt: "Research abstract", tags: ["VLA"] };
const events: EventStore = { updatedAt: "2026-08-02", events: [{ id: "funding", title: "Example 完成融资", type: "投融资", entities: ["Example"], primaryEntity: "Example", routes: ["部署与商业化"], status: "已确证", firstSeenAt: "2026-08-02", lastUpdatedAt: "2026-08-02", lastVerifiedAt: "2026-08-02", facts: ["完成可核验融资。"], openQuestions: [], evidence: [{ link: "https://example.com", source: "Official", grade: "A", publishedAt: "2026-08-02", supports: "融资" }], timeline: [{ date: "2026-08-02", summary: "完成可核验融资。", evidenceLinks: ["https://example.com"] }], funding: { entityStatus: "已确认", investors: [] } }] };

function makeEvent(overrides: Partial<EventStore["events"][number]>): EventStore["events"][number] {
  return { ...events.events[0], ...overrides };
}

test("builds compact dashboard data from verified events and research", () => {
  const companies = [{ name: "Example", region: "中国", stage: "创业公司" as const, routes: ["部署与商业化" as const], thesis: "真实场景机器人部署", officialUrl: "https://example.com" }];
  const dashboard = buildDashboard(events, companies, [article], new Date("2026-08-02"), { activeSources: 12, periodLabel: "2026-W31" });
  assert.equal(dashboard.capital[0]?.title, "Example 完成融资");
  assert.equal(dashboard.research[0]?.title, "机器人研究论文");
  assert.equal(dashboard.routes.length, 5);
  assert.equal(dashboard.companyRadar[0]?.name, "Example");
  assert.equal(dashboard.companyRadar[0]?.capitalStatus, "已证实");
  assert.equal(dashboard.companyRadar[0]?.funding?.title, "Example 完成融资");
  assert.equal(dashboard.companyRadar[0]?.identitySource, "公司官网");
  assert.equal(dashboard.stats.sources, 12);
  assert.equal(dashboard.confirmedSignals.length, 1);
  assert.equal(dashboard.developingSignals.length, 0);
  assert.equal(dashboard.topSignals[0]?.evidenceGrade, "A");
  assert.equal(dashboard.topSignals[0]?.verificationStatus, "官方确认");
  assert.equal(dashboard.topSignals[0]?.evidenceCount, 1);
  assert.match(dashboard.topSignals[0]?.whyItMatters ?? "", /资本/);
  assert.equal(dashboard.companyRadar[0]?.momentumLabel, "持续推进");
  assert.equal(dashboard.companyBoards?.policy.minimumSampleSize, 10);
  assert.equal(dashboard.companyBoards?.momentum.mode, "watchlist");
  assert.equal(dashboard.companyBoards?.momentum.entries[0]?.rank, null);
  assert.equal(dashboard.companyBoards?.momentum.entries[0]?.companyName, "Example");
  assert.equal(dashboard.researchGraph[0]?.route, "VLA 与具身模型");
  assert.deepEqual(dashboard.researchGraph[0]?.companies, []);
});

test("projects only aggregate publication health without diagnostic or candidate content", () => {
  const health = projectPublicationHealth({
    dailyPublicationFreshness: {
      expectedDate: "2026-08-02",
      latestPublishedDate: "2026-08-01",
      state: "missing",
      publicationDue: true,
    },
  }, {
    quality: { publicIndustryItems: 2, publicResearchItems: 3, candidates: 9, sourceFailures: 1 },
    services: [{ component: "LLM", status: "部分降级", attempted: 1, succeeded: 0, failed: 1, detail: "provider error https://private.example/token" }],
  }, 7);

  assert.deepEqual(health, {
    daily: { expectedDate: "2026-08-02", latestPublishedDate: "2026-08-01", state: "missing", publicationDue: true },
    publicIndustryItems: 2,
    publicResearchItems: 3,
    candidateBacklog: 7,
    sourceFailureCount: 1,
    degradedComponents: ["LLM"],
  });
  assert.doesNotMatch(JSON.stringify(health), /provider error|private\.example|token|candidates|sourceFailures/);

  const dashboard = buildDashboard(events, [], [], new Date("2026-08-02"), { publicationHealth: health });
  assert.deepEqual(dashboard.publicationHealth, health);
  assert.doesNotMatch(JSON.stringify(dashboard), /provider error|private\.example|token/);
});

test("projects only partial service degradations and clamps source failures to a safe count", () => {
  const health = projectPublicationHealth({
    dailyPublicationFreshness: { expectedDate: "2026-08-02", latestPublishedDate: "2026-08-02", state: "current", publicationDue: false },
  }, {
    quality: { publicIndustryItems: 0, publicResearchItems: 0, candidates: 0, sourceFailures: -2 },
    services: [
      { component: "LLM", status: "部分降级", attempted: 1, succeeded: 0, failed: 1, detail: "provider error https://private.example/token" },
      { component: "OpenAlex", status: "未配置", attempted: 0, succeeded: 0, failed: 0, detail: "disabled" },
      { component: "GitHub", status: "未配置", attempted: 0, succeeded: 0, failed: 0, detail: "disabled" },
    ],
  }, 0);

  assert.deepEqual(health.degradedComponents, ["LLM"]);
  assert.equal(health.sourceFailureCount, 0);
  assert.doesNotMatch(JSON.stringify(health), /provider error|private\.example|token|disabled/);
});

test("keeps incomplete research and unowned events out of the public dashboard", () => {
  const incomplete = { ...article, id: "raw", titleZh: undefined, summaryZh: undefined };
  const unowned: EventStore = { updatedAt: events.updatedAt, events: [{ ...events.events[0], id: "unknown", primaryEntity: undefined, entities: [] }] };
  const dashboard = buildDashboard(unowned, [], [incomplete], new Date("2026-08-02"));
  assert.equal(dashboard.stats.events, 0);
  assert.equal(dashboard.stats.research, 0);
  assert.deepEqual(dashboard.research, []);
  assert.deepEqual(dashboard.topSignals, []);
});

test("keeps research with a failed decision gate out of the public dashboard", () => {
  const record = { id: article.id, article, firstSeenAt: "2026-08-02", lastCheckedAt: "2026-08-02", factHash: "paper", status: "新论文" as const, appearances: 1, evidenceTags: [] as [], authorityLabels: [] as string[], changes: [] as [] };
  const failed = materializeResearchDecisionCard(record, { now: new Date("2026-08-02") });
  assert.equal(failed.eligibleForTopResearch, false);
  const dashboard = buildDashboard(events, [], [article], new Date("2026-08-02"), { researchDecisionCards: [failed] });
  assert.equal(dashboard.stats.research, 0);
  assert.deepEqual(dashboard.research, []);
});

test("does not turn a missing financing record into a negative company claim", () => {
  const company = { name: "NoFundingClaim", region: "北美", stage: "创业公司" as const, routes: ["VLA 与具身模型" as const], thesis: "机器人基础模型", officialUrl: "https://example.com/company" };
  const dashboard = buildDashboard({ updatedAt: "2026-08-02", events: [] }, [company], [], new Date("2026-08-02"));
  assert.equal(dashboard.companyRadar[0]?.capitalStatus, "证据不足");
  assert.equal(dashboard.companyRadar[0]?.funding, undefined);
});

test("ranks authoritative high-impact top signals ahead of weaker recent updates", () => {
  const store: EventStore = { updatedAt: "2026-08-08", events: [
    makeEvent({ id: "deployment", title: "DeployCo 完成客户部署", primaryEntity: "DeployCo", entities: ["DeployCo"], type: "部署案例", lastUpdatedAt: "2026-08-07", facts: ["DeployCo 已在客户工厂完成真实机器人部署。"], timeline: [], evidence: [{ link: "https://deploy.example/official", source: "DeployCo 官网", grade: "A", publishedAt: "2026-08-07", supports: "部署" }] }),
    makeEvent({ id: "minor", title: "ToolCo 更新开源工具", primaryEntity: "ToolCo", entities: ["ToolCo"], type: "开源项目", lastUpdatedAt: "2026-08-08", facts: ["ToolCo 更新了机器人开源工具的文档。"], timeline: [], evidence: [{ link: "https://media.example/tool", source: "Industry Media", grade: "B", publishedAt: "2026-08-08", supports: "更新" }] }),
  ] };
  const dashboard = buildDashboard(store, [], [], new Date("2026-08-08"));
  assert.equal(dashboard.topSignals[0]?.entity, "DeployCo");
  assert.equal(dashboard.topSignals[0]?.evidenceGrade, "A");
  assert.ok((dashboard.topSignals[0]?.score ?? 0) > (dashboard.topSignals[1]?.score ?? 0));
});

test("uses public evidence grade and excludes discovery-only, stale, future, and malformed events", () => {
  const discoveryAndPublic = makeEvent({ id: "mixed", title: "MixedCo 发布机器人", primaryEntity: "MixedCo", entities: ["MixedCo"], type: "产品发布", lastUpdatedAt: "2026-08-08", facts: ["MixedCo 发布了已可核验的机器人产品。"], timeline: [], evidence: [
    { link: "https://x.com/clue", source: "X · clue", grade: "A", publishedAt: "2026-08-08", supports: "线索" },
    { link: "https://media.example/mixed", source: "Industry Media", grade: "B", publishedAt: "2026-08-08", supports: "发布" },
  ] });
  const store: EventStore = { updatedAt: "2026-08-08", events: [
    discoveryAndPublic,
    makeEvent({ id: "discovery", evidence: [{ link: "https://news.google.com/clue", source: "Google News", grade: "A", publishedAt: "2026-08-08", supports: "线索" }] }),
    makeEvent({ id: "stale", lastUpdatedAt: "2026-08-08", evidence: [{ link: "https://example.com/stale", source: "Official", grade: "A", publishedAt: "2026-06-01", supports: "旧事件" }] }),
    makeEvent({ id: "future", lastUpdatedAt: "2026-08-08", evidence: [{ link: "https://example.com/future", source: "Official", grade: "A", publishedAt: "2026-08-09", supports: "未来日期" }] }),
    makeEvent({ id: "invalid", lastUpdatedAt: "2026-08-08", evidence: [{ link: "https://example.com/invalid", source: "Official", grade: "A", publishedAt: "not-a-date", supports: "无效日期" }] }),
  ] };
  const dashboard = buildDashboard(store, [], [], new Date("2026-08-08"));
  assert.deepEqual(dashboard.topSignals, []);
  assert.deepEqual(dashboard.developingSignals.map((item) => item.entity), ["MixedCo"]);
  assert.equal(dashboard.developingSignals[0]?.evidenceGrade, "B");
  assert.equal(dashboard.developingSignals[0]?.verificationStatus, "正在发生");
  assert.equal(dashboard.developingSignals[0]?.link, "https://media.example/mixed");
});

test("links a signal to its strongest public evidence instead of evidence array order", () => {
  const event = makeEvent({ evidence: [
    { link: "https://media.example/report", source: "Industry Media", grade: "B", publishedAt: "2026-08-08", supports: "融资" },
    { link: "https://example.com/official", source: "Example 官网", grade: "A", publishedAt: "2026-08-08", supports: "融资" },
  ], lastUpdatedAt: "2026-08-08" });
  const dashboard = buildDashboard({ updatedAt: "2026-08-08", events: [event] }, [], [], new Date("2026-08-08"));
  assert.equal(dashboard.topSignals[0]?.evidenceGrade, "A");
  assert.equal(dashboard.topSignals[0]?.link, "https://example.com/official");
  assert.equal(dashboard.topSignals[0]?.source, "Example 官网");
});

test("company momentum counts only public signals inside the rolling window", () => {
  const companies = [
    { name: "ActiveCo", region: "中国", stage: "成长公司" as const, routes: ["VLA 与具身模型" as const], thesis: "具身模型", officialUrl: "https://active.example" },
    { name: "QuietCo", region: "北美", stage: "创业公司" as const, routes: ["VLA 与具身模型" as const], thesis: "具身模型", officialUrl: "https://quiet.example" },
  ];
  const store: EventStore = { updatedAt: "2026-08-08", events: [
    makeEvent({ id: "active", title: "ActiveCo 发布新产品", primaryEntity: "ActiveCo", entities: ["ActiveCo"], type: "产品发布", routes: ["VLA 与具身模型"], lastUpdatedAt: "2026-08-07", facts: ["ActiveCo 发布新产品并公开技术能力。"] }),
    makeEvent({ id: "quiet-old", title: "QuietCo 曾发布产品", primaryEntity: "QuietCo", entities: ["QuietCo"], type: "产品发布", routes: ["VLA 与具身模型"], lastUpdatedAt: "2026-08-08", facts: ["QuietCo 曾发布可核验产品。"], evidence: [{ link: "https://quiet.example/old", source: "QuietCo 官网", grade: "A", publishedAt: "2026-05-01", supports: "旧产品" }] }),
  ] };
  const dashboard = buildDashboard(store, companies, [], new Date("2026-08-08"));
  assert.equal(dashboard.companyRadar[0]?.name, "ActiveCo");
  assert.equal(dashboard.companyRadar[0]?.recentSignals, 1);
  assert.equal(dashboard.companyRadar[1]?.recentSignals, 0);
  assert.equal(dashboard.companyRadar[1]?.momentumLabel, "长期跟踪");
});

test("never treats route overlap as adoption and only links explicit verified research evidence", () => {
  const companies = [
    { name: "LeaderCo", region: "北美", stage: "成长公司" as const, routes: ["VLA 与具身模型" as const], thesis: "VLA", officialUrl: "https://leader.example" },
    { name: "FollowerCo", region: "中国", stage: "创业公司" as const, routes: ["VLA 与具身模型" as const], thesis: "VLA", officialUrl: "https://follower.example" },
  ];
  const leaderEvent = makeEvent({ id: "leader", title: "LeaderCo 完成客户部署", primaryEntity: "LeaderCo", entities: ["LeaderCo"], type: "部署案例", routes: ["VLA 与具身模型"], lastUpdatedAt: "2026-08-08", facts: ["LeaderCo 已在客户现场完成机器人部署。"] });
  const hardwarePaper = { ...article, id: "hardware", title: "Dexterous humanoid hardware", titleZh: "灵巧人形机器人硬件", summaryZh: "论文介绍人形机器人本体与灵巧操作硬件。实验在真实机器人上完成基准测试。", tags: ["humanoid"] };
  const relations = buildResearchIndustryRelationEdges([article, hardwarePaper], companies, [{
    paperId: article.id,
    companyId: researchIndustryCompanyId(companies[0]!),
    relationType: "code_or_model_adoption",
    url: "https://leader.example/research-adoption",
    source: "LeaderCo 官网",
    grade: "A",
    publishedAt: "2026-08-07",
    supports: "LeaderCo 官方说明产品采用该论文公开的方法。",
  }], { now: new Date("2026-08-08") });
  const dashboard = buildDashboard({ updatedAt: "2026-08-08", events: [leaderEvent] }, companies, [article, hardwarePaper], new Date("2026-08-08"), { researchIndustryEdges: relations.edges });
  assert.equal(dashboard.researchGraph[0]?.route, "VLA 与具身模型");
  assert.deepEqual(dashboard.researchGraph[0]?.companies, ["LeaderCo"]);
  assert.match(dashboard.researchGraph[0]?.connection ?? "", /已核验 1 条/);
  assert.equal(dashboard.researchGraph[1]?.route, "本体与硬件");
  assert.deepEqual(dashboard.researchGraph[1]?.companies, []);
  assert.match(dashboard.researchGraph[1]?.connection ?? "", /暂无已证实产业关联/);
});

test("uses occurrence or evidence publication date instead of ingestion time", () => {
  const older = makeEvent({
    id: "older-ingested-late", title: "OlderCo 完成部署", primaryEntity: "OlderCo", entities: ["OlderCo"], type: "部署案例",
    lastUpdatedAt: "2026-08-08", lastVerifiedAt: "2026-08-08", facts: ["OlderCo 在真实客户现场完成机器人部署。"],
    evidence: [{ link: "https://older.example", source: "OlderCo 官网", grade: "A", publishedAt: "2026-07-20", supports: "部署" }],
  });
  const newer = makeEvent({
    id: "newer-ingested-early", title: "NewerCo 发布产品", primaryEntity: "NewerCo", entities: ["NewerCo"], type: "产品发布",
    lastUpdatedAt: "2026-08-01", lastVerifiedAt: "2026-08-09", facts: ["NewerCo 正式发布具身机器人产品。"],
    evidence: [{ link: "https://newer.example", source: "NewerCo 官网", grade: "A", publishedAt: "2026-08-06", supports: "发布" }],
  });
  const dashboard = buildDashboard({ updatedAt: "2026-08-09", events: [older, newer] }, [], [], new Date("2026-08-09"));
  assert.deepEqual(dashboard.industry.map((item) => item.title), ["NewerCo 发布产品", "OlderCo 完成部署"]);
  assert.equal(dashboard.industry[0]?.date, "2026-08-06");
  assert.equal(dashboard.industry[0]?.isThisWeek, true);
  assert.equal(dashboard.industry[0]?.lastVerifiedAt, "2026-08-09T00:00:00.000Z");
  assert.equal(dashboard.industry[1]?.date, "2026-07-20");
  assert.equal(dashboard.industry[1]?.isThisWeek, false);
});

test("keeps 30-day verified events visible when the current week is empty", () => {
  const olderFunding = makeEvent({
    id: "funding-older-week", lastUpdatedAt: "2026-08-09", lastVerifiedAt: "2026-08-09",
    evidence: [{ link: "https://example.com/funding", source: "Example 官网", grade: "A", publishedAt: "2026-07-25", supports: "融资" }],
  });
  const dashboard = buildDashboard({ updatedAt: "2026-08-09", events: [olderFunding] }, [], [], new Date("2026-08-09"));
  assert.equal(dashboard.capital.length, 1);
  assert.equal(dashboard.capital[0]?.date, "2026-07-25");
  assert.equal(dashboard.capital[0]?.isThisWeek, false);
});

test("publishes two independent B sources as corroborated, not developing", () => {
  const event = makeEvent({
    id: "corroborated", title: "DualCo 发布机器人产品", primaryEntity: "DualCo", entities: ["DualCo"], type: "产品发布",
    facts: ["DualCo 发布了面向仓储场景的机器人产品。"], timeline: [],
    evidence: [
      { link: "https://media-one.example/story", source: "媒体一", grade: "B", publishedAt: "2026-08-08", supports: "发布" },
      { link: "https://media-two.example/report", source: "媒体二", grade: "B", publishedAt: "2026-08-08", supports: "发布" },
    ],
  });
  const dashboard = buildDashboard({ updatedAt: "2026-08-09", events: [event] }, [], [], new Date("2026-08-09"));
  assert.equal(dashboard.confirmedSignals[0]?.verificationStatus, "多方证实");
  assert.equal(dashboard.confirmedSignals[0]?.evidenceCount, 2);
  assert.deepEqual(dashboard.developingSignals, []);
});

test("never exposes subject conflicts or financing with an unidentified entity", () => {
  const conflicted = makeEvent({
    id: "conflict", title: "ConflictCo 完成融资", primaryEntity: "ConflictCo", entities: ["ConflictCo"],
    openQuestions: ["不同来源的金额冲突"], funding: { entityStatus: "已确认", investors: [] },
    facts: ["ConflictCo 被报道完成融资。"], evidence: [{ link: "https://media.example/conflict", source: "媒体", grade: "B", publishedAt: "2026-08-08", supports: "融资" }],
  });
  const unidentified = makeEvent({
    id: "unknown-funding", title: "某机器人公司完成融资", primaryEntity: "某机器人公司", entities: ["某机器人公司"],
    funding: { entityStatus: "待识别", investors: [] }, facts: ["某机器人公司被报道完成融资。"],
    evidence: [{ link: "https://media.example/unknown", source: "媒体", grade: "B", publishedAt: "2026-08-08", supports: "融资" }],
  });
  const dashboard = buildDashboard({ updatedAt: "2026-08-09", events: [conflicted, unidentified] }, [], [], new Date("2026-08-09"));
  assert.deepEqual(dashboard.confirmedSignals, []);
  assert.deepEqual(dashboard.developingSignals, []);
  assert.equal(dashboard.stats.events, 0);
});

test("keeps every candidate verification record out of the public dashboard", () => {
  const baseRecord = {
    id: "verify-one", companyName: "FreshCo", kind: "投融资" as const, title: "FreshCo 完成新一轮融资", status: "等待重试" as const,
    publicStatus: "developing" as const, confidenceScore: 30, firstSeenAt: "2026-08-08T00:00:00Z", lastAttemptAt: "2026-08-09T00:00:00Z",
    attempts: 1, evidenceHash: "hash", facts: { amount: "1000 万美元", eventDate: "2026-08-08" },
    fieldVerification: {
      amount: { status: "single-source" as const, value: "1000 万美元", independentSourceCount: 1, evidenceArticleIds: ["a"] },
      round: { status: "unknown" as const, independentSourceCount: 0, evidenceArticleIds: [] },
      eventDate: { status: "single-source" as const, value: "2026-08-08", independentSourceCount: 1, evidenceArticleIds: ["a"] },
    }, conflicts: [], failureReasons: ["尚缺一条 A 级一手证据，或两个独立 B 级来源"],
    evidence: [{ articleId: "a", link: "https://media.example/fresh", source: "权威媒体", grade: "B" as const, sourceClass: "authoritative-media" as const, score: 30, independentOrigin: "media.example", publishedAt: "2026-08-08T00:00:00Z", title: "FreshCo 完成融资", amount: "1000 万美元" }],
  };
  const unresolved = { ...baseRecord, id: "verify-unknown", companyName: "待识别公司" };
  const conflicting = { ...baseRecord, id: "verify-conflict", companyName: "ConflictCo", conflicts: ["金额冲突"], publicStatus: "candidate" as const };
  const dashboard = buildDashboard({ updatedAt: "2026-08-09", events: [] }, [], [], new Date("2026-08-09"), { candidateVerificationRecords: [baseRecord, unresolved, conflicting] });
  assert.deepEqual(dashboard.developingSignals, []);
  assert.deepEqual(dashboard.confirmedSignals, []);
  assert.deepEqual(dashboard.topSignals, []);
});

test("requires an EventStore promotion even for an official candidate record", () => {
  const officialRecord = {
    id: "verify-official", companyName: "OfficialCo", companyEntityId: "official-co", kind: "产品发布" as const,
    title: "OfficialCo 发布新一代具身机器人", status: "可人工审核" as const,
    publicStatus: "confirmed" as const, publicationState: "confirmed" as const,
    confidenceScore: 50, independentEvidenceCount: 1, impactScore: 52,
    discoveryOrigins: [], enrichmentAttempts: [], firstSeenAt: "2026-08-08T00:00:00Z", lastAttemptAt: "2026-08-09T00:00:00Z",
    attempts: 1, evidenceHash: "official-hash", facts: { eventDate: "2026-08-08" },
    fieldVerification: {
      amount: { status: "unknown" as const, independentSourceCount: 0, evidenceArticleIds: [] },
      round: { status: "unknown" as const, independentSourceCount: 0, evidenceArticleIds: [] },
      eventDate: { status: "confirmed" as const, value: "2026-08-08", independentSourceCount: 1, evidenceArticleIds: ["official"] },
    },
    conflicts: [], failureReasons: [],
    evidence: [{ articleId: "official", link: "https://official.example/product", source: "OfficialCo 官网", grade: "A" as const,
      sourceClass: "company-official" as const, score: 50, independentOrigin: "official.example", publishedAt: "2026-08-08T00:00:00Z",
      title: "OfficialCo 发布新一代具身机器人", eventDate: "2026-08-08" }],
  };
  const dashboard = buildDashboard({ updatedAt: "2026-08-09", events: [] }, [], [], new Date("2026-08-09"), { candidateVerificationRecords: [officialRecord] });
  assert.deepEqual(dashboard.confirmedSignals, []);
  assert.deepEqual(dashboard.topSignals, []);
  assert.deepEqual(dashboard.developingSignals, []);
});

test("passes the public watchlist through without changing legacy company surfaces", () => {
  const watchlist: WatchlistPublicView = {
    week: "2026-W34",
    snapshotVersion: 1,
    methodologyVersion: "method-v1",
    lastSuccessfulAt: "2026-08-17T01:00:00.000Z",
    companyIds: [],
    forwardRadar: [],
    validatedMomentum: [],
    changes: [],
  };

  const withWatchlist = buildDashboard({ updatedAt: watchlist.lastSuccessfulAt, events: [] }, [], [], new Date(watchlist.lastSuccessfulAt), { watchlist });
  assert.strictEqual(withWatchlist.watchlist, watchlist);
  assert.ok(Array.isArray(withWatchlist.companyRadar));
  assert.ok(withWatchlist.companyBoards);

  const legacy = buildDashboard({ updatedAt: watchlist.lastSuccessfulAt, events: [] }, [], [], new Date(watchlist.lastSuccessfulAt));
  assert.equal(legacy.watchlist, undefined);
  assert.ok(Array.isArray(legacy.companyRadar));
  assert.ok(legacy.companyBoards);
});

test("copies compatibility projections from the validated decision artifact without reranking", () => {
  const generatedAt = "2026-08-17T01:00:00.000Z";
  const decisionProducts: DecisionProductArtifact = {
    schemaVersion: 1,
    generatedAt,
    periodStart: "2026-08-10",
    topSignals: [],
    companyCards: [],
    researchPassports: [],
    subscriptions: { generatedAt, entries: [] },
  };
  const dashboard = buildDashboard({ updatedAt: generatedAt, events: [] }, [], [], new Date(generatedAt), { decisionProducts });
  assert.strictEqual(dashboard.decisionProducts, decisionProducts);
  assert.deepEqual(dashboard.topSignals.map((item) => item.signalId), decisionProducts.topSignals.map((item) => item.signalId));
  assert.deepEqual(dashboard.companyRadar.map((item) => item.cardId), decisionProducts.companyCards.map((item) => item.cardId));
  assert.deepEqual(dashboard.research.map((item) => item.passportId), decisionProducts.researchPassports.map((item) => item.passportId));
});
