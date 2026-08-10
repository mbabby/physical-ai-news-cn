import assert from "node:assert/strict";
import test from "node:test";
import { applyReviewCaseActions, buildReviewCaseArtifact, reviewCaseId } from "../src/review-cases.js";
import { assignReviewCases, buildReviewAssignmentArtifact } from "../src/review-assignment.js";

const NOW = new Date("2026-08-10T00:00:00.000Z");
const CREATED = "2026-08-09T22:00:00.000Z";

function cases() {
  return buildReviewCaseArtifact(undefined, [{
    id: "fixture",
    generate: () => [
      { type: "article" as const, subjectId: "urgent", priority: "P0" as const, createdAt: CREATED, nextAction: "核对官方公告" },
      { type: "company" as const, subjectId: "company", priority: "P1" as const, createdAt: CREATED, nextAction: "核对公司主体" },
      { type: "article" as const, subjectId: "second", priority: "P2" as const, createdAt: CREATED, nextAction: null },
    ],
  }], NOW).cases;
}

test("auto-assigns deterministically with owner, dueAt, nextAction and priority SLO", () => {
  const artifact = buildReviewAssignmentArtifact(cases(), [
    { ownerId: "bob", maxActiveCases: 2, caseTypes: ["article", "company"] },
    { ownerId: "alice", maxActiveCases: 2, caseTypes: ["article", "company"] },
  ], undefined, NOW);
  const urgent = artifact.assignments.find((item) => item.caseId === reviewCaseId("article", "urgent"))!;
  assert.equal(urgent.owner, "alice");
  assert.equal(urgent.status, "assigned");
  assert.equal(urgent.dueAt, "2026-08-10T02:00:00.000Z");
  assert.equal(urgent.nextAction, "核对官方公告");
  assert.equal(urgent.slo.firstResponseHours, 4);
  assert.equal(urgent.autoDecisionAllowed, false);
  assert.equal(artifact.metrics.assigned, 3);
  assert.deepEqual(artifact.metrics.ownerLoad, { alice: { active: 2, capacity: 2 }, bob: { active: 1, capacity: 2 } });
});

test("capacity limiting leaves overflow unassigned and safely private", () => {
  const assigned = assignReviewCases(cases(), [{ ownerId: "only-reviewer", maxActiveCases: 1 }], [], NOW);
  assert.equal(assigned.filter((item) => item.status === "assigned").length, 1);
  const overflow = assigned.filter((item) => item.status === "unassigned");
  assert.equal(overflow.length, 2);
  assert.ok(overflow.every((item) => item.owner === null && item.reason === "capacity-exhausted" && item.autoDecisionAllowed === false));
  assert.match(overflow.find((item) => item.nextAction.includes("容量"))?.nextAction ?? "", /保持私有/);
});

test("missing owner configuration degrades explicitly without losing SLO or next action", () => {
  const reviewCases = cases().slice(0, 1);
  const [assignment] = assignReviewCases(reviewCases, [], [], NOW);
  assert.equal(assignment?.owner, null);
  assert.equal(assignment?.status, "unassigned");
  assert.equal(assignment?.reason, "no-eligible-owner");
  assert.equal(assignment?.dueAt, "2026-08-10T02:00:00.000Z");
  assert.equal(assignment?.nextAction, "核对官方公告");
  assert.equal(assignment?.auditTrail[0]?.action, "degraded");
  assert.deepEqual(assignReviewCases(reviewCases, [], [assignment!], NOW), [assignment]);
});

test("assignment reruns are idempotent and a rejected case becomes completed", () => {
  const reviewCases = cases().slice(0, 1);
  const owners = [{ ownerId: "alice", maxActiveCases: 1 }];
  const first = assignReviewCases(reviewCases, owners, [], NOW);
  const rerun = assignReviewCases(reviewCases, owners, first, NOW);
  assert.deepEqual(rerun, first);

  const rejected = applyReviewCaseActions(reviewCases, [{ caseId: reviewCases[0]!.caseId, action: "rejected", at: "2026-08-10T01:00:00Z", decisionReason: "证据冲突" }]);
  const completed = assignReviewCases(rejected, owners, first, new Date("2026-08-10T01:00:00Z"));
  assert.equal(completed[0]?.status, "completed");
  assert.equal(completed[0]?.reason, "case-completed");
  assert.equal(completed[0]?.auditTrail.at(-1)?.action, "completed");
  const completedRerun = assignReviewCases(rejected, owners, completed, new Date("2026-08-10T02:00:00Z"));
  assert.deepEqual(completedRerun, completed);
});
