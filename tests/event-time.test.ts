import assert from "node:assert/strict";
import test from "node:test";
import { eventTimeForArticle, migrateEventTime } from "../src/event-time.js";
import type { Article, EventRecord } from "../src/types.js";
import { projectCoreCoverageEventDates } from "../src/core-coverage/timeline.js";
import { event } from "./core-coverage-fixtures.js";

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

test("stored source calendar days retain precision while genuine ISO clocks remain instants", () => {
  const now = new Date("2026-09-06T17:00:00Z");
  for (const [source, expected] of [["2026-09-07", "2026-09-07"], ["2026-09-06T16:00:00Z", "2026-09-07"], ["2026-09-07T00:00:00Z", "unknown"], ["2026-09-08", "unknown"], ["2026-02-30", "unknown"], ["2026-13-01", "unknown"], ["unknown", "unknown"]]) {
    const record = event("product", { occurredAt: source, eventDate: source.slice(0, 10), dateSource: "explicit", firstSeenAt: now.toISOString(), lastVerifiedAt: now.toISOString(), lastMaterialChangeAt: "unknown", lastEvidenceAt: source, evidence: [{ ...event("product").evidence[0], publishedAt: source }] });
    const migrated = migrateEventTime(record);
    const projected = projectCoreCoverageEventDates(migrated, now);
    assert.equal(projected.occurredOn, expected, source);
    assert.equal(projected.publishedOn, expected, source);
    assert.equal(migrated.occurredAt, source.includes("T") ? new Date(source).toISOString() : source);
    assert.equal(migrated.lastEvidenceAt, source.includes("T") ? new Date(source).toISOString() : source);
    assert.equal(migrated.firstSeenAt, now.toISOString());
    assert.equal(migrated.lastVerifiedAt, now.toISOString());
    assert.equal(migrated.lastMaterialChangeAt, "unknown");
    assert.deepEqual(migrateEventTime(migrated), migrated);
  }
});
