import assert from "node:assert/strict";
import test from "node:test";
import { formatMarkdown } from "../src/formatter.js";
import type { Article } from "../src/types.js";

test("renders a complete daily Markdown entry and failures", () => {
  const now = new Date("2026-08-01T00:00:00.000Z");
  const article: Article = { id: "1", title: "Robot launch", titleZh: "机器人发布", summaryZh: "要点一\n要点二", link: "https://example.com", publishedAt: now, fetchedAt: now, source: "Official", sourceWeight: 9, excerpt: "text", kind: "产品发布", tags: ["产品", "robot"] };
  const markdown = formatMarkdown([article], 24, [{ source: "HN", reason: "timeout" }], now);
  assert.match(markdown, /机器人发布/);
  assert.match(markdown, /`产品`/);
  assert.match(markdown, /HN：失败/);
});
