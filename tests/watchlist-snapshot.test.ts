import assert from "node:assert/strict";
import test from "node:test";
import type { CompanyThesis, WatchlistSnapshot } from "../src/watchlist/contracts.js";
import { buildWatchlistSnapshot, snapshotPath } from "../src/watchlist/snapshot.js";

const GENERATED_AT = "2026-08-17T01:00:00.000Z";

function thesis(companyId: string, overrides: Partial<CompanyThesis> = {}): CompanyThesis {
  return {
    thesisId: `thesis-${companyId}`,
    companyId,
    track: "forward-radar",
    lifecycle: "new",
    thesisVersion: 1,
    whyNow: `AI 研究判断：${companyId} 出现新的规范事实。`,
    routeAndDependencies: "AI 研究判断：路线依赖后续验证。",
    nextValidationPoints: [{ text: "核验后续规范事实。", dueAt: "2026-10-01" }],
    falsifiers: [{ text: "规范事实被撤回。" }],
    factReferenceIds: [`event-${companyId}`],
    verifiedSensitiveBindings: [],
    inferenceLabels: ["AI 研究判断"],
    confidence: "medium",
    generatedAt: "2026-08-16T01:00:00.000Z",
    expiresAt: "2026-10-15T01:00:00.000Z",
    modelVersion: "model-v1",
    promptVersion: "prompt-v1",
    methodologyVersion: "method-v1",
    ...overrides,
  };
}

function input(theses: CompanyThesis[], previous?: WatchlistSnapshot) {
  return {
    theses,
    previous,
    week: "2026-W34",
    methodologyVersion: "method-v1",
    generatedAt: GENERATED_AT,
    primaryRouteByCompanyId: Object.fromEntries(theses.map((item, index) => [item.companyId, `route-${index}`])),
    routeShareExceptionReason: "测试样本少于五家公司。",
  };
}

test("stable reruns return the exact prior snapshot without changing version or timestamp", () => {
  const first = buildWatchlistSnapshot(input([thesis("alpha"), thesis("beta", { track: "validated-momentum" })], undefined));
  const rerun = buildWatchlistSnapshot({ ...input([thesis("beta", { track: "validated-momentum" }), thesis("alpha")], first), generatedAt: "2026-08-17T02:00:00.000Z" });
  assert.equal(rerun, first);
  assert.equal(rerun.snapshotVersion, 1);
  assert.equal(rerun.generatedAt, GENERATED_AT);
  assert.deepEqual(snapshotPath(rerun), {
    current: "watchlist/current.json",
    history: "watchlist/history/2026-W34-v1.json",
  });
});

test("a correction increments the same-week version and records structured deltas", () => {
  const prior = buildWatchlistSnapshot(input([
    thesis("alpha"),
    thesis("beta", { lifecycle: "awaiting-validation" }),
    thesis("exit"),
  ]));
  const corrected = buildWatchlistSnapshot({
    ...input([
      thesis("alpha", { thesisVersion: 2, lifecycle: "strengthening" }),
      thesis("beta", { thesisVersion: 2, lifecycle: "downgraded" }),
      thesis("new-company"),
    ], prior),
    primaryRouteByCompanyId: { alpha: "route-a", beta: "route-b", "new-company": "route-c" },
  });
  assert.equal(corrected.snapshotVersion, 2);
  assert.deepEqual(corrected.changesSinceLastWeek, [
    { companyId: "alpha", change: "strengthened" },
    { companyId: "beta", change: "downgraded" },
    { companyId: "exit", change: "exited" },
    { companyId: "new-company", change: "added" },
  ]);
});

test("snapshot enforces mutual exclusion, ten entries, and at most two continued observations per track", () => {
  const theses = Array.from({ length: 14 }, (_, index) => thesis(`company-${index}`, {
    track: index % 2 ? "validated-momentum" : "forward-radar",
    lifecycle: index < 6 ? "awaiting-validation" : "new",
    generatedAt: `2026-08-${String(16 - (index % 9)).padStart(2, "0")}T01:00:00.000Z`,
  }));
  theses.push(thesis("company-0", { track: "validated-momentum", thesisVersion: 2, lifecycle: "strengthening" }));
  const routes = Object.fromEntries(theses.map((item, index) => [item.companyId, `route-${index % 5}`]));
  const snapshot = buildWatchlistSnapshot({ ...input(theses), primaryRouteByCompanyId: routes });
  const entries = [...snapshot.forwardRadar, ...snapshot.validatedMomentum];
  assert.ok(entries.length <= 10);
  assert.equal(new Set(entries.map((entry) => entry.companyId)).size, entries.length);
  assert.ok(snapshot.forwardRadar.filter((entry) => entry.group === "continued-observation").length <= 2);
  assert.ok(snapshot.validatedMomentum.filter((entry) => entry.group === "continued-observation").length <= 2);
  assert.equal(entries.find((entry) => entry.companyId === "company-0")?.thesisVersion, 2);
});

test("route concentration above forty percent requires and records an explicit exception", () => {
  const theses = [thesis("alpha"), thesis("beta"), thesis("gamma")];
  const concentrated = { alpha: "VLA", beta: "VLA", gamma: "VLA" };
  assert.throws(
    () => buildWatchlistSnapshot({ ...input(theses), primaryRouteByCompanyId: concentrated, routeShareExceptionReason: undefined }),
    /路线集中度例外原因/,
  );
  const snapshot = buildWatchlistSnapshot({
    ...input(theses),
    primaryRouteByCompanyId: concentrated,
    routeShareExceptionReason: "当期仅三家公司达到公开证据门槛。",
  });
  assert.deepEqual(snapshot.routeShareException, {
    route: "VLA",
    share: 1,
    reason: "当期仅三家公司达到公开证据门槛。",
  });
});

test("a new ISO week restarts snapshot version while retaining prior-week deltas", () => {
  const prior = buildWatchlistSnapshot(input([thesis("alpha")]));
  const next = buildWatchlistSnapshot({
    ...input([thesis("alpha", { thesisVersion: 2, lifecycle: "strengthening" })], prior),
    week: "2026-W35",
  });
  assert.equal(next.snapshotVersion, 1);
  assert.deepEqual(next.changesSinceLastWeek, [{ companyId: "alpha", change: "strengthened" }]);
});
