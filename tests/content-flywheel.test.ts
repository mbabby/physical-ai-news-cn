import assert from "node:assert/strict";
import test from "node:test";
import { aggregateSourceCandidates, applyRegistryWeights, buildSourceRegistry, discoverSourceCandidates, formatReviewMarkdown } from "../src/content-flywheel.js";
import type { Article, DailyArchive, SourceConfig, SourceRegistry } from "../src/types.js";

const sources: SourceConfig[] = [
  { type: "rss", name: "Official", url: "https://official.example/feed.xml", weight: 8, keywords: ["robot"] },
  { type: "algolia", name: "Hacker News · Robotics", query: "robotics", weight: 2, keywords: ["robot"] },
];

function article(overrides: Partial<Article>): Article {
  const now = new Date("2026-08-01T00:00:00.000Z");
  return { id: "id", title: "Humanoid robot launch", link: "https://official.example/news", publishedAt: now, fetchedAt: now, source: "Official", sourceWeight: 8, excerpt: "robot launch", tags: [], ...overrides };
}

test("low-reliability sources are automatically down-weighted only after enough runs", () => {
  const registry: SourceRegistry = { updatedAt: "2026-08-01T00:00:00Z", windowDays: 30, sources: [{ name: "Official", type: "rss", configuredWeight: 8, effectiveWeight: 8, successfulRuns: 2, failedRuns: 3, selectedArticles: 0, reliability: 0.4, recommendation: "排查" }] };
  assert.equal(applyRegistryWeights(sources, registry)[0].weight, 6);
  assert.equal(applyRegistryWeights(sources)[0].weight, 8);
});

test("registry, discovery and review keep raw HN leads separate from published news", () => {
  const hn = article({ source: "Hacker News · Robotics", sourceWeight: 2, excerpt: "", link: "https://new-source.example/post" });
  const discovered = discoverSourceCandidates([hn], sources);
  assert.equal(discovered[0].domain, "new-source.example");
  const archives: DailyArchive[] = [
    { date: "2026-07-30", articles: [], discoveredSources: discovered, sourceOutcomes: [{ source: "Official", status: "success" }] },
    { date: "2026-07-31", articles: [], discoveredSources: discovered, sourceOutcomes: [{ source: "Official", status: "failure", reason: "timeout" }] },
  ];
  const registry = buildSourceRegistry(archives, sources, sources, new Date("2026-08-01T00:00:00Z"));
  const candidates = aggregateSourceCandidates(archives);
  assert.equal(candidates.length, 1);
  assert.match(formatReviewMarkdown(registry, candidates, [], "2026-W31"), /new-source.example/);
});
