import assert from "node:assert/strict";
import test from "node:test";
import { buildEventAnomalyReport } from "../src/event-anomalies.js";
import type { DailyArchive, EventRecord, EventStore } from "../src/types.js";

function event(id: string, publishedAt: string, type: EventRecord["type"] = "产品发布", source = "Company 官网", link = `https://company.example/${id}`): EventRecord {
  return {
    id, title: `Company ${id}`, type, entities: ["Company"], primaryEntity: "Company", routes: ["部署与商业化"], status: "已确证",
    firstSeenAt: "2026-08-09", lastUpdatedAt: "2026-08-09", lastVerifiedAt: "2026-08-09", facts: ["Company 公布了可核验的机器人进展。"], openQuestions: [], timeline: [],
    evidence: [{ link, source, grade: "A", publishedAt, supports: "公开事件" }],
  };
}

test("flags concentrated dates, stale evidence, candidate backlog and arXiv contamination", () => {
  const events = [
    event("one", "2026-08-01"), event("two", "2026-08-01"), event("three", "2026-08-01"), event("four", "2026-07-31"),
    event("paper-pollution", "2026-08-01", "产品发布", "arXiv", "https://arxiv.org/abs/1234"),
  ];
  const candidates = Array.from({ length: 21 }, (_, index) => ({
    id: `candidate-${index}`, title: `Candidate ${index}`, link: `https://lead.example/${index}`, publishedAt: new Date("2026-08-08"), fetchedAt: new Date("2026-08-09"),
    source: "Discovery", sourceWeight: 8, excerpt: "lead", tags: [], stage: "待二次证据" as const, holdReasons: ["需要第二来源"],
  }));
  const archives: DailyArchive[] = [{ date: "2026-08-09", articles: [], candidates }];
  const report = buildEventAnomalyReport({ updatedAt: "2026-08-09", events }, archives, new Date("2026-08-09T12:00:00Z"));
  assert.equal(report.metrics.publicIndustryEvents30d, 5);
  assert.equal(report.metrics.dominantEventDate, "2026-08-01");
  assert.equal(report.metrics.candidateBacklog, 21);
  assert.equal(report.metrics.arxivIndustryEvents, 1);
  assert.ok(report.alerts.some((alert) => alert.code === "event-date-concentration"));
  assert.ok(report.alerts.some((alert) => alert.code === "no-new-industry-evidence"));
  assert.ok(report.alerts.some((alert) => alert.code === "candidate-backlog"));
  assert.ok(report.alerts.some((alert) => alert.code === "arxiv-industry-contamination"));
});

test("reports an honestly empty week without creating an event", () => {
  const report = buildEventAnomalyReport({ updatedAt: "2026-08-09", events: [event("old", "2026-07-20")] }, [], new Date("2026-08-09T12:00:00Z"));
  assert.equal(report.metrics.publicIndustryEvents30d, 1);
  assert.equal(report.metrics.newPublicIndustryEvents7d, 0);
  assert.equal(report.alerts.find((alert) => alert.code === "no-new-industry-evidence")?.severity, "严重");
});

test("does not treat discovery-only evidence as public activity", () => {
  const clue = event("clue", "2026-08-09", "投融资", "Google News", "https://news.google.com/clue");
  const report = buildEventAnomalyReport({ updatedAt: "2026-08-09", events: [clue] }, [], new Date("2026-08-09T12:00:00Z"));
  assert.equal(report.metrics.publicIndustryEvents30d, 0);
  assert.ok(report.alerts.some((alert) => alert.code === "no-new-industry-evidence"));
});
