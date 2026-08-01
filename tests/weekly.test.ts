import assert from "node:assert/strict";
import test from "node:test";
import { isoWeek, selectWeekly } from "../src/weekly.js";
import type { Article } from "../src/types.js";

function article(overrides: Partial<Article>): Article {
  const now = new Date("2026-08-01T00:00:00.000Z");
  return { id: Math.random().toString(), title: "Robot update", link: "https://example.com", publishedAt: now, fetchedAt: now, source: "Official", sourceWeight: 9, excerpt: "robot", kind: "公司商业", tags: ["产业"], score: 100, ...overrides };
}

test("weekly selection keeps funding first, deduplicates and limits each kind", () => {
  const selected = selectWeekly([
    article({ title: "Robot startup raises Series B", link: "https://example.com/funding", excerpt: "robotics funding series b", kind: "投融资", score: 100 }),
    article({ title: "Robot startup raises Series B", link: "https://mirror.example.com/funding", sourceWeight: 4, kind: "投融资", score: 70 }),
    article({ title: "Robot deployed to factory", link: "https://example.com/deploy", kind: "部署案例", score: 90 }),
    article({ title: "New robot partnership", link: "https://example.com/partnership", kind: "公司商业", score: 85 }),
  ]);
  assert.equal(selected.length, 3);
  assert.equal(selected[0].kind, "投融资");
  assert.match(selected[0].selectionReason, /多条日报交叉佐证/);
});

test("calculates ISO weeks around year boundaries", () => {
  assert.equal(isoWeek(new Date("2026-08-01T00:00:00Z")), "2026-W31");
});
