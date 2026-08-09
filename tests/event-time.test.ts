import assert from "node:assert/strict";
import test from "node:test";
import { eventTimeForArticle, migrateEventTime } from "../src/event-time.js";
import type { Article, EventRecord } from "../src/types.js";

function article(overrides: Partial<Article> = {}): Article {
  return {
    id: "item", title: "Robot launch", link: "https://company.example/news", publishedAt: new Date("2026-07-16T08:00:00Z"), fetchedAt: new Date("2026-08-01T00:00:00Z"), source: "Company newsroom", sourceWeight: 10, sourceTier: "官方公司与实验室", excerpt: "launch", tags: [], ...overrides,
  };
}

test("official publication time becomes the event date instead of ingestion time", () => {
  const fields = eventTimeForArticle(article(), new Date("2026-08-01T00:00:00Z"));
  assert.equal(fields.occurredAt, "2026-07-16T08:00:00.000Z");
  assert.equal(fields.eventDate, "2026-07-16");
  assert.equal(fields.dateSource, "official-published");
  assert.equal(fields.dateConfidence, "high");
  assert.equal(fields.firstSeenAt, "2026-08-01T00:00:00.000Z");
});

test("an explicit occurrence date takes priority over page publication time", () => {
  const fields = eventTimeForArticle(article({ eventDate: new Date("2026-07-14T00:00:00Z") }), new Date("2026-08-01T00:00:00Z"));
  assert.equal(fields.occurredAt, "2026-07-14T00:00:00.000Z");
  assert.equal(fields.dateSource, "explicit");
});

test("legacy migration prefers A-grade evidence and remains idempotent", () => {
  const legacy = {
    id: "evt", title: "公司发布机器人", type: "产品发布", entities: ["Example"], routes: ["本体与硬件"], status: "已确证", firstSeenAt: "2026-08-01T00:00:00Z", lastUpdatedAt: "2026-08-01T00:00:00Z", lastVerifiedAt: "2026-08-01T00:00:00Z", facts: ["公司发布机器人。"], openQuestions: [], timeline: [], evidence: [
      { link: "https://media.example/story", source: "Media", grade: "B", publishedAt: "2026-07-10T00:00:00Z", supports: "报道" },
      { link: "https://company.example/news", source: "Company", grade: "A", publishedAt: "2026-07-12T00:00:00Z", supports: "公告" },
    ],
  } as EventRecord;
  const once = migrateEventTime(legacy);
  const twice = migrateEventTime(once);
  assert.equal(once.occurredAt, "2026-07-12T00:00:00.000Z");
  assert.equal(once.lastEvidenceAt, "2026-07-12T00:00:00.000Z");
  assert.deepEqual(twice, once);
});
