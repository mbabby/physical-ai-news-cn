import assert from "node:assert/strict";
import test from "node:test";
import { formatHomepageDigest, formatHomepageWeekly, formatMarkdown, formatWeeklyMarkdown } from "../src/formatter.js";
import type { Article, WeeklyArticle } from "../src/types.js";

test("renders a complete daily Markdown entry and failures", () => {
  const now = new Date("2026-08-01T00:00:00.000Z");
  const article: Article = { id: "1", title: "Robot launch", titleZh: "机器人发布", summaryZh: "要点一\n要点二", link: "https://example.com", publishedAt: now, fetchedAt: now, source: "Official", sourceWeight: 9, excerpt: "text", kind: "产品发布", tags: ["产品", "robot"] };
  const markdown = formatMarkdown([article], 24, [{ source: "HN", reason: "timeout" }], now);
  assert.match(markdown, /机器人发布/);
  assert.match(markdown, /产品发布 · Official · 08-01 · #产品 · #robot/);
  assert.match(markdown, /HN：失败/);
});

test("adapts a daily archive for the README homepage", () => {
  const markdown = "# 物理 AI 每日资讯 — 2026-08-01\n\n## 机器人发布\n\n内容";
  const homepage = formatHomepageDigest(markdown);
  assert.match(homepage, /### 最新日报 · 2026-08-01/);
  assert.match(homepage, /#### 机器人发布/);
});

test("renders and adapts an automatic weekly selection", () => {
  const now = new Date("2026-08-01T00:00:00.000Z");
  const article: WeeklyArticle = { id: "1", title: "Robot funding", titleZh: "机器人融资", summaryZh: "获得新一轮融资。", link: "https://example.com", publishedAt: now, fetchedAt: now, source: "Official", sourceWeight: 10, excerpt: "funding", kind: "投融资", tags: ["投融资"], weeklyScore: 120, selectionReason: "披露投融资、并购或估值等资本信号；来源为一手官方发布。" };
  const markdown = formatWeeklyMarkdown([article], "2026-W31");
  assert.match(markdown, /入选原因：/);
  assert.match(formatHomepageWeekly(markdown), /### 本周精选 · 2026-W31/);
});
