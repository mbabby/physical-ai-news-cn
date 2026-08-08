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
