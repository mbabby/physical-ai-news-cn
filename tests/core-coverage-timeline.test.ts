import assert from "node:assert/strict";
import test from "node:test";
import type { CompanyClaim, CompanyClaimLedger } from "../src/company-claim-ledger.js";
import type { LedgerField } from "../src/ledger-contracts.js";
import type { EventRecord } from "../src/types.js";
import {
  coverageWindows,
  inCoverageWindow,
  needsCurrentStateReview,
  projectCoreCoverageTimeline,
} from "../src/core-coverage/timeline.js";

const NOW = new Date("2026-09-06T01:00:00Z");

function field<T>(value: T, status: LedgerField<T>["status"] = "verified", evidenceIndex = 1): LedgerField<T> {
  return { value, status, evidenceIds: [`event-1:evidence:${evidenceIndex}`], evidenceUrls: [`https://example.com/proof-${evidenceIndex}`], observedAt: "2025-01-01T00:00:00Z", verifiedAt: "2025-01-02T00:00:00Z" };
}

function claim(overrides: Partial<CompanyClaim> = {}): CompanyClaim {
  const unknown = { value: "unknown", status: "unknown", evidenceIds: [], evidenceUrls: [], observedAt: "unknown", verifiedAt: "unknown" } as const;
  return {
    claimId: "claim-1", companyId: "company-1", claimType: "funding", statement: "Series A",
    value: "$10M", evidenceIds: ["event-1:evidence:1"], evidenceUrls: ["https://example.com/proof-1"], evidenceState: "verified",
    eventIds: ["event-1"], corrections: [], eventDate: "2025-01-01", verifiedAt: "2025-01-02T00:00:00Z",
    freshness: { ttlDays: 180, state: "stale", expiresAt: "2025-07-01T00:00:00Z", daysSinceVerified: 612 }, unresolvedQuestions: [],
    fields: { eventDate: field("2025-01-01"), round: field("Series A"), amount: field("$10M"), valuation: unknown, investors: unknown, product: unknown, customer: unknown, deployment: unknown, productionStage: unknown },
    ...overrides,
  };
}

function ledger(claims: CompanyClaim[]): CompanyClaimLedger {
  return { generatedAt: NOW.toISOString(), limit: 1, companies: [{ companyId: "company-1", companyName: "Company 1", selectionScore: 1, claims, metrics: {} as never }], metrics: {} as never };
}

function event(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: "event-1", title: "Series A", type: "投融资", entities: ["Company 1"], primaryEntity: "Company 1", routes: [], status: "已核验",
    occurredAt: "2026-08-01T00:00:00Z", eventDate: "2026-08-01", dateSource: "explicit", dateConfidence: "high",
    firstSeenAt: "2026-08-20T00:00:00Z", lastUpdatedAt: "2026-08-20T00:00:00Z", lastVerifiedAt: "2026-08-20T00:00:00Z",
    facts: ["Series A"], openQuestions: [], evidence: [{ link: "https://example.com/proof-1", source: "Company", grade: "A", publishedAt: "2026-08-20T00:00:00Z", supports: "事件日期 2026-08-01；轮次 Series A；金额 $10M" }], timeline: [],
    funding: { round: "Series A", amount: "$10M", investors: [] }, ...overrides,
  };
}

test("computes inclusive Shanghai calendar windows and clamps target month end", () => {
  assert.deepEqual(coverageWindows(NOW), { backfillStart: "2025-09-06", currentStart: "2026-06-09", through: "2026-09-06" });
  assert.equal(coverageWindows(new Date("2024-02-29T01:00:00Z")).backfillStart, "2023-02-28");
  assert.equal(coverageWindows(new Date("2026-09-05T16:00:00Z")).through, "2026-09-06");
});

test("rejects unknown, malformed, and future days from a closed coverage window", () => {
  assert.equal(inCoverageWindow("unknown", "2026-06-09", "2026-09-06"), false);
  assert.equal(inCoverageWindow("2026-02-30", "2026-06-09", "2026-09-06"), false);
  assert.equal(inCoverageWindow("2026-09-07", "2026-06-09", "2026-09-06"), false);
  assert.equal(inCoverageWindow("2026-06-09", "2026-06-09", "2026-09-06"), true);
});

test("marks current state for review only after thirty Shanghai natural days", () => {
  assert.equal(needsCurrentStateReview("2026-08-07T15:59:59Z", NOW), false);
  assert.equal(needsCurrentStateReview("2026-08-06T15:59:59Z", NOW), true);
  assert.equal(needsCurrentStateReview("unknown", NOW), true);
});

test("projects explicit occurrence and known publication into independent 90-day sets", () => {
  const missingOccurrence = event({ id: "event-2", occurredAt: undefined, eventDate: undefined, dateSource: "official-published", evidence: [{ ...event().evidence[0]!, publishedAt: "2026-08-21T00:00:00Z" }] });
  const projection = projectCoreCoverageTimeline(ledger([claim({ eventIds: ["event-1", "event-2"] })]), [event(), missingOccurrence], NOW);
  assert.deepEqual(projection.occurred.map((item) => item.eventId), ["event-1"]);
  assert.deepEqual(projection.published.map((item) => item.eventId), ["event-2", "event-1"]);
  assert.equal(projection.published.find((item) => item.eventId === "event-2")?.occurredOn, "unknown");
});

test("retains verified historical funding beyond freshness TTL", () => {
  const projection = projectCoreCoverageTimeline(ledger([claim()]), [event()], NOW);
  assert.equal(projection.historicalFunding.length, 1);
  assert.equal(projection.historicalFunding[0]?.claimId, "claim-1");
});

test("withdrawn or conflicted evidence cannot retain projected facts", () => {
  const deployment = claim({ claimId: "claim-deploy", claimType: "deployment", eventIds: ["event-1"], fields: { ...claim().fields, deployment: field("Factory") } });
  const withdrawn = event({ evidenceState: "withdrawn" } as Partial<EventRecord>);
  assert.deepEqual(projectCoreCoverageTimeline(ledger([claim(), deployment]), [withdrawn], NOW).historicalFunding, []);
  assert.deepEqual(projectCoreCoverageTimeline(ledger([claim(), deployment]), [withdrawn], NOW).currentFacts, []);
  const conflicted = event({ evidence: [{ ...event().evidence[0]!, withdrawn: true } as EventRecord["evidence"][number]] });
  assert.deepEqual(projectCoreCoverageTimeline(ledger([deployment]), [conflicted], NOW).currentFacts, []);
});

test("removes fields bound only to a withdrawn source while preserving independently live fields", () => {
  const mixed = event({ evidence: [
    { ...event().evidence[0]!, supports: "部署 Factory", withdrawn: true } as EventRecord["evidence"][number],
    { ...event().evidence[0]!, link: "https://example.com/proof-2", source: "Company filing", publishedAt: "2026-08-21T00:00:00Z", supports: "产品 Robot" },
  ], productDeployment: { product: "Robot", customers: [], deployment: "Factory" } });
  const deployment = claim({ claimType: "deployment", fields: { ...claim().fields, deployment: field("Factory", "verified", 1), product: field("Robot", "verified", 2) } });
  const projected = projectCoreCoverageTimeline(ledger([deployment]), [mixed], NOW).currentFacts;
  assert.equal(projected.length, 1);
  assert.equal(projected[0]?.fields.deployment, undefined);
  assert.equal(projected[0]?.fields.product?.value, "Robot");
  assert.deepEqual(projected[0]?.fields.product?.evidenceUrls, ["https://example.com/proof-2"]);
  assert.deepEqual(projectCoreCoverageTimeline(ledger([deployment]), [mixed], NOW).published.map((item) => item.eventId), ["event-1"]);
});

test("does not let an unrelated A source rescue a field after one corroborating B is withdrawn", () => {
  const mixed = event({ evidence: [
    { ...event().evidence[0]!, grade: "B", source: "Media 1", independentOrigin: "media-1", supports: "金额 $10M", withdrawn: true } as EventRecord["evidence"][number],
    { ...event().evidence[0]!, link: "https://example.com/proof-2", grade: "B", source: "Media 2", independentOrigin: "media-2", supports: "金额 $10M" },
    { ...event().evidence[0]!, link: "https://example.com/proof-3", source: "Company", supports: "轮次 Series A" },
  ] });
  const funding = claim({ fields: { ...claim().fields, round: field("Series A", "verified", 3), amount: field("$10M", "verified", 2) } });
  const projected = projectCoreCoverageTimeline(ledger([funding]), [mixed], NOW).historicalFunding;
  assert.equal(projected.length, 1);
  assert.equal(projected[0]?.fields.amount, undefined);
  assert.equal(projected[0]?.fields.round?.value, "Series A");
  assert.deepEqual(projected[0]?.fields.round?.evidenceUrls, ["https://example.com/proof-3"]);
});

test("does not expose unrelated or insufficient-proof canonical events", () => {
  const unrelated = event({ id: "event-unrelated" });
  const candidate = event({ id: "event-candidate", evidenceState: "candidate" } as Partial<EventRecord>);
  const singleB = event({ id: "event-single-b", evidence: [{ ...event().evidence[0]!, grade: "B", source: "Media" }] });
  const projection = projectCoreCoverageTimeline(ledger([claim()]), [event(), unrelated, candidate, singleB], NOW);
  assert.deepEqual(projection.published.map((item) => item.eventId), ["event-1"]);
});

test("rejects malformed or future explicit occurrence clocks and legacy ledger fallback dates", () => {
  const malformed = event({ occurredAt: "2026-02-30", eventDate: "2026-02-30" });
  const malformedProjection = projectCoreCoverageTimeline(ledger([claim()]), [malformed], NOW);
  assert.deepEqual(malformedProjection.occurred, []);
  assert.equal(malformedProjection.historicalFunding[0]?.fields.eventDate, undefined);

  const future = event({ occurredAt: "2026-09-07T00:00:00Z", eventDate: "2026-09-07" });
  assert.deepEqual(projectCoreCoverageTimeline(ledger([claim()]), [future], NOW).occurred, []);
});

test("date-only today is valid before 08:00 Shanghai but actual future timestamps are not", () => {
  const earlyNow = new Date("2026-09-05T16:30:00Z");
  const dated = event({ occurredAt: "2026-09-06", eventDate: "2026-09-06" });
  const projection = projectCoreCoverageTimeline(ledger([claim()]), [dated], earlyNow);
  assert.equal(projection.occurred[0]?.occurredOn, "2026-09-06");
  const timestamp = event({ occurredAt: "2026-09-06T00:00:00Z" });
  assert.deepEqual(projectCoreCoverageTimeline(ledger([claim()]), [timestamp], earlyNow).occurred, []);
});

test("future verification timestamps require review even within today's Shanghai calendar day", () => {
  assert.equal(needsCurrentStateReview("2026-09-06T01:00:01Z", NOW), true);
  assert.equal(needsCurrentStateReview("2026-09-07T00:00:00Z", NOW), true);
  assert.equal(needsCurrentStateReview("2026-09-06T01:00:00Z", NOW), false);
});

test("impossible verification dates require review rather than normalizing to a recent date", () => {
  const march = new Date("2026-03-02T01:00:00Z");
  assert.equal(needsCurrentStateReview("2026-02-30", march), true);
  assert.equal(needsCurrentStateReview("2026-02-30T00:00:00Z", march), true);
  assert.equal(needsCurrentStateReview("2026-02-28T00:00:00Z", march), false);
});

test("date-only verification today is valid before 08:00 Shanghai, while tomorrow needs review", () => {
  const earlyNow = new Date("2026-09-05T16:30:00Z");
  assert.equal(needsCurrentStateReview("2026-09-06", earlyNow), false);
  assert.equal(needsCurrentStateReview("2026-09-07", earlyNow), true);
  assert.equal(needsCurrentStateReview("2026-09-06T00:00:00Z", earlyNow), true);
});
