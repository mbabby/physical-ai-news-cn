import assert from "node:assert/strict";
import test from "node:test";
import { buildCandidateVerificationArtifact, isCandidateEligibleForPublicLayer, resolveCandidateCompany, verificationIssueSeeds } from "../src/candidate-verification.js";
import type { Article, CompanyProfile } from "../src/types.js";

const profiles: CompanyProfile[] = [{
  entityId: "nova", name: "Nova Robotics", aliases: ["Nova"], region: "北美", stage: "创业公司",
  routes: ["本体与硬件"], thesis: "仓储机器人", officialUrl: "https://nova.example.com",
}];

function candidate(id: string, overrides: Partial<Article> = {}): Article {
  const date = new Date("2026-08-09T00:00:00.000Z");
  return {
    id, title: "Nova Robotics raises $12 million seed funding", titleZh: "Nova Robotics 完成 1200 万美元种子轮融资",
    summaryZh: "Nova Robotics 完成种子轮融资，用于仓储机器人产品研发。", link: `https://media-${id}.example.com/nova`,
    source: "Robotics Industry Media", sourceWeight: 8, sourceTier: "权威产业媒体", excerpt: "robotics funding",
    publishedAt: date, fetchedAt: date, kind: "投融资", tags: ["投融资"], ...overrides,
  };
}

test("one A-grade official item creates only a human-review seed, never a public event", () => {
  const artifact = buildCandidateVerificationArtifact(undefined, [candidate("official", {
    link: "https://nova.example.com/news/seed", source: "Nova Robotics 官网", sourceTier: "官方公司与实验室", sourceWeight: 10,
  })], profiles, new Date("2026-08-09T01:00:00Z"));
  assert.equal(artifact.records[0].status, "可人工审核");
  assert.equal(artifact.records[0].evidence[0].grade, "A");
  assert.equal(artifact.records[0].publicationState, "confirmed");
  assert.equal(artifact.records[0].confidenceScore, 50);
  assert.equal(artifact.records[0].fieldVerification.amount.status, "confirmed");
  assert.equal(artifact.records[0].fieldVerification.eventDate.status, "unknown");
  assert.equal(isCandidateEligibleForPublicLayer(artifact.records[0]), true);
  assert.equal(verificationIssueSeeds(artifact).length, 1);
  assert.equal((artifact as unknown as { events?: unknown }).events, undefined);
});

test("two independent B sources clear the review threshold", () => {
  const artifact = buildCandidateVerificationArtifact(undefined, [candidate("one", { source: "Robot Report" }), candidate("two", {
    source: "Tech Industry News", title: "Nova Robotics secures $12 million seed funding",
    titleZh: "Nova Robotics 获得 1200 万美元种子轮融资",
  })], profiles, new Date("2026-08-09T01:00:00Z"));
  assert.equal(artifact.records.length, 1);
  assert.equal(artifact.records[0].status, "可人工审核");
  assert.deepEqual(artifact.records[0].evidence.map((item) => item.grade), ["B", "B"]);
  assert.equal(artifact.records[0].publicationState, "corroborated");
  assert.equal(artifact.records[0].confidenceScore, 60);
  assert.equal(artifact.records[0].independentEvidenceCount, 2);
  assert.equal(artifact.records[0].fieldVerification.amount.status, "corroborated");
});

test("one authoritative-media report is developing rather than hidden", () => {
  const artifact = buildCandidateVerificationArtifact(undefined, [candidate("one")], profiles, new Date("2026-08-09T01:00:00Z"));
  const record = artifact.records[0];
  assert.equal(record.status, "等待重试");
  assert.equal(record.publicationState, "developing");
  assert.equal(record.confidenceScore, 30);
  assert.equal(record.fieldVerification.amount.status, "single-source");
  assert.equal(isCandidateEligibleForPublicLayer(record), true);
  assert.equal(isCandidateEligibleForPublicLayer(record, { includeDeveloping: false }), false);
});

test("syndicated copies do not count as independent corroboration", () => {
  const artifact = buildCandidateVerificationArtifact(undefined, [candidate("one"), candidate("two")], profiles, new Date("2026-08-09T01:00:00Z"));
  assert.equal(artifact.records[0].independentEvidenceCount, 1);
  assert.equal(artifact.records[0].publicationState, "developing");
  assert.equal(artifact.records[0].status, "等待重试");
});

test("discovery leads never count as corroborating publication evidence", () => {
  const artifact = buildCandidateVerificationArtifact(undefined, [candidate("g1", {
    link: "https://news.google.com/rss/articles/one", source: "Google News · Robotics Capital", sourceTier: "线索发现层",
  }), candidate("g2", {
    link: "https://news.google.com/rss/articles/two", source: "Google News · Robotics Capital", sourceTier: "线索发现层",
  })], profiles, new Date("2026-08-09T01:00:00Z"));
  assert.equal(artifact.records[0].status, "等待重试");
  assert.match(artifact.records[0].failureReasons.join(" "), /全部来自线索发现层/);
  assert.equal(verificationIssueSeeds(artifact).length, 0);
});

test("conflicting amounts block review even when evidence grades are sufficient", () => {
  const artifact = buildCandidateVerificationArtifact(undefined, [candidate("one"), candidate("two", {
    title: "Nova Robotics raises $18 million seed funding", titleZh: "Nova Robotics 完成 1800 万美元种子轮融资",
  })], profiles, new Date("2026-08-09T01:00:00Z"));
  assert.equal(artifact.records[0].status, "证据冲突");
  assert.equal(artifact.records[0].publicationState, "candidate");
  assert.equal(artifact.records[0].fieldVerification.amount.status, "conflicting");
  assert.equal(artifact.records[0].facts.amount, undefined);
  assert.equal(isCandidateEligibleForPublicLayer(artifact.records[0]), false);
  assert.match(artifact.records[0].conflicts.join(" "), /金额不一致/);
  assert.equal(verificationIssueSeeds(artifact).length, 0);
});

test("ambiguous or unnamed company subjects are rejected, not fabricated", () => {
  const ambiguousProfiles: CompanyProfile[] = [...profiles, { ...profiles[0], entityId: "nova-labs", name: "Nova Labs", aliases: ["Nova Robotics"] }];
  const result = resolveCandidateCompany(candidate("ambiguous"), ambiguousProfiles);
  assert.match(result.error ?? "", /多个公司实体/);
  const artifact = buildCandidateVerificationArtifact(undefined, [candidate("unnamed", {
    title: "Robotics funding roundup", titleZh: "机器人投融资盘点", summaryZh: "本周机器人行业融资盘点。",
  })], [], new Date("2026-08-09T01:00:00Z"));
  assert.equal(artifact.records[0].companyName, "待识别公司");
  assert.equal(artifact.records[0].status, "已拒绝");
  assert.equal(artifact.records[0].publicationState, "candidate");
  assert.equal(isCandidateEligibleForPublicLayer(artifact.records[0]), false);
});

test("headline subject wins over companies mentioned only in body copy", () => {
  const toyota: CompanyProfile = {
    entityId: "toyota-research-institute", name: "Toyota Research Institute", aliases: ["TRI"],
    region: "北美", stage: "研究机构", routes: ["数据与训练"], thesis: "机器人研究", officialUrl: "https://www.tri.global/",
  };
  const result = resolveCandidateCompany(candidate("avatar", {
    title: "Avatar Robotics raises $6.5 million seed funding",
    titleZh: "Avatar Robotics 获 650 万美元种子轮融资",
    summaryZh: "Toyota Research Institute 曾参与相关机器人生态建设。",
  }), [toyota]);
  assert.deepEqual(result, { name: "Avatar Robotics" });
});

test("generic humanoid mentions do not replace an explicit acquisition subject", () => {
  const humanoid: CompanyProfile = {
    entityId: "humanoid", name: "Humanoid", aliases: [], region: "欧洲", stage: "创业公司",
    routes: ["本体与硬件"], thesis: "人形机器人", officialUrl: "https://thehumanoid.ai/",
  };
  const result = resolveCandidateCompany(candidate("realbotix", {
    title: "Onconetix signs Realbotix acquisition agreement",
    titleZh: "Onconetix 收购标的 Realbotix 签约，其人形机器人将亮相剧集",
    summaryZh: "该交易涉及 humanoid robotics 产品。",
  }), [humanoid]);
  assert.deepEqual(result, { name: "Onconetix" });
});

test("explicit event dates are verified without inferring them from publication time", () => {
  const unknown = buildCandidateVerificationArtifact(undefined, [candidate("one")], profiles, new Date("2026-08-09T01:00:00Z"));
  assert.equal(unknown.records[0].facts.eventDate, undefined);
  assert.equal(unknown.records[0].fieldVerification.eventDate.status, "unknown");
  const explicit = buildCandidateVerificationArtifact(undefined, [candidate("official", {
    link: "https://nova.example.com/news/seed", source: "Nova 官网", sourceTier: "官方公司与实验室",
    eventDate: new Date("2026-08-07T00:00:00Z"),
  })], profiles, new Date("2026-08-09T01:00:00Z"));
  assert.equal(explicit.records[0].facts.eventDate, "2026-08-07");
  assert.equal(explicit.records[0].fieldVerification.eventDate.status, "confirmed");
});

test("old artifacts missing scoring fields are upgraded on rebuild", () => {
  const current = buildCandidateVerificationArtifact(undefined, [candidate("one")], profiles, new Date("2026-08-09T00:00:00Z"));
  const legacy = structuredClone(current) as unknown as { schemaVersion: 1; generatedAt: string; records: Array<Record<string, unknown>> };
  delete legacy.records[0].publicationState;
  delete legacy.records[0].publicStatus;
  delete legacy.records[0].confidenceScore;
  delete legacy.records[0].independentEvidenceCount;
  delete legacy.records[0].fieldVerification;
  const rebuilt = buildCandidateVerificationArtifact(legacy as never, [candidate("one")], profiles, new Date("2026-08-09T12:00:00Z"));
  assert.equal(rebuilt.records[0].publicationState, "developing");
  assert.equal(rebuilt.records[0].confidenceScore, 30);
  assert.equal(rebuilt.records[0].attempts, 1);
});

test("retry schedule is 1/3/7/30 days, unchanged input is idempotent before due, then stops", () => {
  const lead = candidate("only-b");
  const dates = ["2026-08-09T00:00:00Z", "2026-08-10T00:00:00Z", "2026-08-13T00:00:00Z", "2026-08-20T00:00:00Z", "2026-09-19T00:00:00Z"];
  let artifact = buildCandidateVerificationArtifact(undefined, [lead], profiles, new Date(dates[0]));
  assert.equal(artifact.records[0].attempts, 1);
  assert.equal(artifact.records[0].nextReviewAt?.slice(0, 10), "2026-08-10");
  const unchanged = buildCandidateVerificationArtifact(artifact, [lead], profiles, new Date("2026-08-09T12:00:00Z"));
  assert.equal(unchanged.records[0].attempts, 1);
  for (const date of dates.slice(1)) artifact = buildCandidateVerificationArtifact(artifact, [lead], profiles, new Date(date));
  assert.equal(artifact.records[0].attempts, 5);
  assert.equal(artifact.records[0].status, "停止自动重试");
  assert.equal(artifact.records[0].nextReviewAt, undefined);
});

test("new evidence bypasses the waiting clock and is reassessed immediately", () => {
  const first = buildCandidateVerificationArtifact(undefined, [candidate("one")], profiles, new Date("2026-08-09T00:00:00Z"));
  const enriched = buildCandidateVerificationArtifact(first, [candidate("one"), candidate("official", {
    link: "https://nova.example.com/news/seed", source: "Nova 官网", sourceTier: "官方公司与实验室",
  })], profiles, new Date("2026-08-09T01:00:00Z"));
  assert.equal(enriched.records[0].attempts, 2);
  assert.equal(enriched.records[0].status, "可人工审核");
});
