import assert from "node:assert/strict";
import test from "node:test";
import type { CompanyClaim, CompanyClaimLedger } from "../src/company-claim-ledger.js";
import type { CompanyProfile, EventRecord } from "../src/types.js";
import type { CompanyThesis } from "../src/watchlist/contracts.js";
import { scheduleAtomId, WatchlistGenerator, type CompanyThesisDraft } from "../src/watchlist/generator.js";
import type { SelectedThesisSeed } from "../src/watchlist/scoring.js";
import type { ThesisSeed } from "../src/watchlist/seeds.js";
import {
  validateThesisDraft,
  validateTrackEvidence,
  buildCanonicalFactAtoms,
  type SentenceCitation,
  type ThesisValidationInput,
} from "../src/watchlist/validation.js";

const GENERATED_AT = "2026-08-13T01:00:00.000Z";
const EXPIRES_AT = "2026-10-12T01:00:00.000Z";

const company: CompanyProfile = {
  entityId: "company-alpha",
  entityType: "公司",
  name: "Alpha Robotics",
  region: "北美",
  stage: "成长公司",
  routes: ["VLA 与具身模型", "部署与商业化"],
  thesis: "受控测试实体",
  officialUrl: "https://alpha.example",
};

function event(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: "event-alpha",
    title: "Alpha Robotics 宣布 Atlas-X 工厂部署与客户订单",
    type: "部署案例",
    entities: [company.name],
    primaryEntity: company.name,
    routes: ["部署与商业化"],
    status: "已确证",
    occurredAt: "2026-08-10T00:00:00.000Z",
    firstSeenAt: "2026-08-10T01:00:00.000Z",
    lastEvidenceAt: "2026-08-10T02:00:00.000Z",
    lastMaterialChangeAt: "2026-08-12T00:00:00.000Z",
    lastUpdatedAt: "2026-08-12T00:00:00.000Z",
    lastVerifiedAt: "2026-08-12T01:00:00.000Z",
    facts: ["已公布客户试点、收入和订单"],
    openQuestions: [],
    timeline: [],
    funding: { entityStatus: "已确认", amount: "1200 万美元", valuation: "1 亿美元", investors: [] },
    productDeployment: { product: "Atlas-X", customers: ["Acme Factory"], deployment: "工厂部署" },
    evidence: [{
      link: "https://alpha.example/event-alpha",
      source: "Alpha Robotics 官网",
      grade: "A",
      publishedAt: "2026-08-10T02:00:00.000Z",
      supports: "部署、客户、收入和订单",
    }],
    ...overrides,
  };
}

function seed(overrides: Partial<ThesisSeed> = {}): ThesisSeed {
  return {
    companyId: "company-alpha",
    companyName: "Alpha Robotics",
    track: "validated-momentum",
    routes: ["VLA 与具身模型", "部署与商业化"],
    factReferenceIds: ["event-alpha"],
    evidenceGrade: "A",
    verifiedSensitiveFields: ["amount", "valuation", "customer", "revenue", "order"],
    unknownSensitiveFields: [],
    evidenceSummary: ["Alpha Robotics 宣布 Atlas-X 工厂部署与客户订单"],
    ...overrides,
  };
}

function draft(overrides: Partial<CompanyThesisDraft> = {}): CompanyThesisDraft {
  return {
    companyId: "company-alpha",
    track: "validated-momentum",
    whyNow: "AI 研究判断：Alpha Robotics 的 Atlas-X 工厂部署形成新的公开验证节点。",
    routeAndDependencies: "AI 研究判断：Atlas-X 路线依赖真实工厂数据和后续客户验证。",
    nextValidationPoints: [{ text: "核验 Alpha Robotics 是否公布 Atlas-X 后续部署数据。", dueAt: "2026-09-30" }],
    falsifiers: [{ text: "Alpha Robotics 撤回 Atlas-X 工厂部署公告。" }],
    factReferenceIds: ["event-alpha"],
    inferenceLabels: ["AI 研究判断"],
    confidence: "high",
    generatedAt: GENERATED_AT,
    expiresAt: EXPIRES_AT,
    modelVersion: "model-official",
    promptVersion: "watchlist-thesis-v1",
    methodologyVersion: "v1",
    sentenceCitations: citationsFor({
      whyNow: overrides.whyNow ?? "AI 研究判断：Alpha Robotics 的 Atlas-X 工厂部署形成新的公开验证节点。",
      routeAndDependencies: overrides.routeAndDependencies ?? "AI 研究判断：Atlas-X 路线依赖真实工厂数据和后续客户验证。",
      nextValidationPoints: overrides.nextValidationPoints ?? [{ text: "核验 Alpha Robotics 是否公布 Atlas-X 后续部署数据。", dueAt: "2026-09-30" }],
      falsifiers: overrides.falsifiers ?? [{ text: "Alpha Robotics 撤回 Atlas-X 工厂部署公告。" }],
    }),
    ...overrides,
  };
}

function claim(claimType: CompanyClaim["claimType"]): CompanyClaim {
  return {
    companyId: "company-alpha",
    claimType,
    statement: "Alpha Robotics 宣布 1200 万美元融资、1 亿美元估值、Acme Factory 客户、收入和订单",
    value: "1200 万美元 · 1 亿美元 · Acme Factory · 收入 · 订单",
    evidenceIds: ["event-alpha:evidence:1"],
    evidenceUrls: ["https://alpha.example/event-alpha"],
    evidenceState: "verified",
    eventDate: "2026-08-10",
    verifiedAt: "2026-08-12T01:00:00.000Z",
    freshness: { ttlDays: 90, state: "fresh", expiresAt: "2026-11-10T01:00:00.000Z", daysSinceVerified: 1 },
    unresolvedQuestions: [],
  };
}

function ledger(claims: CompanyClaim[] = [claim("funding"), claim("deployment"), claim("commercialization")]): CompanyClaimLedger {
  const metrics = {
    populatedFields: 0, totalFields: 0, fieldCompletenessRate: 1, staleClaimCount: 0,
    staleEvidenceCount: 0, eligibleEventCount: 1, attributedEventCount: 1, eventCoverageRate: 1,
  };
  return {
    generatedAt: GENERATED_AT,
    limit: 15,
    companies: [{ companyId: company.entityId!, companyName: company.name, selectionScore: 1, claims, metrics }],
    metrics: { ...metrics, selectedCompanyCount: 1, companiesWithEligibleEvents: 1 },
  };
}

function citationsFor(fields: Pick<CompanyThesisDraft, "whyNow" | "routeAndDependencies" | "nextValidationPoints" | "falsifiers">): SentenceCitation[] {
  const factAtomIds = buildCanonicalFactAtoms([event()]).map((atom) => atom.id);
  return [
    { path: "whyNow", sentenceIndex: 0, text: fields.whyNow, claimKind: "analysis", referenceIds: ["event-alpha"], factAtomIds, sensitiveFields: [] },
    { path: "routeAndDependencies", sentenceIndex: 0, text: fields.routeAndDependencies, claimKind: "analysis", referenceIds: ["event-alpha"], factAtomIds, sensitiveFields: [] },
    ...fields.nextValidationPoints.map((point, index) => {
      const path = `nextValidationPoints.${index}`;
      return { path, sentenceIndex: 0, text: point.text, claimKind: "validation-point" as const, referenceIds: ["event-alpha"], factAtomIds: [...factAtomIds, scheduleAtomId(path, point.dueAt)], sensitiveFields: [] };
    }),
    ...fields.falsifiers.map((falsifier, index) => ({ path: `falsifiers.${index}`, sentenceIndex: 0, text: falsifier.text, claimKind: "falsifier" as const, referenceIds: ["event-alpha"], factAtomIds, sensitiveFields: [] })),
  ];
}

function citations(): SentenceCitation[] { return draft().sentenceCitations; }

function input(overrides: Partial<ThesisValidationInput> & { sentenceCitations?: SentenceCitation[] } = {}): ThesisValidationInput {
  const { sentenceCitations, ...validationOverrides } = overrides;
  const selectedDraft = validationOverrides.draft ?? draft();
  return {
    draft: sentenceCitations === undefined ? selectedDraft : { ...selectedDraft, sentenceCitations },
    seed: seed(),
    companies: [company],
    canonicalEvents: [event()],
    claimLedger: ledger(),
    ...validationOverrides,
  };
}

function issueCodes(result: ReturnType<typeof validateThesisDraft>): string[] {
  return result.issues.map((issue) => issue.code);
}

test("publishes only a fully cited, canonical, fresh thesis", () => {
  const result = validateThesisDraft(input());

  assert.equal(result.publishable, true);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.citationCoverage, { citedSentences: 4, totalSentences: 4, ratio: 1 });
  assert.deepEqual(result.sensitiveFields, []);
});

const blockedScenarios: Array<{ name: string; expectedCode: string; make: () => ThesisValidationInput }> = [
  { name: "unknown company", expectedCode: "unknown-company", make: () => input({ companies: [] }) },
  { name: "noncanonical seed company", expectedCode: "company-mismatch", make: () => input({ draft: draft({ companyId: "company-other" }) }) },
  { name: "missing draft fact reference", expectedCode: "missing-fact-reference", make: () => input({ draft: draft({ factReferenceIds: [] }) }) },
  { name: "reference outside seed", expectedCode: "reference-outside-seed", make: () => input({ draft: draft({ factReferenceIds: ["event-other"] }) }) },
  { name: "seed reference outside canonical events", expectedCode: "missing-canonical-event", make: () => input({ canonicalEvents: [] }) },
  { name: "canonical event attributed to another company", expectedCode: "event-company-mismatch", make: () => input({ canonicalEvents: [event({ primaryEntity: "Other Robotics" })] }) },
  { name: "non-company canonical entity", expectedCode: "unknown-company", make: () => input({ companies: [{ ...company, entityType: "实验室" }] }) },
  { name: "single-B momentum", expectedCode: "single-b-momentum", make: () => input({ seed: seed({ evidenceGrade: "B" }) }) },
  { name: "forged A seed over canonical single-B evidence", expectedCode: "single-b-momentum", make: () => input({ canonicalEvents: [event({ evidence: [{ ...event().evidence[0]!, grade: "B", source: "产业媒体", link: "https://media.example/alpha" }] })] }) },
  { name: "conflicted evidence", expectedCode: "conflicted-evidence", make: () => input({ canonicalEvents: [event({ evidenceState: "conflicted" } as Partial<EventRecord>)] }) },
  { name: "withdrawn evidence", expectedCode: "withdrawn-evidence", make: () => input({ canonicalEvents: [event({ evidence: [{ ...event().evidence[0]!, withdrawn: true } as EventRecord["evidence"][number]] })] }) },
  { name: "rejected evidence", expectedCode: "rejected-evidence", make: () => input({ canonicalEvents: [event({ evidenceState: "rejected" } as Partial<EventRecord>)] }) },
  { name: "missing Chinese why-now copy", expectedCode: "missing-chinese-copy", make: () => input({ draft: draft({ whyNow: "AI research judgment: Alpha Robotics has a new public milestone." }) }) },
  { name: "missing validation point", expectedCode: "missing-validation-point", make: () => input({ draft: draft({ nextValidationPoints: [] }) }) },
  { name: "missing falsifier", expectedCode: "missing-falsifier", make: () => input({ draft: draft({ falsifiers: [] }) }) },
  { name: "invalid expiry timestamp", expectedCode: "invalid-expiry", make: () => input({ draft: draft({ expiresAt: "not-a-date" }) }) },
  { name: "expiry shorter than exactly 60 days", expectedCode: "invalid-expiry", make: () => input({ draft: draft({ expiresAt: "2026-10-12T00:59:59.999Z" }) }) },
  { name: "expiry longer than exactly 60 days", expectedCode: "invalid-expiry", make: () => input({ draft: draft({ expiresAt: "2026-10-12T01:00:00.001Z" }) }) },
  { name: "unknown sensitive name in seed", expectedCode: "unknown-sensitive-field", make: () => input({ seed: seed({ verifiedSensitiveFields: ["marketShare"] }) }) },
  { name: "canonical event awaiting review", expectedCode: "conflicted-evidence", make: () => input({ canonicalEvents: [event({ status: "待复核" })] }) },
  { name: "funding entity pending identification", expectedCode: "conflicted-evidence", make: () => input({ canonicalEvents: [event({ funding: { entityStatus: "待识别", amount: "1200 万美元", investors: [] } })] }) },
  { name: "unresolved valuation verification", expectedCode: "conflicted-evidence", make: () => input({ canonicalEvents: [event({ openQuestions: ["估值待核验"] })] }) },
];

for (const scenario of blockedScenarios) {
  test(`blocks ${scenario.name}`, () => {
    const result = validateThesisDraft(scenario.make());
    assert.equal(result.publishable, false);
    assert.ok(issueCodes(result).includes(scenario.expectedCode), JSON.stringify(result.issues));
  });
}

test("requires an explicit citation for every sentence and never guesses support", () => {
  const twoSentenceDraft = draft({
    whyNow: "AI 研究判断：Alpha Robotics 已公布部署。Atlas-X 仍需后续验证。",
  });
  const onlyFirstSentence = citations().map((citation) => citation.path === "whyNow"
    ? { ...citation, text: "AI 研究判断：Alpha Robotics 已公布部署。" }
    : citation);

  const result = validateThesisDraft(input({ draft: twoSentenceDraft, sentenceCitations: onlyFirstSentence }));

  assert.equal(result.publishable, false);
  assert.ok(issueCodes(result).includes("uncited-sentence"));
  assert.deepEqual(result.citationCoverage, { citedSentences: 3, totalSentences: 5, ratio: 0.6 });
});

test("a generated CompanyThesisDraft without a citation sidecar blocks safely", () => {
  const result = validateThesisDraft(input({ draft: { ...draft(), sentenceCitations: undefined as never } }));

  assert.equal(result.publishable, false);
  assert.ok(issueCodes(result).includes("uncited-sentence"));
  assert.deepEqual(result.citationCoverage, { citedSentences: 0, totalSentences: 4, ratio: 0 });
});

test("a genuine WatchlistGenerator result flows directly into validation", async () => {
  const selectedSeed: SelectedThesisSeed = {
    ...seed(), score: 80, components: [], eligible: true, ineligibilityReasons: [],
    primaryRoute: "VLA 与具身模型", selectionGroup: "priority-focus",
  };
  const payload = {
    whyNow: draft().whyNow,
    routeAndDependencies: draft().routeAndDependencies,
    nextValidationPoints: draft().nextValidationPoints,
    falsifiers: draft().falsifiers,
    factReferenceIds: ["event-alpha"],
    confidence: "high",
    sentenceCitations: citations(),
  };
  const generator = new WatchlistGenerator(
    { apiKey: "test-key", baseUrl: "https://llm.example/v1", model: "model-official" },
    { "event-alpha": { excerpt: event().title, officialNames: ["Alpha Robotics", "Atlas-X"], factAtoms: buildCanonicalFactAtoms([event()]) } },
    {
      now: () => new Date(GENERATED_AT),
      fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] })),
    },
  );

  const generated = await generator.generate(selectedSeed);

  assert.equal(generated.ok, true);
  if (!generated.ok) return;
  assert.equal(validateThesisDraft(input({ draft: generated.draft })).publishable, true);
});

test("rejects a sentence citation whose exact text or reference is not canonical", () => {
  const wrongText = citations().map((citation) => citation.path === "whyNow" ? { ...citation, text: "相似但不是原句。" } : citation);
  const outsideSeed = citations().map((citation) => citation.path === "whyNow" ? { ...citation, referenceIds: ["event-other"] } : citation);

  assert.ok(issueCodes(validateThesisDraft(input({ sentenceCitations: wrongText }))).includes("uncited-sentence"));
  assert.ok(issueCodes(validateThesisDraft(input({ sentenceCitations: outsideSeed }))).includes("citation-reference-outside-seed"));
});

test("blocks invented material names and numeric values even with an allowed reference ID", () => {
  const invented = draft({ whyNow: "AI 研究判断：Alpha Robotics 的 Phantom-Z 工厂部署金额为 999 亿美元。" });

  const result = validateThesisDraft(input({ draft: invented }));

  assert.equal(result.publishable, false);
  assert.ok(issueCodes(result).includes("unsupported-sentence-claim"));
});

test("blocks a deployment claim when the cited canonical event has no deployment facts", () => {
  const fundingOnly = event({
    type: "投融资",
    title: "Alpha Robotics 宣布融资",
    facts: ["已完成融资"],
    productDeployment: undefined,
    evidence: [{ ...event().evidence[0]!, supports: "融资主体和金额" }],
  });

  const result = validateThesisDraft(input({ canonicalEvents: [fundingOnly] }));

  assert.equal(result.publishable, false);
  assert.ok(issueCodes(result).includes("unsupported-sentence-claim"));
});

const sensitiveScenarios: Array<{ field: "amount" | "valuation" | "customer" | "revenue" | "order"; claimType: CompanyClaim["claimType"] }> = [
  { field: "amount", claimType: "funding" },
  { field: "valuation", claimType: "funding" },
  { field: "customer", claimType: "deployment" },
  { field: "revenue", claimType: "commercialization" },
  { field: "order", claimType: "commercialization" },
];

for (const scenario of sensitiveScenarios) {
  test(`blocks unverified ${scenario.field}`, () => {
    const sentenceCitations = citations().map((citation) => citation.path === "whyNow"
      ? { ...citation, sensitiveFields: [scenario.field] }
      : citation);
    const result = validateThesisDraft(input({ claimLedger: ledger([]), sentenceCitations }));

    assert.equal(result.publishable, false);
    assert.ok(issueCodes(result).includes("unverified-sensitive-field"));
    assert.deepEqual(result.sensitiveFields, [{ field: scenario.field, verified: false, referenceIds: ["event-alpha"] }]);
  });

  test(`allows verified fresh ${scenario.field} mapped to the canonical event`, () => {
    const sentenceCitations = citations().map((citation) => citation.path === "whyNow"
      ? { ...citation, sensitiveFields: [scenario.field] }
      : citation);
    const result = validateThesisDraft(input({ claimLedger: ledger([claim(scenario.claimType)]), sentenceCitations }));

    assert.equal(result.publishable, true, JSON.stringify(result.issues));
    assert.deepEqual(result.sensitiveFields, [{ field: scenario.field, verified: true, referenceIds: ["event-alpha"] }]);
  });
}

test("allows only the five declared sensitive field names", () => {
  const sentenceCitations = citations().map((citation) => citation.path === "whyNow"
    ? { ...citation, sensitiveFields: ["marketShare"] as never[] }
    : citation);

  const result = validateThesisDraft(input({ sentenceCitations }));

  assert.equal(result.publishable, false);
  assert.ok(issueCodes(result).includes("unknown-sensitive-field"));
});

test("detects an undeclared sensitive claim so omission cannot bypass field verification", () => {
  const sensitiveDraft = draft({ whyNow: "AI 研究判断：Alpha Robotics 的融资金额为 999 亿美元，估值为 2000 亿美元。" });
  const sentenceCitations = citations().map((citation) => citation.path === "whyNow"
    ? { ...citation, text: sensitiveDraft.whyNow, sensitiveFields: [] }
    : citation);

  const result = validateThesisDraft(input({ draft: sensitiveDraft, claimLedger: ledger([]), sentenceCitations }));

  assert.equal(result.publishable, false);
  assert.equal(result.sensitiveFields.some((field) => field.field === "amount" && !field.verified), true);
  assert.equal(result.sensitiveFields.some((field) => field.field === "valuation" && !field.verified), true);
});

test("detects canonical amount and customer claims regardless of word order", () => {
  const amountDraft = draft({ whyNow: "AI 研究判断：Alpha Robotics 完成 1200 万美元融资。" });
  const customerDraft = draft({ whyNow: "AI 研究判断：Alpha Robotics 向 Acme Factory 交付 Atlas-X。" });

  for (const sensitiveDraft of [amountDraft, customerDraft]) {
    const result = validateThesisDraft(input({ draft: sensitiveDraft, claimLedger: ledger([]) }));
    assert.equal(result.publishable, false);
    assert.ok(issueCodes(result).includes("undeclared-sensitive-field"));
    assert.ok(issueCodes(result).includes("unverified-sensitive-field"));
  }
});

test("allows canonical funding amount and valuation together with separate typed atoms", () => {
  const variants = [
    "AI 研究判断：Alpha Robotics 融资金额为 1200 万美元，估值为 1 亿美元。",
    "AI 研究判断：Alpha Robotics 融资金额为 1200 万美元、估值为 1 亿美元。",
    "AI 研究判断：Alpha Robotics 融资金额为 1200 万美元并估值为 1 亿美元。",
  ];
  for (const whyNow of variants) {
    const combined = draft({ whyNow });
    combined.sentenceCitations[0] = {
      ...combined.sentenceCitations[0]!, sensitiveFields: ["amount", "valuation"],
    };
    const result = validateThesisDraft(input({ draft: combined }));
    assert.equal(result.publishable, true, `${whyNow}: ${JSON.stringify(result.issues)}`);
    assert.deepEqual(result.sensitiveFields.map((field) => field.field), ["amount", "valuation"]);
  }
});

test("rejects swapped funding amount and valuation despite both exact values being present", () => {
  const swapped = draft({ whyNow: "AI 研究判断：Alpha Robotics 融资金额为 1 亿美元、估值为 1200 万美元。" });
  swapped.sentenceCitations[0] = {
    ...swapped.sentenceCitations[0]!, sensitiveFields: ["amount", "valuation"],
  };

  const result = validateThesisDraft(input({ draft: swapped }));

  assert.equal(result.publishable, false);
  assert.ok(issueCodes(result).includes("unsupported-sentence-claim"));
});

test("blocks a sensitive declaration omitted from its exact sentence binding", () => {
  const sensitiveDraft = draft({ whyNow: "AI 研究判断：Alpha Robotics 的客户包括 Acme Factory，且已获得订单。" });
  const sentenceCitations = citations().map((citation) => citation.path === "whyNow"
    ? { ...citation, text: sensitiveDraft.whyNow, sensitiveFields: [] }
    : citation);

  const result = validateThesisDraft(input({ draft: sensitiveDraft, sentenceCitations }));

  assert.equal(result.publishable, false);
  assert.ok(issueCodes(result).includes("undeclared-sensitive-field"));
});

test("blocks an invented customer even when the sentence declares the customer field", () => {
  const sensitiveDraft = draft({ whyNow: "AI 研究判断：Alpha Robotics 的客户包括 Tesla。" });
  sensitiveDraft.sentenceCitations[0] = {
    ...sensitiveDraft.sentenceCitations[0]!, text: sensitiveDraft.whyNow, sensitiveFields: ["customer"],
  };

  const result = validateThesisDraft(input({ draft: sensitiveDraft }));

  assert.equal(result.publishable, false);
  assert.ok(issueCodes(result).includes("unsupported-sentence-claim"));
});

test("blocks invented single-token, Chinese, count, and date claims", () => {
  const inventions = [
    "AI 研究判断：Alpha Robotics 已向 Tesla 部署 10000 台 Atlas-X。",
    "AI 研究判断：Alpha Robotics 已向特斯拉交付 Atlas-X。",
    "AI 研究判断：Alpha Robotics 将于 2026 年 9 月 30 日部署 Atlas-X。",
  ];
  for (const whyNow of inventions) {
    const result = validateThesisDraft(input({ draft: draft({ whyNow }) }));
    assert.equal(result.publishable, false, whyNow);
    assert.ok(issueCodes(result).includes("unsupported-sentence-claim"), whyNow);
  }
});

test("blocks unsupported partnership, acquisition, product-release, and research categories", () => {
  const unsupportedClaims = [
    "AI 研究判断：Alpha Robotics 与特斯拉达成合作。",
    "AI 研究判断：Alpha Robotics 已收购 Atlas-X。",
    "AI 研究判断：Alpha Robotics 正式发布 Atlas-X。",
    "AI 研究判断：Alpha Robotics 已发表 Atlas-X 研究论文。",
  ];
  for (const whyNow of unsupportedClaims) {
    const result = validateThesisDraft(input({ draft: draft({ whyNow }) }));
    assert.equal(result.publishable, false, whyNow);
    assert.ok(issueCodes(result).includes("unsupported-sentence-claim"), whyNow);
  }
});

test("binds the exact Chinese product or action target, not only the event category", () => {
  const productRelease = event({
    type: "产品发布",
    title: "Alpha Robotics 正式发布 Atlas-X",
    facts: ["Atlas-X 已正式发布"],
    productDeployment: { product: "Atlas-X", customers: [], deployment: "产品发布" },
    evidence: [{ ...event().evidence[0]!, supports: "Atlas-X 产品发布" }],
  });
  const invented = draft({ whyNow: "AI 研究判断：Alpha Robotics 正式发布幻影一号，Atlas-X 仍是依赖。" });

  const result = validateThesisDraft(input({ canonicalEvents: [productRelease], draft: invented }));

  assert.equal(result.publishable, false);
  assert.ok(issueCodes(result).includes("unsupported-sentence-claim"));
});

test("allows canonical route acronyms and prospective validation horizons", () => {
  const routedEvent = event({ routes: ["VLA 与具身模型", "部署与商业化"] });
  const routedDraft = draft({ routeAndDependencies: "AI 研究判断：VLA 路线依赖 Atlas-X 的真实工厂数据。" });
  routedDraft.sentenceCitations[1] = {
    ...routedDraft.sentenceCitations[1]!, factAtomIds: buildCanonicalFactAtoms([routedEvent]).map((atom) => atom.id),
  };
  const prospectiveDraft = draft({
    nextValidationPoints: [{ text: "未来 30 天核验 Alpha Robotics 的 Atlas-X 后续部署。", dueAt: "2026-09-12" }],
  });

  assert.equal(validateThesisDraft(input({ canonicalEvents: [routedEvent], draft: routedDraft })).publishable, true);
  assert.equal(validateThesisDraft(input({ draft: prospectiveDraft })).publishable, true);
});

test("allows only schedule-bound future horizons, not historical dates or durations", () => {
  const historicalClaims = [
    { text: "核验 Alpha Robotics 是否已于 2024-01-01 部署 Atlas-X。", dueAt: "2026-09-12" },
    { text: "核验 Alpha Robotics 此前是否已连续运行 90 天。", dueAt: "2026-09-12" },
  ];
  for (const nextValidationPoint of historicalClaims) {
    const result = validateThesisDraft(input({ draft: draft({ nextValidationPoints: [nextValidationPoint] }) }));
    assert.equal(result.publishable, false);
    assert.ok(issueCodes(result).includes("unsupported-sentence-claim"));
  }

  const scheduled = draft({
    nextValidationPoints: [{ text: "未来 30 天核验 Alpha Robotics 的 Atlas-X 后续部署。", dueAt: "2026-09-12" }],
  });
  assert.equal(validateThesisDraft(input({ draft: scheduled })).publishable, true);
});

test("does not combine numeric fragments from different typed atoms into an invented date", () => {
  const september = event({
    id: "event-beta", occurredAt: "2026-09-01T00:00:00.000Z", eventDate: "2026-09-01",
    title: "Alpha Robotics 在九月更新 Atlas-X", lastMaterialChangeAt: "2026-09-01T00:00:00.000Z",
  });
  const mixedSeed = seed({ factReferenceIds: ["event-alpha", "event-beta"] });
  const mixedDraft = draft({
    whyNow: "AI 研究判断：Alpha Robotics 已于 2026-09-10 部署 Atlas-X。",
    factReferenceIds: ["event-alpha", "event-beta"],
  });
  const atomIds = buildCanonicalFactAtoms([event(), september]).map((atom) => atom.id);
  mixedDraft.sentenceCitations[0] = {
    ...mixedDraft.sentenceCitations[0]!, referenceIds: ["event-alpha", "event-beta"], factAtomIds: atomIds,
  };

  const result = validateThesisDraft(input({ seed: mixedSeed, canonicalEvents: [event(), september], draft: mixedDraft }));

  assert.equal(result.publishable, false);
  assert.ok(issueCodes(result).includes("unsupported-sentence-claim"));
});

test("rejects schedule atoms outside the 30-to-90-day generatedAt horizon", () => {
  const invalidSchedules = [
    { text: "2025-01-01 之前核验 Alpha Robotics 的 Atlas-X。", dueAt: "2025-01-01" },
    { text: "2027-01-01 之前核验 Alpha Robotics 的 Atlas-X。", dueAt: "2027-01-01" },
  ];
  for (const point of invalidSchedules) {
    const result = validateThesisDraft(input({ draft: draft({ nextValidationPoints: [point] }) }));
    assert.equal(result.publishable, false);
    assert.ok(issueCodes(result).includes("unsupported-sentence-claim"));
  }
});

test("does not use discovery-only support text to substantiate a material claim", () => {
  const laundered = event({
    evidence: [
      { ...event().evidence[0]!, supports: "部署类别" },
      { ...event().evidence[0]!, grade: "C", source: "Google News", link: "https://news.google.com/lead", supports: "Tesla 10000 台部署" },
    ],
  });
  const invented = draft({ whyNow: "AI 研究判断：Alpha Robotics 已向 Tesla 部署 10000 台 Atlas-X。" });

  const result = validateThesisDraft(input({ canonicalEvents: [laundered], draft: invented }));

  assert.equal(result.publishable, false);
  assert.ok(issueCodes(result).includes("unsupported-sentence-claim"));
});

test("momentum proof honors facts-contract discovery metadata and independent origins", () => {
  const discoveryA = event({
    evidence: [{ ...event().evidence[0]!, discovery: true } as EventRecord["evidence"][number]],
  });
  const syndicatedB = event({
    evidence: [
      { ...event().evidence[0]!, grade: "B", link: "https://media-one.example/a", independentOrigin: "same-wire" } as EventRecord["evidence"][number],
      { ...event().evidence[0]!, grade: "B", link: "https://media-two.example/a", independentOrigin: "same-wire" } as EventRecord["evidence"][number],
    ],
  });

  for (const unsupported of [discoveryA, syndicatedB]) {
    const result = validateThesisDraft(input({ canonicalEvents: [unsupported] }));
    assert.equal(result.publishable, false);
    assert.ok(issueCodes(result).includes("single-b-momentum"));
  }
});

test("blocks sensitive claims backed by stale, conflicted, or differently mapped ledger evidence", () => {
  const sentenceCitations = citations().map((citation) => citation.path === "whyNow"
    ? { ...citation, sensitiveFields: ["amount" as const] }
    : citation);
  const stale = { ...claim("funding"), freshness: { ...claim("funding").freshness, state: "stale" as const } };
  const conflicted = { ...claim("funding"), unresolvedQuestions: ["融资金额冲突"] };
  const outsideEvent = { ...claim("funding"), evidenceIds: ["event-other:evidence:1"] };
  const unknownValue = { ...claim("funding"), value: "unknown" as const };

  for (const badClaim of [stale, conflicted, outsideEvent, unknownValue]) {
    const result = validateThesisDraft(input({ claimLedger: ledger([badClaim]), sentenceCitations }));
    assert.equal(result.publishable, false);
    assert.ok(issueCodes(result).includes("unverified-sensitive-field") || issueCodes(result).includes("conflicted-evidence"));
  }
});

test("accepts canonical ISO timestamps without milliseconds when expiry is exactly 60 days", () => {
  const noMilliseconds = draft({
    generatedAt: "2026-08-13T01:00:00Z",
    expiresAt: "2026-10-12T01:00:00Z",
  });

  assert.equal(validateThesisDraft(input({ draft: noMilliseconds })).publishable, true);
});

test("blocks a sensitive field when its fresh ledger claim maps to an event that lacks that field", () => {
  const sentenceCitations = citations().map((citation) => citation.path === "whyNow"
    ? { ...citation, sensitiveFields: ["valuation" as const] }
    : citation);
  const withoutValuation = event({
    funding: { entityStatus: "已确认", amount: "1200 万美元", investors: [] },
  });

  const result = validateThesisDraft(input({ canonicalEvents: [withoutValuation], sentenceCitations }));

  assert.equal(result.publishable, false);
  assert.ok(issueCodes(result).includes("unverified-sensitive-field"));
});

test("blocks a replacement when canonical material changes are not newer than the prior thesis", () => {
  const prior: CompanyThesis = {
    ...draft({ generatedAt: "2026-08-12T01:00:00.000Z", expiresAt: "2026-10-11T01:00:00.000Z" }),
    thesisId: "thesis-alpha-v1",
    lifecycle: "new",
    thesisVersion: 1,
  };
  const staleEvent = event({ lastMaterialChangeAt: "2026-08-12T01:00:00.000Z", lastUpdatedAt: "2026-08-12T01:00:00.000Z" });

  const result = validateThesisDraft(input({ priorThesis: prior, canonicalEvents: [staleEvent] }));

  assert.equal(result.publishable, false);
  assert.ok(issueCodes(result).includes("no-material-change"));
});

test("allows a replacement after a newer canonical material change", () => {
  const prior: CompanyThesis = {
    ...draft({ generatedAt: "2026-08-11T01:00:00.000Z", expiresAt: "2026-10-10T01:00:00.000Z" }),
    thesisId: "thesis-alpha-v1",
    lifecycle: "new",
    thesisVersion: 1,
  };

  assert.equal(validateThesisDraft(input({ priorThesis: prior })).publishable, true);
});

test("allows a material forward-radar to validated-momentum promotion", () => {
  const prior: CompanyThesis = {
    ...draft({
      track: "forward-radar",
      generatedAt: "2026-08-11T01:00:00.000Z",
      expiresAt: "2026-10-10T01:00:00.000Z",
    }),
    thesisId: "thesis-alpha-v1",
    lifecycle: "new",
    thesisVersion: 1,
  };

  assert.equal(validateThesisDraft(input({ priorThesis: prior })).publishable, true);
});

test("blocks a validated-momentum to forward-radar regression", () => {
  const forwardSeed = seed({ track: "forward-radar" });
  const forwardDraft = draft({ track: "forward-radar" });
  const prior: CompanyThesis = {
    ...draft({ generatedAt: "2026-08-11T01:00:00.000Z", expiresAt: "2026-10-10T01:00:00.000Z" }),
    thesisId: "thesis-alpha-v1",
    lifecycle: "new",
    thesisVersion: 1,
  };

  const result = validateThesisDraft(input({ draft: forwardDraft, seed: forwardSeed, priorThesis: prior }));

  assert.equal(result.publishable, false);
  assert.ok(issueCodes(result).includes("prior-thesis-mismatch"));
});

const prohibitedVariants = [
  "买入", "卖出", "目标价", "回报率", "收益率", "建议配置", "投资建议", "推荐关注",
  "预计收益", "投资回报", "有望获得回报", "预期回报", "预计将获得收益", "或将带来回报",
];

for (const phrase of prohibitedVariants) {
  test(`blocks prohibited investment language: ${phrase}`, () => {
    const unsafe = draft({ whyNow: `AI 研究判断：Alpha Robotics ${phrase}。` });
    const unsafeCitations = citations().map((citation) => citation.path === "whyNow" ? { ...citation, text: unsafe.whyNow } : citation);
    const result = validateThesisDraft(input({ draft: unsafe, sentenceCitations: unsafeCitations }));

    assert.equal(result.publishable, false);
    assert.ok(issueCodes(result).includes("prohibited-investment-language"));
  });
}

test("does not block technical recommendation terminology", () => {
  const safe = draft({ routeAndDependencies: "AI 研究判断：Atlas-X 依赖推荐算法、真实工厂数据和后续客户验证。" });
  const safeCitations = citations().map((citation) => citation.path === "routeAndDependencies" ? { ...citation, text: safe.routeAndDependencies } : citation);

  assert.equal(validateThesisDraft(input({ draft: safe, sentenceCitations: safeCitations })).publishable, true);
});

test("track evidence validation is deterministic and blocks missing references and single-B momentum", () => {
  assert.deepEqual(validateTrackEvidence(seed()), []);
  assert.deepEqual(validateTrackEvidence(seed({ factReferenceIds: [] })).map((issue) => issue.code), ["missing-fact-reference"]);
  assert.deepEqual(validateTrackEvidence(seed({ evidenceGrade: "B" })).map((issue) => issue.code), ["single-b-momentum"]);
});
