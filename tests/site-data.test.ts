import assert from "node:assert/strict";
import test from "node:test";
import { buildDashboard } from "../src/site-data.js";
import type { Article, EventStore } from "../src/types.js";

const article: Article = { id: "paper", title: "Robotics paper", titleZh: "机器人研究论文", link: "https://arxiv.org/abs/test", publishedAt: new Date("2026-08-02"), fetchedAt: new Date(), source: "arXiv · Robotics", sourceWeight: 9, excerpt: "Research abstract", tags: ["VLA"] };
const events: EventStore = { updatedAt: "2026-08-02", events: [{ id: "funding", title: "Example 完成融资", type: "投融资", entities: ["Example"], primaryEntity: "Example", routes: ["部署与商业化"], status: "已确证", firstSeenAt: "2026-08-02", lastUpdatedAt: "2026-08-02", lastVerifiedAt: "2026-08-02", facts: ["完成可核验融资。"], openQuestions: [], evidence: [{ link: "https://example.com", source: "Official", grade: "A", publishedAt: "2026-08-02", supports: "融资" }], timeline: [{ date: "2026-08-02", summary: "完成可核验融资。", evidenceLinks: ["https://example.com"] }] }] };

test("builds compact dashboard data from verified events and research", () => {
  const dashboard = buildDashboard(events, [], [article], new Date("2026-08-02"));
  assert.equal(dashboard.capital[0]?.title, "Example 完成融资");
  assert.equal(dashboard.research[0]?.title, "机器人研究论文");
  assert.equal(dashboard.routes.length, 5);
});
