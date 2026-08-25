import assert from "node:assert/strict";
import test from "node:test";
import { buildEvidenceTaskSeeds, targetPriority, type BuildEvidenceTaskSeedsInput } from "../src/community-evidence/task-seeds.js";
import { assertEvidenceTaskSeedArtifact } from "../src/community-evidence/contracts.js";
import { materializeResearchDecisionCard, type ResearchDecisionCard } from "../src/research-decision-card.js";
import type { CandidateCompany, EventRecord, ResearchRecord } from "../src/types.js";

const GENERATED_AT = "2026-08-24T01:00:00Z";
const GENERATED_WEEK = "2026-W35";

function company(overrides: Partial<CandidateCompany> = {}): CandidateCompany {
  return {
    id: "company-alpha",
    name: "Alpha Robotics",
    aliases: ["Alpha Robotics"],
    status: "观察中",
    verificationScore: 88,
    routes: ["本体与硬件"],
    officialUrl: "https://alpha.example/",
    firstSeenAt: GENERATED_AT,
    lastSeenAt: GENERATED_AT,
    evidence: [{
      link: "https://investor.example/alpha",
      source: "Investor",
      sourceWeight: 10,
      publishedAt: GENERATED_AT,
      title: "Alpha financing announcement",
    }],
    openQuestions: ["融资金额待补充"],
    ...overrides,
  };
}

function deployment(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: "event-atlas",
    title: "Alpha Robotics 部署 Atlas-X",
    type: "部署案例",
    entities: ["Alpha Robotics"],
    primaryEntity: "Alpha Robotics",
    routes: ["部署与商业化"],
    status: "已确证",
    occurredAt: "2026-08-20T00:00:00Z",
    firstSeenAt: GENERATED_AT,
    lastUpdatedAt: GENERATED_AT,
    lastVerifiedAt: GENERATED_AT,
    facts: ["Alpha Robotics 公布 Atlas-X 部署进展。"],
    openQuestions: ["客户名称待补充"],
    evidence: [{
      link: "https://alpha.example/atlas-x",
      source: "Alpha Robotics",
      grade: "A",
      publishedAt: "2026-08-20",
      supports: "产品部署",
    }],
    timeline: [],
    productDeployment: { product: "Atlas-X", customers: [], deployment: "工厂试点" },
    ...overrides,
  };
}

function research(overrides: Partial<ResearchRecord> = {}): ResearchRecord {
  const article = {
    id: "paper-alpha",
    title: "Atlas Policy",
    titleZh: "Atlas 策略",
    summaryZh: "论文提出 Atlas 策略。论文报告真实机器人实验。",
    link: "https://arxiv.org/abs/2608.00001",
    publishedAt: new Date("2026-08-20T00:00:00Z"),
    fetchedAt: new Date(GENERATED_AT),
    source: "arXiv",
    sourceWeight: 10,
    excerpt: "We ran 12 real-robot trials. Weights https://huggingface.co/acme/atlas and data https://huggingface.co/datasets/acme/atlas.",
    kind: "研究与数据" as const,
    tags: [],
    scholar: {
      provider: "OpenAlex" as const,
      workId: "W260800001",
      citedByCount: 5,
      isRetracted: false,
      institutions: ["Alpha Lab"],
      authors: [{ name: "Alice", institutions: ["Alpha Lab"] }],
      checkedAt: GENERATED_AT,
    },
  };
  return {
    id: "arxiv:2608.00001",
    article,
    firstSeenAt: GENERATED_AT,
    lastCheckedAt: GENERATED_AT,
    factHash: "research-v1",
    status: "候选资源",
    appearances: 1,
    evidenceTags: [],
    authorityLabels: [],
    changes: [],
    ...overrides,
  };
}

function input(overrides: Partial<BuildEvidenceTaskSeedsInput> = {}): BuildEvidenceTaskSeedsInput {
  const paper = research();
  return {
    generatedAt: GENERATED_AT,
    generatedWeek: GENERATED_WEEK,
    companyCandidates: { updatedAt: GENERATED_AT, companies: [company()] },
    events: { updatedAt: GENERATED_AT, events: [deployment()] },
    researchRecords: [paper],
    researchCards: [materializeResearchDecisionCard(paper, { now: new Date(GENERATED_AT) })],
    ...overrides,
  };
}

test("maps one safe gap from each metadata pool without exposing internal ranking", () => {
  const artifact = buildEvidenceTaskSeeds(input());

  assert.deepEqual(artifact.seeds.map((seed) => seed.category), [
    "company-funding",
    "product-deployment",
    "research-metadata",
  ]);
  assert.deepEqual(artifact.seeds.map((seed) => seed.targetField), [
    "funding.amount",
    "deployment.customer",
    "research.codeUrl",
  ]);
  assert.ok(artifact.seeds.every((seed) => seed.estimatedMinutes === 2));
  assert.ok(artifact.seeds.every((seed) => !JSON.stringify(seed).includes("rankScore")));
  assert.doesNotThrow(() => assertEvidenceTaskSeedArtifact(artifact));
  assert.equal(JSON.stringify(buildEvidenceTaskSeeds(input())), JSON.stringify(artifact));
});

test("derives company subject identity without copying or depending on the private candidate ID", () => {
  const privateId = "internal-record-plaintext-987654";
  const build = (id: string) => buildEvidenceTaskSeeds(input({
    companyCandidates: { updatedAt: GENERATED_AT, companies: [company({ id })] },
    events: { updatedAt: GENERATED_AT, events: [] },
    researchRecords: [],
    researchCards: [],
  }));
  const first = build(privateId);
  const second = build("different-private-row-123456");
  const renamed = buildEvidenceTaskSeeds(input({
    companyCandidates: { updatedAt: GENERATED_AT, companies: [company({ id: "third-private-row", name: "Alpha Robotics, Inc." })] },
    events: { updatedAt: GENERATED_AT, events: [] },
    researchRecords: [],
    researchCards: [],
  }));
  const withoutOfficialUrl = buildEvidenceTaskSeeds(input({
    companyCandidates: { updatedAt: GENERATED_AT, companies: [company({ officialUrl: undefined, openQuestions: ["公司官网待补充"] })] },
    events: { updatedAt: GENERATED_AT, events: [] },
    researchRecords: [],
    researchCards: [],
  }));
  const withOfficialUrl = buildEvidenceTaskSeeds(input({
    companyCandidates: { updatedAt: GENERATED_AT, companies: [company({ openQuestions: ["公司官网待补充"] })] },
    events: { updatedAt: GENERATED_AT, events: [] },
    researchRecords: [],
    researchCards: [],
  }));
  const serialized = JSON.stringify(first);

  assert.equal(first.seeds[0]!.subject.id, second.seeds[0]!.subject.id);
  assert.equal(first.seeds[0]!.subject.id, renamed.seeds[0]!.subject.id);
  assert.equal(withoutOfficialUrl.seeds[0]!.subject.id, withOfficialUrl.seeds[0]!.subject.id);
  assert.equal(first.seeds[0]!.materialVersion, second.seeds[0]!.materialVersion);
  assert.equal(first.seeds[0]!.id, second.seeds[0]!.id);
  for (const reversible of [privateId, encodeURIComponent(privateId), Buffer.from(privateId).toString("base64"), Buffer.from(privateId).toString("hex")]) {
    assert.ok(!serialized.includes(reversible), `private candidate ID leaked as ${reversible}`);
  }
});

test("rejects unsupported Chinese and English absence claims in every pool", () => {
  const empty = { updatedAt: GENERATED_AT, companies: [] as CandidateCompany[] };
  const noEvents = { updatedAt: GENERATED_AT, events: [] as EventRecord[] };
  const companyCase = (phrase: string): BuildEvidenceTaskSeedsInput => input({
    companyCandidates: { updatedAt: GENERATED_AT, companies: [company({ openQuestions: ["融资金额待补充", phrase] })] },
    events: noEvents,
    researchRecords: [],
    researchCards: [],
  });
  const productCase = (phrase: string): BuildEvidenceTaskSeedsInput => input({
    companyCandidates: empty,
    events: { updatedAt: GENERATED_AT, events: [deployment({ facts: [phrase] })] },
    researchRecords: [],
    researchCards: [],
  });
  const researchCase = (phrase: string): BuildEvidenceTaskSeedsInput => {
    const base = research();
    const record = { ...base, article: { ...base.article, excerpt: `${base.article.excerpt} ${phrase}` } };
    return input({
      companyCandidates: empty,
      events: noEvents,
      researchRecords: [record],
      researchCards: [materializeResearchDecisionCard(record, { now: new Date(GENERATED_AT) })],
    });
  };
  const cases: Array<[string, (phrase: string) => BuildEvidenceTaskSeedsInput, string[]]> = [
    ["company", companyCase, ["无融资", "该公司暂未融资", "公司未融资", "融资尚未发生", "融资公告并未找到", "尚未找到融资公告", "no public evidence of funding", "funding has not occurred", "the company lacks funding"]],
    ["product", productCase, ["无部署", "该产品尚无部署", "产品未部署", "产品未进行部署", "没有公开的部署信息", "未发现客户证据", "deployment is absent", "the product has not been deployed"]],
    ["research", researchCase, ["无代码", "论文未公开代码", "项目暂无代码", "code is unavailable", "code hasn't been released", "code hasn’t been released", "the paper has not published code"]],
  ];

  for (const [pool, build, phrases] of cases) {
    for (const phrase of phrases) assert.deepEqual(buildEvidenceTaskSeeds(build(phrase)).seeds, [], `${pool}: ${phrase}`);
  }
});

test("rejects a company candidate when any evidence has been withdrawn", () => {
  const withdrawnEvidence = company().evidence.map((item) => ({ ...item, withdrawn: true })) as CandidateCompany["evidence"];
  const artifact = buildEvidenceTaskSeeds(input({
    companyCandidates: { updatedAt: GENERATED_AT, companies: [company({ evidence: withdrawnEvidence })] },
    events: { updatedAt: GENERATED_AT, events: [] },
    researchRecords: [],
    researchCards: [],
  }));

  assert.deepEqual(artifact.seeds, []);
});

test("declares the exact target priority order", () => {
  assert.deepEqual(targetPriority, {
    "company-funding": ["company.officialUrl", "funding.regulatoryFiling", "funding.amount", "funding.round", "funding.valuation", "funding.investors", "company.officialName"],
    "product-deployment": ["product.officialUrl", "deployment.customer", "deployment.scale", "deployment.location", "product.releaseDate"],
    "research-metadata": ["research.codeUrl", "research.weightsUrl", "research.datasetUrl", "research.realRobotEvidence", "research.institutions"],
  });
});

test("maps every declared target field from a single explicit gap", () => {
  const emptyCompanies = { updatedAt: GENERATED_AT, companies: [] as CandidateCompany[] };
  const emptyEvents = { updatedAt: GENERATED_AT, events: [] as EventRecord[] };
  const companyCases: Array<[string, Partial<CandidateCompany>]> = [
    ["company.officialUrl", { officialUrl: undefined, openQuestions: ["公司官网待补充"] }],
    ["funding.regulatoryFiling", { openQuestions: ["监管披露待补充"] }],
    ["funding.amount", { openQuestions: ["融资金额待补充"] }],
    ["funding.round", { openQuestions: ["融资轮次待补充"] }],
    ["funding.valuation", { openQuestions: ["融资估值待补充"] }],
    ["funding.investors", { openQuestions: ["投资方待补充"] }],
    ["company.officialName", { openQuestions: ["公司官方名称待补充"] }],
  ];
  for (const [targetField, overrides] of companyCases) {
    const artifact = buildEvidenceTaskSeeds(input({
      companyCandidates: { updatedAt: GENERATED_AT, companies: [company(overrides)] },
      events: emptyEvents,
      researchRecords: [],
      researchCards: [],
    }));
    assert.deepEqual(artifact.seeds.map((seed) => seed.targetField), [targetField], targetField);
  }

  const productCases: Array<[string, Partial<EventRecord>]> = [
    ["product.officialUrl", { openQuestions: ["产品官方页面待补充"], productDeployment: { product: "Atlas-X", customers: ["Acme"], deployment: "试点" } }],
    ["deployment.customer", { openQuestions: ["客户名称待补充"] }],
    ["deployment.scale", { openQuestions: ["部署规模待补充"], productDeployment: { product: "Atlas-X", customers: ["Acme"], deployment: "试点" } }],
    ["deployment.location", { openQuestions: ["部署地点待补充"], productDeployment: { product: "Atlas-X", customers: ["Acme"], deployment: "试点" } }],
    ["product.releaseDate", { occurredAt: undefined, eventDate: undefined, openQuestions: ["产品发布日期待补充"], productDeployment: { product: "Atlas-X", customers: ["Acme"], deployment: "试点" } }],
  ];
  for (const [targetField, overrides] of productCases) {
    const artifact = buildEvidenceTaskSeeds(input({
      companyCandidates: emptyCompanies,
      events: { updatedAt: GENERATED_AT, events: [deployment(overrides)] },
      researchRecords: [],
      researchCards: [],
    }));
    assert.deepEqual(artifact.seeds.map((seed) => seed.targetField), [targetField], targetField);
  }

  const record = research();
  const baseCard = materializeResearchDecisionCard(record, { now: new Date(GENERATED_AT) });
  const evidenceUrls = [record.article.link];
  const known = <T>(value: T) => ({ value, evidenceUrls });
  const absent = { value: "unknown" as const, evidenceUrls: [] };
  const completeTargets = {
    code: known("https://github.com/acme/atlas"),
    weights: known("https://huggingface.co/acme/atlas"),
    data: known("https://huggingface.co/datasets/acme/atlas"),
    realRobotTrials: known(12),
    lab: known(["Alpha Lab"]),
  };
  const researchCases = ["research.codeUrl", "research.weightsUrl", "research.datasetUrl", "research.realRobotEvidence", "research.institutions"] as const;
  for (const targetField of researchCases) {
    const card: ResearchDecisionCard = {
      ...baseCard,
      artifacts: {
        ...baseCard.artifacts,
        code: targetField === "research.codeUrl" ? absent : completeTargets.code,
        weights: targetField === "research.weightsUrl" ? absent : completeTargets.weights,
        data: targetField === "research.datasetUrl" ? absent : completeTargets.data,
      },
      realRobotTrials: targetField === "research.realRobotEvidence" ? absent : completeTargets.realRobotTrials,
      lab: targetField === "research.institutions" ? absent : completeTargets.lab,
    };
    const artifact = buildEvidenceTaskSeeds(input({
      companyCandidates: emptyCompanies,
      events: emptyEvents,
      researchRecords: [record],
      researchCards: [card],
    }));
    assert.deepEqual(artifact.seeds.map((seed) => seed.targetField), [targetField], targetField);
  }
});

test("keeps task identity stable across non-material observation clock refreshes", () => {
  const first = buildEvidenceTaskSeeds(input());
  const refreshedPaper = research({ lastCheckedAt: "2026-08-24T02:00:00Z" });
  const second = buildEvidenceTaskSeeds(input({
    companyCandidates: {
      updatedAt: "2026-08-24T02:00:00Z",
      companies: [company({ lastSeenAt: "2026-08-24T02:00:00Z" })],
    },
    events: {
      updatedAt: "2026-08-24T02:00:00Z",
      events: [deployment({ lastUpdatedAt: "2026-08-24T02:00:00Z", lastVerifiedAt: "2026-08-24T02:00:00Z" })],
    },
    researchRecords: [refreshedPaper],
    researchCards: [materializeResearchDecisionCard(refreshedPaper, { now: new Date(GENERATED_AT) })],
  }));

  assert.deepEqual(second.seeds.map((seed) => seed.id), first.seeds.map((seed) => seed.id));
});

test("canonicalizes unordered deployment metadata before deriving task identity", () => {
  const event = deployment({
    openQuestions: ["部署规模待补充"],
    productDeployment: { product: "Atlas-X", customers: ["Acme", "Beta"], deployment: "工厂试点" },
  });
  const build = (item: EventRecord) => buildEvidenceTaskSeeds(input({
    companyCandidates: { updatedAt: GENERATED_AT, companies: [] },
    events: { updatedAt: GENERATED_AT, events: [item] },
    researchRecords: [],
    researchCards: [],
  })).seeds[0]!.id;

  assert.equal(build({ ...event, productDeployment: { ...event.productDeployment!, customers: ["Beta", "Acme"] } }), build(event));
});

test("rejects unsafe, terminal, ambiguous, or unsupported seed inputs", () => {
  const safePaper = research();
  const safeCard = materializeResearchDecisionCard(safePaper, { now: new Date(GENERATED_AT) });
  const sparsePaper = research({ article: { ...safePaper.article, excerpt: "No artifact metadata is reported." } });
  const retractedPaper = research({ status: "已撤稿" });
  const withdrawnEvent = {
    ...deployment(),
    evidenceState: "withdrawn",
  } as EventRecord;

  const cases: Array<[string, Partial<BuildEvidenceTaskSeedsInput>]> = [
    ["unresolved company", { companyCandidates: { updatedAt: GENERATED_AT, companies: [company({ status: "候选" })] }, events: { updatedAt: GENERATED_AT, events: [] }, researchRecords: [], researchCards: [] }],
    ["company without a public reference", { companyCandidates: { updatedAt: GENERATED_AT, companies: [company({ officialUrl: undefined, evidence: [] })] }, events: { updatedAt: GENERATED_AT, events: [] }, researchRecords: [], researchCards: [] }],
    ["company with only an internal review reference", { companyCandidates: { updatedAt: GENERATED_AT, companies: [company({ officialUrl: "https://alpha.example/review/private", evidence: [] })] }, events: { updatedAt: GENERATED_AT, events: [] }, researchRecords: [], researchCards: [] }],
    ["company with an invalid official URL and another gap", { companyCandidates: { updatedAt: GENERATED_AT, companies: [company({ officialUrl: "http://alpha.invalid", openQuestions: ["融资金额待补充"] })] }, events: { updatedAt: GENERATED_AT, events: [] }, researchRecords: [], researchCards: [] }],
    ["company with multiple gaps", { companyCandidates: { updatedAt: GENERATED_AT, companies: [company({ openQuestions: ["融资金额待补充", "融资轮次待补充"] })] }, events: { updatedAt: GENERATED_AT, events: [] }, researchRecords: [], researchCards: [] }],
    ["company with an unsupported negative", { companyCandidates: { updatedAt: GENERATED_AT, companies: [company({ openQuestions: ["该公司没有融资"] })] }, events: { updatedAt: GENERATED_AT, events: [] }, researchRecords: [], researchCards: [] }],
    ["unresolved event subject", { companyCandidates: { updatedAt: GENERATED_AT, companies: [] }, events: { updatedAt: GENERATED_AT, events: [deployment({ primaryEntity: undefined })] }, researchRecords: [], researchCards: [] }],
    ["blank event identity", { companyCandidates: { updatedAt: GENERATED_AT, companies: [] }, events: { updatedAt: GENERATED_AT, events: [deployment({ id: "" })] }, researchRecords: [], researchCards: [] }],
    ["blank event title", { companyCandidates: { updatedAt: GENERATED_AT, companies: [] }, events: { updatedAt: GENERATED_AT, events: [deployment({ title: "   " })] }, researchRecords: [], researchCards: [] }],
    ["pending event", { companyCandidates: { updatedAt: GENERATED_AT, companies: [] }, events: { updatedAt: GENERATED_AT, events: [deployment({ status: "核验中" })] }, researchRecords: [], researchCards: [] }],
    ["event with weak evidence", { companyCandidates: { updatedAt: GENERATED_AT, companies: [] }, events: { updatedAt: GENERATED_AT, events: [deployment({ evidence: [{ ...deployment().evidence[0]!, grade: "C" }] })] }, researchRecords: [], researchCards: [] }],
    ["event without a public reference", { companyCandidates: { updatedAt: GENERATED_AT, companies: [] }, events: { updatedAt: GENERATED_AT, events: [deployment({ evidence: [] })] }, researchRecords: [], researchCards: [] }],
    ["withdrawn event", { companyCandidates: { updatedAt: GENERATED_AT, companies: [] }, events: { updatedAt: GENERATED_AT, events: [withdrawnEvent] }, researchRecords: [], researchCards: [] }],
    ["event with multiple gaps", { companyCandidates: { updatedAt: GENERATED_AT, companies: [] }, events: { updatedAt: GENERATED_AT, events: [deployment({ openQuestions: ["客户名称待补充", "部署地点待补充"] })] }, researchRecords: [], researchCards: [] }],
    ["event with an unsupported negative", { companyCandidates: { updatedAt: GENERATED_AT, companies: [] }, events: { updatedAt: GENERATED_AT, events: [deployment({ openQuestions: ["该产品没有部署"] })] }, researchRecords: [], researchCards: [] }],
    ["event with a subject-first Chinese negative", { companyCandidates: { updatedAt: GENERATED_AT, companies: [] }, events: { updatedAt: GENERATED_AT, events: [deployment({ facts: ["部署尚未发生"] })] }, researchRecords: [], researchCards: [] }],
    ["event with an unsupported English negative", { companyCandidates: { updatedAt: GENERATED_AT, companies: [] }, events: { updatedAt: GENERATED_AT, events: [deployment({ openQuestions: ["There is no deployment"] })] }, researchRecords: [], researchCards: [] }],
    ["event with an inflected English negative", { companyCandidates: { updatedAt: GENERATED_AT, companies: [] }, events: { updatedAt: GENERATED_AT, events: [deployment({ openQuestions: ["The product was not deployed"] })] }, researchRecords: [], researchCards: [] }],
    ["research without a public reference", { companyCandidates: { updatedAt: GENERATED_AT, companies: [] }, events: { updatedAt: GENERATED_AT, events: [] }, researchRecords: [{ ...safePaper, article: { ...safePaper.article, link: "" } }], researchCards: [safeCard] }],
    ["retracted research", { companyCandidates: { updatedAt: GENERATED_AT, companies: [] }, events: { updatedAt: GENERATED_AT, events: [] }, researchRecords: [retractedPaper], researchCards: [materializeResearchDecisionCard(retractedPaper, { now: new Date(GENERATED_AT) })] }],
    ["research with multiple gaps", { companyCandidates: { updatedAt: GENERATED_AT, companies: [] }, events: { updatedAt: GENERATED_AT, events: [] }, researchRecords: [sparsePaper], researchCards: [materializeResearchDecisionCard(sparsePaper, { now: new Date(GENERATED_AT) })] }],
    ["research with a blank public title", { companyCandidates: { updatedAt: GENERATED_AT, companies: [] }, events: { updatedAt: GENERATED_AT, events: [] }, researchRecords: [{ ...safePaper, article: { ...safePaper.article, title: " ", titleZh: " " } }], researchCards: [safeCard] }],
  ];

  for (const [name, overrides] of cases) {
    assert.deepEqual(buildEvidenceTaskSeeds(input(overrides)).seeds, [], name);
  }
});
