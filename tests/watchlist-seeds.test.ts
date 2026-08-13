import assert from "node:assert/strict";
import test from "node:test";
import { buildCompanyBoards } from "../src/company-boards.js";
import { buildThesisSeeds } from "../src/watchlist/seeds.js";
import type { CompanyClaimLedger } from "../src/company-claim-ledger.js";
import type { CompanyProfile, EventRecord } from "../src/types.js";

const NOW = new Date("2026-08-10T00:00:00.000Z");

function company(name: string, overrides: Partial<CompanyProfile> = {}): CompanyProfile {
  return {
    entityId: name.toLowerCase().replace(/\s+/g, "-"), entityType: "公司", name, region: "北美", stage: "成长公司",
    routes: ["VLA 与具身模型"], thesis: `${name} 的受控档案`, officialUrl: `https://${name.toLowerCase().replace(/\s+/g, "-")}.example`,
    ...overrides,
  };
}

function event(companyName: string, overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: `event-${companyName.toLowerCase().replace(/\s+/g, "-")}`, title: `${companyName} 宣布工厂部署`, type: "部署案例", entities: [companyName], primaryEntity: companyName,
    routes: ["部署与商业化"], status: "已确证", occurredAt: "2026-08-05T00:00:00.000Z", firstSeenAt: "2026-08-05T00:00:00.000Z",
    lastEvidenceAt: "2026-08-05T00:00:00.000Z", lastMaterialChangeAt: "2026-08-05T00:00:00.000Z", lastUpdatedAt: "2026-08-05T00:00:00.000Z", lastVerifiedAt: "2026-08-06T00:00:00.000Z",
    facts: ["已在工厂部署机器人"], openQuestions: [], timeline: [], productDeployment: { deployment: "工厂部署", customers: [] },
    evidence: [{ link: `https://${companyName.toLowerCase().replace(/\s+/g, "-")}.example/news`, source: `${companyName} 官网`, grade: "A", publishedAt: "2026-08-05T00:00:00.000Z", supports: "部署日期与范围" }],
    ...overrides,
  };
}

test("seeds use canonical events and never unresolved candidate records", () => {
  const alpha = company("Company Alpha");
  const verifiedEvent = event(alpha.name, { id: "event-alpha" });
  const boards = buildCompanyBoards([alpha], [verifiedEvent], { now: NOW });

  const seeds = buildThesisSeeds({ companies: [alpha], events: [verifiedEvent], boards, generatedAt: NOW.toISOString() });

  assert.deepEqual(seeds.map((seed) => seed.companyId), ["company-alpha"]);
  assert.deepEqual(seeds[0]?.factReferenceIds, ["event-alpha"]);
  assert.equal(seeds[0]?.evidenceGrade, "A");
});

test("a company is assigned to only one track and momentum wins", () => {
  const alpha = company("Company Alpha");
  const verifiedEvent = event(alpha.name, { id: "event-alpha" });
  const boards = buildCompanyBoards([alpha], [verifiedEvent], { now: NOW });

  const seeds = buildThesisSeeds({ companies: [alpha], events: [verifiedEvent], boards, generatedAt: NOW.toISOString() });

  assert.deepEqual(seeds.map((seed) => seed.track), ["validated-momentum"]);
});

test("strategic seeds require an independent B+B canonical event and retain unknown sensitive fields", () => {
  const alpha = company("Company Alpha");
  const beta = company("Company Beta");
  const alphaEvent = event(alpha.name, { id: "event-alpha" });
  const betaEvent = event(beta.name, {
    id: "event-beta", status: "持续跟踪",
    evidence: [
      { link: "https://media-one.example/beta", source: "媒体一", grade: "B", publishedAt: "2026-08-05T00:00:00.000Z", supports: "部署" },
      { link: "https://media-two.example/beta", source: "媒体二", grade: "B", publishedAt: "2026-08-05T00:00:00.000Z", supports: "部署" },
    ],
  });
  const boards = buildCompanyBoards([alpha, beta], [alphaEvent, betaEvent], { now: NOW });
  const strategicOnlyBoards = {
    ...boards,
    momentum: { ...boards.momentum, entries: boards.momentum.entries.filter((entry) => entry.companyId !== "company-beta") },
  };
  const claimLedger: CompanyClaimLedger = {
    generatedAt: NOW.toISOString(), limit: 2,
    companies: [{
      companyId: "company-beta", companyName: beta.name, selectionScore: 0,
      claims: [{
        companyId: "company-beta", claimType: "deployment", statement: betaEvent.title, value: "unknown", evidenceIds: ["event-beta:evidence:1"], evidenceUrls: ["https://media-one.example/beta"], evidenceState: "verified", eventDate: "2026-08-05", verifiedAt: "2026-08-06T00:00:00.000Z",
        freshness: { ttlDays: 90, state: "fresh", expiresAt: "2026-11-04T00:00:00.000Z", daysSinceVerified: 4 }, unresolvedQuestions: [],
      }],
      metrics: { populatedFields: 0, totalFields: 0, fieldCompletenessRate: 0, staleClaimCount: 0, staleEvidenceCount: 0, eligibleEventCount: 1, attributedEventCount: 1, eventCoverageRate: 1 },
    }],
    metrics: { populatedFields: 0, totalFields: 0, fieldCompletenessRate: 0, staleClaimCount: 0, staleEvidenceCount: 0, eligibleEventCount: 1, attributedEventCount: 1, eventCoverageRate: 1, selectedCompanyCount: 1, companiesWithEligibleEvents: 1 },
  };

  const seeds = buildThesisSeeds({ companies: [alpha, beta], events: [alphaEvent, betaEvent], boards: strategicOnlyBoards, claimLedger, generatedAt: NOW.toISOString() });

  assert.deepEqual(seeds.map((seed) => [seed.companyId, seed.track]), [["company-beta", "forward-radar"], ["company-alpha", "validated-momentum"]]);
  assert.equal(seeds[0]?.evidenceGrade, "B+B");
  assert.deepEqual(seeds[0]?.verifiedSensitiveFields, []);
  assert.deepEqual(seeds[0]?.unknownSensitiveFields, ["amount", "valuation", "customer", "revenue", "order"]);
});
