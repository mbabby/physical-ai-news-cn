import assert from "node:assert/strict";
import test from "node:test";
import { buildWatchlistMetrics } from "../src/watchlist/metrics.js";

test("reports only canonical product-quality metrics with explicit unavailable following observations", () => {
  const input = {
    snapshot: {
      week: "2026-W34",
      snapshotVersion: 1,
      methodologyVersion: "method-v1",
      generatedAt: "2026-08-17T01:00:00.000Z",
      forwardRadar: [{ companyId: "company-alpha", thesisId: "thesis-alpha", thesisVersion: 1, group: "priority-focus" }],
      validatedMomentum: [],
      changesSinceLastWeek: [],
    },
    theses: {
      schemaVersion: 1,
      generatedAt: "2026-08-17T01:00:00.000Z",
      theses: [{
        thesisId: "thesis-alpha", companyId: "company-alpha", track: "forward-radar", lifecycle: "new", thesisVersion: 1,
        whyNow: "AI 研究判断：规范事实。", routeAndDependencies: "AI 研究判断：后续验证。",
        nextValidationPoints: [{ text: "核验部署。", dueAt: "2026-10-01" }], falsifiers: [{ text: "事实撤回。" }],
        factReferenceIds: ["event-alpha"], verifiedSensitiveBindings: [], inferenceLabels: ["AI 研究判断"], confidence: "medium",
        generatedAt: "2026-08-16T01:00:00.000Z", expiresAt: "2026-10-15T01:00:00.000Z", modelVersion: "model-v1", promptVersion: "prompt-v1", methodologyVersion: "method-v1",
      }],
    },
    view: {
      week: "2026-W34", snapshotVersion: 1, methodologyVersion: "method-v1", lastSuccessfulAt: "2026-08-17T01:00:00.000Z", companyIds: ["company-alpha"],
      forwardRadar: [{
        companyId: "company-alpha", companyName: "Alpha Robotics", thesisId: "thesis-alpha", thesisVersion: 1, track: "forward-radar", group: "priority-focus", lifecycle: "new", lifecycleLabel: "新进入", routes: ["VLA 与具身模型"],
        whyNow: "AI 研究判断：规范事实。", routeAndDependencies: "AI 研究判断：后续验证。", nextValidationPoints: [{ text: "核验部署。", dueAt: "2026-10-01" }], falsifiers: [{ text: "事实撤回。" }],
        evidenceLinks: [{ eventId: "event-alpha", title: "Alpha Robotics 发布进展", url: "https://alpha.example/release", source: "Alpha Robotics", grade: "A" }], capital: { status: "evidence-insufficient", summary: "证据不足（不代表未融资）" },
      }],
      validatedMomentum: [], changes: [],
    },
    changePage: { schemaVersion: 1, current: { week: "2026-W34", snapshotVersion: 1, generatedAt: "2026-08-17T01:00:00.000Z" }, baseline: null, emptyBaseline: true, changes: [] },
    feeds: { schemaVersion: 1, snapshotWeek: "2026-W34", snapshotVersion: 1, companyFeedIds: ["company-alpha"], companyFeeds: [{ companyId: "company-alpha", path: "feeds/companies/company-alpha.xml" }], routeFeeds: [
      { route: "数据与训练", slug: "data-and-training", path: "feeds/routes/data-and-training.xml" }, { route: "VLA 与具身模型", slug: "vla-and-embodied-models", path: "feeds/routes/vla-and-embodied-models.xml" }, { route: "世界模型与空间智能", slug: "world-models-and-spatial-intelligence", path: "feeds/routes/world-models-and-spatial-intelligence.xml" }, { route: "本体与硬件", slug: "embodiment-and-hardware", path: "feeds/routes/embodiment-and-hardware.xml" }, { route: "部署与商业化", slug: "deployment-and-commercialization", path: "feeds/routes/deployment-and-commercialization.xml" },
    ] },
    readme: "> 观察名单快照：2026-W34 · v1\n\nAI 研究判断\n\ncompanies.html#company-alpha\n",
  };
  const metrics = buildWatchlistMetrics(input);

  assert.deepEqual(metrics.productQuality.citationCoverage, { numerator: 1, denominator: 1, value: 1 });
  assert.deepEqual(metrics.productQuality.validationPointHitRate, { status: "unavailable", numerator: 0, denominator: 0, value: null });
  assert.deepEqual(metrics.following.visitors, { status: "unavailable", value: null });
  assert.deepEqual(metrics.following.referrers, { status: "unavailable", value: null });
  assert.deepEqual(metrics.following.copyEvents, { status: "unavailable", value: null });
  assert.deepEqual(metrics.following.shareEvents, { status: "unavailable", value: null });
  assert.equal(JSON.stringify(metrics).includes("stars"), false);
  assert.deepEqual(buildWatchlistMetrics(input), metrics);
});
