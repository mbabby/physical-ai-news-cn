import assert from "node:assert/strict";
import test from "node:test";
import type { CompanyProfile, EventRecord } from "../src/types.js";
import type { CompanyThesis, CompanyThesisArtifact, WatchlistSnapshot } from "../src/watchlist/contracts.js";
import { buildWatchlistPublicView } from "../src/watchlist/public-view.js";

const NOW = "2026-08-17T01:00:00.000Z";

function thesis(overrides: Partial<CompanyThesis> = {}): CompanyThesis {
  return {
    thesisId: "thesis-alpha",
    companyId: "company-alpha",
    track: "validated-momentum",
    lifecycle: "new",
    thesisVersion: 1,
    whyNow: "AI 研究判断：Alpha Robotics 出现新的规范事实。",
    routeAndDependencies: "AI 研究判断：路线依赖后续部署验证。",
    nextValidationPoints: [{ text: "核验后续规范事实。", dueAt: "2026-10-01" }],
    falsifiers: [{ text: "规范事实被撤回。" }],
    factReferenceIds: ["event-alpha"],
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

const company: CompanyProfile = {
  entityId: "company-alpha",
  entityType: "公司",
  name: "Alpha Robotics",
  region: "美国",
  routes: ["VLA 与具身模型"],
  thesis: "test",
  officialUrl: "https://alpha.example",
};

function event(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: "event-alpha",
    title: "Alpha Robotics 发布 Atlas-X",
    type: "产品发布",
    entities: ["Alpha Robotics"],
    primaryEntity: "Alpha Robotics",
    routes: ["VLA 与具身模型"],
    status: "已确证",
    occurredAt: "2026-08-16T00:00:00.000Z",
    eventDate: "2026-08-16",
    firstSeenAt: "2026-08-16T00:00:00.000Z",
    lastUpdatedAt: "2026-08-16T00:00:00.000Z",
    lastMaterialChangeAt: "2026-08-16T00:00:00.000Z",
    lastVerifiedAt: "2026-08-16T00:30:00.000Z",
    facts: ["Alpha Robotics 发布 Atlas-X"],
    openQuestions: [],
    timeline: [],
    productDeployment: { product: "Atlas-X", customers: [], deployment: "公开发布" },
    evidence: [{
      link: "https://alpha.example/atlas-x",
      source: "Alpha Robotics",
      grade: "A",
      publishedAt: "2026-08-16T00:00:00.000Z",
      supports: "Alpha Robotics 发布 Atlas-X",
    }],
    ...overrides,
  };
}

function snapshot(overrides: Partial<WatchlistSnapshot> = {}): WatchlistSnapshot {
  return {
    week: "2026-W34",
    snapshotVersion: 1,
    methodologyVersion: "method-v1",
    generatedAt: NOW,
    forwardRadar: [],
    validatedMomentum: [{ companyId: "company-alpha", thesisId: "thesis-alpha", thesisVersion: 1, group: "priority-focus" }],
    changesSinceLastWeek: [{ companyId: "company-alpha", change: "added" }],
    routeShareException: { route: "VLA 与具身模型", share: 1, reason: "当期仅一家公司达到公开门槛。" },
    ...overrides,
  };
}

function artifact(items: CompanyThesis[] = [thesis()]): CompanyThesisArtifact {
  return { schemaVersion: 1, generatedAt: NOW, theses: items };
}

test("resolves one public view with canonical company names and evidence links", () => {
  const view = buildWatchlistPublicView({ snapshot: snapshot(), thesisArtifact: artifact(), companies: [company], events: [event()] });
  assert.equal(view.week, "2026-W34");
  assert.equal(view.snapshotVersion, 1);
  assert.equal(view.lastSuccessfulAt, NOW);
  assert.deepEqual(view.companyIds, ["company-alpha"]);
  assert.equal(view.validatedMomentum[0]?.companyName, "Alpha Robotics");
  assert.equal(view.validatedMomentum[0]?.lifecycleLabel, "新进入");
  assert.deepEqual(view.validatedMomentum[0]?.routes, ["VLA 与具身模型"]);
  assert.deepEqual(view.validatedMomentum[0]?.evidenceLinks, [{
    eventId: "event-alpha",
    title: "Alpha Robotics 发布 Atlas-X",
    url: "https://alpha.example/atlas-x",
    source: "Alpha Robotics",
    grade: "A",
  }]);
  assert.equal(view.validatedMomentum[0]?.capital.summary, "证据不足（不代表未融资）");
  assert.doesNotMatch(JSON.stringify(view), /internalScore|\"score\"|\"rank\"/);
});

test("missing thesis, company, event, or public evidence blocks the whole view", () => {
  const base = { snapshot: snapshot(), thesisArtifact: artifact(), companies: [company], events: [event()] };
  assert.throws(() => buildWatchlistPublicView({ ...base, thesisArtifact: artifact([]) }), /判断版本/);
  assert.throws(() => buildWatchlistPublicView({ ...base, companies: [] }), /规范公司/);
  assert.throws(() => buildWatchlistPublicView({ ...base, events: [] }), /规范事件/);
  assert.throws(() => buildWatchlistPublicView({ ...base, events: [event({ evidence: [{ ...event().evidence[0]!, discovery: true }] })] }), /公开证据/);
});

test("falsified and expired theses cannot resolve into a public view", () => {
  assert.throws(() => buildWatchlistPublicView({
    snapshot: snapshot(), thesisArtifact: artifact([thesis({ lifecycle: "falsified" })]), companies: [company], events: [event()],
  }), /不可公开/);
  assert.throws(() => buildWatchlistPublicView({
    snapshot: snapshot(), thesisArtifact: artifact([thesis({ expiresAt: NOW })]), companies: [company], events: [event()],
  }), /不可公开/);
});

test("verified financing is resolved from canonical events without converting absent fields into negatives", () => {
  const funding = event({
    title: "Alpha Robotics 完成 A 轮融资",
    type: "投融资",
    facts: ["Alpha Robotics 完成 A 轮融资"],
    productDeployment: undefined,
    funding: { entityStatus: "已确认", round: "A 轮", amount: "5000 万美元", valuation: "未披露", investors: ["Fund A"] },
  });
  const view = buildWatchlistPublicView({ snapshot: snapshot(), thesisArtifact: artifact(), companies: [company], events: [funding] });
  assert.deepEqual(view.validatedMomentum[0]?.capital, {
    status: "verified",
    summary: "A 轮 · 5000 万美元 · 估值未披露",
  });
});

test("change list resolves company names from the same canonical company boundary", () => {
  const view = buildWatchlistPublicView({ snapshot: snapshot(), thesisArtifact: artifact(), companies: [company], events: [event()] });
  assert.deepEqual(view.changes, [{ companyId: "company-alpha", companyName: "Alpha Robotics", change: "added" }]);
});

test("duplicate canonical inputs and duplicate snapshot selections block the view regardless of input order", () => {
  const base = { snapshot: snapshot(), thesisArtifact: artifact(), companies: [company], events: [event()] };
  const duplicateEvent = event({ title: "Conflicting Alpha event" });
  const duplicateCompany = { ...company, name: "Conflicting Alpha" };
  const duplicateThesis = thesis({ lifecycle: "falsified" });

  for (const events of [[event(), duplicateEvent], [duplicateEvent, event()]]) {
    assert.throws(() => buildWatchlistPublicView({ ...base, events }), /重复规范事件/);
  }
  for (const companies of [[company, duplicateCompany], [duplicateCompany, company]]) {
    assert.throws(() => buildWatchlistPublicView({ ...base, companies }), /重复规范公司/);
  }
  assert.throws(() => buildWatchlistPublicView({ ...base, companies: [{ ...company, entityType: "实验室" }] }), /规范公司/);
  for (const theses of [[thesis(), duplicateThesis], [duplicateThesis, thesis()]]) {
    assert.throws(() => buildWatchlistPublicView({ ...base, thesisArtifact: artifact(theses) }), /重复判断版本/);
  }
  assert.throws(() => buildWatchlistPublicView({
    ...base,
    snapshot: snapshot({ validatedMomentum: [snapshot().validatedMomentum[0]!, snapshot().validatedMomentum[0]!] }),
  }), /重复快照选择/);
});

test("each referenced event must emit a renderable qualifying evidence link", () => {
  assert.throws(() => buildWatchlistPublicView({
    snapshot: snapshot(), thesisArtifact: artifact(), companies: [company],
    events: [event({ evidence: [{ ...event().evidence[0]!, link: "" }] })],
  }), /公开证据/);
});
