import assert from "node:assert/strict";
import test from "node:test";
import { summarizeWithCache } from "../src/main.js";
import { CompatibleSummarizer } from "../src/summarize.js";
import type { Article } from "../src/types.js";

const base: Article = { id: "1", title: "Robot news", link: "https://example.com", publishedAt: new Date(), fetchedAt: new Date(), source: "Test", sourceWeight: 1, excerpt: "", tags: [] };

test("keeps a readable fallback when source material is insufficient", async () => {
  const output = await new CompatibleSummarizer({}).summarize(base);
  assert.equal(output.titleZh, "Robot news");
  assert.match(output.summaryZh ?? "", /暂无原文摘要/);
});

test("degrades safely when no model is configured", async () => {
  const output = await new CompatibleSummarizer({}).summarize({ ...base, excerpt: "A real robot deployment." });
  assert.match(output.summaryZh ?? "", /未配置/);
});

test("skips model calls when the source excerpt is absent", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ choices: [{ message: { content: "标题：机器人新品\n摘要：官方发布了机器人新品。" } }] }), { status: 200 });
  };
  try {
    const summarizer = new CompatibleSummarizer({ apiKey: "test", baseUrl: "https://llm.invalid/v1", model: "test" });
    const output = await summarizer.summarize(base);
    assert.equal(calls, 0);
    assert.equal(summarizer.status().attempted, 0);
    assert.match(output.summaryZh ?? "", /暂无原文摘要/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects title-only model output without opening the provider circuit", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ choices: [{ message: { content: "标题：机器人新品" } }] }), { status: 200 });
  };
  try {
    const summarizer = new CompatibleSummarizer({ apiKey: "test", baseUrl: "https://llm.invalid/v1", model: "test" });
    const output = await summarizer.summarize({ ...base, excerpt: "Official source describes a robot product release." });
    assert.equal(calls, 1, "invalid completions must not be retried as provider faults");
    assert.equal(summarizer.status().succeeded, 0);
    assert.equal(summarizer.status().failed, 0, "invalid output is distinct from a provider fault");
    assert.match(summarizer.status().detail, /无效/);
    assert.match(output.summaryZh ?? "", /暂未生成中文摘要/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("opens a circuit after repeated provider failures", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new TypeError("provider unavailable"); };
  try {
    const summarizer = new CompatibleSummarizer({ apiKey: "test", baseUrl: "https://llm.invalid/v1", model: "test" });
    await summarizer.summarize({ ...base, id: "one", excerpt: "Provider failure test source material." });
    await summarizer.summarize({ ...base, id: "two", excerpt: "Provider failure test source material." });
    await summarizer.summarize({ ...base, id: "three", excerpt: "Provider failure test source material." });
    assert.equal(calls, 4, "the third article must not contact an unhealthy provider");
    assert.equal(summarizer.status().attempted, 2);
    assert.match(summarizer.status().detail, /熔断/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("limits uncached pulse summaries to two in-flight calls", async () => {
  let active = 0;
  let peak = 0;
  const summarizer = {
    async summarize(article: Article): Promise<Article> {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { ...article, titleZh: `中文标题${article.id}`, summaryZh: "完整的中文事实简介。" };
    },
  };
  const pulseArticles = Array.from({ length: 5 }, (_, index) => ({ ...base, id: `pulse-${index}`, excerpt: "完整来源摘要" }));
  const output = await summarizeWithCache(summarizer, pulseArticles, []);
  assert.equal(output.length, 5);
  assert.equal(peak, 2);
});
