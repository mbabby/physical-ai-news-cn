import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { stableDecisionId } from "../src/decision-products/contracts.js";
import { buildDecisionTopSignals } from "../src/decision-products/top-signals.js";
import {
  loadGrowthExperimentConfig,
  topSignalsContentSha256,
  validateGrowthExperimentConfig,
  validateTopSignalsApproval,
  validateTopSignalsDraft,
} from "../src/top-signals-growth/contracts.js";
import type { CompanyProfile, EventEvidence, EventRecord } from "../src/types.js";

interface GrowthGoldCase {
  caseId: string;
  eligible: boolean;
  event: Partial<EventRecord> & { evidenceMode?: "single-b" | "discovery-only" };
  company: Partial<CompanyProfile> | null;
}

const ROOT = fileURLToPath(new URL("../", import.meta.url));

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
    title: "Alpha Robotics 发布机器人进展",
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
    facts: ["Alpha Robotics 发布机器人进展。", "该进展已获得公开证据支持。"],
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

function materializeGoldCase(item: GrowthGoldCase): { event: EventRecord; companies: CompanyProfile[] } {
  const { evidenceMode, ...eventOverrides } = item.event;
  const evidence = evidenceFor(item.caseId, evidenceMode);
  const company = { ...canonicalCompany(), ...(item.company ?? {}) };
  return {
    event: { ...canonicalEvent(), id: item.caseId, ...eventOverrides, ...(evidence ? { evidence } : {}) },
    companies: item.company === null ? [] : [company],
  };
}

function draftFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    schemaVersion: 1,
    experimentId: "github-top-signals-2026-08",
    week: "2026-W36",
    generatedAt: "2026-09-03T10:00:00.000Z",
    periodStart: "2026-08-31",
    periodEnd: "2026-09-06",
    signals: [{
      signalId: stableDecisionId("signal", "event-alpha"),
      eventId: "event-alpha",
      entityId: "company-alpha",
      entityName: "Alpha Robotics",
      titleZh: "Alpha Robotics 完成新一轮融资",
      factsZh: ["Alpha Robotics 完成新一轮融资。", "本轮资金将用于机器人本体研发。"],
      kind: "投融资",
      routes: ["本体与硬件"],
      occurredAt: "2026-09-02T02:00:00.000Z",
      verifiedAt: "2026-09-03T01:00:00.000Z",
      changedThisWeek: true,
      evidenceState: "official",
      evidence: [{ evidenceId: stableDecisionId("evidence", "event-alpha\nhttps://alpha.example/news/funding"), url: "https://alpha.example/news/funding", source: "Alpha Robotics", grade: "A" }],
      impact: ["company", "capital"],
      whyItMatters: "AI 研究判断：该事件为相关公司与技术路线带来新的资本信号。",
      rankReasons: ["本周发生实质变化", "官方一手证据", "资本事件"],
      nextValidationPoint: "核验资金到账与研发计划进展。",
      scoreBreakdown: { industryCapitalImpact: 5, evidenceQuality: 5, recency: 5, informationGain: 4, strategicRelevance: 4, total: 23 },
    }],
    ...overrides,
  };
}

test("loads the fixed Top Signals growth experiment configuration", async () => {
  const config = await loadGrowthExperimentConfig(ROOT);
  assert.deepEqual(config, {
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
  });
  assert.throws(() => validateGrowthExperimentConfig({ ...config, unexpected: true }), /keys|字段/i);
});

test("approval binds canonical content but ignores retry timestamp", () => {
  const first = draftFixture({ generatedAt: "2026-09-03T10:00:00.000Z" });
  const retry = draftFixture({ generatedAt: "2026-09-03T10:05:00.000Z" });
  assert.equal(topSignalsContentSha256(first), topSignalsContentSha256(retry));
  assert.doesNotThrow(() => validateTopSignalsApproval({
    schemaVersion: 1,
    experimentId: first.experimentId,
    week: first.week,
    contentSha256: topSignalsContentSha256(first),
    approvedBy: "mbabby",
    approvedAt: "2026-09-03T10:10:00.000Z",
  }));
});

test("strict contracts reject extra keys and invalid week", () => {
  assert.throws(() => validateTopSignalsDraft({ ...draftFixture(), forged: true }), /keys|字段/i);
  assert.throws(() => validateTopSignalsDraft(draftFixture({ week: "2026-W99" })), /week|周/i);
});

test("gold set materializes complete events without fixture-only evidence modes", async () => {
  const cases = JSON.parse(await readFile(new URL("./fixtures/top-signals-growth-gold-v1.json", import.meta.url), "utf8")) as GrowthGoldCase[];
  assert.equal(cases.length, 12);
  assert.equal(new Set(cases.map((item) => item.caseId)).size, cases.length);

  for (const item of cases) {
    const { event, companies } = materializeGoldCase(item);
    assert.equal(Object.hasOwn(event, "evidenceMode"), false, item.caseId);
    assert.equal(companies.length === 1, item.company !== null, item.caseId);
    assert.ok(Array.isArray(buildDecisionTopSignals([event], companies, new Date("2026-09-03T12:00:00.000Z"))), item.caseId);
  }
});
