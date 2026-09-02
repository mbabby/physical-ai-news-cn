import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { assessDailyPublicationFreshness, buildPipelineHealth, updateRunHistory, validateHistoryContinuity } from "../src/runtime/health.js";
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

test("daily publication freshness stays pending until the 09:20 Beijing SLA cutoff", () => {
  const latest = run("yesterday", "2026-08-17T01:00:00Z");
  const history = { schemaVersion: 1 as const, updatedAt: latest.finishedAt, runs: [latest] };

  assert.deepEqual(
    assessDailyPublicationFreshness(history, new Date("2026-08-18T01:19:00Z")),
    { expectedDate: "2026-08-18", latestPublishedDate: "2026-08-17", state: "pending", publicationDue: false },
  );
});

test("daily publication freshness is missing at the 09:20 Beijing SLA cutoff", () => {
  const latest = run("yesterday", "2026-08-17T01:00:00Z");
  const history = { schemaVersion: 1 as const, updatedAt: latest.finishedAt, runs: [latest] };

  assert.deepEqual(
    assessDailyPublicationFreshness(history, new Date("2026-08-18T01:20:00Z")),
    { expectedDate: "2026-08-18", latestPublishedDate: "2026-08-17", state: "missing", publicationDue: true },
  );
});

test("daily publication freshness uses the Beijing calendar date across a UTC day boundary", () => {
  const localToday = run("beijing-today", "2026-08-17T16:30:00Z");
  const history = { schemaVersion: 1 as const, updatedAt: localToday.finishedAt, runs: [localToday] };

  assert.deepEqual(
    assessDailyPublicationFreshness(history, new Date("2026-08-18T01:20:00Z")),
    { expectedDate: "2026-08-18", latestPublishedDate: "2026-08-18", state: "current", publicationDue: true },
  );
});

test("a failed same-day run does not satisfy the daily publication SLA and is used as the date fallback", () => {
  const failed = run("failed", "2026-08-18T00:30:00Z", "failed");
  const history = { schemaVersion: 1 as const, updatedAt: failed.finishedAt, runs: [failed] };

  assert.deepEqual(
    assessDailyPublicationFreshness(history, new Date("2026-08-18T01:20:00Z")),
    { expectedDate: "2026-08-18", latestPublishedDate: "2026-08-18", state: "missing", publicationDue: true },
  );
});

test("a non-failed same-day run satisfies the daily publication SLA and is projected in pipeline health", () => {
  const current = run("current", "2026-08-18T00:30:00Z", "success", 0);
  const history = { schemaVersion: 1 as const, updatedAt: current.finishedAt, runs: [current] };
  const now = new Date("2026-08-18T01:20:00Z");

  assert.deepEqual(
    assessDailyPublicationFreshness(history, now),
    { expectedDate: "2026-08-18", latestPublishedDate: "2026-08-18", state: "current", publicationDue: true },
  );
  assert.deepEqual(buildPipelineHealth(history, now).dailyPublicationFreshness, {
    expectedDate: "2026-08-18",
    latestPublishedDate: "2026-08-18",
    state: "current",
    publicationDue: true,
  });
});

const validateHealthAt = (now: string) => spawnSync(
  process.execPath,
  ["--require", "./tests/helpers/freeze-now.cjs", "--import", "tsx", "src/validate-health.ts"],
  { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, FREEZE_NOW: now } },
);

test("validate health accepts a pending daily publication before the Beijing cutoff", () => {
  const result = validateHealthAt("2026-09-02T01:19:00Z");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"state": "pending"/);
});

test("validate health rejects a missing daily publication at the Beijing cutoff", () => {
  const result = validateHealthAt("2026-09-02T01:20:00Z");

  assert.equal(result.status, 1);
  assert.match(result.stdout, /"state": "missing"/);
  assert.match(result.stderr, /北京时间日报未在 09:20 前成功发布/);
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
