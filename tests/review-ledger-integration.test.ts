import assert from "node:assert/strict";
import test from "node:test";
import { buildCandidateVerificationArtifact } from "../src/candidate-verification.js";
import { buildCompanyClaimLedger } from "../src/company-claim-ledger.js";
import { buildReviewCaseArtifact, reviewCaseGenerator } from "../src/review-cases.js";
import type { CandidateArticle, CandidateCompany, CandidateSource, CompanyProfile, EventStore, ResearchRecord } from "../src/types.js";

const NOW = new Date("2026-08-10T00:00:00.000Z");
const RERUN_NOW = new Date("2026-08-10T12:00:00.000Z");
const FIRST_SEEN = "2026-08-09T00:00:00.000Z";

const candidate: CandidateArticle = {
  id: "candidate-funding", title: "Quiet Robotics completes seed financing", link: "https://quiet.example/news/funding",
  publishedAt: new Date(FIRST_SEEN), fetchedAt: new Date(FIRST_SEEN), source: "Quiet Robotics official", sourceWeight: 10,
  sourceTier: "官方公司与实验室", excerpt: "Quiet Robotics completed a seed financing round.", tags: [], kind: "投融资",
  stage: "待公司主体确认", holdReasons: ["尚未进入人工确认流程"],
};
const profile: CompanyProfile = {
  entityId: "quiet-robotics", name: "Quiet Robotics", region: "北美", stage: "创业公司", routes: ["VLA 与具身模型"],
  thesis: "测试公司", officialUrl: "https://quiet.example",
};
const company: CandidateCompany = {
  id: "candidate-company-quiet", name: "Quiet Robotics", aliases: [], status: "候选", verificationScore: 70, routes: ["VLA 与具身模型"],
  firstSeenAt: FIRST_SEEN, lastSeenAt: FIRST_SEEN, evidence: [], openQuestions: ["需要人工确认融资金额"],
};
const source: CandidateSource = {
  domain: "quiet.example", title: "Quiet Robotics", link: "https://quiet.example", status: "候选", firstSeenAt: FIRST_SEEN,
  lastSeenAt: FIRST_SEEN, successfulRuns: 1, failedRuns: 0, selectedArticles: 1,
};
const paper: ResearchRecord = {
  id: "research-candidate", article: { ...candidate, id: "paper-source", kind: "研究与数据" }, firstSeenAt: FIRST_SEEN,
  lastCheckedAt: FIRST_SEEN, factHash: "paper", status: "待复核", appearances: 1, evidenceTags: [], authorityLabels: [], changes: [],
};

function verificationGenerator(records: ReturnType<typeof buildCandidateVerificationArtifact>["records"]) {
  return {
    id: "candidate-verification",
    *generate() {
      for (const record of records) {
        yield {
          type: "article" as const, subjectId: record.id, createdAt: record.firstSeenAt, impactScore: record.impactScore,
          evidenceCount: record.independentEvidenceCount, hasConflict: record.conflicts.length > 0,
          missingEvidence: [...record.failureReasons, ...record.conflicts], nextAction: "人工确认前保持私有",
        };
      }
    },
  };
}

test("candidate review and company ledger stay private, keep unknown funding, and are idempotent", () => {
  const verification = buildCandidateVerificationArtifact(undefined, [candidate], [profile], NOW);
  assert.equal(verification.records[0]?.status, "可人工审核");
  const eventStore: EventStore = { updatedAt: NOW.toISOString(), events: [] };
  const firstCases = buildReviewCaseArtifact(undefined, [
    reviewCaseGenerator({ articles: [candidate], companies: [company], sources: [source], papers: [paper] }),
    verificationGenerator(verification.records),
  ], NOW);
  const firstLedger = buildCompanyClaimLedger([profile], eventStore.events, { now: NOW });

  // A review-ready A-grade candidate is still only a review case; this flow
  // never mutates the public event store or invents a financing value.
  assert.deepEqual(eventStore.events, []);
  assert.equal(firstCases.cases.length, 5);
  assert.equal(firstLedger.companies[0]?.claims[0]?.claimType, "funding");
  assert.equal(firstLedger.companies[0]?.claims[0]?.value, "unknown");
  assert.equal(firstLedger.companies[0]?.claims[0]?.evidenceState, "evidence_insufficient");

  const rerunVerification = buildCandidateVerificationArtifact(verification, [candidate], [profile], RERUN_NOW);
  const rerunCases = buildReviewCaseArtifact(firstCases, [
    reviewCaseGenerator({ articles: [candidate], companies: [company], sources: [source], papers: [paper] }),
    verificationGenerator(rerunVerification.records),
  ], RERUN_NOW);
  const rerunLedger = buildCompanyClaimLedger([profile], eventStore.events, { now: RERUN_NOW });
  assert.deepEqual(rerunVerification.records, verification.records);
  assert.deepEqual(rerunCases.cases, firstCases.cases);
  assert.deepEqual(
    { limit: rerunLedger.limit, companies: rerunLedger.companies, metrics: rerunLedger.metrics },
    { limit: firstLedger.limit, companies: firstLedger.companies, metrics: firstLedger.metrics },
  );
});
