import assert from "node:assert/strict";
import test from "node:test";
import { buildApprovedAnalysisTemplates, buildCoverageBriefs } from "../src/core-coverage/brief.js";
import { deriveCoverageCorrections } from "../src/core-coverage/corrections.js";
import { fixture, event, NOW } from "./core-coverage-fixtures.js";

test("withdrawal appends immutable before/after field history and repeat runs stay idempotent", () => {
  const input = fixture([event("funding"), event()]);
  const analyses = buildApprovedAnalysisTemplates(input);
  const previous = buildCoverageBriefs({ ...input, analyses });
  const current = buildCoverageBriefs({ ...input, events: [input.events[1]!], analyses });
  const previousCopy = structuredClone(previous);
  const changes = deriveCoverageCorrections({ previous, current, now: NOW });
  const amount = changes.find((item) => item.fieldPath.endsWith(".amount"))!;
  assert.ok(amount, "withdrawn amount must produce a before/after correction");
  assert.equal(amount.before.value, "1200 万美元");
  assert.equal(amount.after.value, "unknown");
  assert.equal(amount.reason, "source-withdrawn");
  assert.equal(amount.companyId, "alpha");
  assert.ok(changes.every((item) => !item.fieldPath.endsWith(".deployment")));
  assert.deepEqual(previous, previousCopy);
  const rerun = deriveCoverageCorrections({ previous, current, previousCorrections: changes, now: new Date("2026-09-07") });
  assert.deepEqual(rerun, changes);
  assert.deepEqual(deriveCoverageCorrections({ previous, current, now: new Date("2026-09-07") }).map((item) => item.changeId), changes.map((item) => item.changeId));
  const restored = deriveCoverageCorrections({ previous: current, current: previous, previousCorrections: changes, now: NOW });
  assert.deepEqual(restored.slice(0, changes.length), changes);
  assert.ok(restored.length > changes.length);
});

test("verifiedAt-only updates do not create corrections or material change dates", () => {
  const beforeInput = fixture();
  const afterInput = fixture([event("deployment", { lastVerifiedAt: NOW.toISOString() })]);
  const previous = buildCoverageBriefs({ ...beforeInput, analyses: buildApprovedAnalysisTemplates(beforeInput) });
  const current = buildCoverageBriefs({ ...afterInput, analyses: buildApprovedAnalysisTemplates(afterInput) });
  assert.equal(previous[0]?.lastMaterialChangeAt, "2026-08-20T00:00:00.000Z");
  assert.deepEqual(deriveCoverageCorrections({ previous, current, now: NOW }), []);
  assert.equal(current[0]?.lastMaterialChangeAt, previous[0]?.lastMaterialChangeAt);
});

test("conflict-caused removals retain their reason and never masquerade as source withdrawal", () => {
  const input = fixture([event("funding"), event()]);
  const analyses = buildApprovedAnalysisTemplates(input);
  const previous = buildCoverageBriefs({ ...input, analyses });
  const current = buildCoverageBriefs({ ...input, events: [{ ...input.events[0]!, openQuestions: ["金额证据冲突"] }, event()], analyses });
  const changes = deriveCoverageCorrections({ previous, current, now: NOW });
  assert.ok(changes.length > 0);
  assert.ok(changes.every((change) => change.reason === "conflict-detected"));
  assert.equal(changes.find((change) => change.fieldPath.endsWith(".amount"))?.after.value, "unknown");
});

test("canonical field conflicts retain field-specific reasons without conflict keywords", () => {
  const funding = event("funding", { evidence: [
    { ...event("funding").evidence[0]!, link: "https://alpha.example/a-round", supports: "轮次 Seed" },
    { ...event("funding").evidence[0]!, link: "https://alpha.example/b-amount", supports: "金额 1200 万美元" },
  ] });
  const input = fixture([funding, event()]);
  const analyses = buildApprovedAnalysisTemplates(input);
  const previous = buildCoverageBriefs({ ...input, analyses });
  const disputed = structuredClone(funding);
  disputed.openQuestions = ["金额：1200 万美元 / 1500 万美元"];
  Object.assign(disputed.evidence[0]!, { withdrawn: true });
  disputed.evidence.push({ ...funding.evidence[1]!, link: "https://alpha.example/c-amount", supports: "金额 1500 万美元" });
  const current = buildCoverageBriefs({ ...input, events: [disputed, event()], analyses });
  assert.ok(current[0]!.gapsZh.some((gap) => /冲突/.test(gap)));
  assert.ok(current[0]!.reviewIssues.some((issue) => issue.reason === "conflict" && issue.fieldPath === "amount"));
  assert.doesNotMatch(current[0]!.summaryZh, /1200|1500/);
  assert.match(current[0]!.summaryZh, /工厂测试/);
  assert.deepEqual(current[0]!.analyses.map((item) => item.template), ["deployment-validation"]);
  const changes = deriveCoverageCorrections({ previous, current, now: NOW });
  assert.equal(changes.find((change) => change.fieldPath.endsWith(".amount"))?.reason, "conflict-detected");
  assert.equal(changes.find((change) => change.fieldPath.endsWith(".round"))?.reason, "source-withdrawn");
  const restored = deriveCoverageCorrections({ previous: current, current: previous, previousCorrections: changes, now: NOW });
  assert.equal(restored.slice(changes.length).find((change) => change.fieldPath.endsWith(".amount"))?.reason, "conflict-resolved");
});
