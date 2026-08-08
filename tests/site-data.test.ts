import assert from "node:assert/strict";
import test from "node:test";
import { buildDashboard } from "../src/site-data.js";
import type { Article, EventStore } from "../src/types.js";

const article: Article = { id: "paper", title: "Robotics paper", titleZh: "机器人研究论文", summaryZh: "论文在真实机器人基准上验证了新的视觉语言动作方法。", link: "https://arxiv.org/abs/test", publishedAt: new Date("2026-08-02"), fetchedAt: new Date(), source: "arXiv · Robotics", sourceWeight: 9, excerpt: "Research abstract", tags: ["VLA"] };
const events: EventStore = { updatedAt: "2026-08-02", events: [{ id: "funding", title: "Example 完成融资", type: "投融资", entities: ["Example"], primaryEntity: "Example", routes: ["部署与商业化"], status: "已确证", firstSeenAt: "2026-08-02", lastUpdatedAt: "2026-08-02", lastVerifiedAt: "2026-08-02", facts: ["完成可核验融资。"], openQuestions: [], evidence: [{ link: "https://example.com", source: "Official", grade: "A", publishedAt: "2026-08-02", supports: "融资" }], timeline: [{ date: "2026-08-02", summary: "完成可核验融资。", evidenceLinks: ["https://example.com"] }], funding: { entityStatus: "已确认", investors: [] } }] };

test("builds compact dashboard data from verified events and research", () => {
  const companies = [{ name: "Example", region: "中国", stage: "创业公司" as const, routes: ["部署与商业化" as const], thesis: "真实场景机器人部署", officialUrl: "https://example.com" }];
  const dashboard = buildDashboard(events, companies, [article], new Date("2026-08-02"));
  assert.equal(dashboard.capital[0]?.title, "Example 完成融资");
  assert.equal(dashboard.research[0]?.title, "机器人研究论文");
  assert.equal(dashboard.routes.length, 5);
  assert.equal(dashboard.companyRadar[0]?.name, "Example");
  assert.equal(dashboard.companyRadar[0]?.capitalStatus, "已证实");
  assert.equal(dashboard.companyRadar[0]?.funding?.title, "Example 完成融资");
  assert.equal(dashboard.companyRadar[0]?.identitySource, "公司官网");
});

test("keeps incomplete research and unowned events out of the public dashboard", () => {
  const incomplete = { ...article, id: "raw", titleZh: undefined, summaryZh: undefined };
  const unowned: EventStore = { updatedAt: events.updatedAt, events: [{ ...events.events[0], id: "unknown", primaryEntity: undefined, entities: [] }] };
  const dashboard = buildDashboard(unowned, [], [incomplete], new Date("2026-08-02"));
  assert.equal(dashboard.stats.events, 0);
  assert.equal(dashboard.stats.research, 0);
  assert.deepEqual(dashboard.research, []);
});

test("does not turn a missing financing record into a negative company claim", () => {
  const company = { name: "NoFundingClaim", region: "北美", stage: "创业公司" as const, routes: ["VLA 与具身模型" as const], thesis: "机器人基础模型", officialUrl: "https://example.com/company" };
  const dashboard = buildDashboard({ updatedAt: "2026-08-02", events: [] }, [company], [], new Date("2026-08-02"));
  assert.equal(dashboard.companyRadar[0]?.capitalStatus, "证据不足");
  assert.equal(dashboard.companyRadar[0]?.funding, undefined);
});
