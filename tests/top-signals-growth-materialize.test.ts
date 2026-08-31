import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { stableDecisionId } from "../src/decision-products/contracts.js";
import type { DecisionProductArtifact, DecisionTopSignal } from "../src/decision-products/contracts.js";
import type { GrowthExperimentConfig, TopSignalsDraft } from "../src/top-signals-growth/contracts.js";
import { buildTopSignalsDraft, stageTopSignalsDraft } from "../src/top-signals-growth/materialize.js";

const NOW = new Date("2026-09-03T12:00:00.000Z");

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

function decisionSignal(index: number): DecisionTopSignal {
  const eventId = `event-${index}`;
  const kinds = ["投融资", "部署案例", "产品发布", "公司商业", "部署案例"] as const;
  const kind = kinds[index]!;
  const titleZh = kind === "公司商业" ? `Alpha ${index} 完成客户订单交付` : `Alpha ${index} 发布重要进展`;
  const evidenceUrl = `https://alpha-${index}.example/news/update`;
  return {
    signalId: stableDecisionId("signal", eventId),
    eventId,
    entityId: `company-alpha-${index}`,
    entityName: `Alpha Robotics ${index}`,
    titleZh,
    factsZh: [`Alpha Robotics ${index} 已确认本次进展。`, `该进展已获得官方公开证据支持。`],
    kind,
    routes: ["部署与商业化"],
    occurredAt: `2026-09-0${index + 1}T02:00:00.000Z`,
    verifiedAt: `2026-09-0${index + 1}T03:00:00.000Z`,
    changedThisWeek: true,
    evidenceState: "official",
    evidence: [{
      evidenceId: stableDecisionId("evidence", `${eventId}\n${evidenceUrl}`),
      url: evidenceUrl,
      source: `Alpha Robotics ${index}`,
      grade: "A",
    }],
    impact: ["company", "product-deployment"],
    whyItMatters: "AI 研究判断：该事件为产业部署提供了新的可核验信号。",
    rankReasons: ["官方一手证据", "本周发生实质变化"],
  };
}

function decisionArtifact(signalCount = 5): DecisionProductArtifact {
  return {
    schemaVersion: 1,
    generatedAt: NOW.toISOString(),
    periodStart: "2026-08-28",
    topSignals: Array.from({ length: signalCount }, (_, index) => decisionSignal(index)),
    companyCards: [],
    researchPassports: [],
    subscriptions: { generatedAt: NOW.toISOString(), entries: [] },
  };
}

test("materializes one deterministic review draft without publishing it", () => {
  const result = buildTopSignalsDraft({ artifact: decisionArtifact(), now: NOW, config: config() });
  assert.equal(result.status, "in-experiment");
  assert.equal(result.draft.week, "2026-W36");
  assert.equal(result.draft.periodStart, "2026-08-31");
  assert.equal(result.draft.periodEnd, "2026-09-06");
  assert.equal(result.draft.signals.length, 5);
  assert.deepEqual(buildTopSignalsDraft({ artifact: decisionArtifact(), now: NOW, config: config() }), result);
});

test("stages only a review path", () => {
  const result = buildTopSignalsDraft({ artifact: decisionArtifact(), now: NOW, config: config() });
  assert.equal(result.status, "in-experiment");
  const staged: Array<{ path: string; content: string }> = [];
  stageTopSignalsDraft({
    root: "/repo",
    draft: result.draft,
    transaction: { stage: (path, content) => staged.push({ path, content }) },
  });
  assert.deepEqual(staged.map(({ path }) => path), [join("/repo", "review", "top-signals-drafts", "2026-W36.json")]);
  assert.deepEqual(JSON.parse(staged[0]!.content) as TopSignalsDraft, result.draft);
  assert.ok(staged[0]!.content.endsWith("\n"));
});

test("uses UTC ISO weeks, keeps sparse review diagnostics, and rejects invalid clocks", () => {
  const w37 = buildTopSignalsDraft({
    artifact: decisionArtifact(2),
    now: new Date("2026-09-07T00:00:00.000Z"),
    config: config(),
  });
  assert.equal(w37.status, "in-experiment");
  assert.equal(w37.draft.week, "2026-W37");
  assert.equal(w37.draft.periodStart, "2026-09-07");
  assert.equal(w37.draft.periodEnd, "2026-09-13");
  assert.equal(w37.draft.signals.length, 2);

  assert.deepEqual(buildTopSignalsDraft({ artifact: decisionArtifact(), now: new Date("2026-08-30T23:59:59.999Z"), config: config() }), { status: "outside-experiment" });
  assert.deepEqual(buildTopSignalsDraft({ artifact: decisionArtifact(), now: new Date("2026-09-14T00:00:00.000Z"), config: config() }), { status: "outside-experiment" });
  assert.throws(() => buildTopSignalsDraft({ artifact: decisionArtifact(), now: new Date(Number.NaN), config: config() }), /clock|时钟|valid/i);
});
