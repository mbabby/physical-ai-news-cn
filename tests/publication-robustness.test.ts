import assert from "node:assert/strict";
import test from "node:test";
import { preferKnownGoodArticles } from "../src/publication.js";
import { validatePublication } from "../src/runtime/validation.js";
import type { Article, DailyArchive, EventStore, ResearchRecord } from "../src/types.js";

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
