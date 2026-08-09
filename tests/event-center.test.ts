import assert from "node:assert/strict";
import test from "node:test";
import { buildCompanyDossiers, buildRouteCompetitionMap, buildRouteIndex, formatCompanyDossiers, formatCompanyRadar, formatIndustryMap, formatRecentEvents, formatResearchUpdates, routeCorrections, upsertEvents } from "../src/event-center.js";
import type { Article } from "../src/types.js";

function article(overrides: Partial<Article> = {}): Article {
  const now = new Date("2026-08-01T00:00:00.000Z");
  return { id: "gemini", title: "Google DeepMind announces Gemini Robotics product launch", titleZh: "Google DeepMind 发布 Gemini Robotics", summaryZh: "官方发布新的机器人模型。该模型面向机器人任务。", link: "https://deepmind.google/gemini-robotics", publishedAt: now, fetchedAt: now, source: "Google DeepMind Blog", sourceWeight: 10, excerpt: "Gemini Robotics vision-language-action robot launch", kind: "产品发布", tags: ["产品"], ...overrides };
}

test("creates an evidence-backed canonical event from a qualified article", () => {
  const store = upsertEvents(undefined, [article()], new Date("2026-08-01T01:00:00.000Z"));
  assert.equal(store.events.length, 1);
  assert.equal(store.events[0].status, "已确证");
  assert.deepEqual(store.events[0].entities, ["Google DeepMind"]);
  assert.match(formatRecentEvents(store.events), /\[Google DeepMind 发布 Gemini Robotics\]/);
  assert.match(formatRecentEvents(store.events), /本期关键进展/);
  assert.match(formatRecentEvents(store.events, new Date("2026-08-02")), /数据刷新至 2026-08-02/);
  assert.match(formatRecentEvents(store.events, new Date("2026-08-02")), /最近确证产业事件 2026-08-01/);
  assert.doesNotMatch(formatRecentEvents(store.events), /为什么值得看/);
});

test("keeps generic funding labels out of the public industry feed", () => {
  const store = upsertEvents(undefined, [article({ title: "机器人公司完成新一轮融资", titleZh: "机器人公司完成新一轮融资", kind: "投融资" })]);
  assert.doesNotMatch(formatRecentEvents(store.events), /机器人公司完成新一轮融资/);
});

test("keeps discovery-only sources out of public event and company surfaces", () => {
  const lead = article({ source: "Google News · Robotics", sourceWeight: 8, sourceTier: "线索发现层" });
  const store = upsertEvents(undefined, [lead]);
  assert.doesNotMatch(formatRecentEvents(store.events), /Gemini Robotics/);
  assert.doesNotMatch(formatCompanyRadar([], store.events), /Gemini Robotics/);
});

test("company radar uses occurrence time for its 30-day window and weekly-new badge", () => {
  const old = upsertEvents(undefined, [article()], new Date("2026-08-01T16:00:00Z"));
  const current = upsertEvents(old, [article({ id: "weekly", link: "https://deepmind.google/weekly", titleZh: "Google DeepMind 发布本周机器人模型", title: "Google DeepMind launches weekly robotics model", publishedAt: new Date("2026-08-04T07:00:00Z") })], new Date("2026-08-04T08:00:00Z"));
  const output = formatCompanyRadar([], current.events, new Date("2026-08-08T03:00:00Z"));
  assert.match(output, /发布本周机器人模型/);
  assert.doesNotMatch(output, /Google DeepMind 发布 Gemini Robotics/);
  assert.match(output, /本周新增/);
});

test("keeps the latest successful research cards visible when arXiv is temporarily unavailable", () => {
  const output = formatResearchUpdates([article({ title: "RoboBRIDGE", titleZh: "RoboBRIDGE：面向真实机器人的稳健策略框架" })], "2026-08-01");
  assert.match(output, /arXiv 暂未刷新/);
  assert.match(output, /最近一次成功抓取（2026-08-01）/);
});

test("connects companies, routes and only attributable capital evidence", () => {
  const store = upsertEvents(undefined, [article({
    title: "LeRobot v0.6 release",
    titleZh: "Google DeepMind 完成新一轮融资",
    excerpt: "LeRobot dataset training and VLA policy release",
    kind: "投融资",
    link: "https://example.com/lerobot-v06",
  })]);
  const companies = [{ name: "Google DeepMind", region: "北美", stage: "平台公司" as const, routes: ["VLA 与具身模型" as const], thesis: "VLA 模型", officialUrl: "https://example.com/deepmind" }];
  const map = formatIndustryMap(store.events, companies);
  assert.match(map, /物理 AI 技术路线竞争图谱/);
  assert.match(map, /竞争总览/);
  assert.match(map, /本路线领先信号/);
  assert.match(map, /证据不足/);
  assert.match(map, /Google DeepMind/);
  assert.match(map, /完成新一轮融资/);
  assert.doesNotMatch(map, /最新可验证信号/);
});

test("keeps companies without route evidence in a compact watchlist", () => {
  const active = { name: "Active Robotics", region: "北美", stage: "创业公司" as const, routes: ["VLA 与具身模型" as const], thesis: "通用操作模型", officialUrl: "https://active.example" };
  const quiet = { name: "Quiet Robotics", region: "中国", stage: "创业公司" as const, routes: ["VLA 与具身模型" as const], thesis: "具身策略", officialUrl: "https://quiet.example" };
  const store = upsertEvents(undefined, [article({ title: "Active Robotics raises $10M", titleZh: "Active Robotics 完成 1000 万美元融资", kind: "投融资", summaryZh: "Active Robotics 完成 1000 万美元融资。资金用于机器人策略研发。" })], new Date(), [active, quiet]);
  const map = formatIndustryMap(store.events, [active, quiet]);
  assert.match(map, /本路线领先信号/);
  assert.match(map, /持续跟踪（尚缺可归属的资本或验证事件/);
  assert.match(map, /Quiet Robotics/);
});

test("makes capital uncertainty explicit and records route-stage corrections", () => {
  const company = { name: "Google DeepMind", region: "北美", stage: "平台公司" as const, routes: ["VLA 与具身模型" as const], thesis: "机器人模型", officialUrl: "https://deepmind.google" };
  const first = buildRouteCompetitionMap(upsertEvents(undefined, [article()], new Date(), [company]).events, [company], new Date("2026-08-01"));
  const before = first.routes.find((item) => item.route === "VLA 与具身模型")!.companies[0]!;
  assert.equal(before.capitalStatus, "证据不足");
  assert.equal(before.validationStage, "原型与演示");
  const funded = upsertEvents(undefined, [article({ id: "fund", kind: "投融资", title: "Google DeepMind Gemini Robotics VLA raises $12M funding", titleZh: "Google DeepMind 的 Gemini Robotics VLA 完成 1200 万美元融资", summaryZh: "Google DeepMind 的 Gemini Robotics VLA 完成 1200 万美元融资。该资金用于机器人模型研发。" })], new Date(), [company]);
  const next = buildRouteCompetitionMap(funded.events, [company], new Date("2026-08-02"));
  assert.equal(next.routes.find((item) => item.route === "VLA 与具身模型")!.companies[0]!.capitalStatus, "已证实");
  assert.match(routeCorrections(first, next)[0]?.detail ?? "", /已证实/);
  assert.match(formatIndustryMap(funded.events, [company]), /证据不足（不代表未融资）|已证实/);
  assert.match(formatIndustryMap(funded.events, [company]), /技术路线竞争图谱/);
});

test("keeps a complete Chinese research card readable", () => {
  const output = formatResearchUpdates([article({ title: "RoboBRIDGE: Modular robot agents", titleZh: "RoboBRIDGE：稳健机器人智能体框架", summaryZh: "模块化框架将策略组织为具备故障恢复能力的真实机器人智能体。它在真实机器人任务中验证恢复能力。" })]);
  assert.match(output, /RoboBRIDGE：稳健机器人智能体框架/);
  assert.match(output, /模块化框架/);
  assert.doesNotMatch(output, /物理 AI 研究论文/);
});

test("prioritizes a paper from a recognized physical AI lab when other signals tie", () => {
  const newer = article({ title: "Generic VLA manipulation", titleZh: "通用 VLA 操作策略", summaryZh: "提出机器人操作策略。该方法用于操作任务。", publishedAt: new Date("2026-08-02"), authors: ["Unknown Author"] });
  const deepmind = article({ id: "deepmind-paper", title: "Robotics world model", titleZh: "机器人世界模型", summaryZh: "提出面向真实机器人推理的世界模型。该模型用于任务规划。", publishedAt: new Date("2026-08-01"), authors: ["Danijar Hafner"] });
  const output = formatResearchUpdates([newer, deepmind]);
  assert.ok(output.indexOf("机器人世界模型") < output.indexOf("通用 VLA 操作策略"));
  assert.match(output, /重点关注：Google DeepMind/);
});

test("does not publish half-translated research cards", () => {
  const output = formatResearchUpdates([article({ titleZh: "Only English", summaryZh: "暂未生成中文摘要，请阅读原文。" })]);
  assert.match(output, /正在完成中文解读/);
  assert.doesNotMatch(output, /Only English/);
});

test("does not publish an English source title disguised as a Chinese research card", () => {
  const output = formatResearchUpdates([article({
    title: "Robots Learn from World Models",
    titleZh: "Robots Learn from World Models",
    summaryZh: "论文研究机器人策略学习。实验在操作任务中完成验证。",
  })]);
  assert.match(output, /正在完成中文解读/);
  assert.doesNotMatch(output, /Robots Learn from World Models/);
});

test("does not assign a company merely mentioned in article body", () => {
  const store = upsertEvents(undefined, [article({
    title: "Agility Robotics expands its deployment",
    titleZh: "Agility Robotics 扩大部署",
    excerpt: "The work takes place near Tesla and is unrelated to Optimus.",
  })]);
  assert.equal(store.events[0].primaryEntity, "Agility Robotics");
  assert.deepEqual(store.events[0].entities, ["Agility Robotics"]);
  assert.ok(store.events[0].mentionedEntities?.includes("Tesla"));
});

test("merges multilingual coverage of the same financing event", () => {
  const now = new Date("2026-08-01T01:00:00.000Z");
  const companies = [{ name: "Humanoid", aliases: ["humanoid"], region: "欧洲", stage: "创业公司" as const, routes: ["本体与硬件" as const], thesis: "人形机器人", officialUrl: "https://humanoid.example" }];
  const first = upsertEvents(undefined, [article({ title: "Humanoid Raises $152 Million at $1.35 Billion Valuation", titleZh: undefined, kind: "投融资" })], now, companies);
  const second = upsertEvents(first, [article({ id: "humanoid-zh", title: "Humanoid完成1.52亿美元融资，投后估值13.5亿美元", titleZh: undefined, link: "https://example.com/humanoid-zh", kind: "投融资" })], now, companies);
  assert.equal(second.events.length, 1);
  assert.equal(second.events[0].evidence.length, 2);
});

test("stores structured funding facts and never calls an unknown subject an industry company", () => {
  const known = { name: "Nova Robotics", aliases: ["nova robotics"], region: "北美", stage: "创业公司" as const, routes: ["本体与硬件" as const], thesis: "仓储机器人", officialUrl: "https://novarobotics.example" };
  const knownStore = upsertEvents(undefined, [article({
    title: "Nova Robotics raises $12M Seed funding",
    titleZh: "Nova Robotics 完成 1200 万美元种子轮融资",
    summaryZh: "Nova Robotics 完成 1200 万美元种子轮融资，用于仓储机器人研发。",
    kind: "投融资",
  })], new Date(), [known]);
  assert.equal(knownStore.events[0].primaryEntity, "Nova Robotics");
  assert.equal(knownStore.events[0].funding?.entityStatus, "已确认");
  assert.match(knownStore.events[0].funding?.round ?? "", /seed|种子/i);
  assert.match(knownStore.events[0].funding?.amount ?? "", /12/);
  const unknownStore = upsertEvents(undefined, [article({ title: "创业机器人公司完成 500 万美元种子轮融资", titleZh: "创业机器人公司完成 500 万美元种子轮融资", summaryZh: "一家创业机器人公司完成 500 万美元种子轮融资，用于具身机器人研发。", kind: "投融资" })]);
  assert.match(formatCompanyRadar([], unknownStore.events), /待识别公司/);
  assert.doesNotMatch(formatCompanyRadar([], unknownStore.events), /行业公司/);
});

test("builds company dossiers and route indexes from attributable events", () => {
  const company = { name: "Google DeepMind", region: "北美", stage: "平台公司" as const, routes: ["VLA 与具身模型" as const], thesis: "机器人模型", officialUrl: "https://deepmind.google" };
  const store = upsertEvents(undefined, [article()], new Date(), [company]);
  const dossiers = buildCompanyDossiers([company], store.events);
  const routes = buildRouteIndex([company], store.events);
  assert.equal(dossiers.length, 1);
  assert.equal(dossiers[0].eventIds.length, 1);
  assert.equal(dossiers[0].productsAndDeployments.length, 1);
  assert.equal(dossiers[0].identityEvidence[0]?.link, company.officialUrl);
  assert.equal(dossiers[0].capitalStatus, "证据不足");
  assert.equal(dossiers[0].validationStage, "原型与演示");
  assert.deepEqual(routes.find((item) => item.route === "VLA 与具身模型")?.companies, ["Google DeepMind"]);
  assert.match(formatCompanyDossiers(dossiers), /Google DeepMind/);
  assert.match(formatCompanyDossiers(dossiers), /产品 \/ 部署/);
  assert.match(formatCompanyDossiers(dossiers), /不代表未融资/);
});

test("appends new evidence to an existing event instead of duplicating it", () => {
  const first = upsertEvents(undefined, [article()], new Date("2026-08-01T01:00:00.000Z"));
  const second = upsertEvents(first, [article({ id: "coverage", link: "https://spectrum.ieee.org/gemini-robotics", source: "IEEE Spectrum", sourceWeight: 7, title: "Google DeepMind Gemini Robotics product launch" })], new Date("2026-08-02T01:00:00.000Z"));
  assert.equal(second.events.length, 1);
  assert.equal(second.events[0].evidence.length, 2);
  assert.equal(second.events[0].timeline.length, 2);
});

test("reprocessing identical evidence does not create a false material update", () => {
  const first = upsertEvents(undefined, [article({ publishedAt: new Date("2026-07-30T09:00:00Z") })], new Date("2026-08-01T01:00:00Z"));
  const second = upsertEvents(first, [article({ publishedAt: new Date("2026-07-30T09:00:00Z") })], new Date("2026-08-09T01:00:00Z"));
  assert.equal(second.events[0].occurredAt, "2026-07-30T09:00:00.000Z");
  assert.equal(second.events[0].lastMaterialChangeAt, "2026-08-01T01:00:00.000Z");
  assert.equal(second.events[0].lastUpdatedAt, "2026-08-01T01:00:00.000Z");
  assert.equal(second.events[0].lastVerifiedAt, "2026-08-09T01:00:00.000Z");
});

test("new corroboration refreshes evidence and verification clocks without rewriting occurrence", () => {
  const first = upsertEvents(undefined, [article({ publishedAt: new Date("2026-07-30T09:00:00Z") })], new Date("2026-08-01T01:00:00Z"));
  const second = upsertEvents(first, [article({ link: "https://spectrum.ieee.org/gemini-robotics", source: "IEEE Spectrum", sourceWeight: 7, publishedAt: new Date("2026-08-02T09:00:00Z") })], new Date("2026-08-03T01:00:00Z"));
  assert.equal(second.events[0].occurredAt, "2026-07-30T09:00:00.000Z");
  assert.equal(second.events[0].lastEvidenceAt, "2026-08-02T09:00:00.000Z");
  assert.equal(second.events[0].lastVerifiedAt, "2026-08-03T01:00:00.000Z");
  assert.equal(second.events[0].lastMaterialChangeAt, "2026-08-01T01:00:00.000Z");
});

test("rejects arXiv papers even when a legacy classifier calls them a product launch", () => {
  const store = upsertEvents(undefined, [article({ source: "arXiv Robotics", link: "https://arxiv.org/abs/2608.00001", kind: "产品发布" })]);
  assert.equal(store.events.length, 0);
});

test("removes legacy discovery-only and unnamed records from the public event store", () => {
  const seed = upsertEvents(undefined, [article()], new Date("2026-08-01T01:00:00Z"));
  const valid = seed.events[0];
  const polluted = {
    ...valid,
    id: "legacy-discovery-only",
    primaryEntity: undefined,
    entities: [],
    evidence: [{
      link: "https://news.google.com/rss/articles/lead",
      source: "Google News · Robotics Capital",
      grade: "B" as const,
      publishedAt: "2026-08-01T00:00:00.000Z",
      supports: "融资线索",
    }],
  };
  const cleaned = upsertEvents({ updatedAt: seed.updatedAt, events: [valid, polluted] }, [], new Date("2026-08-09T01:00:00Z"));
  assert.deepEqual(cleaned.events.map((event) => event.id), [valid.id]);
});

test("public dates use occurrence time and 30-day radar labels do not imply ingestion date", () => {
  const store = upsertEvents(undefined, [article({ publishedAt: new Date("2026-07-16T09:00:00Z") })], new Date("2026-08-01T01:00:00Z"));
  const feed = formatRecentEvents(store.events, new Date("2026-08-09T00:00:00Z"));
  const radar = formatCompanyRadar([], store.events, new Date("2026-08-09T00:00:00Z"));
  assert.match(feed, /事件 07-16/);
  assert.match(feed, /最近确证产业事件 2026-07-16/);
  assert.doesNotMatch(feed, /事件 08-01/);
  assert.match(radar, /近 30 天产品 \/ 部署/);
  assert.match(radar, /事件 07-16/);
  assert.doesNotMatch(radar, /本周新增/);
});
