import assert from "node:assert/strict";
import test from "node:test";

import { buildCompanyClaimLedger } from "../src/company-claim-ledger.js";
import { validateCompanyClaimLedger, validateDualLedgers } from "../src/dual-ledger.js";
import type { CompanyProfile, EventRecord } from "../src/types.js";

const NOW = new Date("2026-08-23T08:00:00.000Z");
const company: CompanyProfile = { entityId: "alpha", name: "Alpha Robotics", region: "北美", stage: "创业公司", routes: ["VLA 与具身模型"], thesis: "测试", officialUrl: "https://alpha.example" };
const event: EventRecord = {
  id: "event-alpha-funding", title: "Alpha Robotics 完成种子轮融资", type: "投融资", entities: [company.name], primaryEntity: company.name,
  routes: ["VLA 与具身模型"], status: "已确证", occurredAt: "2026-08-20T00:00:00.000Z", firstSeenAt: "2026-08-20T00:00:00.000Z",
  lastEvidenceAt: "2026-08-20T00:00:00.000Z", lastMaterialChangeAt: "2026-08-20T00:00:00.000Z", lastUpdatedAt: "2026-08-20T00:00:00.000Z", lastVerifiedAt: "2026-08-21T00:00:00.000Z",
  facts: [], openQuestions: [], timeline: [], funding: { entityStatus: "已确认", round: "Seed", amount: "1200 万美元", investors: [] },
  evidence: [{ link: "https://alpha.example/funding", source: "Alpha", grade: "A", publishedAt: "2026-08-20T00:00:00.000Z", supports: "事件日期 2026-08-20；Seed 轮次；金额 1200 万美元" }],
};

function current() {
  return buildCompanyClaimLedger([company], [event], { now: NOW });
}

test("company ledger validator rejects forged current claim semantics", () => {
  const mutations: Array<(ledger: ReturnType<typeof current>) => void> = [
    (ledger) => { ledger.companies[0]!.claims[0]!.claimType = "rumour" as never; },
    (ledger) => { ledger.companies[0]!.claims[0]!.claimId = "company-claim-forged"; },
    (ledger) => { ledger.companies[0]!.claims[0]!.value = "PUBLIC FORGERY"; },
    (ledger) => { ledger.companies[0]!.claims[0]!.evidenceState = "evidence_insufficient"; },
    (ledger) => { ledger.companies[0]!.claims[0]!.evidenceIds = ["event-alpha-funding:evidence:99"]; },
    (ledger) => { ledger.companies[0]!.claims[0]!.evidenceIds = []; ledger.companies[0]!.claims[0]!.evidenceUrls = []; },
    (ledger) => { (ledger.companies[0]!.claims[0] as unknown as Record<string, unknown>).extra = true; },
  ];
  for (const mutate of mutations) {
    const ledger = current();
    mutate(ledger);
    assert.throws(() => validateCompanyClaimLedger(ledger));
  }
});

test("dual-ledger validation rejects non-canonical or wrongly owned company events", () => {
  const ledger = current();
  const common = {
    company: ledger,
    benchmark: { generatedAt: ledger.generatedAt, entries: [] },
    companyIds: new Set(["alpha"]), paperIds: new Set<string>(), decisionCards: [], expectedGeneratedAt: ledger.generatedAt,
  };
  assert.throws(() => validateDualLedgers({ ...common, companyEventOwners: new Map() }), /non-canonical company event/);
  assert.throws(() => validateDualLedgers({ ...common, companyEventOwners: new Map([[event.id, "beta"]]) }), /owned by another company/);
  assert.doesNotThrow(() => validateDualLedgers({ ...common, companyEventOwners: new Map([[event.id, "alpha"]]) }));
});

test("legacy migration accepts only the exact pre-Phase-2 claim schema", () => {
  const ledger = current();
  const claim = ledger.companies[0]!.claims[0]!;
  const legacyClaim = {
    companyId: claim.companyId, claimType: claim.claimType, statement: claim.statement, value: claim.value,
    evidenceIds: claim.evidenceIds, evidenceUrls: claim.evidenceUrls, evidenceState: claim.evidenceState,
    eventDate: claim.eventDate, verifiedAt: claim.verifiedAt, freshness: claim.freshness, unresolvedQuestions: claim.unresolvedQuestions,
  };
  const legacy = structuredClone(ledger) as unknown as ReturnType<typeof current>;
  legacy.companies[0]!.claims = [legacyClaim as never];
  assert.doesNotThrow(() => validateCompanyClaimLedger(legacy, { allowLegacy: true }));

  for (const mutate of [
    (record: Record<string, unknown>) => { record.claimType = "rumour"; },
    (record: Record<string, unknown>) => { record.companyId = "beta"; },
    (record: Record<string, unknown>) => { record.evidenceUrls = ["not-a-url"]; },
    (record: Record<string, unknown>) => { record.eventIds = []; },
    (record: Record<string, unknown>) => { delete record.statement; },
  ]) {
    const malformed = structuredClone(legacy);
    mutate(malformed.companies[0]!.claims[0] as unknown as Record<string, unknown>);
    assert.throws(() => validateCompanyClaimLedger(malformed, { allowLegacy: true }));
  }
});
