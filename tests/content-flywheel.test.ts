import assert from "node:assert/strict";
import test from "node:test";
import { aggregateSourceCandidates, applyRegistryWeights, buildSourceRegistry, discoverSourceCandidates, formatReviewMarkdown } from "../src/content-flywheel.js";
import { formatSourceNetwork } from "../src/source-network.js";
import type { Article, DailyArchive, SourceConfig, SourceRegistry } from "../src/types.js";

const sources: SourceConfig[] = [
  { type: "rss", name: "Official", url: "https://official.example/feed.xml", weight: 8, keywords: ["robot"] },
  { type: "algolia", name: "Hacker News · Robotics", query: "robotics", weight: 2, keywords: ["robot"] },
];

function article(overrides: Partial<Article>): Article {
  const now = new Date("2026-08-01T00:00:00.000Z");
  return { id: "id", title: "Humanoid robot launch", link: "https://official.example/news", publishedAt: now, fetchedAt: now, source: "Official", sourceWeight: 8, excerpt: "robot launch", tags: [], ...overrides };
}

test("low-health sources are automatically down-weighted only after enough runs", () => {
  const registry: SourceRegistry = { updatedAt: "2026-08-01T00:00:00Z", windowDays: 30, sources: [{ name: "Official", type: "rss", tier: "官方公司与实验室", status: "观察", publicationPolicy: "可作为一手证据", configuredWeight: 8, effectiveWeight: 8, successfulRuns: 2, failedRuns: 3, selectedArticles: 0, reliability: 0.4, fetchedArticles: 10, relatedHits: 1, correctionCount: 0, health: { successRate: 0.4, hitRate: 0.1, inclusionRate: 0, correctionRate: 0, score: 55 }, recommendation: "排查" }] };
  assert.equal(applyRegistryWeights(sources, registry)[0].weight, 6);
  assert.equal(applyRegistryWeights(sources)[0].weight, 8);
});

test("source registry exposes tiers, health and a pause for access-restricted sources", () => {
  const archives: DailyArchive[] = Array.from({ length: 5 }, (_, index) => ({
    date: `2026-07-${String(27 + index).padStart(2, "0")}`,
    articles: [],
    sourceOutcomes: [{ source: "Official", status: "failure", reason: "HTTP 402", fetchedArticles: 0 }],
  }));
  const registry = buildSourceRegistry(archives, sources, sources, new Date("2026-08-01T00:00:00Z"));
  const official = registry.sources[0];
  assert.equal(official.status, "已暂停");
  assert.equal(official.health.score, 37.5);
  assert.match(formatSourceNetwork(registry), /官方公司与实验室/);
  assert.match(formatSourceNetwork(registry), /访问受限/);
});

test("a quiet but reliable official source is not downgraded for publishing nothing", () => {
  const archives: DailyArchive[] = Array.from({ length: 8 }, (_, index) => ({
    date: `2026-07-${String(24 + index).padStart(2, "0")}`,
    articles: [],
    candidates: [],
    sourceOutcomes: [{ source: "Official", status: "success", fetchedArticles: 0 }],
  }));
  const registry = buildSourceRegistry(archives, sources, sources, new Date("2026-08-01T00:00:00Z"));
  assert.equal(registry.sources[0].status, "已启用");
  assert.equal(registry.sources[0].health.score, 77.5);
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
