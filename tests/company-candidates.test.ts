import assert from "node:assert/strict";
import test from "node:test";
import { updateCandidateCompanies } from "../src/company-candidates.js";
import type { Article } from "../src/types.js";

function funding(overrides: Partial<Article> = {}): Article {
  const now = new Date("2026-08-05T00:00:00Z");
  return { id: "seed", title: "Nova Robotics raises $12M seed funding", titleZh: "Nova Robotics 完成 1200 万美元种子轮融资", summaryZh: "Nova Robotics 完成种子轮融资，用于开发面向仓储操作的具身机器人。", link: "https://news.example.com/nova", source: "Industry Wire", sourceWeight: 8, excerpt: "Humanoid robotics startup funding and warehouse deployment.", publishedAt: now, fetchedAt: now, kind: "投融资", tags: ["投融资"], ...overrides };
}

test("builds an internal funding dossier without promoting it to a public company", () => {
  const registry = updateCandidateCompanies(undefined, [funding()], new Date("2026-08-05T01:00:00Z"));
  assert.equal(registry.companies.length, 1);
  assert.equal(registry.companies[0].name, "Nova Robotics");
  assert.equal(registry.companies[0].status, "候选");
  assert.match(registry.companies[0].openQuestions[0], /官网/);
});

test("upgrades score only after independent evidence and official-domain evidence", () => {
  const first = updateCandidateCompanies(undefined, [funding()], new Date("2026-08-05T01:00:00Z"));
  const second = updateCandidateCompanies(first, [funding({ id: "official", link: "https://novarobotics.com/news/seed", source: "Nova Robotics", sourceWeight: 10 })], new Date("2026-08-06T01:00:00Z"));
  assert.equal(second.companies[0].status, "已交叉核验");
  assert.ok(second.companies[0].verificationScore >= 70);
  assert.equal(second.companies[0].officialUrl, "https://novarobotics.com");
});

test("does not create a dossier for a generic or non-physical-AI financing headline", () => {
  const registry = updateCandidateCompanies(undefined, [funding({
    title: "行业公司完成 3000 万元融资",
    titleZh: "行业公司完成 3000 万元融资",
    excerpt: "A generic market update without a physical AI subject.",
  })]);
  assert.equal(registry.companies.length, 0);
});
