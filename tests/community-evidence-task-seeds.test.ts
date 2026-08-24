import assert from "node:assert/strict";
import test from "node:test";
import { buildEvidenceTaskSeeds, type BuildEvidenceTaskSeedsInput } from "../src/community-evidence/task-seeds.js";
import { assertEvidenceTaskSeedArtifact } from "../src/community-evidence/contracts.js";
import { materializeResearchDecisionCard } from "../src/research-decision-card.js";
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
    ["company with multiple gaps", { companyCandidates: { updatedAt: GENERATED_AT, companies: [company({ openQuestions: ["融资金额待补充", "融资轮次待补充"] })] }, events: { updatedAt: GENERATED_AT, events: [] }, researchRecords: [], researchCards: [] }],
    ["company with an unsupported negative", { companyCandidates: { updatedAt: GENERATED_AT, companies: [company({ openQuestions: ["该公司没有融资"] })] }, events: { updatedAt: GENERATED_AT, events: [] }, researchRecords: [], researchCards: [] }],
    ["unresolved event subject", { companyCandidates: { updatedAt: GENERATED_AT, companies: [] }, events: { updatedAt: GENERATED_AT, events: [deployment({ primaryEntity: undefined })] }, researchRecords: [], researchCards: [] }],
    ["event without a public reference", { companyCandidates: { updatedAt: GENERATED_AT, companies: [] }, events: { updatedAt: GENERATED_AT, events: [deployment({ evidence: [] })] }, researchRecords: [], researchCards: [] }],
    ["withdrawn event", { companyCandidates: { updatedAt: GENERATED_AT, companies: [] }, events: { updatedAt: GENERATED_AT, events: [withdrawnEvent] }, researchRecords: [], researchCards: [] }],
    ["event with multiple gaps", { companyCandidates: { updatedAt: GENERATED_AT, companies: [] }, events: { updatedAt: GENERATED_AT, events: [deployment({ openQuestions: ["客户名称待补充", "部署地点待补充"] })] }, researchRecords: [], researchCards: [] }],
    ["event with an unsupported negative", { companyCandidates: { updatedAt: GENERATED_AT, companies: [] }, events: { updatedAt: GENERATED_AT, events: [deployment({ openQuestions: ["该产品没有部署"] })] }, researchRecords: [], researchCards: [] }],
    ["event with an unsupported English negative", { companyCandidates: { updatedAt: GENERATED_AT, companies: [] }, events: { updatedAt: GENERATED_AT, events: [deployment({ openQuestions: ["There is no deployment"] })] }, researchRecords: [], researchCards: [] }],
    ["research without a public reference", { companyCandidates: { updatedAt: GENERATED_AT, companies: [] }, events: { updatedAt: GENERATED_AT, events: [] }, researchRecords: [{ ...safePaper, article: { ...safePaper.article, link: "" } }], researchCards: [safeCard] }],
    ["retracted research", { companyCandidates: { updatedAt: GENERATED_AT, companies: [] }, events: { updatedAt: GENERATED_AT, events: [] }, researchRecords: [retractedPaper], researchCards: [materializeResearchDecisionCard(retractedPaper, { now: new Date(GENERATED_AT) })] }],
    ["research with multiple gaps", { companyCandidates: { updatedAt: GENERATED_AT, companies: [] }, events: { updatedAt: GENERATED_AT, events: [] }, researchRecords: [sparsePaper], researchCards: [materializeResearchDecisionCard(sparsePaper, { now: new Date(GENERATED_AT) })] }],
  ];

  for (const [name, overrides] of cases) {
    assert.deepEqual(buildEvidenceTaskSeeds(input(overrides)).seeds, [], name);
  }
});
