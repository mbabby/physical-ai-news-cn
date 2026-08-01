import assert from "node:assert/strict";
import test from "node:test";
import { CompatibleSummarizer } from "../src/summarize.js";
import type { Article } from "../src/types.js";

const base: Article = { id: "1", title: "Robot news", link: "https://example.com", publishedAt: new Date(), fetchedAt: new Date(), source: "Test", sourceWeight: 1, excerpt: "", tags: [] };

test("does not call a model when source material is insufficient", async () => {
  const output = await new CompatibleSummarizer({}).summarize(base);
  assert.equal(output.titleZh, "Robot news");
  assert.match(output.summaryZh ?? "", /未提供/);
});

test("degrades safely when no model is configured", async () => {
  const output = await new CompatibleSummarizer({}).summarize({ ...base, excerpt: "A real robot deployment." });
  assert.match(output.summaryZh ?? "", /未配置/);
});
