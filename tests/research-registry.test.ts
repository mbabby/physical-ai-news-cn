import assert from "node:assert/strict";
import test from "node:test";
import { rankResearchRecords, researchEvidenceTags, updateResearchRegistry } from "../src/research-registry.js";
import type { Article } from "../src/types.js";

function paper(overrides: Partial<Article> = {}): Article {
  return {
    id: "arxiv:2608.00001", title: "Robots with an open benchmark", titleZh: "面向真实机器人的开源基准", summaryZh: "论文提出用于真实机器人的操作基准。代码与评测协议已公开，摘要提供了可复现实验信息。",
    link: "https://arxiv.org/abs/2608.00001v1", publishedAt: new Date("2026-08-01"), fetchedAt: new Date("2026-08-05"), source: "arXiv · Robotics", sourceWeight: 9, excerpt: "Real robot benchmark with code available at github.com/example/repo.", tags: ["robot"],
    scholar: { provider: "OpenAlex", workId: "W1", citedByCount: 5, isRetracted: false, institutions: ["Stanford University"], authors: [{ name: "Researcher", totalCitations: 3000, institutions: ["Stanford University"] }], checkedAt: "2026-08-05T00:00:00Z" },
    ...overrides,
  };
}

test("uses only source-backed research evidence labels", () => {
  assert.deepEqual(researchEvidenceTags(paper()), ["真实机器人", "基准", "开源"]);
});

test("does not turn negated evidence into trusted research labels", () => {
  const negated = paper({
    title: "A simulation study without released artifacts",
    excerpt: "We do not evaluate on real robots. No benchmark is used and the code is not available.",
    summaryZh: "论文仅报告仿真实验。作者明确说明没有实机、基准或开源代码证据。",
    link: "https://arxiv.org/abs/2608.00002v1",
  });
  assert.deepEqual(researchEvidenceTags(negated), []);
});

test("does not infer real-robot evidence from simulation-only experiments", () => {
  assert.deepEqual(researchEvidenceTags(paper({
    title: "A simulation-only manipulation policy",
    excerpt: "Experiments are conducted only in simulation; no real robot experiments are performed.",
    summaryZh: "论文只在仿真中评估操作策略。摘要明确说明没有真实机器人实验。",
    link: "https://arxiv.org/abs/2608.00003v1",
  })), []);
});

test("does not treat future artifact releases as verified open source", () => {
  assert.deepEqual(researchEvidenceTags(paper({
    title: "A robot policy with planned artifacts",
    excerpt: "The open-source code and model weights will be released after publication.",
    summaryZh: "论文介绍机器人策略。作者仅宣布未来将发布代码和权重。",
    link: "https://arxiv.org/abs/2608.00004v1",
  })), []);
});

test("does not treat related-work benchmark mentions as evaluation evidence", () => {
  assert.deepEqual(researchEvidenceTags(paper({
    title: "A new robot representation",
    excerpt: "Related work evaluates policies on LIBERO and RLBench. Our paper studies representation geometry without benchmark evaluation.",
    summaryZh: "论文研究机器人表征几何。LIBERO 与 RLBench 只出现在相关工作中。",
    link: "https://arxiv.org/abs/2608.00005v1",
  })), []);
});

test("normalizes cached arXiv classification to research", () => {
  const registry = updateResearchRegistry(undefined, [paper({ kind: "产品发布", tags: ["产品", "robot"] })], new Date("2026-08-01"));
  assert.equal(registry.records[0]?.article.kind, "研究与数据");
  assert.deepEqual(registry.records[0]?.article.tags, ["研究", "robot"]);
});

test("promotes recurring complete research but removes a retraction", () => {
  let registry = updateResearchRegistry(undefined, [paper()], new Date("2026-08-01"));
  registry = updateResearchRegistry(registry, [paper()], new Date("2026-08-02"));
  assert.equal(registry.records[0]?.status, "候选资源");
  registry = updateResearchRegistry(registry, [paper({ scholar: { ...paper().scholar!, isRetracted: true } })], new Date("2026-08-03"));
  assert.equal(registry.records[0]?.status, "已撤稿");
  assert.equal(rankResearchRecords(registry.records).length, 0);
});

test("does not promote a paper merely because the same day was rerun", () => {
  let registry = updateResearchRegistry(undefined, [paper()], new Date("2026-08-01T01:00:00Z"));
  registry = updateResearchRegistry(registry, [paper()], new Date("2026-08-01T08:00:00Z"));
  assert.equal(registry.records[0]?.appearances, 2);
  assert.deepEqual(registry.records[0]?.seenDates, ["2026-08-01"]);
  assert.equal(registry.records[0]?.status, "新论文");
});

test("records arXiv version changes for a renewed factual check", () => {
  const first = updateResearchRegistry(undefined, [paper()], new Date("2026-08-01"));
  const next = updateResearchRegistry(first, [paper({ link: "https://arxiv.org/abs/2608.00001v2" })], new Date("2026-08-02"));
  assert.equal(next.records[0]?.arxivVersion, 2);
  assert.equal(next.records[0]?.changes.at(-1)?.kind, "版本更新");
});

test("citations alone cannot promote a paper to milestone status", () => {
  const cited = paper({
    title: "A theoretical robotics perspective",
    excerpt: "We present a theoretical perspective on robot learning.",
    summaryZh: "论文提出机器人学习的理论视角。文章没有报告实机、基准或开源证据。",
    scholar: { ...paper().scholar!, citedByCount: 500 },
    link: "https://arxiv.org/abs/2608.00006v1",
  });
  let registry = updateResearchRegistry(undefined, [cited], new Date("2026-08-01"));
  registry = updateResearchRegistry(registry, [cited], new Date("2026-08-02"));
  registry = updateResearchRegistry(registry, [cited], new Date("2026-08-03"));
  registry = updateResearchRegistry(registry, [cited], new Date("2026-08-04"));
  assert.equal(registry.records[0]?.status, "新论文");
});
