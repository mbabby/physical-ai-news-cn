import assert from "node:assert/strict";
import test from "node:test";
import { formatHomepageDigest, formatMarkdown } from "../src/formatter.js";
import type { Article } from "../src/types.js";

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
