import assert from "node:assert/strict";
import test from "node:test";
import { updateCompanyEntityRegistry } from "../src/company-entities.js";
import type { CandidateCompanyRegistry, CompanyProfile } from "../src/types.js";

const galaxea: CompanyProfile = {
  entityId: "company-galaxea", name: "星海图", aliases: ["Galaxea", "Galaxea AI"], region: "中国", stage: "创业公司",
  routes: ["VLA 与具身模型", "本体与硬件"], thesis: "具身智能基础模型与自研机器人。", officialUrl: "https://galaxea-ai.com/cn/about",
  profileEvidence: [{ link: "https://galaxea-ai.com/cn/about", source: "星海图官网", checkedAt: "2026-08-06", supports: "确认公司主体和技术方向。" }],
};

test("keeps a curated company identity public while merging candidate aliases and evidence", () => {
  const candidates: CandidateCompanyRegistry = { updatedAt: "2026-08-06T00:00:00Z", companies: [{
    id: "candidate-galaxea", name: "Galaxea", aliases: ["Galaxea", "星海图"], status: "候选", verificationScore: 40,
    routes: ["数据与训练"], officialUrl: galaxea.officialUrl, firstSeenAt: "2026-08-06T00:00:00Z", lastSeenAt: "2026-08-06T00:00:00Z",
    evidence: [{ link: "https://media.example.com/funding", source: "媒体", sourceWeight: 8, publishedAt: "2026-08-06T00:00:00Z", title: "星海图融资线索" }], openQuestions: ["待核验"],
  }] };
  const registry = updateCompanyEntityRegistry(undefined, [galaxea], candidates, new Date("2026-08-06T01:00:00Z"));
  assert.equal(registry.entities.length, 1);
  assert.equal(registry.entities[0].name, "星海图");
  assert.equal(registry.entities[0].status, "已建档");
  assert.ok(registry.entities[0].aliases.includes("Galaxea"));
  assert.equal(registry.entities[0].promotion.eligibleForReview, false);
});

test("does not automatically promote a cross-verified candidate into a public profile", () => {
  const candidates: CandidateCompanyRegistry = { updatedAt: "2026-08-06T00:00:00Z", companies: [{
    id: "candidate-nova", name: "Nova Robotics", aliases: ["Nova Robotics"], status: "已交叉核验", verificationScore: 90,
    routes: ["VLA 与具身模型"], firstSeenAt: "2026-08-06T00:00:00Z", lastSeenAt: "2026-08-06T00:00:00Z",
    evidence: [{ link: "https://nova.example.com/news", source: "官网", sourceWeight: 10, publishedAt: "2026-08-06T00:00:00Z", title: "融资" }], openQuestions: [],
  }] };
  const registry = updateCompanyEntityRegistry(undefined, [], candidates, new Date("2026-08-06T01:00:00Z"));
  assert.equal(registry.entities[0].status, "已交叉核验");
  assert.equal(registry.entities[0].promotion.eligibleForReview, true);
});

test("rebuild drops stale headline fragments from the historical identity graph", () => {
  const existing = { updatedAt: "2026-08-01T00:00:00Z", entities: [{
    id: "company-noise", entityType: "公司" as const, name: "一家机器人公司完成亿元融资", aliases: ["一家机器人公司完成亿元融资"], officialDomains: [], sourceIds: [], products: [], routes: [], status: "候选" as const,
    firstSeenAt: "2026-08-01T00:00:00Z", lastSeenAt: "2026-08-01T00:00:00Z", evidence: [], promotion: { eligibleForReview: false, reasons: [] },
  }] };
  const registry = updateCompanyEntityRegistry(existing, [galaxea], { updatedAt: "2026-08-08T00:00:00Z", companies: [] }, new Date("2026-08-08T00:00:00Z"));
  assert.deepEqual(registry.entities.map((entity) => entity.name), ["星海图"]);
});

test("candidate headline fragments never become company entities", () => {
  const candidates: CandidateCompanyRegistry = { updatedAt: "2026-08-08T00:00:00Z", companies: [{
    id: "candidate-noise", name: "机器人初创公司完成亿元融资", aliases: [], status: "已交叉核验", verificationScore: 90,
    routes: ["本体与硬件"], firstSeenAt: "2026-08-08T00:00:00Z", lastSeenAt: "2026-08-08T00:00:00Z", evidence: [], openQuestions: [],
  }] };
  const registry = updateCompanyEntityRegistry(undefined, [], candidates, new Date("2026-08-08T00:00:00Z"));
  assert.equal(registry.entities.length, 0);
});
