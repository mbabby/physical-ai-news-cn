import assert from "node:assert/strict";
import test from "node:test";
import { isIncomingCandidateSubjectAdmissible, updateCandidateCompanies } from "../src/company-candidates.js";
import type { Article, CompanyProfile } from "../src/types.js";

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

test("quarantines incoming roundup subjects without changing historical candidate records", () => {
  const existing = updateCandidateCompanies(undefined, [funding({
    title: "Atlas Robotics raises funding", titleZh: "Atlas Robotics 完成融资",
  })], new Date("2026-08-05T01:00:00Z"));
  const before = structuredClone(existing);

  assert.equal(isIncomingCandidateSubjectAdmissible("2026年8月具身智能赛道融资盘点"), false);
  const next = updateCandidateCompanies(existing, [funding({
    id: "roundup", title: "2026 embodied AI funding roundup", titleZh: "2026年8月具身智能赛道融资盘点",
    link: "https://news.example.com/roundup",
  })], new Date("2026-08-06T01:00:00Z"));

  assert.deepEqual(next.companies, before.companies);
});

test("refreshes a legacy candidate even when its subject now fails incoming admissibility", () => {
  const existing = {
    updatedAt: "2026-08-05T00:00:00.000Z",
    companies: [{
      id: "legacy-roundup", name: "2026年8月具身智能赛道", aliases: ["2026年8月具身智能赛道"], status: "候选" as const,
      verificationScore: 0, routes: [], firstSeenAt: "2026-08-05T00:00:00.000Z", lastSeenAt: "2026-08-05T00:00:00.000Z", evidence: [], openQuestions: [],
    }],
  };
  const next = updateCandidateCompanies(existing, [funding({
    id: "legacy-refresh", title: "2026 embodied AI sector raises funding", titleZh: "2026年8月具身智能赛道完成融资",
    link: "https://news.example.com/legacy-refresh",
  })], new Date("2026-08-06T01:00:00Z"));

  assert.equal(next.companies.length, 1);
  assert.equal(next.companies[0]?.evidence[0]?.link, "https://news.example.com/legacy-refresh");
  assert.equal(next.companies[0]?.lastSeenAt, "2026-08-06T01:00:00.000Z");
});

test("resolves a funding lead to an existing Chinese company profile without treating its profile as financing proof", () => {
  const galaxea: CompanyProfile = {
    entityId: "company-galaxea", name: "星海图", aliases: ["Galaxea", "Galaxea AI"], region: "中国", stage: "创业公司",
    routes: ["VLA 与具身模型", "本体与硬件"], thesis: "具身智能基础模型与自研机器人。", officialUrl: "https://galaxea-ai.com/cn/about",
  };
  const registry = updateCandidateCompanies(undefined, [funding({
    title: "Galaxea raises funding", titleZh: "星海图完成融资", link: "https://media.example.com/galaxea-funding",
  })], new Date("2026-08-06T01:00:00Z"), [galaxea]);
  assert.equal(registry.companies[0].name, "星海图");
  assert.equal(registry.companies[0].officialUrl, galaxea.officialUrl);
  assert.notEqual(registry.companies[0].status, "已交叉核验");
});

test("uses distinct Google News publishers only to raise a lead into observation", () => {
  const first = updateCandidateCompanies(undefined, [funding({
    id: "robot-report", source: "Google News · Robotics Capital", sourceTier: "线索发现层",
    link: "https://news.google.com/rss/articles/one", title: "Avatar Robotics raises $6.5M seed round - The Robot Report",
    titleZh: "Avatar Robotics 完成 650 万美元种子轮融资",
  })], new Date("2026-08-08T01:00:00Z"));
  const second = updateCandidateCompanies(first, [funding({
    id: "tech-eu", source: "Google News · Robotics Capital", sourceTier: "线索发现层",
    link: "https://news.google.com/rss/articles/two", title: "Avatar Robotics raises $6.5M seed round - Tech.eu",
    titleZh: "Avatar Robotics 获 650 万美元种子轮融资",
  })], new Date("2026-08-08T02:00:00Z"));
  assert.equal(second.companies.length, 1);
  assert.equal(second.companies[0].name, "Avatar Robotics");
  assert.equal(second.companies[0].status, "观察中");
  assert.notEqual(second.companies[0].status, "已交叉核验");
  assert.deepEqual(second.companies[0].evidence.map((item) => item.publisher), ["The Robot Report", "Tech.eu"]);
});

test("merges descriptive aliases but rejects an unnamed incubator subject", () => {
  const existing = updateCandidateCompanies(undefined, [funding({
    title: "Avatar Robotics raises seed funding", titleZh: "Avatar Robotics 完成种子轮融资",
  })], new Date("2026-08-07T01:00:00Z"));
  existing.companies.push({ ...existing.companies[0], id: "bad-existing", name: "IIT Madras 孵化初创公司", aliases: ["IIT Madras 孵化初创公司"], evidence: [] });
  existing.companies.push({ ...existing.companies[0], id: "bad-enterprise", name: "IIT Madras孵化初创企业", aliases: ["IIT Madras孵化初创企业"], evidence: [] });
  const next = updateCandidateCompanies(existing, [
    funding({ id: "dirty", title: "Avatar Robotics raises funding", titleZh: "用 VR 头显远程操控仓库机器人，Avatar Robotics 获融资", link: "https://news.example.com/avatar-two" }),
    funding({ id: "unnamed", title: "IIT Madras-incubated startup raises $5.5M", titleZh: "IIT Madras 孵化初创公司获 550 万美元融资", link: "https://news.example.com/unnamed" }),
    funding({ id: "park", title: "Robotics industrial park investment", titleZh: "佛山具身智能视觉感知产业园揭牌，总投资 73 亿元", link: "https://news.example.com/park" }),
  ], new Date("2026-08-08T01:00:00Z"));
  assert.equal(next.companies.length, 1);
  assert.equal(next.companies[0].name, "Avatar Robotics");
  assert.equal(next.companies[0].evidence.length, 2);
});

test("collapses bilingual descriptive prefixes and shared evidence into one company", () => {
  const sharedLink = "https://news.google.com/rss/articles/pokebot?oc=5";
  const existing = {
    updatedAt: "2026-08-05T00:00:00.000Z",
    companies: [
      {
        id: "candidate-cn",
        name: "中国机器人初创公司 PokeBot",
        aliases: ["中国机器人初创公司 PokeBot"],
        status: "候选" as const,
        verificationScore: 22,
        routes: ["部署与商业化" as const],
        firstSeenAt: "2026-08-05T00:00:00.000Z",
        lastSeenAt: "2026-08-05T00:00:00.000Z",
        evidence: [{ link: sharedLink, source: "Google News", sourceWeight: 4, publishedAt: "2026-08-05T00:00:00.000Z", title: "PokeBot 融资" }],
        openQuestions: []
      },
      {
        id: "candidate-en",
        name: "Chinese Robotics Startup PokeBot",
        aliases: ["Chinese Robotics Startup PokeBot"],
        status: "候选" as const,
        verificationScore: 22,
        routes: ["部署与商业化" as const],
        firstSeenAt: "2026-08-05T00:00:00.000Z",
        lastSeenAt: "2026-08-05T00:00:00.000Z",
        evidence: [{ link: sharedLink, source: "Google News", sourceWeight: 4, publishedAt: "2026-08-05T00:00:00.000Z", title: "PokeBot funding" }],
        openQuestions: []
      }
    ]
  };

  const updated = updateCandidateCompanies(existing, [], new Date("2026-08-08T00:00:00.000Z"));
  assert.equal(updated.companies.length, 1);
  assert.equal(updated.companies[0].name, "PokeBot");
  assert.equal(updated.companies[0].evidence.length, 1);
});
