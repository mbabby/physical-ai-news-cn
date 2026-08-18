import assert from "node:assert/strict";
import test from "node:test";
import { buildPipelineHealth, updateRunHistory, validateHistoryContinuity } from "../src/runtime/health.js";
import type { RunManifest } from "../src/types.js";

const run = (id: string, finishedAt: string, status: RunManifest["status"] = "success", items = 3): RunManifest => ({
  schemaVersion: 1,
  runId: id,
  date: finishedAt.slice(0, 10),
  startedAt: finishedAt,
  finishedAt,
  status,
  quality: { publicIndustryItems: items, publicResearchItems: 0, candidates: 0, sourceFailures: 0 },
  services: [],
  outputs: 1,
});

test("run history is idempotent, ordered and bounded", () => {
  const first = run("one", "2026-08-07T01:00:00Z");
  const second = run("two", "2026-08-08T01:00:00Z", "degraded");
  let history = updateRunHistory(undefined, first, 2);
  history = updateRunHistory(history, second, 2);
  history = updateRunHistory(history, second, 2);
  assert.deepEqual(history.runs.map((item) => item.runId), ["two", "one"]);
});

test("pipeline health exposes a degraded but successfully published run", () => {
  const history = updateRunHistory(undefined, run("latest", "2026-08-08T01:00:00Z", "degraded", 6));
  const health = buildPipelineHealth(history, new Date("2026-08-08T02:00:00Z"));
  assert.equal(health.status, "degraded");
  assert.equal(health.consecutiveSuccessfulPublications, 1);
  assert.equal(health.latestPublicItems, 6);
  assert.match(health.reasons.join(" "), /外部服务或信源降级/);
});

test("pipeline health marks an old publication stale", () => {
  const history = updateRunHistory(undefined, run("old", "2026-08-06T01:00:00Z"));
  assert.equal(buildPipelineHealth(history, new Date("2026-08-08T02:00:00Z")).status, "stale");
});

test("pipeline health reports a missed day as degraded without making future publication stale", () => {
  const latest = run("latest", "2026-08-18T01:00:00Z");
  const beforeGap = run("before-gap", "2026-08-16T01:00:00Z");
  const health = buildPipelineHealth(
    { schemaVersion: 1, updatedAt: latest.finishedAt, runs: [latest, beforeGap] },
    new Date("2026-08-18T02:00:00Z"),
  );
  assert.equal(health.status, "degraded");
  assert.match(health.reasons.join(" "), /1 天空档：2026-08-16 → 2026-08-18/);
});

test("pipeline health artifact validation rejects a forged healthy state over a missed day", async () => {
  const latest = run("latest", "2026-08-18T01:00:00.000Z");
  const beforeGap = run("before-gap", "2026-08-16T01:00:00.000Z");
  const history = { schemaVersion: 1 as const, updatedAt: latest.finishedAt, runs: [latest, beforeGap] };
  const expected = buildPipelineHealth(history, new Date(history.updatedAt));
  const runtime = await import("../src/runtime/health.js") as Record<string, unknown>;
  assert.equal(typeof runtime.validatePipelineHealthArtifact, "function");
  const validate = runtime.validatePipelineHealthArtifact as (input: typeof history, artifact: typeof expected) => string[];
  const errors = validate(history, { ...expected, status: "healthy", reasons: [] });
  assert.match(errors.join(" "), /没有由运行历史正确派生/);
});

test("pipeline health artifact validation binds its clock to the latest run receipt", async () => {
  const latest = run("latest", "2026-08-18T01:00:00.000Z");
  const history = { schemaVersion: 1 as const, updatedAt: latest.finishedAt, runs: [latest] };
  const runtime = await import("../src/runtime/health.js") as Record<string, unknown>;
  const validate = runtime.validatePipelineHealthArtifact as (input: typeof history, artifact: ReturnType<typeof buildPipelineHealth>) => string[];

  const wrongClock = buildPipelineHealth(history, new Date("2026-08-20T00:00:00Z"));
  assert.match(validate(history, wrongClock).join(" "), /检查时间没有绑定最新运行/);

  const forgedHistory = { ...history, updatedAt: "2026-08-19T00:00:00Z" };
  const forgedArtifact = buildPipelineHealth(forgedHistory, new Date(forgedHistory.updatedAt));
  assert.match(validate(forgedHistory, forgedArtifact).join(" "), /运行历史更新时间没有绑定最新运行/);
});

test("continuity validator detects duplicate ids and multi-day gaps", () => {
  const duplicate = run("same", "2026-08-08T01:00:00Z");
  const errors = validateHistoryContinuity({ schemaVersion: 1, updatedAt: duplicate.finishedAt, runs: [duplicate, { ...run("same", "2026-08-04T01:00:00Z") }] });
  assert.ok(errors.some((error) => error.includes("重复")));
  assert.ok(errors.some((error) => error.includes("空档")));
});
