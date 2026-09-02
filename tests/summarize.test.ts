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

test("rejects canonical placeholder and one-sentence research completion as invalid output", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    const content = calls === 1
      ? "标题：机器人新品\n摘要：原文摘要：请查看英文页面。"
      : "标题：机器人操作基准研究\n摘要：论文提出机器人操作基准并报告实验设置。";
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  };
  try {
    const summarizer = new CompatibleSummarizer({ apiKey: "test", baseUrl: "https://llm.invalid/v1", model: "test" });
    await summarizer.summarize({ ...base, id: "placeholder", excerpt: "Official release details." });
    await summarizer.summarize({ ...base, id: "paper", source: "arXiv · Robotics", kind: "研究与数据", excerpt: "Research abstract." });
    const status = summarizer.status();
    assert.equal(status.succeeded, 0);
    assert.equal(status.failed, 0);
    assert.match(status.detail, /无效模型输出 2/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("counts malformed HTTP 200 bodies as invalid output rather than provider failure", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("not-json", { status: 200 });
  try {
    const summarizer = new CompatibleSummarizer({ apiKey: "test", baseUrl: "https://llm.invalid/v1", model: "test" });
    await summarizer.summarize({ ...base, excerpt: "Official source details." });
    const status = summarizer.status();
    assert.equal(status.failed, 0);
    assert.match(status.detail, /无效模型输出 1/);
    assert.match(status.detail, /提供方失败 0/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("counts JSON null completion payloads as invalid output rather than provider failure", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("null", { status: 200, headers: { "content-type": "application/json" } });
  try {
    const summarizer = new CompatibleSummarizer({ apiKey: "test", baseUrl: "https://llm.invalid/v1", model: "test" });
    await summarizer.summarize({ ...base, excerpt: "Official source details." });
    const status = summarizer.status();
    assert.equal(status.failed, 0);
    assert.match(status.detail, /无效模型输出 1/);
    assert.match(status.detail, /提供方失败 0/);
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

test("keeps provider circuits isolated by lane and reports mixed outcomes safely", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return new Response(JSON.stringify({ choices: [{ message: { content: "标题：机器人新品" } }] }), { status: 200 });
    if (calls <= 5) throw new TypeError("provider unavailable");
    return new Response(JSON.stringify({ choices: [{ message: { content: "标题：研究机器人进展\n摘要：论文提出机器人操作方法。实验在真实机器人上完成验证。" } }] }), { status: 200 });
  };
  try {
    const summarizer = new CompatibleSummarizer({ apiKey: "test", baseUrl: "https://llm.invalid/v1", model: "test" });
    await summarizer.summarize({ ...base, id: "invalid", excerpt: "Industry source." }, "pulse");
    await summarizer.summarize({ ...base, id: "industry-one", excerpt: "Industry source." }, "industry");
    await summarizer.summarize({ ...base, id: "industry-two", excerpt: "Industry source." }, "industry");
    const research = await summarizer.summarize({ ...base, id: "research", source: "arXiv · Robotics", kind: "研究与数据", excerpt: "Research source." }, "research");
    assert.equal(calls, 6, "research must not inherit the industry circuit");
    assert.equal(research.titleZh, "研究机器人进展");
    assert.match(summarizer.status().detail, /提供方失败 2/);
    assert.match(summarizer.status().detail, /无效模型输出 1/);
    assert.match(summarizer.status().detail, /缓存命中 0/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("routes pulse through cache-first batches of at most two calls", async () => {
  let active = 0;
  let peak = 0;
  let cacheHits = 0;
  const lanes: string[] = [];
  const summarizer = {
    recordCacheHits(count: number): void { cacheHits += count; },
    async summarize(article: Article, lane?: string): Promise<Article> {
      active += 1;
      peak = Math.max(peak, active);
      lanes.push(lane ?? "");
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { ...article, titleZh: `中文标题${article.id}`, summaryZh: "完整的中文事实简介。" };
    },
  };
  const pulseArticles = Array.from({ length: 5 }, (_, index) => ({ ...base, id: `pulse-${index}`, excerpt: "完整来源摘要" }));
  const cached = { ...pulseArticles[0]!, titleZh: "缓存中文标题", summaryZh: "缓存的完整中文事实简介。" };
  const output = await summarizeWithCache(summarizer, pulseArticles, [cached], "pulse");
  assert.equal(output.length, 5);
  assert.equal(peak, 2);
  assert.equal(cacheHits, 1);
  assert.deepEqual(lanes, ["pulse", "pulse", "pulse", "pulse"]);
});

test("uses the newest matching LKG in the cache before scheduling a summary call", async () => {
  let calls = 0;
  const summarizer = {
    async summarize(article: Article): Promise<Article> {
      calls += 1;
      return { ...article, titleZh: "不应调用模型", summaryZh: "不应调用模型。" };
    },
  };
  const current = { ...base, id: "duplicate", title: "机器人发布新平台", excerpt: "机器人公司发布新平台，并说明应用场景。" };
  const newest = { ...current, publishedAt: new Date("2026-08-02T00:00:00Z"), fetchedAt: new Date("2026-08-02T01:00:00Z"), titleZh: "最新缓存标题", summaryZh: "最新缓存的完整中文事实简介。" };
  const older = { ...current, title: "旧版机器人平台", excerpt: "旧版来源摘要。", publishedAt: new Date("2026-08-01T00:00:00Z"), fetchedAt: new Date("2026-08-01T01:00:00Z"), titleZh: "旧缓存标题", summaryZh: "旧缓存的完整中文事实简介。" };
  const output = await summarizeWithCache(summarizer, [current], [newest, older]);
  assert.equal(calls, 0);
  assert.equal(output[0]?.titleZh, "最新缓存标题");
});
