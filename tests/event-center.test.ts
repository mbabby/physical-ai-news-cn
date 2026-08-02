import assert from "node:assert/strict";
import test from "node:test";
import { formatIndustryMap, formatRecentEvents, formatResearchUpdates, upsertEvents } from "../src/event-center.js";
import type { Article } from "../src/types.js";

function article(overrides: Partial<Article> = {}): Article {
  const now = new Date("2026-08-01T00:00:00.000Z");
  return { id: "gemini", title: "Google DeepMind announces Gemini Robotics product launch", titleZh: "Google DeepMind 发布 Gemini Robotics", summaryZh: "官方发布新的机器人模型。", link: "https://deepmind.google/gemini-robotics", publishedAt: now, fetchedAt: now, source: "Google DeepMind Blog", sourceWeight: 10, excerpt: "Gemini Robotics vision-language-action robot launch", kind: "产品发布", tags: ["产品"], ...overrides };
}

test("creates an evidence-backed canonical event from a qualified article", () => {
  const store = upsertEvents(undefined, [article()], new Date("2026-08-01T01:00:00.000Z"));
  assert.equal(store.events.length, 1);
  assert.equal(store.events[0].status, "已确证");
  assert.deepEqual(store.events[0].entities, ["Google DeepMind"]);
  assert.match(formatRecentEvents(store.events), /\[Google DeepMind 发布 Gemini Robotics\]/);
  assert.match(formatRecentEvents(store.events), /本期关键进展/);
  assert.match(formatRecentEvents(store.events), /更新至 2026-08-01/);
  assert.doesNotMatch(formatRecentEvents(store.events), /为什么值得看/);
});

test("keeps generic funding labels out of the public industry feed", () => {
  const store = upsertEvents(undefined, [article({ title: "机器人公司完成新一轮融资", titleZh: "机器人公司完成新一轮融资", kind: "投融资" })]);
  assert.doesNotMatch(formatRecentEvents(store.events), /机器人公司完成新一轮融资/);
});

test("keeps the latest successful research cards visible when arXiv is temporarily unavailable", () => {
  const output = formatResearchUpdates([article({ title: "RoboBRIDGE", titleZh: "RoboBRIDGE：面向真实机器人的稳健策略框架" })], "2026-08-01");
  assert.match(output, /arXiv 暂未刷新/);
  assert.match(output, /最近一次成功抓取（2026-08-01）/);
});

test("connects companies, routes and only attributable capital evidence", () => {
  const store = upsertEvents(undefined, [article({
    title: "LeRobot v0.6 release",
    titleZh: "Google DeepMind 完成新一轮融资",
    excerpt: "LeRobot dataset training and VLA policy release",
    kind: "投融资",
    link: "https://example.com/lerobot-v06",
  })]);
  const companies = [{ name: "Google DeepMind", region: "北美", stage: "平台公司" as const, routes: ["VLA 与具身模型" as const], thesis: "VLA 模型", officialUrl: "https://example.com/deepmind" }];
  const map = formatIndustryMap(store.events, companies);
  assert.match(map, /公司 × 技术路线 × 资本图谱/);
  assert.match(map, /路线热度/);
  assert.match(map, /Google DeepMind/);
  assert.match(map, /完成新一轮融资/);
  assert.doesNotMatch(map, /最新可验证信号/);
});

test("keeps a complete Chinese research card readable", () => {
  const output = formatResearchUpdates([article({ title: "RoboBRIDGE: Modular robot agents", titleZh: "RoboBRIDGE：稳健机器人智能体框架", summaryZh: "模块化框架将策略组织为具备故障恢复能力的真实机器人智能体。" })]);
  assert.match(output, /RoboBRIDGE：稳健机器人智能体框架/);
  assert.match(output, /模块化框架/);
  assert.doesNotMatch(output, /物理 AI 研究论文/);
});

test("prioritizes a paper from a recognized physical AI lab when other signals tie", () => {
  const newer = article({ title: "Generic VLA manipulation", titleZh: "通用 VLA 操作策略", summaryZh: "提出机器人操作策略。", publishedAt: new Date("2026-08-02"), authors: ["Unknown Author"] });
  const deepmind = article({ id: "deepmind-paper", title: "Robotics world model", titleZh: "机器人世界模型", summaryZh: "提出面向真实机器人推理的世界模型。", publishedAt: new Date("2026-08-01"), authors: ["Danijar Hafner"] });
  const output = formatResearchUpdates([newer, deepmind]);
  assert.ok(output.indexOf("机器人世界模型") < output.indexOf("通用 VLA 操作策略"));
  assert.match(output, /重点关注：Google DeepMind/);
});

test("does not publish half-translated research cards", () => {
  const output = formatResearchUpdates([article({ titleZh: "Only English", summaryZh: "暂未生成中文摘要，请阅读原文。" })]);
  assert.match(output, /正在完成中文解读/);
  assert.doesNotMatch(output, /Only English/);
});

test("does not assign a company merely mentioned in article body", () => {
  const store = upsertEvents(undefined, [article({
    title: "Agility Robotics expands its deployment",
    titleZh: "Agility Robotics 扩大部署",
    excerpt: "The work takes place near Tesla and is unrelated to Optimus.",
  })]);
  assert.equal(store.events[0].primaryEntity, "Agility Robotics");
  assert.deepEqual(store.events[0].entities, ["Agility Robotics"]);
  assert.ok(store.events[0].mentionedEntities?.includes("Tesla"));
});

test("merges multilingual coverage of the same financing event", () => {
  const now = new Date("2026-08-01T01:00:00.000Z");
  const first = upsertEvents(undefined, [article({ title: "Humanoid Raises $152 Million at $1.35 Billion Valuation", titleZh: undefined, kind: "投融资" })], now);
  const second = upsertEvents(first, [article({ id: "humanoid-zh", title: "Humanoid完成1.52亿美元融资，投后估值13.5亿美元", titleZh: undefined, link: "https://example.com/humanoid-zh", kind: "投融资" })], now);
  assert.equal(second.events.length, 1);
  assert.equal(second.events[0].evidence.length, 2);
});

test("appends new evidence to an existing event instead of duplicating it", () => {
  const first = upsertEvents(undefined, [article()], new Date("2026-08-01T01:00:00.000Z"));
  const second = upsertEvents(first, [article({ id: "coverage", link: "https://spectrum.ieee.org/gemini-robotics", source: "IEEE Spectrum", sourceWeight: 7, title: "Google DeepMind Gemini Robotics product launch" })], new Date("2026-08-02T01:00:00.000Z"));
  assert.equal(second.events.length, 1);
  assert.equal(second.events[0].evidence.length, 2);
  assert.equal(second.events[0].timeline.length, 2);
});
