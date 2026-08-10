import assert from "node:assert/strict";
import test from "node:test";
import {
  applyReviewCaseActions,
  buildReviewCaseArtifact,
  candidateArticleReviewCase,
  candidateCompanyReviewCase,
  candidateSourceReviewCase,
  paperReviewCase,
  reviewCaseGenerator,
  reviewCaseId,
  serializeReviewCaseArtifact,
} from "../src/review-cases.js";
import type { CandidateArticle, CandidateCompany, CandidateSource, ResearchRecord } from "../src/types.js";

const created = "2026-08-09T00:00:00.000Z";
const now = new Date("2026-08-09T05:00:00.000Z");

test("maps candidate articles, companies, sources and papers to stable explicit review cases", () => {
  const article: CandidateArticle = {
    id: "article-1", title: "Robot deployment", link: "https://example.com/article", publishedAt: new Date(created), fetchedAt: new Date(created),
    source: "Official", sourceWeight: 10, excerpt: "robot", tags: [], stage: "待公司主体确认", holdReasons: ["确认公司主体"],
  };
  const company: CandidateCompany = {
    id: "company-1", name: "Nova", aliases: [], status: "已交叉核验", verificationScore: 90, routes: [], firstSeenAt: created, lastSeenAt: created,
    evidence: [], openQuestions: ["补充投资方公告"],
  };
  const source: CandidateSource = { domain: "source.example", title: "Source", link: "https://source.example", status: "候选", firstSeenAt: created, lastSeenAt: created, successfulRuns: 5, failedRuns: 0, selectedArticles: 3 };
  const paper: ResearchRecord = {
    id: "paper-1", article: { ...article, id: "raw-paper", link: "https://arxiv.org/abs/1", scholar: { provider: "OpenAlex", workId: "W1", citedByCount: 80, isRetracted: false, institutions: [], authors: [], checkedAt: created } },
    firstSeenAt: created, lastCheckedAt: created, factHash: "hash", status: "待复核", appearances: 1, evidenceTags: [], authorityLabels: [], changes: [],
  };
  const artifact = buildReviewCaseArtifact(undefined, [reviewCaseGenerator({ articles: [article], companies: [company], sources: [source], papers: [paper] })], now);
  assert.equal(artifact.cases.length, 4);
  assert.deepEqual(artifact.cases.map((item) => item.type).sort(), ["article", "company", "paper", "source"]);
  const item = artifact.cases.find((caseItem) => caseItem.type === "article")!;
  assert.equal(item.caseId, reviewCaseId("article", "article-1"));
  assert.equal(item.owner, null);
  assert.equal(item.decision, null);
  assert.equal(item.firstActionAt, null);
  assert.equal(item.priority, "P0");
  assert.equal(item.dueAt, "2026-08-09T04:00:00.000Z");
  assert.deepEqual(item.auditTrail.map((entry) => entry.action), ["created"]);
  assert.match(serializeReviewCaseArtifact(artifact), /"schemaVersion": 1/);
});

test("raises overdue, unowned and no-next-action alerts and reports the P0 SLO metrics", () => {
  const p0 = { type: "article" as const, subjectId: "p0", createdAt: created, priority: "P0" as const, nextAction: null, missingEvidence: [] };
  const p1 = { type: "company" as const, subjectId: "p1", createdAt: created, priority: "P1" as const, owner: "reviewer", nextAction: "查官网", missingEvidence: ["官网公告"] };
  let artifact = buildReviewCaseArtifact(undefined, [{ id: "fixture", generate: () => [p0, p1] }], now);
  const alerts = artifact.alerts.filter((item) => item.caseId === reviewCaseId("article", "p0"));
  assert.deepEqual(alerts.map((item) => item.code).sort(), ["no-next-action", "overdue", "unowned"]);
  assert.equal(alerts.find((item) => item.code === "overdue")?.severity, "critical");
  assert.equal(artifact.metrics.dueTop20ProbeCoverage.eligible, 1);
  assert.equal(artifact.metrics.dueTop20ProbeCoverage.covered, 0);

  artifact = { ...artifact, cases: applyReviewCaseActions(artifact.cases, [{ caseId: reviewCaseId("article", "p0"), action: "probe", at: "2026-08-09T05:00:00Z", owner: "alice", nextAction: "核对公告" }]) };
  const rebuilt = buildReviewCaseArtifact(artifact, [], now);
  assert.equal(rebuilt.metrics.dueTop20ProbeCoverage.covered, 1);
  assert.equal(rebuilt.metrics.firstResponseP90Hours, 5);
  assert.equal(rebuilt.metrics.sloComplianceRate.eligible, 1);
  assert.equal(rebuilt.metrics.sloComplianceRate.rate, 0);
  assert.equal(rebuilt.metrics.backlogAgeHours.cases, 2);
});

test("same-day generator reruns are idempotent and do not duplicate a case or its audit trail", () => {
  const seed = { type: "source" as const, subjectId: "stable.example", createdAt: created, priority: "P1" as const, nextAction: "验证 feed", missingEvidence: ["RSS 地址"] };
  const first = buildReviewCaseArtifact(undefined, [{ id: "one", generate: () => [seed] }], new Date("2026-08-09T01:00:00Z"));
  const second = buildReviewCaseArtifact(first, [{ id: "one", generate: () => [seed] }], new Date("2026-08-09T23:00:00Z"));
  assert.equal(second.cases.length, 1);
  assert.equal(second.cases[0].createdAt, first.cases[0].createdAt);
  assert.deepEqual(second.cases[0].auditTrail, first.cases[0].auditTrail);
  assert.equal(second.cases[0].caseId, first.cases[0].caseId);
});

test("a rejection is a durable decision and later seed upserts cannot reopen it", () => {
  const seed = { type: "paper" as const, subjectId: "paper-retracted", createdAt: created, priority: "P0" as const, nextAction: "核验撤稿", missingEvidence: ["撤稿原因"] };
  const first = buildReviewCaseArtifact(undefined, [{ id: "paper", generate: () => [seed] }], new Date("2026-08-09T01:00:00Z"));
  const rejectedCases = applyReviewCaseActions(first.cases, [{
    caseId: first.cases[0].caseId, action: "rejected", at: "2026-08-09T02:00:00Z", decisionReason: "论文已撤稿", detail: "Removed from candidate pool",
  }]);
  const rerun = buildReviewCaseArtifact({ ...first, cases: rejectedCases }, [{ id: "paper", generate: () => [seed] }], new Date("2026-08-09T03:00:00Z"));
  assert.equal(rerun.cases[0].state, "rejected");
  assert.equal(rerun.cases[0].decision, "rejected");
  assert.equal(rerun.cases[0].decisionReason, "论文已撤稿");
  assert.equal(rerun.cases[0].nextAction, null);
  assert.equal(rerun.alerts.length, 0);
  assert.deepEqual(rerun.cases[0].auditTrail.map((entry) => entry.action), ["created", "rejected"]);
});

test("individual mapping adapters retain registry IDs rather than display names", () => {
  const article = candidateArticleReviewCase({ id: "a-id", title: "t", link: "https://a.example", publishedAt: new Date(created), fetchedAt: new Date(created), source: "s", sourceWeight: 7, excerpt: "", tags: [], stage: "待中文事实简介", holdReasons: [] });
  const company = candidateCompanyReviewCase({ id: "c-id", name: "Renamed Co", aliases: ["Old Co"], status: "候选", verificationScore: 1, routes: [], firstSeenAt: created, lastSeenAt: created, evidence: [], openQuestions: [] });
  const source = candidateSourceReviewCase({ domain: "s.example", title: "S", link: "https://s.example", status: "候选", firstSeenAt: created, lastSeenAt: created, successfulRuns: 0, failedRuns: 0, selectedArticles: 0 });
  const paper = paperReviewCase({ id: "r-id", article: { id: "different-raw-id", title: "p", link: "https://p.example", publishedAt: new Date(created), fetchedAt: new Date(created), source: "arXiv", sourceWeight: 1, excerpt: "", tags: [] }, firstSeenAt: created, lastCheckedAt: created, factHash: "x", status: "待复核", appearances: 1, evidenceTags: [], authorityLabels: [], changes: [] });
  assert.deepEqual([article.subjectId, company.subjectId, source.subjectId, paper.subjectId], ["a-id", "c-id", "s.example", "r-id"]);
});
