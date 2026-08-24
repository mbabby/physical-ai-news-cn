import assert from "node:assert/strict";
import test from "node:test";
import type { CompanyClaim, CompanyClaimLedger, CompanyClaimType } from "../src/company-claim-ledger.js";
import { buildDecisionCompanyCards } from "../src/decision-products/company-card.js";
import { stableDecisionId } from "../src/decision-products/contracts.js";
import type { LedgerField, LedgerFieldStatus } from "../src/ledger-contracts.js";
import type { CompanyProfile, EventRecord } from "../src/types.js";
import type { WatchlistPublicCard, WatchlistPublicView } from "../src/watchlist/public-view.js";

const NOW = new Date("2026-08-24T12:00:00.000Z");

const alpha: CompanyProfile = {
  entityId: "company-alpha",
  entityType: "公司",
  name: "Alpha Robotics",
  region: "中国",
  stage: "成长公司",
  routes: ["本体与硬件", "部署与商业化"],
  thesis: "机器人本体与工业部署",
  officialUrl: "https://alpha.example/",
  lastVerifiedAt: "2026-08-10T00:00:00.000Z",
};

const beta: CompanyProfile = {
  ...alpha,
  entityId: "company-beta",
  name: "Beta Robotics",
  officialUrl: "https://beta.example/",
};

function field<T>(
  value: T | "unknown" = "unknown",
  status: LedgerFieldStatus = "unknown",
  eventId = "evt-funding",
  observedAt = "2026-08-20T09:00:00.000Z",
): LedgerField<T> {
  const known = status !== "unknown";
  return {
    value,
    status,
    evidenceIds: known ? [`${eventId}:evidence:1`] : [],
    evidenceUrls: known ? [`https://evidence.example/${eventId}`] : [],
    observedAt: known ? observedAt : "unknown",
    verifiedAt: status === "verified" ? observedAt : "unknown",
  };
}

function claim(claimType: CompanyClaimType, eventId: string, overrides: Partial<CompanyClaim> = {}): CompanyClaim {
  return {
    claimId: `claim-${eventId}`,
    companyId: "company-alpha",
    claimType,
    statement: `Alpha ${claimType}`,
    value: "unknown",
    evidenceIds: [`${eventId}:evidence:1`],
    evidenceUrls: [`https://evidence.example/${eventId}`],
    evidenceState: "verified",
    eventIds: [eventId],
    fields: {
      eventDate: field("2026-08-20", "verified", eventId),
      round: field(), amount: field(), valuation: field(), investors: field<string[]>(),
      product: field(), customer: field<string[]>(), deployment: field(), productionStage: field(),
    },
    corrections: [],
    eventDate: "2026-08-20",
    verifiedAt: "2026-08-20T09:00:00.000Z",
    freshness: { ttlDays: 90, state: "fresh", expiresAt: "2026-11-18T09:00:00.000Z", daysSinceVerified: 4 },
    unresolvedQuestions: [],
    ...overrides,
  };
}

function ledger(claims: CompanyClaim[], companyId = "company-alpha"): CompanyClaimLedger {
  const emptyMetrics = {
    populatedFields: 0, totalFields: 0, fieldCompletenessRate: 0,
    staleClaimCount: 0, staleEvidenceCount: 0, eligibleEventCount: 0,
    attributedEventCount: 0, eventCoverageRate: 0,
  };
  return {
    generatedAt: NOW.toISOString(),
    limit: 20,
    companies: [{ companyId, companyName: companyId === "company-alpha" ? alpha.name : beta.name, selectionScore: 999, claims, metrics: emptyMetrics }],
    metrics: { ...emptyMetrics, selectedCompanyCount: 1, companiesWithEligibleEvents: 1 },
  };
}

function event(id: string, occurredAt: string, overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id,
    title: `Alpha 规范事件 ${id}`,
    type: "产品发布",
    entities: [alpha.name],
    primaryEntity: alpha.name,
    routes: ["本体与硬件"],
    status: "已确证",
    occurredAt,
    firstSeenAt: occurredAt,
    lastMaterialChangeAt: occurredAt,
    lastUpdatedAt: occurredAt,
    lastVerifiedAt: occurredAt,
    facts: ["Alpha Robotics 公布了规范进展。"],
    openQuestions: [],
    evidence: [{
      link: `https://evidence.example/${id}`,
      source: "Alpha Robotics",
      grade: "A",
      publishedAt: occurredAt,
      supports: "规范事件字段",
    }],
    timeline: [],
    ...overrides,
  };
}

function emptyWatchlist(cards: WatchlistPublicCard[] = []): WatchlistPublicView {
  return {
    week: "2026-W34",
    snapshotVersion: 1,
    methodologyVersion: "method-v1",
    lastSuccessfulAt: "2026-08-24T01:00:00.000Z",
    companyIds: cards.map((card) => card.companyId),
    forwardRadar: cards.filter((card) => card.track === "forward-radar"),
    validatedMomentum: cards.filter((card) => card.track === "validated-momentum"),
    changes: [],
  };
}

function watchlistCard(): WatchlistPublicCard {
  return {
    companyId: "company-alpha",
    companyName: alpha.name,
    thesisId: "thesis-alpha",
    thesisVersion: 1,
    track: "validated-momentum",
    group: "priority-focus",
    lifecycle: "strengthening",
    lifecycleLabel: "持续强化",
    routes: ["本体与硬件", "部署与商业化"],
    whyNow: "AI 研究判断：近期产品与部署事实得到补强。",
    routeAndDependencies: "AI 研究判断：依赖工业客户继续验证。",
    nextValidationPoints: [{ text: "核验第二个客户部署。", dueAt: "2026-10-01" }],
    falsifiers: [{ text: "规范事实被撤回。" }],
    evidenceLinks: [{ eventId: "evt-deployment", title: "部署事件", url: "https://evidence.example/evt-deployment", source: "Alpha Robotics", grade: "A" }],
    capital: { status: "verified", summary: "A 轮 · 5000 万美元" },
  };
}

test("company card projects complete canonical fields, public Watchlist context, two newest changes, and material updatedAt", () => {
  const funding = claim("funding", "evt-funding", {
    value: "A 轮 · 5000 万美元",
    eventDate: "2026-08-20",
    fields: {
      eventDate: field("2026-08-20", "verified", "evt-funding"),
      round: field("A 轮", "verified", "evt-funding"),
      amount: field("5000 万美元", "verified", "evt-funding"),
      valuation: field(),
      investors: field(["Fund A"], "verified", "evt-funding"),
      product: field(), customer: field<string[]>(), deployment: field(), productionStage: field(),
    },
  });
  const deployment = claim("deployment", "evt-deployment", {
    value: "Atlas-X",
    eventDate: "2026-08-22",
    verifiedAt: "2026-08-22T08:00:00.000Z",
    fields: {
      eventDate: field("2026-08-22", "verified", "evt-deployment", "2026-08-22T08:00:00.000Z"),
      round: field(), amount: field(), valuation: field(), investors: field<string[]>(),
      product: field("Atlas-X", "verified", "evt-deployment", "2026-08-22T08:00:00.000Z"),
      customer: field(["Factory One"], "verified", "evt-deployment", "2026-08-22T08:00:00.000Z"),
      deployment: field("上海工厂试点", "verified", "evt-deployment", "2026-08-22T08:00:00.000Z"),
      productionStage: field("pilot", "verified", "evt-deployment", "2026-08-22T08:00:00.000Z"),
    },
  });
  const events = [
    event("evt-funding", "2026-08-20T09:00:00.000Z", { type: "投融资" }),
    event("evt-deployment", "2026-08-22T08:00:00.000Z", { type: "部署案例", lastMaterialChangeAt: "2026-08-23T10:00:00.000Z" }),
    event("evt-product", "2026-08-21T08:00:00.000Z"),
  ];

  const [card] = buildDecisionCompanyCards({ companies: [alpha], claimLedger: ledger([funding, deployment]), events, watchlist: emptyWatchlist([watchlistCard()]), now: NOW });

  assert.equal(card.cardId, stableDecisionId("company", "company-alpha"));
  assert.deepEqual(card.capital, {
    status: "verified",
    summary: "A 轮 · 5000 万美元 · Fund A",
    evidence: [{ evidenceId: "evt-funding:evidence:1", url: "https://evidence.example/evt-funding", source: "Alpha Robotics", grade: "A" }],
  });
  assert.deepEqual(card.productDeployment, {
    status: "verified",
    summary: "Atlas-X · Factory One · 上海工厂试点 · pilot",
    evidence: [{ evidenceId: "evt-deployment:evidence:1", url: "https://evidence.example/evt-deployment", source: "Alpha Robotics", grade: "A" }],
  });
  assert.equal(card.validationStage, "客户试点");
  assert.deepEqual(card.watchlist, {
    track: "validated-momentum",
    lifecycle: "strengthening",
    whyNow: "AI 研究判断：近期产品与部署事实得到补强。",
    nextValidationPoints: [{ text: "核验第二个客户部署。", dueAt: "2026-10-01" }],
  });
  assert.deepEqual(card.recentChanges.map((change) => change.eventId), ["evt-deployment", "evt-product"]);
  assert.equal(card.updatedAt, "2026-08-23T10:00:00.000Z");
  assert.ok(card.unknownFields.includes("capital.valuation"));
  assert.doesNotMatch(JSON.stringify(card), /selectionScore|internalScore|rankScore|candidate-/i);
});

test("company card keeps absent financing unknown rather than negative", () => {
  const unknownFunding = claim("funding", "unused", {
    claimId: "claim-unknown-funding",
    value: "unknown", evidenceIds: [], evidenceUrls: [], evidenceState: "evidence_insufficient", eventIds: [],
    eventDate: "unknown", verifiedAt: "unknown",
    freshness: { ttlDays: 180, state: "unknown", expiresAt: "unknown", daysSinceVerified: "unknown" },
    fields: {
      eventDate: field(), round: field(), amount: field(), valuation: field(), investors: field<string[]>(),
      product: field(), customer: field<string[]>(), deployment: field(), productionStage: field(),
    },
  });

  const [card] = buildDecisionCompanyCards({ companies: [alpha], claimLedger: ledger([unknownFunding]), events: [], watchlist: emptyWatchlist(), now: NOW });
  assert.deepEqual(card.capital, { status: "unknown", summary: "证据不足（不代表未融资）", evidence: [] });
  assert.ok(card.unknownFields.includes("capital.amount"));
  assert.ok(card.unknownFields.includes("capital.valuation"));
  assert.equal(card.updatedAt, alpha.lastVerifiedAt);
});

test("company card exposes a conflict state without leaking compatibility or conflicting values", () => {
  const amount = field<string>("unknown", "conflicted", "evt-funding");
  amount.conflictingValues = ["5000 万美元", "8000 万美元"];
  const conflicting = claim("funding", "evt-funding", {
    value: "legacy compatibility value must not leak",
    fields: {
      eventDate: field("2026-08-20", "verified", "evt-funding"), round: field("A 轮", "verified", "evt-funding"),
      amount, valuation: field(), investors: field<string[]>(), product: field(), customer: field<string[]>(), deployment: field(), productionStage: field(),
    },
  });

  const [card] = buildDecisionCompanyCards({ companies: [alpha], claimLedger: ledger([conflicting]), events: [event("evt-funding", "2026-08-20T09:00:00.000Z", { type: "投融资" })], watchlist: emptyWatchlist(), now: NOW });
  assert.equal(card.capital.status, "conflicted");
  assert.equal(card.capital.summary, "字段证据存在冲突");
  assert.ok(card.unknownFields.includes("capital.amount"));
  assert.doesNotMatch(JSON.stringify(card.capital), /5000 万美元|8000 万美元|legacy compatibility/);
});

test("company card rejects a ledger event attributed to another canonical company", () => {
  const betaOwned = event("evt-beta", "2026-08-22T08:00:00.000Z", { title: "Beta 融资", type: "投融资", entities: [beta.name], primaryEntity: beta.name });
  const alphaClaim = claim("funding", "evt-beta", { eventDate: "2026-08-22" });
  assert.throws(
    () => buildDecisionCompanyCards({ companies: [alpha, beta], claimLedger: ledger([alphaClaim]), events: [betaOwned], watchlist: emptyWatchlist(), now: NOW }),
    /归属/,
  );
});

test("company cards reject candidate company identifiers at the public boundary", () => {
  const candidate = { ...alpha, entityId: "candidate-hidden" };
  assert.throws(
    () => buildDecisionCompanyCards({ companies: [candidate], claimLedger: { ...ledger([]), companies: [] }, events: [], watchlist: emptyWatchlist(), now: NOW }),
    /候选/,
  );
});

test("company cards require the explicit canonical company entity type", () => {
  const legacyProfile = { ...alpha, entityType: undefined };
  assert.deepEqual(buildDecisionCompanyCards({
    companies: [legacyProfile], claimLedger: { ...ledger([]), companies: [] },
    events: [], watchlist: emptyWatchlist(), now: NOW,
  }), []);
});

test("company cards reject candidate event identifiers before emitting recent changes", () => {
  assert.throws(
    () => buildDecisionCompanyCards({
      companies: [alpha], claimLedger: { ...ledger([]), companies: [] },
      events: [event("candidate-hidden-event", "2026-08-22T08:00:00.000Z")], watchlist: emptyWatchlist(), now: NOW,
    }),
    /候选|candidate/i,
  );
});

test("company cards reject candidate evidence identifiers before emitting facts", () => {
  const amount = field("5000 万美元", "verified", "evt-funding");
  amount.evidenceIds = ["candidate-hidden-evidence"];
  const funding = claim("funding", "evt-funding", {
    value: "5000 万美元",
    fields: {
      eventDate: field("2026-08-20", "verified", "evt-funding"), round: field(), amount,
      valuation: field(), investors: field<string[]>(), product: field(), customer: field<string[]>(), deployment: field(), productionStage: field(),
    },
  });
  assert.throws(
    () => buildDecisionCompanyCards({
      companies: [alpha], claimLedger: ledger([funding]),
      events: [event("evt-funding", "2026-08-20T09:00:00.000Z", { type: "投融资" })], watchlist: emptyWatchlist(), now: NOW,
    }),
    /候选|candidate/i,
  );
});

test("company cards reject private diagnostics disguised as public Watchlist copy", () => {
  const privateCard = { ...watchlistCard(), whyNow: "internalScore 99" };
  assert.throws(
    () => buildDecisionCompanyCards({ companies: [alpha], claimLedger: ledger([]), events: [], watchlist: emptyWatchlist([privateCard]), now: NOW }),
    /私有|分数|排名/,
  );
});

test("company card does not publish stale claims as current facts", () => {
  const stale = claim("funding", "evt-funding", {
    value: "A 轮 · 5000 万美元",
    freshness: { ttlDays: 180, state: "stale", expiresAt: "2026-08-01T09:00:00.000Z", daysSinceVerified: 200 },
    fields: {
      eventDate: field("2026-01-01", "verified", "evt-funding", "2026-01-01T09:00:00.000Z"),
      round: field("A 轮", "verified", "evt-funding", "2026-01-01T09:00:00.000Z"),
      amount: field("5000 万美元", "verified", "evt-funding", "2026-01-01T09:00:00.000Z"),
      valuation: field(), investors: field<string[]>(), product: field(), customer: field<string[]>(), deployment: field(), productionStage: field(),
    },
    eventDate: "2026-01-01", verifiedAt: "2026-01-01T09:00:00.000Z",
  });
  const [card] = buildDecisionCompanyCards({ companies: [alpha], claimLedger: ledger([stale]), events: [event("evt-funding", "2026-01-01T09:00:00.000Z", { type: "投融资" })], watchlist: emptyWatchlist(), now: NOW });
  assert.deepEqual(card.capital, { status: "unknown", summary: "证据不足（不代表未融资）", evidence: [] });
  assert.ok(card.unknownFields.includes("capital.amount"));
});

test("company card prefers material event time over newer profile verification", () => {
  const recentlyCheckedProfile = { ...alpha, lastVerifiedAt: "2026-08-23T00:00:00.000Z" };
  const materialEvent = event("evt-material", "2026-08-01T00:00:00.000Z", {
    lastMaterialChangeAt: "2026-08-02T00:00:00.000Z",
    lastUpdatedAt: "2026-08-02T00:00:00.000Z",
  });

  const [card] = buildDecisionCompanyCards({
    companies: [recentlyCheckedProfile], claimLedger: { ...ledger([]), companies: [] },
    events: [materialEvent], watchlist: emptyWatchlist(), now: NOW,
  });

  assert.equal(card.updatedAt, "2026-08-02T00:00:00.000Z");
});

test("company cards default to twenty in stable company-ID order and reject clock-driven output", () => {
  const companies = Array.from({ length: 25 }, (_, index): CompanyProfile => ({
    ...alpha,
    entityId: `company-${String(24 - index).padStart(2, "0")}`,
    name: `Company ${24 - index}`,
    officialUrl: `https://company-${24 - index}.example/`,
  }));
  const emptyLedger = { ...ledger([]), companies: [] };
  const input = { companies, claimLedger: emptyLedger, events: [], watchlist: emptyWatchlist(), now: NOW };
  const first = buildDecisionCompanyCards(input);
  const second = buildDecisionCompanyCards({ ...structuredClone(input), now: new Date("2027-08-24T12:00:00.000Z") });
  assert.equal(first.length, 20);
  assert.deepEqual(first.map((card) => card.companyId), Array.from({ length: 20 }, (_, index) => `company-${String(index).padStart(2, "0")}`));
  assert.deepEqual(second, first);
  assert.equal(buildDecisionCompanyCards({ ...input, limit: -1 }).length, 0);
  assert.equal(buildDecisionCompanyCards({ ...input, limit: Number.NaN }).length, 20);
  assert.equal(buildDecisionCompanyCards({ ...input, limit: Number.POSITIVE_INFINITY }).length, 20);
  assert.throws(() => buildDecisionCompanyCards({ ...input, now: new Date("invalid") }), /有效.*时间/);
});
