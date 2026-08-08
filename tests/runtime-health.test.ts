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

test("continuity validator detects duplicate ids and multi-day gaps", () => {
  const duplicate = run("same", "2026-08-08T01:00:00Z");
  const errors = validateHistoryContinuity({ schemaVersion: 1, updatedAt: duplicate.finishedAt, runs: [duplicate, { ...run("same", "2026-08-04T01:00:00Z") }] });
  assert.ok(errors.some((error) => error.includes("重复")));
  assert.ok(errors.some((error) => error.includes("空档")));
});
