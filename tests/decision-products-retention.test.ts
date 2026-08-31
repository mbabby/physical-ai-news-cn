import assert from "node:assert/strict";
import test from "node:test";

import type { BenchmarkResultLedger } from "../src/benchmark-result-ledger.js";
import type { CompanyClaimLedger } from "../src/company-claim-ledger.js";
import { stableDecisionId, type DecisionProductArtifact } from "../src/decision-products/contracts.js";
import {
  buildDecisionProductArtifact,
  buildDecisionProductRetentionReceipt,
  decisionProductArtifactSha256,
  shouldDegradeResearchPassportProjection,
} from "../src/decision-products/materialize.js";
import { materializeResearchDecisionCard } from "../src/research-decision-card.js";
import type { CompanyProfile, EventRecord, ResearchRecord } from "../src/types.js";
import type { WatchlistPublicView } from "../src/watchlist/public-view.js";

const NOW = new Date("2026-08-24T08:00:00.000Z");
const PRIOR_TIME = "2026-08-23T08:00:00.000Z";
const PAPER_URL = "https://arxiv.org/abs/2608.00001";

const company: CompanyProfile = {
  entityType: "公司",
  entityId: "company-alpha",
  name: "Alpha Robotics",
  region: "美国",
  stage: "成长公司",
  routes: ["本体与硬件"],
  thesis: "机器人本体",
  officialUrl: "https://alpha.example/",
};

const researchRecord: ResearchRecord = {
  id: "paper-alpha",
  article: {
    id: "paper-alpha",
    title: "Alpha robot policy",
    titleZh: "一种机器人策略",
    summaryZh: "该方法面向机器人操作。论文报告了真实机器人实验。",
    link: PAPER_URL,
    publishedAt: new Date("2026-08-20T00:00:00.000Z"),
    fetchedAt: new Date(PRIOR_TIME),
    source: "arXiv · Robotics",
    sourceWeight: 1,
    excerpt: "A robot policy.",
    tags: ["机器人"],
    scholar: {
      provider: "OpenAlex",
      workId: "https://openalex.org/W1",
      citedByCount: 1,
      isRetracted: false,
      institutions: ["Alpha Lab"],
      authors: [{ name: "Alice", institutions: ["Alpha Lab"] }],
      checkedAt: PRIOR_TIME,
    },
  },
  firstSeenAt: "2026-08-20T00:00:00.000Z",
  lastCheckedAt: PRIOR_TIME,
  factHash: "fact-alpha",
  status: "新论文",
  appearances: 1,
  evidenceTags: [],
  authorityLabels: ["Alpha Lab"],
  changes: [],
};

function companyLedger(): CompanyClaimLedger {
  return {
    generatedAt: NOW.toISOString(), limit: 15, companies: [],
    metrics: {
      populatedFields: 0, totalFields: 0, fieldCompletenessRate: 0, staleClaimCount: 0,
      staleEvidenceCount: 0, eligibleEventCount: 0, attributedEventCount: 0,
      eventCoverageRate: 0, selectedCompanyCount: 0, companiesWithEligibleEvents: 0,
    },
  };
}

function benchmarkLedger(): BenchmarkResultLedger {
  return { generatedAt: NOW.toISOString(), entries: [] };
}

function watchlist(): WatchlistPublicView {
  return {
    week: "2026-W35", snapshotVersion: 1, methodologyVersion: "v1",
    lastSuccessfulAt: PRIOR_TIME, companyIds: [], forwardRadar: [], validatedMomentum: [], changes: [],
  };
}

function priorArtifact(): DecisionProductArtifact {
  return {
    schemaVersion: 1,
    generatedAt: PRIOR_TIME,
    periodStart: "2026-08-17",
    topSignals: [],
    companyCards: [{
      cardId: stableDecisionId("company", company.entityId!), companyId: company.entityId!, companyName: company.name,
      officialUrl: company.officialUrl, region: company.region, stage: company.stage!, routes: [...company.routes],
      capital: { status: "unknown", summary: "证据不足（不代表未融资）", evidence: [] },
      validationStage: "证据不足",
      productDeployment: { status: "unknown", summary: "证据不足（不代表没有产品或部署进展）", evidence: [] },
      recentChanges: [], watchlist: { track: "unknown", lifecycle: "unknown", whyNow: "证据不足", nextValidationPoints: [] },
      unknownFields: ["capital.amount"], updatedAt: PRIOR_TIME,
    }],
    researchPassports: [{
      passportId: stableDecisionId("research", researchRecord.id), paperId: researchRecord.id,
      titleZh: "一种机器人策略", factsZh: ["该方法面向机器人操作。", "论文报告了真实机器人实验。"],
      sourceUrl: PAPER_URL, task: ["机器人操作"], embodiment: ["机械臂"], methods: "unknown",
      benchmark: { name: "unknown", metric: "unknown", result: "unknown", baseline: "unknown", delta: "unknown", evidenceUrls: [] },
      realRobotTrials: "unknown", assets: { code: "unknown", data: "unknown", weights: "unknown" },
      reproducibilityCost: { level: "unknown", rationale: "unknown" },
      authority: { openAlexWorkId: "W1", authors: ["Alice"], labs: ["Alpha Lab"], citedByCount: 1, checkedAt: PRIOR_TIME },
      limitations: "unknown", gaps: ["assets.code"],
      whyWorthAttention: "AI 研究判断：保留已核验的完整研究卡。", rankReasons: ["OpenAlex 元数据已核验"],
    }],
    subscriptions: { generatedAt: PRIOR_TIME, entries: [] },
  };
}

function buildInput(previousArtifact?: DecisionProductArtifact) {
  return {
    generatedAt: NOW,
    events: [] as EventRecord[],
    companies: [structuredClone(company)],
    companyClaimLedger: companyLedger(),
    researchRecords: [structuredClone(researchRecord)],
    researchDecisionCards: [],
    benchmarkResultLedger: benchmarkLedger(),
    watchlist: watchlist(),
    previousArtifact,
    researchPassportProjectionDegraded: false,
  };
}

test("passport projection degrades only on an attempted partial external-service failure", () => {
  const previousArtifact = priorArtifact();
  const researchDecisionCards = [materializeResearchDecisionCard(structuredClone(researchRecord), { now: NOW })];
  const status = (component: "LLM" | "OpenAlex", state: "成功" | "部分降级" | "未配置") => ({
    component, status: state, attempted: state === "未配置" ? 0 : 1,
    succeeded: state === "成功" ? 1 : 0, failed: state === "部分降级" ? 1 : 0, detail: state,
  });
  assert.equal(shouldDegradeResearchPassportProjection({ previousArtifact, researchDecisionCards, runtimeStatuses: [status("OpenAlex", "未配置")] }), false);
  assert.equal(shouldDegradeResearchPassportProjection({ previousArtifact, researchDecisionCards, runtimeStatuses: [status("LLM", "成功")] }), false);
  assert.equal(shouldDegradeResearchPassportProjection({ previousArtifact, researchDecisionCards, runtimeStatuses: [status("OpenAlex", "部分降级")] }), true);
});

test("a sparse degraded run retains prior valid cards and passports without changing item clocks", () => {
  const completeInput = buildInput();
  completeInput.companies[0]!.lastVerifiedAt = PRIOR_TIME;
  completeInput.researchDecisionCards = [materializeResearchDecisionCard(completeInput.researchRecords[0]!, { now: NOW })];
  const first = buildDecisionProductArtifact(completeInput);
  assert.equal(first.companyCards.length, 1);
  assert.equal(first.researchPassports.length, 1);

  const degradedInput = buildInput(first);
  degradedInput.researchDecisionCards = [materializeResearchDecisionCard(degradedInput.researchRecords[0]!, { now: NOW })];
  degradedInput.researchPassportProjectionDegraded = true;
  const retained = buildDecisionProductArtifact(degradedInput);
  assert.deepEqual(retained.topSignals, []);
  assert.deepEqual(retained.companyCards.map((card) => card.cardId), first.companyCards.map((card) => card.cardId));
  assert.deepEqual(retained.researchPassports.map((passport) => passport.passportId), first.researchPassports.map((passport) => passport.passportId));
  assert.equal(retained.companyCards[0]!.updatedAt, PRIOR_TIME);
  assert.equal(retained.researchPassports[0]!.authority.checkedAt, PRIOR_TIME);
});

test("retention receipt records prior influence even when current and published artifacts share every identity", () => {
  const previous = priorArtifact();
  const current = structuredClone(previous);
  current.generatedAt = NOW.toISOString();
  current.periodStart = "2026-08-18";
  current.subscriptions.generatedAt = NOW.toISOString();
  current.researchPassports[0]!.factsZh = ["当前输入生成第一条事实。", "当前输入生成第二条事实。"];

  const published = structuredClone(current);
  published.researchPassports[0]!.factsZh = [...previous.researchPassports[0]!.factsZh] as [string, string];

  const receipt = buildDecisionProductRetentionReceipt({
    currentArtifact: current,
    artifact: published,
    previousArtifact: previous,
  });

  assert.equal(receipt.previousArtifactSha256, decisionProductArtifactSha256(previous));
  assert.deepEqual(receipt.retainedCompanyIds, []);
  assert.deepEqual(receipt.retainedPaperIds, []);
});

test("retention drops a company card whose referenced event is now withdrawn", () => {
  const previous = priorArtifact();
  previous.companyCards[0]!.recentChanges = [{ eventId: "event-alpha", title: "Alpha 发布机器人", occurredAt: PRIOR_TIME, type: "产品发布" }];
  const event: EventRecord & { evidenceState: "withdrawn" } = {
    id: "event-alpha", title: "Alpha 发布机器人", type: "产品发布", entities: [company.name], primaryEntity: company.name,
    routes: ["本体与硬件"], status: "已归档", evidenceState: "withdrawn", occurredAt: PRIOR_TIME,
    firstSeenAt: PRIOR_TIME, lastUpdatedAt: PRIOR_TIME, lastVerifiedAt: PRIOR_TIME,
    facts: ["Alpha 发布了机器人。", "该产品公开了验证结果。"], openQuestions: [], timeline: [],
    evidence: [{ link: "https://alpha.example/robot", source: "Alpha", grade: "A", withdrawn: true } as EventRecord["evidence"][number]],
  };
  const input = buildInput(previous);
  input.events = [event];
  assert.deepEqual(buildDecisionProductArtifact(input).companyCards, []);
});

test("retention drops a passport after a current retraction", () => {
  const control = buildInput(priorArtifact());
  control.researchDecisionCards = [materializeResearchDecisionCard(control.researchRecords[0]!, { now: NOW })];
  control.researchPassportProjectionDegraded = true;
  assert.equal(buildDecisionProductArtifact(control).researchPassports.length, 1);
  const input = buildInput(priorArtifact());
  input.researchDecisionCards = [materializeResearchDecisionCard(input.researchRecords[0]!, { now: NOW })];
  input.researchPassportProjectionDegraded = true;
  input.researchRecords[0]!.status = "已撤稿";
  input.researchRecords[0]!.article.scholar!.isRetracted = true;
  assert.deepEqual(buildDecisionProductArtifact(input).researchPassports, []);
});

test("retention drops a prior Passport when current papers share one normalized OpenAlex work identity", () => {
  const input = buildInput(priorArtifact());
  input.researchRecords[0]!.article.scholar!.workId = "https://openalex.org/W1";
  input.researchRecords.push({
    ...structuredClone(researchRecord),
    id: "paper-beta",
    article: {
      ...structuredClone(researchRecord.article), id: "paper-beta", link: "https://arxiv.org/abs/2608.00002",
      scholar: { ...structuredClone(researchRecord.article.scholar!), workId: "w1" },
    },
  });
  assert.deepEqual(buildDecisionProductArtifact(input).researchPassports, []);
});

test("retention drops a prior W1 Passport after a valid current card changes ownership to W2", () => {
  const input = buildInput(priorArtifact());
  input.researchRecords[0]!.article.scholar!.workId = "W2";
  input.researchDecisionCards = [materializeResearchDecisionCard(input.researchRecords[0]!, { now: NOW })];
  input.researchPassportProjectionDegraded = true;
  assert.deepEqual(buildDecisionProductArtifact(input).researchPassports, []);
});

test("retention accepts a unique normalized OpenAlex ID and rejects a non-OpenAlex owner", () => {
  const normalized = buildInput(priorArtifact());
  normalized.researchRecords[0]!.article.scholar!.workId = "w1";
  normalized.researchDecisionCards = [materializeResearchDecisionCard(normalized.researchRecords[0]!, { now: NOW })];
  normalized.researchPassportProjectionDegraded = true;
  assert.deepEqual(buildDecisionProductArtifact(normalized).researchPassports.map((passport) => passport.paperId), ["paper-alpha"]);

  const mismatchedOwner = buildInput(priorArtifact());
  mismatchedOwner.researchRecords[0]!.article.scholar!.workId = "https://example.com/W1";
  assert.deepEqual(buildDecisionProductArtifact(mismatchedOwner).researchPassports, []);
});

test("retention drops prior known benchmark data unsupported by the current ledger", () => {
  const previous = priorArtifact();
  previous.researchPassports[0]!.benchmark = {
    name: "LIBERO", metric: "unknown", result: "unknown", baseline: "unknown", delta: "unknown", evidenceUrls: [PAPER_URL],
  };
  assert.deepEqual(buildDecisionProductArtifact(buildInput(previous)).researchPassports, []);
});

test("retention requires the current canonical entity to remain a company", () => {
  const input = buildInput(priorArtifact());
  input.companies[0]!.entityType = "实验室";
  assert.deepEqual(buildDecisionProductArtifact(input).companyCards, []);
});

test("retention is per identity even when an unrelated new card keeps the current count flat", () => {
  const input = buildInput(priorArtifact());
  input.companies.push({
    ...structuredClone(company), entityId: "company-beta", name: "Beta Robotics", officialUrl: "https://beta.example/", lastVerifiedAt: NOW.toISOString(),
  });
  const artifact = buildDecisionProductArtifact(input);
  assert.deepEqual(artifact.companyCards.map((card) => card.companyId), ["company-beta", "company-alpha"]);
});

test("current canonical cards remain first when a full prior set reaches the cap", () => {
  const previous = priorArtifact();
  const baseCard = previous.companyCards[0]!;
  const priorCompanies = Array.from({ length: 20 }, (_, index) => {
    const suffix = String(index).padStart(2, "0");
    return {
      ...structuredClone(company), entityId: `company-prior-${suffix}`, name: `Prior Robotics ${suffix}`, officialUrl: `https://prior-${suffix}.example/`,
    } satisfies CompanyProfile;
  });
  previous.companyCards = priorCompanies.map((profile) => ({
    ...structuredClone(baseCard), cardId: stableDecisionId("company", profile.entityId!), companyId: profile.entityId!,
    companyName: profile.name, officialUrl: profile.officialUrl,
  }));
  const input = buildInput(previous);
  input.companies = [...priorCompanies, {
    ...structuredClone(company), entityId: "company-current", name: "Current Robotics", officialUrl: "https://current.example/", lastVerifiedAt: NOW.toISOString(),
  }];
  const artifact = buildDecisionProductArtifact(input);
  assert.equal(artifact.companyCards.length, 20);
  assert.equal(artifact.companyCards[0]!.companyId, "company-current");
  assert.equal(artifact.companyCards.some((card) => card.companyId === "company-prior-19"), false);
});

test("retention rejects a prior artifact containing candidate or private data", () => {
  for (const mutate of [
    (value: DecisionProductArtifact & { rawModelOutput?: string }) => { value.rawModelOutput = "private"; },
    (value: DecisionProductArtifact) => { value.companyCards[0]!.companyId = "candidate-hidden"; },
  ]) {
    const previous = priorArtifact();
    mutate(previous);
    assert.throws(() => buildDecisionProductArtifact(buildInput(previous)), /Invalid decision product artifact/);
  }
});
