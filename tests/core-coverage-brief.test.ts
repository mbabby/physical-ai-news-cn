import assert from "node:assert/strict";
import test from "node:test";
import { buildApprovedAnalysisTemplates, buildCoverageBriefs, revalidateAnalyses } from "../src/core-coverage/brief.js";
import type { EventRecord } from "../src/types.js";
import { company, coverage, event, fixture } from "./core-coverage-fixtures.js";

test("identity without events and events without analysis remain coverage-only", () => {
  assert.equal(buildCoverageBriefs({ ...fixture([]), analyses: [] })[0]?.completeness, "coverage-only");
  const input = fixture();
  assert.equal(buildCoverageBriefs({ ...input, analyses: [] })[0]?.completeness, "coverage-only");
  const brief = buildCoverageBriefs({ ...input, analyses: buildApprovedAnalysisTemplates(input) })[0]!;
  assert.equal(brief.completeness, "complete");
  assert.match(brief.summaryZh, /工厂测试/);
  assert.doesNotMatch(brief.summaryZh, /全球领先|1200/);
  assert.ok(brief.gapsZh.some((gap) => /融资/.test(gap)));
});

test("requires sourced identity and dates, but accepts explicitly labeled disclosure dates", () => {
  const noIdentity = fixture([event()], [{ ...company, profileEvidence: undefined }]);
  assert.equal(buildCoverageBriefs({ ...noIdentity, analyses: buildApprovedAnalysisTemplates(noIdentity) })[0]?.completeness, "coverage-only");
  const disclosed = fixture([event("deployment", { occurredAt: undefined, eventDate: undefined, dateSource: "official-published" })]);
  const brief = buildCoverageBriefs({ ...disclosed, analyses: buildApprovedAnalysisTemplates(disclosed) })[0]!;
  assert.equal(brief.completeness, "complete");
  assert.equal(brief.knownFacts[0]?.dateKind, "disclosed");
  assert.match(brief.summaryZh, /披露日期/);
  const undated = fixture([event("deployment", { occurredAt: undefined, eventDate: undefined, dateSource: undefined, evidence: [{ ...event().evidence[0]!, publishedAt: "unknown" }] })]);
  assert.equal(buildCoverageBriefs({ ...undated, analyses: buildApprovedAnalysisTemplates(undated) })[0]?.completeness, "coverage-only");
});

test("projects traceable material-change clocks per fact instead of borrowing the company maximum", () => {
  const input = fixture([
    event("deployment", { lastMaterialChangeAt: "2026-08-20T00:00:00Z" }),
    event("product", { lastMaterialChangeAt: undefined }),
  ]);
  const brief = buildCoverageBriefs({ ...input, analyses: buildApprovedAnalysisTemplates(input) })[0]!;
  assert.equal(brief.lastMaterialChangeAt, "2026-08-20T00:00:00.000Z");
  assert.equal(brief.knownFacts.find((fact) => fact.claimType === "deployment")?.materialChangeAt, "2026-08-20T00:00:00.000Z");
  assert.equal(brief.knownFacts.find((fact) => fact.claimType === "product")?.materialChangeAt, "unknown");
});

test("freeform causal claims, altered limitations and forged evidence do not auto-validate", () => {
  const input = fixture([event("funding"), event("product"), event()]);
  const templates = buildApprovedAnalysisTemplates(input);
  assert.deepEqual(new Set(templates.map((item) => item.template)), new Set(["capital-resources", "product-validation", "deployment-validation"]));
  assert.ok(templates.every((item) => item.status === "valid"));
  for (const mutation of [
    { textZh: "融资必然带来百倍收入和全球领先客户规模" },
    { limitationZh: "没有局限，必将领先" },
    { nextValidationZh: "已经证明全球量产" },
    { evidenceIds: ["event-funding:evidence:99"] },
  ]) assert.equal(revalidateAnalyses([{ ...templates[0]!, ...mutation }], input.ledger, input.events)[0]?.status, "needs-review");
});

test("withdrawal and conflict invalidate dependent analysis without erasing independent deployment", () => {
  const input = fixture([event("funding"), event()]);
  const analyses = buildApprovedAnalysisTemplates(input);
  for (const changes of [{ evidenceState: "withdrawn" }, { openQuestions: ["金额证据冲突"] }]) {
    const events = [{ ...input.events[0]!, ...changes }, input.events[1]!] as EventRecord[];
    const result = revalidateAnalyses(analyses, input.ledger, events);
    assert.equal(result.find((item) => item.template === "capital-resources")?.status, "needs-review");
    assert.equal(result.find((item) => item.template === "deployment-validation")?.status, "valid");
    const brief = buildCoverageBriefs({ ...input, events, analyses })[0]!;
    assert.doesNotMatch(brief.summaryZh, /1200/);
    assert.match(brief.summaryZh, /工厂测试/);
    assert.ok(brief.analyses.every((item) => item.status === "valid"));
  }
});

test("single B, candidates, mismatched subjects and group capital cannot create complete briefs", () => {
  for (const overrides of [
    { evidence: [{ ...event().evidence[0]!, grade: "B" }] },
    { evidenceState: "candidate" },
  ]) {
    const input = fixture([event("deployment", overrides as Partial<EventRecord>)]);
    assert.deepEqual(buildApprovedAnalysisTemplates(input), []);
  }
  const input = fixture();
  const analyses = buildApprovedAnalysisTemplates(input);
  const foreign = [{ ...input.events[0]!, primaryEntity: "Other Group" }];
  assert.equal(revalidateAnalyses(analyses, input.ledger, foreign)[0]?.status, "needs-review");
  assert.equal(buildCoverageBriefs({ ...input, events: foreign, analyses })[0]?.completeness, "coverage-only");
});

test("all coverage members survive empty ledgers and financing currencies remain separate", () => {
  const input = fixture([event("funding"), event("funding", { id: "event-cny", funding: { round: "Seed", amount: "800 万人民币", investors: [] }, evidence: [{ ...event("funding").evidence[0]!, link: "https://alpha.example/cny", supports: "轮次 Seed；金额 800 万人民币" }] })]);
  const briefs = buildCoverageBriefs({ ...input, coverage: { ...coverage, members: [...coverage.members, { ...coverage.members[0]!, companyId: "missing" }] }, analyses: buildApprovedAnalysisTemplates(input) });
  assert.equal(briefs.length, 2);
  assert.equal(briefs[1]?.completeness, "coverage-only");
  assert.match(briefs[0]!.summaryZh, /1200 万美元/);
  assert.match(briefs[0]!.summaryZh, /800 万人民币/);
  assert.doesNotMatch(briefs[0]!.summaryZh, /2000|合计/);
});

test("historical financing preserves dates outside 90 days and rejects impossible publication days", () => {
  const historic = fixture([event("funding", { occurredAt: "2025-01-01", eventDate: "2025-01-01", evidence: [{ ...event("funding").evidence[0]!, publishedAt: "2025-01-02", supports: "事件日期 2025-01-01；轮次 Seed；金额 1200 万美元" }] })]);
  const brief = buildCoverageBriefs({ ...historic, analyses: buildApprovedAnalysisTemplates(historic) })[0]!;
  assert.equal(brief.knownFacts[0]?.occurredOn, "2025-01-01");
  assert.equal(brief.knownFacts[0]?.publishedOn, "2025-01-02");
  assert.equal(brief.completeness, "complete");
  const malformed = fixture([event("deployment", { occurredAt: undefined, dateSource: undefined, evidence: [{ ...event().evidence[0]!, publishedAt: "2026-02-30" }] })]);
  assert.equal(buildCoverageBriefs({ ...malformed, analyses: buildApprovedAnalysisTemplates(malformed) })[0]?.completeness, "coverage-only");
});

test("identity proof must be official, named, and already checked, not arbitrary URLs", () => {
  for (const proof of [
    { link: "https://unrelated.example/about" }, { link: "javascript:alert(1)" },
    { supports: "机器人很好" }, { checkedAt: "2026-02-30" }, { checkedAt: "2026-09-07" },
  ]) {
    const input = fixture([event()], [{ ...company, profileEvidence: [{ ...company.profileEvidence![0]!, ...proof }] }]);
    const brief = buildCoverageBriefs({ ...input, analyses: buildApprovedAnalysisTemplates(input) })[0]!;
    assert.equal(brief.completeness, "coverage-only");
    assert.deepEqual(brief.identityEvidence, []);
  }
});

test("lab coverage accepts research facts, never financing inherited from a parent", () => {
  const lab = { ...company, entityType: "实验室" as const };
  const input = fixture([event("funding"), event("product", { type: "研究与数据", title: "作者报告研究产出" })], [lab]);
  const brief = buildCoverageBriefs({ ...input, analyses: buildApprovedAnalysisTemplates(input) })[0]!;
  assert.equal(brief.completeness, "complete");
  assert.equal(brief.knownFacts.length, 1);
  assert.equal(brief.knownFacts[0]?.claimType, "research-team");
  assert.doesNotMatch(brief.summaryZh, /1200/);
  assert.match(brief.analyses[0]!.limitationZh, /作者报告/);
});

test("withdrawing only amount evidence rebuilds the summary and invalidates its old template", () => {
  const funding = event("funding", { evidence: [
    { ...event("funding").evidence[0]!, link: "https://alpha.example/amount", supports: "金额 1200 万美元" },
    { ...event("funding").evidence[0]!, link: "https://alpha.example/round", supports: "轮次 Seed" },
  ] });
  const input = fixture([funding, event()]);
  const analyses = buildApprovedAnalysisTemplates(input);
  const withdrawn = structuredClone(funding);
  Object.assign(withdrawn.evidence[0]!, { withdrawn: true });
  const brief = buildCoverageBriefs({ ...input, events: [withdrawn, event()], analyses })[0]!;
  assert.match(brief.summaryZh, /Seed/);
  assert.match(brief.summaryZh, /工厂测试/);
  assert.doesNotMatch(brief.summaryZh, /1200|\/amount/);
  assert.ok(brief.knownFacts.flatMap((fact) => Object.values(fact.fields)).every((field) => !field!.evidenceUrls.includes("https://alpha.example/amount")));
  assert.deepEqual(brief.analyses.map((item) => item.template), ["deployment-validation"]);
});

test("claim references cannot mix companies or merge unproved event dates into live facts", () => {
  const beta = { ...company, entityId: "beta", name: "Beta", profileEvidence: [{ ...company.profileEvidence![0]!, supports: "Beta 身份" }] };
  const input = fixture([event(), event("funding", { primaryEntity: "Beta" })], [company, beta]);
  const analyses = buildApprovedAnalysisTemplates(input);
  const mixed = { ...analyses[0]!, claimIds: analyses.flatMap((item) => item.claimIds), evidenceIds: analyses.flatMap((item) => item.evidenceIds) };
  assert.equal(revalidateAnalyses([mixed], input.ledger, input.events)[0]?.status, "needs-review");
  const foreignClaim = structuredClone(input.ledger);
  foreignClaim.companies[0]!.claims[0]!.companyId = "beta";
  assert.equal(buildCoverageBriefs({ ...input, ledger: foreignClaim, analyses })[0]?.completeness, "coverage-only");
  const merged = fixture();
  merged.ledger.companies[0]!.claims.find((claim) => claim.claimType === "deployment")!.eventIds.push("withdrawn");
  merged.events.push(event("deployment", { id: "withdrawn", occurredAt: "2026-09-05", evidence: [] }));
  assert.equal(buildApprovedAnalysisTemplates(merged).length, 0);
});

test("conflict and withdrawn dependencies remain visible as safe public gaps", () => {
  const input = fixture([event("funding"), event()]);
  const conflicted = { ...input.events[0]!, openQuestions: ["金额证据冲突"] };
  const brief = buildCoverageBriefs({ ...input, events: [conflicted, event()], analyses: buildApprovedAnalysisTemplates(input) })[0]!;
  assert.ok(brief.gapsZh.some((gap) => /冲突/.test(gap)));
});

test("a date-only official identity check today is accepted during Shanghai early morning", () => {
  const input = fixture([event()], [{ ...company, profileEvidence: [{ ...company.profileEvidence![0]!, checkedAt: "2026-09-06" }] }]);
  input.now = new Date("2026-09-05T16:30:00Z");
  assert.equal(buildCoverageBriefs({ ...input, analyses: buildApprovedAnalysisTemplates(input) })[0]?.completeness, "complete");
});
