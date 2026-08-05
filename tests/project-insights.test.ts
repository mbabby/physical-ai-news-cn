import assert from "node:assert/strict";
import test from "node:test";
import { buildProjectMetrics, formatCommunityReviewQueue, formatWeeklyReport } from "../src/project-insights.js";
import type { CandidateCompanyRegistry, CandidateSourceRegistry, DailyArchive, EventStore, SourceRegistry } from "../src/types.js";

const now = new Date("2026-08-05T08:30:00Z");
const store: EventStore = { updatedAt: now.toISOString(), events: [{
  id: "event-1", title: "Nova Robotics 完成融资", type: "投融资", entities: ["Nova Robotics"], primaryEntity: "Nova Robotics", routes: ["本体与硬件"], status: "已确证", firstSeenAt: now.toISOString(), lastUpdatedAt: now.toISOString(), lastVerifiedAt: now.toISOString(), facts: ["Nova Robotics 完成融资，用于机器人本体研发。"], openQuestions: [], timeline: [], evidence: [{ link: "https://nova.example/funding", source: "Nova 官方", grade: "A", publishedAt: "2026-08-05", supports: "融资" }],
}, {
  id: "hidden", title: "未确认融资", type: "投融资", entities: [], routes: ["本体与硬件"], status: "核验中", firstSeenAt: now.toISOString(), lastUpdatedAt: now.toISOString(), lastVerifiedAt: now.toISOString(), facts: ["行业公司获得融资。"], openQuestions: [], timeline: [], evidence: [{ link: "https://news.example/lead", source: "Google News", grade: "B", publishedAt: "2026-08-05", supports: "线索" }],
}] };
const archives: DailyArchive[] = [{ date: "2026-08-05", articles: [], sourceOutcomes: [{ source: "Nova 官方", status: "success", fetchedArticles: 1 }], candidates: [{ id: "candidate", title: "Nova 线索", titleZh: "Nova 融资线索", summaryZh: "有待官网或投资方补充确认。", link: "https://lead.example", publishedAt: now, fetchedAt: now, source: "媒体", sourceWeight: 8, excerpt: "funding", tags: [], stage: "待公司主体确认", holdReasons: ["公司主体未确认"] }] }];
const registry: SourceRegistry = { updatedAt: now.toISOString(), windowDays: 30, sources: [{ name: "Nova 官方", type: "rss", tier: "官方公司与实验室", status: "已启用", publicationPolicy: "可作为一手证据", configuredWeight: 10, effectiveWeight: 10, successfulRuns: 5, failedRuns: 0, selectedArticles: 3, fetchedArticles: 3, relatedHits: 3, correctionCount: 0, health: { successRate: 1, hitRate: 1, inclusionRate: 1, correctionRate: 0, score: 100 }, recommendation: "保留" }] };
const companies: CandidateCompanyRegistry = { updatedAt: now.toISOString(), companies: [{ id: "company", name: "Nova Robotics", aliases: ["Nova Robotics"], status: "观察中", verificationScore: 60, routes: ["本体与硬件"], firstSeenAt: now.toISOString(), lastSeenAt: now.toISOString(), evidence: [], openQuestions: ["需要官网"] }] };
const sources: CandidateSourceRegistry = { updatedAt: now.toISOString(), sources: [{ domain: "candidate.example", title: "候选", link: "https://candidate.example", status: "候选", firstSeenAt: now.toISOString(), lastSeenAt: now.toISOString(), successfulRuns: 2, failedRuns: 0, selectedArticles: 0 }] };

test("weekly report and metrics only use public evidence-backed facts", () => {
  const metrics = buildProjectMetrics(archives, store, registry, companies, now);
  const output = formatWeeklyReport(store, [], metrics, "2026-W32", now);
  assert.match(output, /Nova Robotics/);
  assert.doesNotMatch(output, /未确认融资/);
  assert.equal(metrics.publicContent.companyDossierCoverage, 1);
  assert.equal(metrics.community.stars.status, "未配置");
});

test("community review queue labels candidates instead of promoting them", () => {
  const output = formatCommunityReviewQueue(archives, companies, sources, "2026-W32");
  assert.match(output, /待核验候选/);
  assert.match(output, /Nova 融资线索/);
  assert.match(output, /需要官网/);
  assert.doesNotMatch(output, /已确证/);
});
