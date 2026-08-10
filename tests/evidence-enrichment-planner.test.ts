import assert from "node:assert/strict";
import test from "node:test";
import { buildEvidenceEnrichmentPlan, evidenceGaps } from "../src/evidence-enrichment-planner.js";
import type { CandidateVerificationArtifact, CandidateVerificationRecord, FieldVerification } from "../src/candidate-verification.js";
import type { Article, CompanyProfile, SourceConfig } from "../src/types.js";

const unknownField = (): FieldVerification => ({ status: "unknown", independentSourceCount: 0, evidenceArticleIds: [] });
const profiles: CompanyProfile[] = [{
  entityId: "nova", name: "Nova Robotics", aliases: ["Nova"], region: "北美", stage: "创业公司", routes: ["本体与硬件"],
  thesis: "仓储机器人", officialUrl: "https://nova.example.com", officialDomains: ["nova.example.com"],
}];
const sources: SourceConfig[] = [{
  id: "nova-official", entityIds: ["nova"], role: "公司官网", type: "rss", name: "Nova News", url: "https://nova.example.com/feed.xml",
  weight: 10, keywords: ["robot"], tier: "官方公司与实验室", status: "已启用", publicationPolicy: "可作为一手证据",
}, {
  id: "robot-media", role: "产业媒体", type: "rss", name: "Robot Wire", url: "https://robotwire.example.com/feed.xml",
  weight: 8, keywords: ["robot"], tier: "权威产业媒体", status: "已启用", publicationPolicy: "可作为独立报道",
}, {
  id: "regulatory", role: "监管披露", type: "webpage", name: "Filings", url: "https://filings.example.gov/search",
  weight: 10, keywords: ["company"], tier: "官方公司与实验室", status: "已启用", publicationPolicy: "可作为一手证据",
}];

function record(id: string, overrides: Partial<CandidateVerificationRecord> = {}): CandidateVerificationRecord {
  const evidence = [{
    articleId: `${id}-b`, link: `https://wire.example.com/${id}`, source: "Industry Wire", grade: "B" as const,
    sourceClass: "authoritative-media" as const, score: 30, independentOrigin: "wire.example.com", publishedAt: "2026-08-08T00:00:00Z",
    title: "Nova Robotics raises $12 million seed funding", amount: "$12 million", round: "seed",
  }];
  return {
    id, companyName: "Nova Robotics", companyEntityId: "nova", kind: "投融资", title: "Nova Robotics 完成 1200 万美元种子轮融资",
    status: "等待重试", publicStatus: "developing", publicationState: "developing", confidenceScore: 30, independentEvidenceCount: 1,
    impactScore: 80, discoveryOrigins: [], enrichmentAttempts: [], firstSeenAt: "2026-08-08T00:00:00Z", attempts: 1,
    evidenceHash: `hash-${id}`, evidence, facts: { amount: "$12 million", round: "seed" },
    fieldVerification: {
      amount: { status: "single-source", value: "$12 million", independentSourceCount: 1, evidenceArticleIds: [`${id}-b`] },
      round: { status: "single-source", value: "seed", independentSourceCount: 1, evidenceArticleIds: [`${id}-b`] }, eventDate: unknownField(),
    }, conflicts: [], failureReasons: ["尚缺一条 A 级一手证据，或两个独立 B 级来源"], ...overrides,
  };
}
function artifact(records: CandidateVerificationRecord[]): CandidateVerificationArtifact { return { schemaVersion: 1, generatedAt: "2026-08-09T00:00:00Z", records }; }
function article(id: string, overrides: Partial<Article> = {}): Article {
  const date = new Date("2026-08-09T00:00:00Z");
  return {
    id, title: "Nova Robotics announces $12 million seed funding", titleZh: "Nova Robotics 宣布完成 1200 万美元种子轮融资",
    link: `https://nova.example.com/news/${id}`, publishedAt: date, fetchedAt: date, source: "Nova News", sourceWeight: 10,
    sourceTier: "官方公司与实验室", excerpt: "Nova Robotics seed funding", kind: "投融资", tags: ["投融资"], ...overrides,
  };
}

test("plans only allowlisted probes and keeps discovered evidence candidate-only", () => {
  const original = record("nova-funding");
  const verification = artifact([original]);
  const result = buildEvidenceEnrichmentPlan({ verification, companies: profiles, sources, evidencePool: [
    article("official"),
    article("unlisted", { link: "https://unlisted.example.net/nova", sourceTier: "权威产业媒体" }),
  ] }, { maxPlansPerRun: 2 }, new Date("2026-08-10T00:00:00Z"));
  const plan = result.plans[0];

  assert.deepEqual(evidenceGaps(original), ["missing-official", "missing-second-independent-source"]);
  assert.ok(plan.probes.length > 0);
  assert.ok(plan.probes.every((probe) => result.policy.allowedDomains.includes(probe.domain)));
  assert.ok(plan.probes.every((probe) => probe.query.startsWith(`site:${probe.domain}`)));
  assert.deepEqual(plan.candidateEvidence.map((item) => item.articleId), ["official"]);
  assert.equal(plan.candidateEvidence[0].disposition, "candidate-only");
  assert.equal(plan.candidateEvidence[0].mayPublish, false);
  assert.equal(plan.candidateEvidence[0].mayUpgradeFactGrade, false);
  assert.equal(verification.records[0].publicationState, "developing");
  assert.equal(result.policy.automaticPublication, false);
});

test("supports missing subjects and amount conflicts with directed source classes", () => {
  const missingSubject = record("unknown", { companyName: "待识别公司", companyEntityId: undefined, title: "Warehouse robotics company raises seed funding" });
  const conflict = record("conflict", {
    impactScore: 95, conflicts: ["金额不一致：$12 million / $18 million"], facts: { round: "seed" },
    fieldVerification: {
      amount: { status: "conflicting", independentSourceCount: 2, evidenceArticleIds: ["a", "b"] },
      round: { status: "corroborated", value: "seed", independentSourceCount: 2, evidenceArticleIds: ["a", "b"] }, eventDate: unknownField(),
    },
  });
  const result = buildEvidenceEnrichmentPlan({ verification: artifact([missingSubject, conflict]), companies: profiles, sources }, {}, new Date("2026-08-10T00:00:00Z"));

  const subjectPlan = result.plans.find((plan) => plan.recordId === "unknown")!;
  const conflictPlan = result.plans.find((plan) => plan.recordId === "conflict")!;
  assert.ok(subjectPlan.gaps.includes("missing-subject"));
  assert.ok(subjectPlan.probes.some((probe) => probe.sourceClass === "regulatory" || probe.sourceClass === "authoritative-media"));
  assert.ok(conflictPlan.gaps.includes("amount-conflict"));
  assert.ok(conflictPlan.probes.filter((probe) => probe.addresses.includes("amount-conflict")).every((probe) => ["company-official", "regulatory", "investor-official"].includes(probe.sourceClass)));
  assert.equal(result.plans[0].recordId, "conflict");
});

test("enforces run budget and keeps unchanged work idempotent during backoff", () => {
  const first = buildEvidenceEnrichmentPlan({ verification: artifact([record("one", { impactScore: 90 }), record("two", { impactScore: 70 })]), companies: profiles, sources }, { maxPlansPerRun: 1 }, new Date("2026-08-10T00:00:00Z"));
  assert.equal(first.budget.attemptedPlans, 1);
  assert.equal(first.budget.deferredPlans, 1);
  assert.equal(first.plans.find((plan) => plan.recordId === "two")?.status, "deferred");
  assert.equal(first.plans.find((plan) => plan.recordId === "one")?.nextAttemptAt?.slice(0, 10), "2026-08-11");

  const unchanged = buildEvidenceEnrichmentPlan({ verification: artifact([record("one", { impactScore: 90 }), record("two", { impactScore: 70 })]), companies: profiles, sources, previous: first }, { maxPlansPerRun: 1 }, new Date("2026-08-10T12:00:00Z"));
  assert.deepEqual(unchanged.plans.find((plan) => plan.recordId === "one"), first.plans.find((plan) => plan.recordId === "one"));
  assert.equal(unchanged.plans.find((plan) => plan.recordId === "one")?.attemptCount, 1);

  let retried = buildEvidenceEnrichmentPlan({ verification: artifact([record("one", { impactScore: 90 })]), companies: profiles, sources, previous: first }, {}, new Date("2026-08-11T00:00:00Z"));
  assert.equal(retried.plans[0].attemptCount, 2);
  assert.equal(retried.plans[0].nextAttemptAt?.slice(0, 10), "2026-08-14");
  for (const date of ["2026-08-14T00:00:00Z", "2026-08-21T00:00:00Z", "2026-09-20T00:00:00Z"]) {
    retried = buildEvidenceEnrichmentPlan({ verification: artifact([record("one", { impactScore: 90 })]), companies: profiles, sources, previous: retried }, {}, new Date(date));
  }
  assert.equal(retried.plans[0].attemptCount, 5);
  assert.equal(retried.plans[0].status, "exhausted");
  assert.equal(retried.plans[0].nextAttemptAt, undefined);
});

test("invalid or insufficient allowlist input degrades per record without throwing", () => {
  const result = buildEvidenceEnrichmentPlan({
    verification: artifact([record("no-target", { companyName: "待识别公司", companyEntityId: undefined })]), companies: [], sources: [], allowedDomains: ["not a domain"],
  }, {}, new Date("2026-08-10T00:00:00Z"));
  assert.equal(result.status, "degraded");
  assert.equal(result.plans[0].status, "degraded");
  assert.equal(result.plans[0].candidateEvidence.length, 0);
  assert.ok(result.errors.some((error) => /白名单域名无效/.test(error)));
});
