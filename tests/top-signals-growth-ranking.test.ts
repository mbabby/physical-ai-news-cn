import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildDecisionTopSignals } from "../src/decision-products/top-signals.js";
import { buildGrowthTopSignals } from "../src/top-signals-growth/ranking.js";
import type { GrowthExperimentConfig } from "../src/top-signals-growth/contracts.js";
import type { CompanyProfile, EventEvidence, EventRecord } from "../src/types.js";

const NOW = new Date("2026-09-03T12:00:00.000Z");

interface GrowthGoldCase {
  caseId: string;
  eligible: boolean;
  event: Partial<EventRecord> & { evidenceMode?: "single-b" | "discovery-only" };
  company: Partial<CompanyProfile> | null;
}

const goldCases = JSON.parse(await readFile(new URL("./fixtures/top-signals-growth-gold-v1.json", import.meta.url), "utf8")) as GrowthGoldCase[];

function config(): GrowthExperimentConfig {
  return {
    schemaVersion: 1,
    experimentId: "github-top-signals-2026-08",
    startDate: "2026-08-31",
    endDate: "2026-09-13",
    manualWeek: "2026-W36",
    automaticWeek: "2026-W37",
    baselineStars: 1,
    targetStars: 11,
    targetExternalAuthors: 3,
    minSignals: 3,
    maxSignals: 5,
    maxSignalsPerEntity: 2,
    maxSignalsPerKind: 3,
    channels: ["github-release", "readme", "github-value-contribution"],
  };
}

function canonicalCompany(): CompanyProfile {
  return {
    name: "Alpha Robotics",
    aliases: ["Alpha"],
    entityId: "company-alpha",
    region: "中国",
    routes: ["本体与硬件", "部署与商业化"],
    thesis: "机器人本体与部署",
    officialUrl: "https://alpha.example/",
  };
}

function canonicalEvent(): EventRecord {
  return {
    id: "canonical-event",
    title: "Alpha Robotics 完成新一轮融资",
    type: "投融资",
    entities: ["Alpha Robotics"],
    primaryEntity: "Alpha Robotics",
    routes: ["本体与硬件"],
    status: "已确证",
    occurredAt: "2026-09-02T02:00:00.000Z",
    firstSeenAt: "2026-09-02T03:00:00.000Z",
    lastMaterialChangeAt: "2026-09-02T04:00:00.000Z",
    lastUpdatedAt: "2026-09-02T04:00:00.000Z",
    lastVerifiedAt: "2026-09-02T05:00:00.000Z",
    facts: ["Alpha Robotics 完成新一轮融资。", "本轮资金将用于机器人本体研发。"],
    openQuestions: [],
    evidence: [{
      link: "https://alpha.example/news/update",
      source: "Alpha Robotics",
      grade: "A",
      publishedAt: "2026-09-02T02:00:00.000Z",
      supports: "官方公告",
    }],
    timeline: [],
    funding: { entityStatus: "已确认", investors: [] },
  };
}

function evidenceFor(caseId: string, mode: GrowthGoldCase["event"]["evidenceMode"]): EventEvidence[] | undefined {
  if (mode === "single-b") return [{
    link: "https://media-one.example/alpha",
    source: "Media One",
    grade: "B",
    publishedAt: "2026-09-02T02:00:00.000Z",
    supports: "融资报道",
  }];
  if (mode === "discovery-only") return [{
    link: "https://news.google.com/articles/alpha",
    source: "Google News",
    grade: "A",
    publishedAt: "2026-09-02T02:00:00.000Z",
    supports: "发现线索",
  }];
  if (caseId === "independent-bb-acquisition") return [
    { link: "https://media-one.example/alpha-acquisition", source: "Media One", grade: "B", publishedAt: "2026-09-02T02:00:00.000Z", supports: "并购交割" },
    { link: "https://media-two.example/alpha-acquisition", source: "Media Two", grade: "B", publishedAt: "2026-09-02T03:00:00.000Z", supports: "并购交割" },
  ];
  return undefined;
}

function goldSignals() {
  const materialized = goldCases.map((item) => {
    const { evidenceMode, ...eventOverrides } = item.event;
    const evidence = evidenceFor(item.caseId, evidenceMode);
    return {
      event: { ...canonicalEvent(), id: item.caseId, ...eventOverrides, ...(evidence ? { evidence } : {}) },
      company: item.company === null ? undefined : { ...canonicalCompany(), ...item.company },
    };
  });
  const companies = [...new Map(
    materialized
      .flatMap(({ company }) => company ? [[company.entityId, company] as const] : []),
  ).values()];
  return buildDecisionTopSignals(
    materialized.map(({ event }) => event),
    companies,
    NOW,
    10,
  );
}

function countBy<T>(values: T[], key: (value: T) => string): number[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(key(value), (counts.get(key(value)) ?? 0) + 1);
  return [...counts.values()];
}

test("ranking applies scope and entity/kind quotas", () => {
  const selected = buildGrowthTopSignals(goldSignals(), NOW, config());
  assert.deepEqual(selected.map((item) => item.eventId), [
    "official-funding",
    "official-deployment",
    "official-product",
    "independent-bb-acquisition",
    "stale-with-new-deployment-evidence",
  ]);
  assert.ok(countBy(selected, (item) => item.entityId).every((count) => count <= 2));
  assert.ok(countBy(selected, (item) => item.kind).every((count) => count <= 3));
});

test("ranking exposes an exact 100-point explanation", () => {
  const first = buildGrowthTopSignals(goldSignals(), NOW, config());
  const second = buildGrowthTopSignals(structuredClone(goldSignals()), new Date(NOW), config());
  assert.deepEqual(second, first);
  for (const signal of first) {
    const score = signal.scoreBreakdown;
    assert.equal(score.total, score.industryCapitalImpact + score.evidenceQuality + score.recency + score.informationGain + score.strategicRelevance);
    assert.ok(score.total >= 0 && score.total <= 100);
    assert.ok(signal.nextValidationPoint.endsWith("。"));
  }
});
