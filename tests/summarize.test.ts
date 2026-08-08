import assert from "node:assert/strict";
import test from "node:test";
import { CompatibleSummarizer } from "../src/summarize.js";
import type { Article } from "../src/types.js";

const base: Article = { id: "1", title: "Robot news", link: "https://example.com", publishedAt: new Date(), fetchedAt: new Date(), source: "Test", sourceWeight: 1, excerpt: "", tags: [] };

test("keeps a readable fallback when source material is insufficient", async () => {
  const output = await new CompatibleSummarizer({}).summarize(base);
  assert.equal(output.titleZh, "Robot news");
  assert.match(output.summaryZh ?? "", /未配置/);
});

test("degrades safely when no model is configured", async () => {
  const output = await new CompatibleSummarizer({}).summarize({ ...base, excerpt: "A real robot deployment." });
  assert.match(output.summaryZh ?? "", /未配置/);
});

test("opens a circuit after repeated provider failures", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response(JSON.stringify({ choices: [] }), { status: 200 }); };
  try {
    const summarizer = new CompatibleSummarizer({ apiKey: "test", baseUrl: "https://llm.invalid/v1", model: "test" });
    await summarizer.summarize({ ...base, id: "one" });
    await summarizer.summarize({ ...base, id: "two" });
    await summarizer.summarize({ ...base, id: "three" });
    assert.equal(calls, 4, "the third article must not contact an unhealthy provider");
    assert.equal(summarizer.status().attempted, 2);
    assert.match(summarizer.status().detail, /熔断/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
