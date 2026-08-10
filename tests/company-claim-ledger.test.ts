import assert from "node:assert/strict";
import test from "node:test";
import { buildCompanyClaimLedger } from "../src/company-claim-ledger.js";
import type { CompanyProfile, EventRecord } from "../src/types.js";

const NOW = new Date("2026-08-10T00:00:00.000Z");

function company(name: string, entityId = name.toLowerCase().replace(/\s+/g, "-")): CompanyProfile {
  return { entityId, name, region: "北美", stage: "创业公司", routes: ["VLA 与具身模型"], thesis: "测试实体", officialUrl: `https://${entityId}.example` };
}

function event(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: "evt-verified", title: "Alpha Robotics 完成 1200 万美元种子轮融资", type: "投融资", entities: ["Alpha Robotics"], primaryEntity: "Alpha Robotics",
    routes: ["VLA 与具身模型"], status: "已确证", occurredAt: "2026-08-01T00:00:00.000Z", firstSeenAt: "2026-08-01T00:00:00.000Z",
    lastEvidenceAt: "2026-08-01T00:00:00.000Z", lastMaterialChangeAt: "2026-08-01T00:00:00.000Z", lastUpdatedAt: "2026-08-01T00:00:00.000Z", lastVerifiedAt: "2026-08-02T00:00:00.000Z",
    facts: [], openQuestions: [], timeline: [], funding: { entityStatus: "已确认", round: "Seed", amount: "1200 万美元", investors: [] },
    evidence: [{ link: "https://alpha.example/funding", source: "Alpha 官方公告", grade: "A", publishedAt: "2026-08-01T00:00:00.000Z", supports: "融资主体、轮次和金额" }],
    ...overrides,
  };
}

test("materializes a verified, traceable funding claim from an attributed event", () => {
  const ledger = buildCompanyClaimLedger([company("Alpha Robotics")], [event()], { now: NOW });
  const claim = ledger.companies[0]!.claims.find((item) => item.claimType === "funding")!;
  assert.equal(claim.companyId, "alpha-robotics");
  assert.equal(claim.value, "Seed · 1200 万美元");
  assert.equal(claim.evidenceState, "verified");
  assert.deepEqual(claim.evidenceIds, ["evt-verified:evidence:1"]);
  assert.deepEqual(claim.evidenceUrls, ["https://alpha.example/funding"]);
  assert.equal(claim.eventDate, "2026-08-01");
  assert.equal(claim.verifiedAt, "2026-08-02T00:00:00.000Z");
  assert.equal(claim.freshness.state, "fresh");
  assert.equal(ledger.metrics.eventCoverageRate, 1);
});

test("uses evidence_insufficient and unknown for a company with no funding proof", () => {
  const ledger = buildCompanyClaimLedger([company("Quiet Robotics")], [], { now: NOW });
  const claim = ledger.companies[0]!.claims[0]!;
  assert.equal(claim.claimType, "funding");
  assert.equal(claim.evidenceState, "evidence_insufficient");
  assert.equal(claim.value, "unknown");
  assert.deepEqual(claim.evidenceUrls, []);
  assert.match(claim.statement, /未收录可归属的公开融资证据/);
  assert.doesNotMatch(claim.statement, /没有融资|未融资/);
  assert.equal(ledger.metrics.fieldCompletenessRate < 1, true);
});

test("does not turn a single B-grade financing report into a verified funding value", () => {
  const reportedOnly = event({ evidence: [{ link: "https://media.example/alpha-funding", source: "可靠媒体", grade: "B", publishedAt: "2026-08-01T00:00:00.000Z", supports: "融资报道" }] });
  const ledger = buildCompanyClaimLedger([company("Alpha Robotics")], [reportedOnly], { now: NOW });
  const claim = ledger.companies[0]!.claims[0]!;
  assert.equal(claim.evidenceState, "evidence_insufficient");
  assert.equal(claim.value, "unknown");
  assert.equal(ledger.metrics.eligibleEventCount, 0);
});

test("reports stale evidence using the claim type TTL", () => {
  const old = event({ lastVerifiedAt: "2025-12-01T00:00:00.000Z" });
  const ledger = buildCompanyClaimLedger([company("Alpha Robotics")], [old], { now: NOW });
  const claim = ledger.companies[0]!.claims.find((item) => item.claimType === "funding")!;
  assert.equal(claim.freshness.ttlDays, 180);
  assert.equal(claim.freshness.state, "stale");
  assert.equal(ledger.metrics.staleClaimCount, 1);
  assert.equal(ledger.metrics.staleEvidenceCount, 1);
});

test("selects a deterministic Top 15 and uses stable company-id tie breaks", () => {
  const companies = Array.from({ length: 17 }, (_, index) => company(`Company ${String(index + 1).padStart(2, "0")}`, `company-${String(index + 1).padStart(2, "0")}`));
  const events = companies.map((item) => event({ id: `evt-${item.entityId}`, title: `${item.name} 发布产品`, type: "产品发布", primaryEntity: item.name, entities: [item.name], funding: undefined, productDeployment: { product: "机器人", customers: [] } }));
  const first = buildCompanyClaimLedger([...companies].reverse(), events, { now: NOW });
  const second = buildCompanyClaimLedger(companies, events, { now: NOW });
  assert.equal(first.companies.length, 15);
  assert.deepEqual(first.companies.map((item) => item.companyId), second.companies.map((item) => item.companyId));
  assert.deepEqual(first.companies.map((item) => item.companyId), companies.slice(0, 15).map((item) => item.entityId));
});

test("is idempotent and ignores non-public evidence in the materialized view", () => {
  const alpha = company("Alpha Robotics");
  const privateLead = event({ id: "evt-lead", evidence: [{ link: "https://lead.example", source: "线索", grade: "D", publishedAt: "2026-08-01T00:00:00.000Z", supports: "线索" }] });
  const first = buildCompanyClaimLedger([alpha], [event(), privateLead], { now: NOW });
  const second = buildCompanyClaimLedger([alpha], [event(), privateLead], { now: NOW });
  assert.deepEqual(first, second);
  assert.equal(first.companies[0]!.metrics.attributedEventCount, 2);
  assert.equal(first.companies[0]!.metrics.eligibleEventCount, 1);
  assert.equal(first.companies[0]!.metrics.eventCoverageRate, 0.5);
});
