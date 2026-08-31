import assert from "node:assert/strict";
import test from "node:test";
import { stableDecisionId } from "../src/decision-products/contracts.js";
import {
  topSignalsContentSha256,
  type GrowthExperimentConfig,
  type TopSignalsApproval,
  type TopSignalsDraft,
} from "../src/top-signals-growth/contracts.js";
import { evaluateTopSignalsGate } from "../src/top-signals-growth/gate.js";

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

function draftFixture({ week = "2026-W36", signalCount = 3 }: { week?: "2026-W36" | "2026-W37"; signalCount?: number } = {}): TopSignalsDraft {
  return {
    schemaVersion: 1,
    experimentId: "github-top-signals-2026-08",
    week,
    generatedAt: "2026-09-03T10:00:00.000Z",
    periodStart: "2026-08-31",
    periodEnd: "2026-09-06",
    signals: Array.from({ length: signalCount }, (_, index) => {
      const eventId = `event-${index + 1}`;
      const url = `https://alpha.example/news/${index + 1}`;
      return {
        signalId: stableDecisionId("signal", eventId),
        eventId,
        entityId: `company-${index + 1}`,
        entityName: `Alpha Robotics ${index + 1}`,
        titleZh: `Alpha Robotics 发布进展 ${index + 1}`,
        factsZh: [`Alpha Robotics 发布进展 ${index + 1}。`, `该进展已获得公开证据支持 ${index + 1}。`],
        kind: "投融资" as const,
        routes: ["本体与硬件" as const],
        occurredAt: "2026-09-02T02:00:00.000Z",
        verifiedAt: "2026-09-03T01:00:00.000Z",
        changedThisWeek: true,
        evidenceState: "official" as const,
        evidence: [{ evidenceId: stableDecisionId("evidence", `${eventId}\n${url}`), url, source: "Alpha Robotics", grade: "A" as const }],
        impact: ["company" as const, "capital" as const],
        whyItMatters: "AI 研究判断：该事件为相关公司与技术路线带来新的资本信号。",
        rankReasons: ["本周发生实质变化", "官方一手证据", "资本事件"],
        nextValidationPoint: "核验资金到账与研发计划进展。",
        scoreBreakdown: { industryCapitalImpact: 5, evidenceQuality: 5, recency: 5, informationGain: 4, strategicRelevance: 4, total: 23 },
      };
    }),
  };
}

function approvalFixture(draft: TopSignalsDraft, overrides: Partial<TopSignalsApproval> = {}): TopSignalsApproval {
  return {
    schemaVersion: 1,
    experimentId: draft.experimentId,
    week: draft.week,
    contentSha256: topSignalsContentSha256(draft),
    approvedBy: "mbabby",
    approvedAt: "2026-09-03T10:10:00.000Z",
    ...overrides,
  };
}

test("manual week needs approval for the exact content hash", () => {
  const draft = draftFixture();

  assert.equal(evaluateTopSignalsGate({ draft, config: config() }).status, "blocked");
  assert.equal(evaluateTopSignalsGate({
    draft,
    config: config(),
    approval: approvalFixture(draft, { contentSha256: "0".repeat(64) }),
  }).status, "blocked");

  const receipt = evaluateTopSignalsGate({ draft, config: config(), approval: approvalFixture(draft) });
  assert.equal(receipt.status, "publishable");
  assert.equal(receipt.contentSha256, topSignalsContentSha256(draft));
  assert.deepEqual(receipt.approval, { approvedBy: "mbabby", approvedAt: "2026-09-03T10:10:00.000Z" });
});

test("automatic week requires three complete signals", () => {
  assert.equal(evaluateTopSignalsGate({ draft: draftFixture({ week: "2026-W37", signalCount: 3 }), config: config() }).status, "publishable");

  const blocked = evaluateTopSignalsGate({ draft: draftFixture({ week: "2026-W37", signalCount: 2 }), config: config() });
  assert.deepEqual(blocked.reasons, ["合格信号不足 3 条"]);
});

test("gate rejects malformed nested signals before issuing a receipt", () => {
  const draft = draftFixture({ week: "2026-W37" });
  draft.signals[0]!.evidence = [];

  assert.throws(() => evaluateTopSignalsGate({ draft, config: config() }), /evidence.*non-empty/i);
});
