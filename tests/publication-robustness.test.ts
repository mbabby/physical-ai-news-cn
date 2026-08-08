import assert from "node:assert/strict";
import test from "node:test";
import { preferKnownGoodArticles, recoverPublishedResearchRecords } from "../src/publication.js";
import { validatePublication, validatePublicationArtifacts } from "../src/runtime/validation.js";
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
  assert.throws(() => validatePublication({ archive, events, research: [], readme: "README", expectedDate: "2026-08-08" }), /缺少完整中文事实简介/);
});

test("publication validation blocks a research-card quality regression", () => {
  const archive: DailyArchive = { date: "2026-08-08", articles: [article("ok")] };
  const events: EventStore = { updatedAt: "2026-08-08", events: [] };
  const record = (id: string): ResearchRecord => ({ id, article: article(id), firstSeenAt: "", lastCheckedAt: "", factHash: id, status: "新论文", appearances: 1, evidenceTags: [], authorityLabels: [], changes: [] });
  assert.throws(() => validatePublication({ archive, events, research: [record("one")], readme: "README", expectedDate: "2026-08-08", previousCompleteResearchCount: 6 }), /研究卡从 6 篇倒退到 1 篇/);
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

test("cross-file contract rejects mismatched counts and service receipts", () => {
  const archive: DailyArchive = { date: "2026-08-08", articles: [article("ok")], candidates: [], runtimeStatus: [{ component: "LLM", status: "成功", attempted: 1, succeeded: 1, failed: 0, detail: "ok" }] };
  const manifest: RunManifest = { schemaVersion: 1, runId: "2026-08-08-test", date: archive.date, startedAt: "2026-08-08T00:00:00Z", finishedAt: "2026-08-08T00:01:00Z", status: "success", quality: { publicIndustryItems: 0, publicResearchItems: 0, candidates: 2, sourceFailures: 0 }, services: [{ component: "LLM", status: "部分降级", attempted: 1, succeeded: 0, failed: 1, detail: "bad" }], outputs: 1 };
  assert.throws(() => validatePublicationArtifacts(archive, manifest), /公开条目计数不一致[\s\S]*候选条目计数[\s\S]*LLM 状态/);
});
