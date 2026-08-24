import assert from "node:assert/strict";
import test from "node:test";
import { preferKnownGoodArticles, recoverPublishedResearchRecords } from "../src/publication.js";
import { materializeResearchDecisionCard } from "../src/research-decision-card.js";
import { validateDecisionProductPublication, validatePublication, validatePublicationArtifacts } from "../src/runtime/validation.js";
import { stableDecisionId, type DecisionProductArtifact } from "../src/decision-products/contracts.js";
import { buildDecisionFeedManifest, renderDecisionFeed } from "../src/decision-products/subscriptions.js";
import { formatDecisionProductReadme } from "../src/decision-products/markdown.js";
import type { WatchlistPublicView } from "../src/watchlist/public-view.js";
import type { Article, DailyArchive, EventStore, ResearchRecord, RunHistory, RunManifest } from "../src/types.js";

const article = (id: string, complete = true): Article => ({
  id, title: `Source ${id}`, link: `https://example.com/${id}`, publishedAt: new Date("2026-08-08T00:00:00Z"), fetchedAt: new Date("2026-08-08T01:00:00Z"), source: "Official", sourceWeight: 10, excerpt: "source fact", tags: [],
  titleZh: complete ? `中文标题${id}` : `Source ${id}`, summaryZh: complete ? "这是经过核验的中文事实简介。" : "暂未生成中文摘要，请阅读原文。",
});

test("last known good copy prevents an LLM outage from degrading a public card", () => {
  const restored = preferKnownGoodArticles([article("one", false)], [article("one", true)]);
  assert.equal(restored[0].titleZh, "中文标题one");
  assert.equal(restored[0].summaryZh, "这是经过核验的中文事实简介。");
});

test("publication validation rejects placeholders before any public swap", () => {
  const archive: DailyArchive = { date: "2026-08-08", articles: [article("bad", false)] };
  const events: EventStore = { updatedAt: "2026-08-08", events: [] };
  assert.throws(() => validatePublication({ archive, events, research: [], researchDecisionCards: [], readme: "README", expectedDate: "2026-08-08" }), /缺少完整中文事实简介/);
});

test("publication validation blocks a research-card quality regression", () => {
  const archive: DailyArchive = { date: "2026-08-08", articles: [article("ok")] };
  const events: EventStore = { updatedAt: "2026-08-08", events: [] };
  const record = (id: string): ResearchRecord => ({ id, article: article(id), firstSeenAt: "", lastCheckedAt: "", factHash: id, status: "新论文", appearances: 1, evidenceTags: [], authorityLabels: [], changes: [] });
  assert.throws(() => validatePublication({ archive, events, research: [record("one")], researchDecisionCards: [], readme: "README", expectedDate: "2026-08-08", previousCompleteResearchCount: 6 }), /研究卡从 6 篇倒退到 1 篇/);
});

test("publication validation rejects a single-B event labeled as confirmed", () => {
  const archive: DailyArchive = { date: "2026-08-08", articles: [article("ok")] };
  const events: EventStore = { updatedAt: "2026-08-08", events: [{
    id: "single-b", title: "Example 宣布客户试点", type: "部署案例", entities: ["Example"], primaryEntity: "Example",
    routes: ["部署与商业化"], status: "已确证", firstSeenAt: "2026-08-08T00:00:00Z", lastUpdatedAt: "2026-08-08T01:00:00Z",
    lastVerifiedAt: "2026-08-08T01:00:00Z", facts: ["Example 宣布客户试点。"], openQuestions: [], timeline: [],
    evidence: [{ link: "https://media.example/report", source: "Industry Media", grade: "B", publishedAt: "2026-08-08T00:00:00Z", supports: "试点" }],
  }] };
  assert.throws(() => validatePublication({ archive, events, research: [], researchDecisionCards: [], readme: "README", expectedDate: "2026-08-08" }), /违反公开事实契约/);
});

test("publication requires one eligible decision card for every public research record", () => {
  const published = {
    ...article("paper"), source: "arXiv · Robotics", title: "A Physical AI Paper", titleZh: "物理智能机器人论文",
    summaryZh: "论文提出一种机器人策略。实验在真实机器人基准上完成验证。",
    excerpt: "We evaluate the policy on a real robot benchmark.",
    scholar: { provider: "OpenAlex" as const, workId: "W-paper", citedByCount: 2, isRetracted: false, institutions: ["Example Lab"], authors: [], checkedAt: "2026-08-08T00:00:00Z" },
  };
  const record: ResearchRecord = { id: published.id, article: published, firstSeenAt: "2026-08-08", lastCheckedAt: "2026-08-08", factHash: "paper", status: "新论文", appearances: 1, evidenceTags: ["真实机器人", "基准"], authorityLabels: [], changes: [] };
  const archive: DailyArchive = { date: "2026-08-08", articles: [published] };
  const events: EventStore = { updatedAt: "2026-08-08", events: [] };
  assert.throws(() => validatePublication({ archive, events, research: [record], researchDecisionCards: [], readme: "README", expectedDate: "2026-08-08" }), /缺少研究决策卡/);
  const card = materializeResearchDecisionCard(record, { now: new Date("2026-08-09") });
  assert.equal(card.eligibleForTopResearch, true);
  assert.doesNotThrow(() => validatePublication({ archive, events, research: [record], researchDecisionCards: [card], readme: "README", expectedDate: "2026-08-08" }));
  assert.throws(() => validatePublication({ archive, events, research: [record], researchDecisionCards: [{ ...card, eligibleForTopResearch: false, gates: [{ code: "contradicted-claim", detail: "bad" }] }], readme: "README", expectedDate: "2026-08-08" }), /未通过研究发布门槛/);
});

test("published research archives remain the quality baseline when registry copy regresses", () => {
  const published = { ...article("paper"), source: "arXiv · Robotics", title: "A Physical AI Paper", titleZh: "物理智能机器人论文", summaryZh: "论文提出一种机器人策略。实验在真实机器人基准上完成验证。" };
  const degraded = { ...published, titleZh: "A Physical AI Paper", summaryZh: "暂未生成中文摘要，请阅读原文。" };
  const prior: ResearchRecord = { id: published.id, article: degraded, firstSeenAt: "", lastCheckedAt: "", factHash: "paper", status: "新论文", appearances: 1, evidenceTags: [], authorityLabels: [], changes: [] };
  const recovered = recoverPublishedResearchRecords([{ date: "2026-08-07", articles: [published] }], [prior]);
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0]?.article.titleZh, "物理智能机器人论文");
  assert.match(recovered[0]?.article.summaryZh ?? "", /真实机器人基准/);
});

test("cross-file contract accepts matching archive, manifest and history", () => {
  const archive: DailyArchive = { date: "2026-08-08", articles: [article("ok")], candidates: [], sourceOutcomes: [{ source: "Official", status: "success", fetchedArticles: 1 }], runtimeStatus: [] };
  const manifest: RunManifest = { schemaVersion: 1, runId: "2026-08-08-test", date: archive.date, startedAt: "2026-08-08T00:00:00Z", finishedAt: "2026-08-08T00:01:00Z", status: "success", quality: { publicIndustryItems: 1, publicResearchItems: 0, candidates: 0, sourceFailures: 0 }, services: [], outputs: 3 };
  const history: RunHistory = { schemaVersion: 1, updatedAt: manifest.finishedAt, runs: [manifest] };
  assert.doesNotThrow(() => validatePublicationArtifacts(archive, manifest, history));
});

test("cross-file publication permits an explicit historical day gap while preserving the current receipt", () => {
  const archive: DailyArchive = { date: "2026-08-18", articles: [article("ok")], candidates: [], runtimeStatus: [] };
  const current: RunManifest = { schemaVersion: 1, runId: "2026-08-18-current", date: archive.date, startedAt: "2026-08-18T00:00:00Z", finishedAt: "2026-08-18T00:01:00Z", status: "success", quality: { publicIndustryItems: 1, publicResearchItems: 0, candidates: 0, sourceFailures: 0 }, services: [], outputs: 3 };
  const beforeGap: RunManifest = { ...current, runId: "2026-08-16-prior", date: "2026-08-16", startedAt: "2026-08-16T00:00:00Z", finishedAt: "2026-08-16T00:01:00Z" };
  const history: RunHistory = { schemaVersion: 1, updatedAt: current.finishedAt, runs: [current, beforeGap] };
  assert.doesNotThrow(() => validatePublicationArtifacts(archive, current, history));
});

test("cross-file publication still blocks duplicate ids and invalid history ordering", () => {
  const archive: DailyArchive = { date: "2026-08-18", articles: [article("ok")], candidates: [], runtimeStatus: [] };
  const current: RunManifest = { schemaVersion: 1, runId: "2026-08-18-current", date: archive.date, startedAt: "2026-08-18T00:00:00Z", finishedAt: "2026-08-18T00:01:00Z", status: "success", quality: { publicIndustryItems: 1, publicResearchItems: 0, candidates: 0, sourceFailures: 0 }, services: [], outputs: 3 };
  const duplicate: RunHistory = { schemaVersion: 1, updatedAt: current.finishedAt, runs: [current, { ...current }] };
  assert.throws(() => validatePublicationArtifacts(archive, current, duplicate), /重复 runId/);

  const laterSecond = { ...current, runId: "2026-08-17-later", date: "2026-08-17", startedAt: "2026-08-19T00:00:00Z", finishedAt: "2026-08-19T00:01:00Z" };
  const invalidOrder: RunHistory = { schemaVersion: 1, updatedAt: current.finishedAt, runs: [current, laterSecond] };
  assert.throws(() => validatePublicationArtifacts(archive, current, invalidOrder), /没有按完成时间倒序排列/);
});

test("cross-file contract rejects mismatched counts and service receipts", () => {
  const archive: DailyArchive = { date: "2026-08-08", articles: [article("ok")], candidates: [], runtimeStatus: [{ component: "LLM", status: "成功", attempted: 1, succeeded: 1, failed: 0, detail: "ok" }] };
  const manifest: RunManifest = { schemaVersion: 1, runId: "2026-08-08-test", date: archive.date, startedAt: "2026-08-08T00:00:00Z", finishedAt: "2026-08-08T00:01:00Z", status: "success", quality: { publicIndustryItems: 0, publicResearchItems: 0, candidates: 2, sourceFailures: 0 }, services: [{ component: "LLM", status: "部分降级", attempted: 1, succeeded: 0, failed: 1, detail: "bad" }], outputs: 1 };
  assert.throws(() => validatePublicationArtifacts(archive, manifest), /公开条目计数不一致[\s\S]*候选条目计数[\s\S]*LLM 状态/);
});

test("an empty Top Signals week preserves valid company cards, passports and subscriptions", () => {
  const generatedAt = "2026-08-24T01:00:00Z";
  const artifact: DecisionProductArtifact = {
    schemaVersion: 1, generatedAt, periodStart: "2026-08-18", topSignals: [],
    companyCards: [{
      cardId: stableDecisionId("company", "company-alpha"), companyId: "company-alpha", companyName: "Alpha Robotics", officialUrl: "https://alpha.example/", region: "美国", stage: "成长型", routes: ["本体与硬件"],
      capital: { status: "unknown", summary: "证据不足（不代表未融资）", evidence: [] }, validationStage: "概念 / 研究",
      productDeployment: { status: "unknown", summary: "证据不足（不代表没有产品或部署进展）", evidence: [] }, recentChanges: [],
      watchlist: { track: "unknown", lifecycle: "untracked", whyNow: "AI 研究判断：等待规范事件证据。", nextValidationPoints: [] }, unknownFields: ["capital.amount"], updatedAt: generatedAt,
    }],
    researchPassports: [{
      passportId: stableDecisionId("research", "paper-alpha"), paperId: "paper-alpha", titleZh: "一种机器人操作方法", factsZh: ["该方法面向机器人操作。", "论文报告了公开实验设置。"], sourceUrl: "https://arxiv.org/abs/2608.00001",
      task: "unknown", embodiment: "unknown", methods: "unknown", benchmark: { name: "unknown", metric: "unknown", result: "unknown", baseline: "unknown", delta: "unknown", evidenceUrls: [] },
      realRobotTrials: "unknown", assets: { code: "unknown", data: "unknown", weights: "unknown" }, reproducibilityCost: { level: "unknown", rationale: "unknown" },
      authority: { openAlexWorkId: "W1", authors: [], labs: [], citedByCount: "unknown", checkedAt: "unknown" }, limitations: "unknown", gaps: ["缺少基准证据"], whyWorthAttention: "AI 研究判断：论文问题与物理智能相关。", rankReasons: ["研究问题相关"],
    }],
    subscriptions: { generatedAt, entries: [{ subscriptionId: "feed-all", label: "全部 Top Signals", description: "每周证据门槛后的决策信号。", cadence: "weekly", format: "rss", url: "https://mbabby.github.io/physical-ai-news-cn/feeds/decision/all.xml", route: "all" }] },
  };
  const watchlist: WatchlistPublicView = { week: "2026-W34", snapshotVersion: 1, methodologyVersion: "v1", lastSuccessfulAt: generatedAt, companyIds: [], forwardRadar: [], validatedMomentum: [], changes: [] };
  const manifest = buildDecisionFeedManifest(artifact);
  assert.doesNotThrow(() => validateDecisionProductPublication({
    artifact, expectedArtifact: structuredClone(artifact), expectedGeneratedAt: generatedAt,
    dashboard: { generatedAt, decisionProducts: structuredClone(artifact), topSignals: [], companyRadar: [{ cardId: artifact.companyCards[0]!.cardId }], research: [{ passportId: artifact.researchPassports[0]!.passportId }] },
    readme: formatDecisionProductReadme(artifact), feedManifest: manifest,
    feeds: Object.fromEntries(manifest.feeds.map((feed) => [feed.path, renderDecisionFeed(artifact, feed.route, { repositoryUrl: "https://github.com/mbabby/physical-ai-news-cn", pagesUrl: "https://mbabby.github.io/physical-ai-news-cn", watchlist })])),
    companyEventOwners: new Map(), benchmarkResultLedger: { generatedAt, entries: [] }, repositoryUrl: "https://github.com/mbabby/physical-ai-news-cn", pagesUrl: "https://mbabby.github.io/physical-ai-news-cn", watchlist,
  }));
});
