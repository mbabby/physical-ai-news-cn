import assert from "node:assert/strict";
import test from "node:test";
import { formatHomepageDigest, formatHomepageWeekly, formatMarkdown, formatWeeklyMarkdown } from "../src/formatter.js";
import type { Article, IndustryPulse, WeeklyArticle } from "../src/types.js";

test("renders a complete daily Markdown entry and failures", () => {
  const now = new Date("2026-08-01T00:00:00.000Z");
  const article: Article = { id: "1", title: "Robot launch", titleZh: "机器人发布", summaryZh: "要点一\n要点二", link: "https://example.com", publishedAt: now, fetchedAt: now, source: "Official", sourceWeight: 9, excerpt: "text", kind: "产品发布", tags: ["产品", "robot"] };
  const markdown = formatMarkdown([article], 24, [{ source: "HN", reason: "timeout" }], now);
  assert.match(markdown, /机器人发布/);
  assert.match(markdown, /产品发布 · Official · 08-01 · #产品 · #robot/);
  assert.match(markdown, /HN：失败/);
});

test("adapts a daily archive for the README homepage", () => {
  const markdown = "# 物理 AI 每日资讯 — 2026-08-01\n\n过去 24 小时 · 1 条精选\n\n## 机器人发布\n\n内容";
  const homepage = formatHomepageDigest(markdown);
  assert.match(homepage, /### 最新日报 · 2026-08-01/);
  assert.match(homepage, /#### 机器人发布/);
  assert.match(homepage, /^> 过去 24 小时/m);
});

test("renders an industry pulse before remaining daily news", () => {
  const now = new Date("2026-08-01T00:00:00.000Z");
  const viewpoint: Article = { id: "view", title: "Leader says robots need world models", titleZh: "领军人物谈世界模型", summaryZh: "公开观点摘要。", link: "https://x.com/example/status/1", publishedAt: now, fetchedAt: now, source: "X · 领军人物", sourceWeight: 7, excerpt: "robot world model", tags: ["world model"], pulseKind: "人物观点", speaker: "领军人物" };
  const event: Article = { ...viewpoint, id: "event", title: "Robot product launch", titleZh: "机器人产品发布", link: "https://example.com/launch", pulseKind: "关键事件", kind: "产品发布", source: "Official" };
  const pulse: IndustryPulse = { viewpoints: [viewpoint], events: [event] };
  const markdown = formatMarkdown([], 24, [], now, pulse, 1);
  assert.match(markdown, /## 行业脉搏/);
  assert.match(markdown, /### 人物观点/);
  assert.match(markdown, /### 关键事件/);
  assert.match(formatHomepageDigest(markdown), /#### 行业脉搏/);
});

test("renders and adapts an automatic weekly selection", () => {
  const now = new Date("2026-08-01T00:00:00.000Z");
  const article: WeeklyArticle = { id: "1", title: "Robot funding", titleZh: "机器人融资", summaryZh: "获得新一轮融资。", link: "https://example.com", publishedAt: now, fetchedAt: now, source: "Official", sourceWeight: 10, excerpt: "funding", kind: "投融资", tags: ["投融资"], weeklyScore: 120, selectionReason: "披露投融资、并购或估值等资本信号；来源为一手官方发布。" };
  const markdown = formatWeeklyMarkdown([article], "2026-W31");
  assert.match(markdown, /入选原因：/);
  assert.match(formatHomepageWeekly(markdown), /> 自动周榜 · 2026-W31/);
});
