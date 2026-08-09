import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { parseAlgoliaResponse } from "../src/fetchers/hn.js";
import { parseRssText } from "../src/fetchers/rss.js";

const rssSource = { type: "rss" as const, name: "Test RSS", url: "https://example.com/feed", weight: 8, keywords: [] };
const hnSource = { type: "algolia" as const, name: "Test HN", query: "robotics", weight: 4, keywords: [] };

test("parses fixed RSS fixture and ignores incomplete records", async () => {
  const xml = await readFile(new URL("./fixtures/robotics.xml", import.meta.url), "utf8");
  const articles = await parseRssText(xml, rssSource);
  assert.equal(articles.length, 1);
  assert.match(articles[0].excerpt, /humanoid/i);
});

test("preserves discovery aggregator and original publisher metadata", async () => {
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Discovery</title><item><title>Nova raises funding - Tech Wire</title><link>https://news.google.com/rss/articles/nova</link><source url="https://techwire.example.com">Tech Wire</source><description>Nova funding</description><pubDate>Sat, 08 Aug 2026 00:00:00 GMT</pubDate></item></channel></rss>`;
  const [article] = await parseRssText(xml, { ...rssSource, tier: "线索发现层" });
  assert.deepEqual(article.discoveryOrigin, {
    aggregatorLink: "https://news.google.com/rss/articles/nova",
    publisher: "Tech Wire",
    publisherUrl: "https://techwire.example.com",
  });
});

test("parses HN results and falls back to discussion link", () => {
  const articles = parseAlgoliaResponse({ hits: [{ title: "Open-source robotics", url: null, objectID: "42", created_at: "2026-08-01T00:00:00.000Z" }] }, hnSource);
  assert.equal(articles[0].link, "https://news.ycombinator.com/item?id=42");
});
