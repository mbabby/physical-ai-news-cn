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
    evidence: [{ link: "https://alpha.example/funding", source: "Alpha 官方公告", grade: "A", publishedAt: "2026-08-01T00:00:00.000Z", supports: "事件日期 2026-08-01；Seed 轮次；金额 1200 万美元" }],
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
  const reportedOnly = event({ evidence: [{ link: "https://media.example/alpha-funding", source: "可靠媒体", grade: "B", publishedAt: "2026-08-01T00:00:00.000Z", supports: "事件日期 2026-08-01；Seed 轮次；金额 1200 万美元" }] });
  const ledger = buildCompanyClaimLedger([company("Alpha Robotics")], [reportedOnly], { now: NOW });
  const claim = ledger.companies[0]!.claims.find((item) => item.eventIds.includes("evt-verified"))!;
  assert.equal(claim.fields.round.status, "developing");
  assert.equal(claim.fields.amount.status, "developing");
  assert.equal(claim.evidenceState, "evidence_insufficient");
  assert.equal(claim.value, "unknown");
  assert.equal(ledger.metrics.eligibleEventCount, 0);
});

test("projects A-grade funding evidence into verified fields while leaving absent fields unknown", () => {
  const ledger = buildCompanyClaimLedger([company("Alpha Robotics")], [event()], { now: NOW });
  const claim = ledger.companies[0]!.claims.find((item) => item.eventIds.includes("evt-verified"))!;

  assert.match(claim.claimId, /^company-claim-/);
  assert.deepEqual(claim.eventIds, ["evt-verified"]);
  assert.equal(claim.fields.eventDate.status, "verified");
  assert.equal(claim.fields.round.status, "verified");
  assert.equal(claim.fields.round.value, "Seed");
  assert.equal(claim.fields.amount.status, "verified");
  assert.equal(claim.fields.amount.value, "1200 万美元");
  assert.equal(claim.fields.valuation.status, "unknown");
  assert.equal(claim.fields.valuation.value, "unknown");
  assert.equal(claim.fields.customer.status, "unknown");
  assert.deepEqual(claim.fields.customer.evidenceIds, []);
});

test("marks explicitly conflicting supported fields conflicted without leaking a compatibility value", () => {
  const conflicted = event({
    openQuestions: ["融资金额不一致：1200 万美元 / 1800 万美元"],
    evidence: [
      { link: "https://media-a.example/funding", source: "媒体 A", grade: "B", publishedAt: "2026-08-01T00:00:00.000Z", supports: "融资金额为 1200 万美元" },
      { link: "https://media-b.example/funding", source: "媒体 B", grade: "B", publishedAt: "2026-08-01T00:00:00.000Z", supports: "融资金额为 1800 万美元" },
    ],
  });
  const ledger = buildCompanyClaimLedger([company("Alpha Robotics")], [conflicted], { now: NOW });
  const claim = ledger.companies[0]!.claims.find((item) => item.eventIds.includes("evt-verified"))!;

  assert.equal(claim.fields.amount.status, "conflicted");
  assert.deepEqual(claim.fields.amount.conflictingValues, ["1200 万美元", "1800 万美元"]);
  assert.equal(claim.value, "unknown");
  assert.equal(claim.evidenceState, "evidence_insufficient");
  assert.equal(ledger.metrics.eligibleEventCount, 0);
});

test("projects deployment fields independently and never turns a missing customer into a negative assertion", () => {
  const deployment = event({
    id: "evt-deployment", title: "Alpha Robotics 部署 Atlas-X", type: "部署案例", funding: undefined,
    productDeployment: { product: "Atlas-X", customers: [], deployment: "工厂部署" },
    evidence: [{ link: "https://alpha.example/deployment", source: "Alpha 官方公告", grade: "A", publishedAt: "2026-08-01T00:00:00.000Z", supports: "事件日期 2026-08-01；产品 Atlas-X；工厂部署" }],
  });
  const ledger = buildCompanyClaimLedger([company("Alpha Robotics")], [deployment], { now: NOW });
  const claim = ledger.companies[0]!.claims.find((item) => item.eventIds.includes("evt-deployment"))!;

  assert.equal(claim.fields.product.status, "verified");
  assert.equal(claim.fields.product.value, "Atlas-X");
  assert.equal(claim.fields.deployment.status, "verified");
  assert.equal(claim.fields.customer.status, "unknown");
  assert.equal(claim.fields.customer.value, "unknown");
  assert.doesNotMatch(claim.statement, /没有客户|无客户/);
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

test("preserves deterministic field correction history across previous-ledger rebuilds", () => {
  const oneB = event({
    evidence: [{ link: "https://media-a.example/alpha-funding", source: "媒体 A", grade: "B", publishedAt: "2026-08-01T00:00:00.000Z", supports: "事件日期 2026-08-01；Seed 轮次；金额 1200 万美元" }],
  });
  const twoB = event({
    evidence: [
      oneB.evidence[0]!,
      { link: "https://media-b.example/alpha-funding", source: "媒体 B", grade: "B", publishedAt: "2026-08-01T00:00:00.000Z", supports: "事件日期 2026-08-01；Seed 轮次；金额 1200 万美元" },
    ],
  });
  const corrected = event({
    ...twoB,
    funding: { entityStatus: "已确认", round: "Seed", amount: "1300 万美元", investors: [] },
    evidence: twoB.evidence.map((item) => ({ ...item, supports: "事件日期 2026-08-01；Seed 轮次；金额 1300 万美元" })),
  });

  const first = buildCompanyClaimLedger([company("Alpha Robotics")], [oneB], { now: NOW });
  const second = buildCompanyClaimLedger([company("Alpha Robotics")], [twoB], { previous: first, now: new Date("2026-08-11T00:00:00.000Z") });
  const third = buildCompanyClaimLedger([company("Alpha Robotics")], [corrected], { previous: second, now: new Date("2026-08-12T00:00:00.000Z") });
  const rerun = buildCompanyClaimLedger([company("Alpha Robotics")], [corrected], { previous: third, now: new Date("2026-08-12T00:00:00.000Z") });
  const claims = [first, second, third, rerun].map((ledger) => ledger.companies[0]!.claims.find((claim) => claim.eventIds.includes("evt-verified"))!);

  assert.equal(new Set(claims.map((claim) => claim.claimId)).size, 1);
  assert.deepEqual(claims[0]!.corrections, []);
  const amountAfterEvidence = claims[1]!.corrections.find((correction) => correction.fieldPath === "fields.amount");
  assert.equal(amountAfterEvidence?.reason, "new-evidence");
  assert.equal(amountAfterEvidence?.before.status, "developing");
  assert.equal(amountAfterEvidence?.after.status, "verified");
  const amountCorrections = claims[2]!.corrections.filter((correction) => correction.fieldPath === "fields.amount");
  assert.deepEqual(amountCorrections.map((correction) => correction.reason), ["new-evidence", "metadata-correction"]);
  assert.equal(amountCorrections[1]?.before.value, "1200 万美元");
  assert.equal(amountCorrections[1]?.after.value, "1300 万美元");
  assert.deepEqual(claims[3]!.corrections, claims[2]!.corrections);
});

test("retains every amount correction across an A to B to A to B cycle", () => {
  const amountEvent = (amount: string): EventRecord => event({
    funding: { entityStatus: "已确认", round: "Seed", amount, investors: [] },
    evidence: [{
      link: "https://alpha.example/funding", source: "Alpha 官方公告", grade: "A",
      publishedAt: "2026-08-01T00:00:00.000Z", supports: `事件日期 2026-08-01；Seed 轮次；金额 ${amount}`,
    }],
  });
  const alpha = company("Alpha Robotics");
  const first = buildCompanyClaimLedger([alpha], [amountEvent("1200 万美元")], { now: NOW });
  const second = buildCompanyClaimLedger([alpha], [amountEvent("1300 万美元")], { previous: first, now: new Date("2026-08-11T00:00:00.000Z") });
  const third = buildCompanyClaimLedger([alpha], [amountEvent("1200 万美元")], { previous: second, now: new Date("2026-08-12T00:00:00.000Z") });
  const fourth = buildCompanyClaimLedger([alpha], [amountEvent("1300 万美元")], { previous: third, now: new Date("2026-08-13T00:00:00.000Z") });
  const claim = fourth.companies[0]!.claims.find((item) => item.eventIds.includes("evt-verified"))!;
  const amountCorrections = claim.corrections.filter((item) => item.fieldPath === "fields.amount");

  assert.equal(amountCorrections.length, 3);
  assert.equal(new Set(amountCorrections.map((item) => item.correctionId)).size, 3);
  assert.deepEqual(amountCorrections.map((item) => [item.before.value, item.after.value]), [
    ["1200 万美元", "1300 万美元"],
    ["1300 万美元", "1200 万美元"],
    ["1200 万美元", "1300 万美元"],
  ]);
});

test("accepts a legacy previous ledger without fabricating correction history", () => {
  const current = buildCompanyClaimLedger([company("Alpha Robotics")], [event()], { now: NOW });
  const legacy = structuredClone(current) as unknown as Record<string, unknown>;
  const legacyClaim = (legacy.companies as Array<{ claims: Array<Record<string, unknown>> }>)[0]!.claims[0]!;
  delete legacyClaim.claimId;
  delete legacyClaim.eventIds;
  delete legacyClaim.fields;
  delete legacyClaim.corrections;

  const rebuilt = buildCompanyClaimLedger([company("Alpha Robotics")], [event()], { previous: legacy as never, now: NOW });
  const claim = rebuilt.companies[0]!.claims.find((item) => item.eventIds.includes("evt-verified"))!;
  assert.deepEqual(claim.corrections, []);
});

test("excludes discovery-only and withdrawn A-grade sources before materializing fields", () => {
  const discoveryEvidence = [
    { source: "Google News · Robotics", link: "https://news.google.com/rss/articles/lead" },
    { source: "Hacker News · Robotics", link: "https://news.ycombinator.com/item?id=1" },
    { source: "X · Robotics", link: "https://x.com/robotics/status/1" },
    { source: "Direct-looking source", link: "https://lead.example/item", discovery: true },
    { source: "Withdrawn official", link: "https://alpha.example/withdrawn", withdrawn: true },
  ];
  for (const [index, item] of discoveryEvidence.entries()) {
    const lead = event({
      id: `evt-discovery-${index}`,
      evidence: [{ ...item, grade: "A", publishedAt: "2026-08-01T00:00:00.000Z", supports: "事件日期 2026-08-01；Seed 轮次；金额 1200 万美元" } as EventRecord["evidence"][number]],
    });
    const ledger = buildCompanyClaimLedger([company("Alpha Robotics")], [lead], { now: NOW });
    assert.equal(ledger.companies[0]!.claims.some((claim) => claim.eventIds.includes(lead.id)), false, item.source);
    assert.equal(ledger.metrics.eligibleEventCount, 0, item.source);
    assert.equal(ledger.companies[0]!.claims[0]!.value, "unknown", item.source);
  }
});

test("binds each field only to direct evidence supporting that exact field value", () => {
  const mixed = event({
    evidence: [
      { link: "https://media-a.example/date", source: "媒体 A", grade: "B", publishedAt: "2026-08-01T00:00:00.000Z", supports: "事件日期 2026-08-01" },
      { link: "https://media-b.example/product", source: "媒体 B", grade: "B", publishedAt: "2026-08-01T00:00:00.000Z", supports: "产品 Atlas-X" },
      { link: "https://official.example/round", source: "官方公告", grade: "A", publishedAt: "2026-08-01T00:00:00.000Z", supports: "Seed 轮次" },
    ],
  });
  const ledger = buildCompanyClaimLedger([company("Alpha Robotics")], [mixed], { now: NOW });
  const claim = ledger.companies[0]!.claims.find((item) => item.eventIds.includes("evt-verified"))!;

  assert.equal(claim.fields.eventDate.status, "developing");
  assert.deepEqual(claim.fields.eventDate.evidenceUrls, ["https://media-a.example/date"]);
  assert.equal(claim.fields.round.status, "verified");
  assert.deepEqual(claim.fields.round.evidenceUrls, ["https://official.example/round"]);
  assert.equal(claim.fields.amount.status, "unknown");
  assert.deepEqual(claim.fields.amount.evidenceUrls, []);
  assert.equal(claim.value, "Seed");
});

test("does not count mismatching B support as corroboration for a canonical field value", () => {
  const mismatched = event({
    evidence: [
      { link: "https://media-a.example/funding", source: "媒体 A", grade: "B", publishedAt: "2026-08-01T00:00:00.000Z", supports: "金额 1200 万美元" },
      { link: "https://media-b.example/funding", source: "媒体 B", grade: "B", publishedAt: "2026-08-01T00:00:00.000Z", supports: "金额 1800 万美元" },
    ],
  });
  const ledger = buildCompanyClaimLedger([company("Alpha Robotics")], [mismatched], { now: NOW });
  const amount = ledger.companies[0]!.claims.find((item) => item.eventIds.includes("evt-verified"))!.fields.amount;

  assert.equal(amount.status, "developing");
  assert.deepEqual(amount.evidenceUrls, ["https://media-a.example/funding"]);
});

test("retains an evidence-backed conflict when no canonical field value was selected", () => {
  const conflicted = event({
    funding: { entityStatus: "已确认", round: "Seed", investors: [] },
    openQuestions: ["融资金额不一致：1200 万美元 / 1800 万美元"],
    evidence: [
      { link: "https://media-a.example/funding", source: "媒体 A", grade: "B", publishedAt: "2026-08-01T00:00:00.000Z", supports: "Seed 轮次；金额 1200 万美元" },
      { link: "https://media-b.example/funding", source: "媒体 B", grade: "B", publishedAt: "2026-08-01T00:00:00.000Z", supports: "Seed 轮次；金额 1800 万美元" },
    ],
  });
  const ledger = buildCompanyClaimLedger([company("Alpha Robotics")], [conflicted], { now: NOW });
  const claim = ledger.companies[0]!.claims.find((item) => item.eventIds.includes("evt-verified"))!;

  assert.equal(claim.fields.amount.status, "conflicted");
  assert.equal(claim.fields.amount.value, "unknown");
  assert.deepEqual(claim.fields.amount.conflictingValues, ["1200 万美元", "1800 万美元"]);
  assert.deepEqual(claim.fields.amount.evidenceUrls, ["https://media-a.example/funding", "https://media-b.example/funding"]);
  assert.equal(claim.value, "unknown");
});

test("keeps claim identity and correction continuity when mutable text reclassifies the same event", () => {
  const initialEvent = event({
    id: "evt-product", type: "公司商业", title: "Alpha Robotics 发布 Atlas-X", funding: undefined,
    productDeployment: { product: "Atlas-X", customers: [] },
    evidence: [{ link: "https://alpha.example/atlas", source: "Alpha 官方公告", grade: "A", publishedAt: "2026-08-01T00:00:00.000Z", supports: "产品 Atlas-X" }],
  });
  const pilotEvent = event({
    ...initialEvent, title: "Alpha Robotics 启动 Atlas-X 试点", facts: ["Atlas-X pilot"],
    evidence: [{ ...initialEvent.evidence[0]!, supports: "产品 Atlas-X；pilot" }],
  });
  const first = buildCompanyClaimLedger([company("Alpha Robotics")], [initialEvent], { now: NOW });
  const second = buildCompanyClaimLedger([company("Alpha Robotics")], [pilotEvent], { previous: first, now: new Date("2026-08-11T00:00:00.000Z") });
  const before = first.companies[0]!.claims.find((claim) => claim.eventIds.includes("evt-product"))!;
  const after = second.companies[0]!.claims.find((claim) => claim.eventIds.includes("evt-product"))!;

  assert.equal(before.claimType, "product");
  assert.equal(after.claimType, "pilot");
  assert.equal(after.claimId, before.claimId);
  assert.equal(after.corrections.some((correction) => correction.fieldPath === "fields.productionStage" && correction.reason === "new-evidence"), true);
});

test("requires token-safe exact value support instead of accepting partial-string matches", () => {
  const cases: Array<{
    name: string;
    record: EventRecord;
    field: "round" | "amount" | "product";
  }> = [
    {
      name: "Seed versus Pre-Seed",
      record: event({ evidence: [{ ...event().evidence[0]!, supports: "Pre-Seed 轮次" }] }),
      field: "round",
    },
    {
      name: "Seed versus Pre–Seed",
      record: event({ evidence: [{ ...event().evidence[0]!, supports: "Pre–Seed 轮次" }] }),
      field: "round",
    },
    {
      name: "Seed versus Pre Seed",
      record: event({ evidence: [{ ...event().evidence[0]!, supports: "Pre Seed 轮次" }] }),
      field: "round",
    },
    {
      name: "12M versus 112M",
      record: event({
        funding: { entityStatus: "已确认", amount: "12M", investors: [] },
        evidence: [{ ...event().evidence[0]!, supports: "金额 112M" }],
      }),
      field: "amount",
    },
    {
      name: "Bot versus Robot",
      record: event({
        type: "产品发布", funding: undefined, productDeployment: { product: "Bot", customers: [] },
        evidence: [{ ...event().evidence[0]!, supports: "产品 Robot" }],
      }),
      field: "product",
    },
  ];

  for (const item of cases) {
    const ledger = buildCompanyClaimLedger([company("Alpha Robotics")], [item.record], { now: NOW });
    const claim = ledger.companies[0]!.claims.find((candidate) => candidate.eventIds.includes("evt-verified"))!;
    assert.equal(claim.fields[item.field].status, "unknown", item.name);
    assert.equal(claim.value, "unknown", item.name);
    assert.equal(claim.evidenceState, "evidence_insufficient", item.name);
    assert.equal(ledger.metrics.eligibleEventCount, 0, item.name);
  }
});

test("treats matching B reports with the same explicit provenance as one independent origin", () => {
  const syndicated = event({
    funding: { entityStatus: "已确认", amount: "1200 万美元", investors: [] },
    evidence: [
      { link: "https://media-a.example/funding", source: "媒体 A", grade: "B", publishedAt: "2026-08-01T00:00:00.000Z", supports: "金额 1200 万美元", independentOrigin: "same-wire" } as EventRecord["evidence"][number],
      { link: "https://media-b.example/funding", source: "媒体 B", grade: "B", publishedAt: "2026-08-01T00:00:00.000Z", supports: "金额 1200 万美元", independentOrigin: "same-wire" } as EventRecord["evidence"][number],
    ],
  });
  const ledger = buildCompanyClaimLedger([company("Alpha Robotics")], [syndicated], { now: NOW });
  const claim = ledger.companies[0]!.claims.find((item) => item.eventIds.includes("evt-verified"))!;

  assert.equal(claim.fields.amount.status, "developing");
  assert.equal(claim.value, "unknown");
  assert.equal(claim.evidenceState, "evidence_insufficient");
  assert.equal(ledger.metrics.eligibleEventCount, 0);
});
