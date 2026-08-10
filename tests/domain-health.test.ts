import assert from "node:assert/strict";
import test from "node:test";
import { buildDomainHealth } from "../src/domain-health.js";
import type { DomainHealthObservation } from "../src/domain-health.js";
import type { Article, CompanyProfile, RunHistory, RuntimeStatus } from "../src/types.js";

test("builds coverage-gap cells for company, region, route, event type and source tier", () => {
  const observations: DomainHealthObservation[] = [{
    id: "funding-alpha", domain: "funding", observed: 1, evidenceReady: 0,
    company: "Alpha Robotics", region: "中国", routes: ["本体与硬件"], eventType: "投融资",
    sourceTier: "权威产业媒体", gaps: ["缺少第二独立来源"],
  }];
  const report = buildDomainHealth({
    observations,
    expectations: [
      { domain: "funding", expected: 2 },
      { domain: "funding", expected: 1, dimension: "company", key: "Alpha Robotics" },
      { domain: "funding", expected: 1, dimension: "region", key: "北美" },
      { domain: "funding", expected: 1, dimension: "route", key: "本体与硬件" },
      { domain: "funding", expected: 1, dimension: "event-type", key: "投融资" },
      { domain: "funding", expected: 1, dimension: "source-tier", key: "官方公司与实验室" },
    ],
  }, new Date("2026-08-10T00:00:00Z"));

  assert.equal(report.domains.funding.expected, 7);
  assert.equal(report.domains.funding.observed, 1);
  assert.equal(report.domains.funding.status, "critical");
  assert.deepEqual(new Set(report.matrix.map((row) => row.dimension)), new Set(["company", "region", "route", "event-type", "source-tier"]));
  const absentRegion = report.matrix.find((row) => row.dimension === "region" && row.key === "北美")!;
  assert.equal(absentRegion.domains.funding?.coverageRate, 0);
  assert.match(absentRegion.total.gaps.join(" "), /缺少 1 个预期观测/);
  const company = report.matrix.find((row) => row.dimension === "company" && row.key === "Alpha Robotics")!;
  assert.equal(company.domains.funding?.coverageRate, 1);
  assert.equal(company.domains.funding?.evidenceReadyRate, 0);
  assert.match(company.total.gaps.join(" "), /第二独立来源/);
});

test("separates LLM, OpenAlex and release degradation from content health", () => {
  const runtimeStatuses: RuntimeStatus[] = [{
    component: "LLM", status: "部分降级", attempted: 3, succeeded: 2, failed: 1, detail: "一个摘要请求超时",
  }, {
    component: "OpenAlex", status: "成功", attempted: 2, succeeded: 2, failed: 0, detail: "成功",
  }];
  const runHistory: RunHistory = { schemaVersion: 1, updatedAt: "2026-08-10T01:00:00Z", runs: [{
    schemaVersion: 1, runId: "run-1", date: "2026-08-10", startedAt: "2026-08-10T00:00:00Z", finishedAt: "2026-08-10T01:00:00Z",
    status: "degraded", quality: { publicIndustryItems: 2, publicResearchItems: 1, candidates: 3, sourceFailures: 1 }, services: runtimeStatuses, outputs: 4,
  }] };
  const report = buildDomainHealth({
    observations: [{ id: "industry", domain: "industry", observed: 1, evidenceReady: 1 }], runtimeStatuses, runHistory,
    expectations: [{ domain: "industry", expected: 1 }, { domain: "llm", expected: 3 }, { domain: "openalex", expected: 2 }, { domain: "release", expected: 1 }],
  }, new Date("2026-08-10T02:00:00Z"));

  assert.equal(report.domains.industry.status, "healthy");
  assert.equal(report.domains.llm.status, "degraded");
  assert.equal(report.domains.openalex.status, "healthy");
  assert.equal(report.domains.release.status, "degraded");
  assert.deepEqual(report.summary.degradedDomains, ["llm", "release"]);
});

test("a failed release degrades safely while empty unconfigured domains remain no-data", () => {
  const report = buildDomainHealth({ observations: [{ id: "release-failed", domain: "release", observed: 0, failures: 1, gaps: ["发布事务失败"] }] });
  assert.equal(report.domains.release.status, "critical");
  assert.equal(report.domains.openalex.status, "no-data");
  assert.match(report.domains.release.gaps.join(" "), /发布事务失败/);
});

test("pipeline adapters roll financing into industry while keeping a single B report unverified", () => {
  const date = new Date("2026-08-09T00:00:00Z");
  const article: Article = {
    id: "alpha-funding", title: "Alpha Robotics raises seed funding", link: "https://media.example/alpha", publishedAt: date, fetchedAt: date,
    source: "Industry Media", sourceWeight: 8, sourceTier: "权威产业媒体", excerpt: "Alpha Robotics funding", kind: "投融资", tags: ["投融资"],
  };
  const company: CompanyProfile = {
    entityId: "alpha", name: "Alpha Robotics", region: "欧洲", routes: ["本体与硬件"], thesis: "机器人本体", officialUrl: "https://alpha.example",
  };
  const report = buildDomainHealth({ articles: [article], companies: [company] });
  assert.equal(report.domains.industry.observed, 1);
  assert.equal(report.domains.funding.observed, 1);
  assert.equal(report.domains.funding.evidenceReady, 0);
  assert.equal(report.domains.funding.status, "degraded");
  assert.equal(report.matrix.find((row) => row.dimension === "company" && row.key === "Alpha Robotics")?.domains.funding?.observed, 1);
});
