import assert from "node:assert/strict";
import test from "node:test";
import { buildEnrichmentTargets, candidateImpactScore, discoveryOrigins, enrichCandidateEvidence } from "../src/candidate-enrichment.js";
import type { Article, CompanyProfile, SourceConfig } from "../src/types.js";

const profile: CompanyProfile = {
  entityId: "nova", name: "Nova Robotics", aliases: ["Nova"], region: "北美", stage: "创业公司",
  routes: ["本体与硬件"], thesis: "仓储机器人", officialUrl: "https://nova.example.com",
};
const sources: SourceConfig[] = [{
  id: "official-nova", entityIds: ["nova"], role: "公司官网", type: "rss", name: "Nova News",
  url: "https://nova.example.com/feed.xml", weight: 10, keywords: ["robot"], tier: "官方公司与实验室",
  status: "已启用", publicationPolicy: "可作为一手证据",
}, {
  id: "media-robot", role: "产业媒体", type: "rss", name: "The Robot Report",
  url: "https://robot.example.com/feed", weight: 8, keywords: ["robot"], tier: "权威产业媒体",
  status: "已启用", publicationPolicy: "可作为独立报道",
}, {
  id: "paused-media", role: "产业媒体", type: "rss", name: "Paused Media",
  url: "https://paused.example.com/feed", weight: 8, keywords: ["robot"], tier: "权威产业媒体",
  status: "已暂停", publicationPolicy: "可作为独立报道",
}];

function article(id: string, overrides: Partial<Article> = {}): Article {
  const date = new Date("2026-08-08T00:00:00Z");
  return {
    id, title: "Nova Robotics raises $80 million Series B - Tech Wire", titleZh: "Nova Robotics 完成 8000 万美元 B 轮融资",
    link: `https://news.google.com/rss/articles/${id}`, publishedAt: date, fetchedAt: date,
    source: "Google News · Robotics Capital", sourceWeight: 6, sourceTier: "线索发现层",
    excerpt: "Nova Robotics funding", kind: "投融资", tags: ["投融资"], ...overrides,
  };
}

test("builds auditable official, media and original-publisher targets while excluding paused sources", () => {
  const lead = article("lead");
  const targets = buildEnrichmentTargets(profile.name, profile.entityId, "投融资", [lead], profile, sources);
  assert.ok(targets.some((target) => target.kind === "公司官网" && target.value === profile.officialUrl));
  assert.ok(targets.some((target) => target.kind === "已启用官方源" && target.label === "Nova News"));
  assert.ok(targets.some((target) => target.kind === "权威产业媒体" && target.label === "The Robot Report"));
  assert.ok(targets.some((target) => target.kind === "原始媒体" && target.label === "Tech Wire"));
  assert.ok(!targets.some((target) => target.label === "Paused Media"));
  assert.ok(targets.every((target) => target.query.includes("Nova Robotics")));
});

test("preserves discovery URL and publisher without pretending a Google News redirect is a landing page", () => {
  const [origin] = discoveryOrigins([article("lead")]);
  assert.equal(origin.discoveryLink, "https://news.google.com/rss/articles/lead");
  assert.equal(origin.publisher, "Tech Wire");
  assert.equal(origin.landingLink, undefined);
});

test("actively merges new same-company same-event evidence from the rolling source corpus", () => {
  const lead = article("lead");
  const official = article("official", {
    title: "Nova Robotics announces Series B financing", titleZh: "Nova Robotics 宣布完成 B 轮融资",
    link: "https://nova.example.com/news/series-b", source: "Nova News", sourceWeight: 10, sourceTier: "官方公司与实验室",
  });
  const independent = article("media", {
    title: "Nova Robotics raises Series B", titleZh: "Nova Robotics 完成 B 轮融资",
    link: "https://robot.example.com/nova-series-b", source: "The Robot Report", sourceWeight: 8, sourceTier: "权威产业媒体",
  });
  const unrelated = article("other", {
    title: "Other Robotics raises funding", titleZh: "Other Robotics 完成融资",
    link: "https://robot.example.com/other", source: "The Robot Report", sourceTier: "权威产业媒体", excerpt: "Other Robotics funding",
  });
  const result = enrichCandidateEvidence({
    companyName: profile.name, entityId: profile.entityId, kind: "投融资", leads: [lead], evidencePool: [lead, official, independent, unrelated],
    profile, sources, previousEvidenceLinks: [], previousAttempts: [], now: new Date("2026-08-09T00:00:00Z"), trigger: "首次补证",
  });
  assert.deepEqual(result.matchedEvidence.map((item) => item.id), ["official", "media"]);
  assert.equal(result.attempt.outcome, "发现新证据");
  assert.deepEqual(result.attempt.newEvidenceLinks, [official.link, independent.link]);
  assert.equal(result.attempt.scannedArticles, 4);
});

test("a retry searches targets but never counts already-known evidence as new", () => {
  const lead = article("lead");
  const official = article("official", {
    title: "Nova Robotics announces Series B financing", link: "https://nova.example.com/news/series-b",
    source: "Nova News", sourceTier: "官方公司与实验室",
  });
  const result = enrichCandidateEvidence({
    companyName: profile.name, entityId: profile.entityId, kind: "投融资", leads: [lead], evidencePool: [lead, official],
    profile, sources, previousEvidenceLinks: [official.link], previousAttempts: [], now: new Date("2026-08-10T00:00:00Z"), trigger: "定时重试",
  });
  assert.equal(result.matchedEvidence.length, 0);
  assert.equal(result.attempt.outcome, "未发现新证据");
  assert.match(result.attempt.failureReasons.join(" "), /已扫描补证目标/);
  assert.ok(result.attempt.targets.length >= 3);
});

test("does not join unrelated research abstracts that merely mention the company", () => {
  const lead = article("lead");
  const unrelatedPaper = article("paper", {
    title: "Evaluating investment logic in language models",
    titleZh: "评估大语言模型的投资逻辑",
    summaryZh: "论文作者感谢 Nova Robotics 提供讨论。",
    excerpt: "Nova Robotics appears only in the abstract",
    link: "https://arxiv.org/abs/2608.00001",
    source: "arXiv · Robotics", sourceWeight: 10, sourceTier: "官方公司与实验室", kind: "投融资",
  });
  const result = enrichCandidateEvidence({
    companyName: profile.name, entityId: profile.entityId, kind: "投融资", leads: [lead], evidencePool: [lead, unrelatedPaper],
    profile, sources, previousEvidenceLinks: [], previousAttempts: [], now: new Date("2026-08-09T00:00:00Z"), trigger: "首次补证",
  });
  assert.deepEqual(result.matchedEvidence, []);
});

test("impact score prioritizes large financing over routine product announcements", () => {
  const financing = candidateImpactScore("投融资", [article("funding", { title: "Nova raises $1 billion Series C" })]);
  const product = candidateImpactScore("产品发布", [article("product", { title: "Nova releases controller", kind: "产品发布" })]);
  assert.ok(financing > product);
});
