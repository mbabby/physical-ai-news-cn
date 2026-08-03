import assert from "node:assert/strict";
import test from "node:test";
import { filterAndRank, normalizeUrl, publicHoldReasons } from "../src/filter.js";
import type { Article } from "../src/types.js";

const now = new Date();
function item(overrides: Partial<Article>): Article {
  return { id: "id", title: "A robot launch", link: "https://example.com/a", publishedAt: now, fetchedAt: now,
    source: "Test", sourceWeight: 8, excerpt: "Humanoid robotics product launch", tags: [], ...overrides };
}

test("normalizes tracking URLs", () => {
  assert.equal(normalizeUrl("https://example.com/a/?utm_source=x&keep=1#part"), "https://example.com/a?keep=1");
});

test("filters unrelated articles, classifies and deduplicates", () => {
  const result = filterAndRank([
    item({ link: "https://example.com/a?utm_source=x", title: "Company launches humanoid robot" }),
    item({ link: "https://other.example/a", title: "Company launches humanoid robot" }),
    item({ link: "https://example.com/b", title: "A new recipe", excerpt: "Kitchen ideas" }),
  ], 24);
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "产品发布");
  assert.ok(result[0].tags.includes("产品"));
});

test("respects time window and daily limit", () => {
  const old = item({ publishedAt: new Date(Date.now() - 48 * 3_600_000), link: "https://example.com/old" });
  const many = Array.from({ length: 12 }, (_, index) => item({ id: String(index), link: `https://example.com/${index}`, title: `Robot launch ${index}` }));
  assert.equal(filterAndRank([old, ...many], 24, 10).length, 10);
});

test("prioritizes funding over otherwise similar industry news", () => {
  const result = filterAndRank([
    item({ id: "commercial", link: "https://example.com/commercial", title: "Humanoid robot commercial partnership" }),
    item({ id: "funding", link: "https://example.com/funding", title: "Humanoid robotics startup raises Series B funding" }),
  ], 24);
  assert.equal(result[0].kind, "投融资");
});

test("keeps context-free Hacker News hits out of the published digest", () => {
  const result = filterAndRank([item({ source: "Hacker News · Robotics", sourceWeight: 2, excerpt: "" })], 24);
  assert.equal(result.length, 0);
});

test("filters secondary-market financing noise even when robotics is mentioned", () => {
  const result = filterAndRank([item({ title: "机器人：融资净买入85.18万元，融资余额10.55亿元", excerpt: "Robotics market activity" })], 24);
  assert.equal(result.length, 0);
});

test("holds incomplete, unowned and roundup content out of public surfaces", () => {
  const incomplete = item({ titleZh: "机器人发布新产品", summaryZh: "暂未生成中文摘要，请阅读原文。" });
  assert.ok(publicHoldReasons(incomplete, true).includes("缺少完整中文事实简介"));
  const unknownCompany = item({ titleZh: "新公司完成机器人融资", summaryZh: "该公司宣布完成一轮机器人研发融资。" });
  assert.ok(publicHoldReasons(unknownCompany, false).includes("公司主体未确认"));
  const roundup = item({ title: "Top 10 robotics stories of July", titleZh: "七月机器人十大新闻盘点", summaryZh: "文章汇总了七月机器人领域的十条新闻。" });
  assert.ok(publicHoldReasons(roundup, true).includes("聚合盘点或评论性质内容"));
});
