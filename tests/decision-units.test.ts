import assert from "node:assert/strict";
import test from "node:test";
import {
  applyDecisionFunnelTransitions,
  buildDecisionUnitArtifact,
  claimDecisionReferenceId,
  decisionUnitId,
  upsertDecisionUnits,
} from "../src/decision-units.js";

const NOW = new Date("2026-08-10T00:00:00.000Z");

test("creates a decision unit containing only stable Event, Claim and ResearchDecisionCard IDs", () => {
  const claimId = claimDecisionReferenceId({ companyId: "company-alpha", claimType: "funding", evidenceIds: ["evt-1:evidence:1"] });
  const artifact = buildDecisionUnitArtifact(undefined, [{
    actorId: "account-1", decisionKey: "evaluate-alpha", createdAt: NOW.toISOString(),
    references: [
      { kind: "research-decision-card", id: "arxiv:2608.00001" },
      { kind: "event", id: "evt-1" },
      { kind: "claim", id: claimId },
    ],
  }], [], NOW);
  const unit = artifact.units[0]!;
  assert.equal(unit.unitId, decisionUnitId("account-1", "evaluate-alpha"));
  assert.deepEqual(unit.references, [
    { kind: "claim", id: claimId },
    { kind: "event", id: "evt-1" },
    { kind: "research-decision-card", id: "arxiv:2608.00001" },
  ]);
  assert.deepEqual(Object.keys(unit.references[0]!).sort(), ["id", "kind"]);
  assert.equal(unit.stage, "discovered");
  assert.equal(unit.auditTrail[0]?.action, "created");
});

test("records every valid unified-funnel transition and terminal conversion", () => {
  const unit = upsertDecisionUnits([], [{ actorId: "account-1", decisionKey: "robot-choice", references: [{ kind: "event", id: "evt-1" }] }], NOW)[0]!;
  const transitions = [
    ["shortlisted", "2026-08-10T01:00:00Z"],
    ["evaluating", "2026-08-10T02:00:00Z"],
    ["decided", "2026-08-10T03:00:00Z"],
    ["acted", "2026-08-10T04:00:00Z"],
  ] as const;
  const artifact = buildDecisionUnitArtifact(
    { schemaVersion: 1, generatedAt: NOW.toISOString(), units: [unit], funnel: { totalUnits: 1, byStage: { discovered: 1, shortlisted: 0, evaluating: 0, decided: 0, acted: 0, dismissed: 0 }, active: 1, converted: 0, rejected: 0, transitionEvents: 0, conversionRate: 0 } },
    [],
    transitions.map(([toStage, at], index) => ({ unitId: unit.unitId, eventId: `transition-${index}`, toStage, actorId: "account-1", at })),
    new Date("2026-08-10T04:00:00Z"),
  );
  assert.equal(artifact.units[0]?.status, "converted");
  assert.equal(artifact.funnel.converted, 1);
  assert.equal(artifact.funnel.conversionRate, 1);
  assert.deepEqual(artifact.units[0]?.auditTrail.map((event) => event.toStage), ["discovered", "shortlisted", "evaluating", "decided", "acted"]);
});

test("rejects illegal funnel jumps and empty reference sets", () => {
  assert.throws(() => upsertDecisionUnits([], [{ actorId: "account-1", decisionKey: "empty", references: [] }], NOW), /at least one stable ID/);
  const unit = upsertDecisionUnits([], [{ actorId: "account-1", decisionKey: "reject-jump", references: [{ kind: "event", id: "evt-1" }] }], NOW)[0]!;
  assert.throws(() => applyDecisionFunnelTransitions([unit], [{ unitId: unit.unitId, eventId: "bad-jump", toStage: "acted", actorId: "account-1" }], NOW), /Invalid decision funnel transition/);
  assert.equal(unit.stage, "discovered");
  assert.equal(unit.auditTrail.length, 1);
});

test("seed reruns and repeated transition event IDs are idempotent while conflicts are rejected", () => {
  const seed = { actorId: "account-1", decisionKey: "stable", references: [{ kind: "event" as const, id: "evt-1" }] };
  const first = upsertDecisionUnits([], [seed], NOW);
  const rerun = upsertDecisionUnits(first, [seed], new Date("2026-08-10T12:00:00Z"));
  assert.deepEqual(rerun, first);
  const command = { unitId: first[0]!.unitId, eventId: "evt-transition-1", toStage: "shortlisted" as const, actorId: "account-1", detail: "saved" };
  const transitioned = applyDecisionFunnelTransitions(first, [command], NOW);
  const repeated = applyDecisionFunnelTransitions(transitioned, [command], new Date("2026-08-11T00:00:00Z"));
  assert.deepEqual(repeated, transitioned);
  assert.throws(() => applyDecisionFunnelTransitions(transitioned, [{ ...command, toStage: "evaluating" }], NOW), /eventId conflict/);
});
