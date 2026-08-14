import assert from "node:assert/strict";
import test from "node:test";
import { scoreThesisSeed, selectWatchlistSeeds } from "../src/watchlist/scoring.js";
import type { TechnicalRoute } from "../src/types.js";
import type { ThesisSeed } from "../src/watchlist/seeds.js";

const ROUTE: TechnicalRoute = "VLA 与具身模型";

function seed(
  companyId: string,
  track: ThesisSeed["track"],
  overrides: Partial<ThesisSeed> = {},
): ThesisSeed {
  return {
    companyId,
    companyName: companyId,
    track,
    routes: [ROUTE],
    factReferenceIds: [`fact-${companyId}`],
    evidenceGrade: "A",
    verifiedSensitiveFields: [],
    unknownSensitiveFields: ["amount", "valuation", "customer", "revenue", "order"],
    evidenceSummary: ["canonical fact"],
    ...overrides,
  };
}

test("scores only structurally supported components and records unknowns", () => {
  const result = scoreThesisSeed(seed("forward", "forward-radar", {
    verifiedSensitiveFields: ["amount"],
    unknownSensitiveFields: ["valuation", "customer", "revenue", "order"],
  }));

  assert.equal(result.eligible, true);
  assert.deepEqual(result.components.map((component) => [component.key, component.maxPoints]), [
    ["route-differentiation", 25], ["team-history", 20], ["capital-partnership-talent", 15],
    ["value-chain-position", 15], ["novelty", 15], ["verifiability", 10],
  ]);
  assert.deepEqual(result.components.find((component) => component.key === "team-history"), {
    key: "team-history", label: "团队与历史能力", points: 0, maxPoints: 20,
    basis: "种子未提供可核验的团队或历史结构字段", unknown: true,
  });
  assert.equal(result.components.find((component) => component.key === "capital-partnership-talent")?.points, 15);
});

test("momentum gates a single-B source before it can receive a substantive score", () => {
  const result = scoreThesisSeed(seed("single-b", "validated-momentum", { evidenceGrade: "B" }));
  assert.equal(result.eligible, false);
  assert.equal(result.score, 0);
  assert.ok(result.components.every((component) => component.points === 0 && component.unknown));
  assert.ok(result.components.every((component) => component.basis.startsWith("资格门槛未通过；未评分：")));
  assert.match(result.ineligibilityReasons.join(" "), /B\+B/);
});

test("momentum uses confirmed weights and never turns absent continuity into a negative fact", () => {
  const result = scoreThesisSeed(seed("momentum", "validated-momentum", {
    routes: ["部署与商业化", "本体与硬件"],
    verifiedSensitiveFields: ["customer", "amount"],
    unknownSensitiveFields: ["valuation", "revenue", "order"],
    evidenceGrade: "B+B",
  }));

  assert.deepEqual(result.components.map((component) => [component.key, component.maxPoints]), [
    ["customer-deployment-revenue-production", 30], ["technology-product", 20], ["capital", 15],
    ["continuity-30-90", 15], ["evidence-strength", 15], ["diversity", 5],
  ]);
  assert.deepEqual(result.components.find((component) => component.key === "continuity-30-90"), {
    key: "continuity-30-90", label: "30/90 天连续强化", points: 0, maxPoints: 15,
    basis: "种子未提供可比较的 30/90 天时间序列", unknown: true,
  });
  assert.equal(result.components.find((component) => component.key === "customer-deployment-revenue-production")?.points, 30);
  assert.equal(result.components.find((component) => component.key === "evidence-strength")?.points, 12);
  assert.deepEqual(result.components.find((component) => component.key === "diversity"), {
    key: "diversity", label: "路线与地域多样性", points: 0, maxPoints: 5,
    basis: "已记录 2 条技术路线；种子未提供地域字段，无法完成路线与地域多样性判断", unknown: true,
  });
});

test("selection is elastic, mutually exclusive, route-diverse, and stable", () => {
  const sameRoute = "VLA 与具身模型" as TechnicalRoute;
  const otherRoutes: TechnicalRoute[] = ["数据与训练", "世界模型与空间智能", "本体与硬件", "部署与商业化"];
  const scored = [
    scoreThesisSeed(seed("shared", "forward-radar", { evidenceGrade: "A" })),
    scoreThesisSeed(seed("shared", "validated-momentum", { evidenceGrade: "B+B", verifiedSensitiveFields: ["customer"] })),
    ...Array.from({ length: 5 }, (_, index) => scoreThesisSeed(seed(`forward-${index}`, "forward-radar", { routes: [sameRoute] }))),
    ...otherRoutes.map((route, index) => scoreThesisSeed(seed(`momentum-${index}`, "validated-momentum", {
      routes: [route], verifiedSensitiveFields: ["customer"], evidenceGrade: "A",
    }))),
  ];

  const selected = selectWatchlistSeeds(scored, { totalLimit: 10, perTrackTarget: 5, maxRouteShare: 0.4 });
  const entries = [...selected.forwardRadar, ...selected.validatedMomentum];
  assert.ok(entries.length <= 10);
  assert.equal(new Set(entries.map((item) => item.companyId)).size, entries.length);
  assert.equal(entries.find((item) => item.companyId === "shared")?.track, "validated-momentum");
  assert.ok(entries.filter((item) => item.primaryRoute === sameRoute).length <= 4);
  assert.ok(selected.forwardRadar.filter((item) => item.selectionGroup === "continued-observation").length <= 2);
  assert.ok(selected.validatedMomentum.filter((item) => item.selectionGroup === "continued-observation").length <= 2);
  assert.deepEqual(selectWatchlistSeeds([...scored].reverse(), { totalLimit: 10, perTrackTarget: 5, maxRouteShare: 0.4 }), selected);
});

test("selection does not invent alternates when only one route has eligible candidates", () => {
  const selected = selectWatchlistSeeds([
    scoreThesisSeed(seed("zulu", "forward-radar")),
    scoreThesisSeed(seed("alpha", "forward-radar")),
  ], { totalLimit: 10, perTrackTarget: 5, maxRouteShare: 0.4 });

  assert.deepEqual(selected.forwardRadar.map((item) => item.companyId), ["alpha", "zulu"]);
  assert.deepEqual(selected.validatedMomentum, []);
});
