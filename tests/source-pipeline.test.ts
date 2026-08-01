import assert from "node:assert/strict";
import test from "node:test";
import { dynamicSources, findFeedUrl, updateCandidateRegistry } from "../src/source-pipeline.js";
import type { DailyArchive } from "../src/types.js";

test("finds RSS alternate links and resolves relative feed URLs", () => {
  const feed = findFeedUrl('<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head></html>', "https://robot.example/news");
  assert.equal(feed, "https://robot.example/feed.xml");
});

test("keeps new sources in shadow observation before promotion", () => {
  const now = new Date("2026-08-15T00:00:00.000Z");
  const firstSeen = "2026-08-01T00:00:00.000Z";
  const archives: DailyArchive[] = Array.from({ length: 5 }, (_, index) => ({
    date: `2026-08-${String(index + 10).padStart(2, "0")}`,
    articles: Array.from({ length: 2 }, (_, articleIndex) => ({ id: `${index}-${articleIndex}`, title: "robot release", link: `https://robot.example/${index}-${articleIndex}`, publishedAt: now, fetchedAt: now, source: "自动发现 · robot.example", sourceWeight: 3, excerpt: "robot release", tags: [] })),
    sourceOutcomes: [{ source: "自动发现 · robot.example", status: "success" }],
  }));
  const registry = updateCandidateRegistry({ updatedAt: firstSeen, sources: [{ domain: "robot.example", title: "Robot feed", link: "https://robot.example/news", feedUrl: "https://robot.example/feed.xml", status: "影子观察", firstSeenAt: firstSeen, lastSeenAt: firstSeen, successfulRuns: 0, failedRuns: 0, selectedArticles: 0 }] }, [], archives, now);
  assert.equal(registry.sources[0].status, "已启用");
  assert.equal(dynamicSources(registry)[0].url, "https://robot.example/feed.xml");
});

test("does not activate candidates without a feed", () => {
  const registry = updateCandidateRegistry(undefined, [{ domain: "no-feed.example", title: "No feed", link: "https://no-feed.example" }], [], new Date("2026-08-01T00:00:00.000Z"));
  assert.equal(registry.sources[0].status, "候选");
  assert.equal(dynamicSources(registry).length, 0);
});
