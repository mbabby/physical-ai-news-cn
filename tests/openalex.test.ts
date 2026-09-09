import assert from "node:assert/strict";
import test from "node:test";
import { enrichResearchWithOpenAlex } from "../src/openalex.js";
import type { Article } from "../src/types.js";

const RUN_AT = new Date("2026-08-08T08:00:00.000Z");

function paper(): Article {
  return {
    id: "arxiv:2608.00001", title: "An open benchmark for robot learning",
    link: "https://arxiv.org/abs/2608.00001", publishedAt: new Date("2026-08-01"), fetchedAt: new Date("2026-08-05"),
    source: "arXiv · Robotics", sourceWeight: 9, excerpt: "A benchmark for real robot learning.", tags: ["robot"],
    scholar: { provider: "OpenAlex", workId: "W1", citedByCount: 5, isRetracted: false, institutions: [], authors: [], checkedAt: "2026-08-05T00:00:00.000Z" },
  };
}

function matchingResponse(): Response {
  return Response.json({ results: [{ id: "https://openalex.org/W1", display_name: paper().title, publication_date: "2026-08-01", cited_by_count: 20, is_retracted: false, authorships: [] }] });
}

test("successful delayed enrichment uses the supplied run observation clock", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: RUN_AT });
  t.mock.method(globalThis, "fetch", async () => {
    t.mock.timers.tick(60_000);
    return matchingResponse();
  });
  const result = await enrichResearchWithOpenAlex([paper()], "test-key", RUN_AT);
  assert.ok(Date.now() > RUN_AT.getTime());
  assert.equal(result.articles[0]!.scholar!.checkedAt, "2026-08-08T08:00:00.000Z");
  assert.equal(result.articles[0]!.scholar!.citedByCount, 20);
  assert.equal(result.status.succeeded, 1);
});

test("enrichment without a run clock keeps the actual successful match time", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: RUN_AT });
  t.mock.method(globalThis, "fetch", async () => {
    t.mock.timers.tick(60_000);
    return matchingResponse();
  });
  const result = await enrichResearchWithOpenAlex([paper()], "test-key");
  assert.equal(result.articles[0]!.scholar!.checkedAt, "2026-08-08T08:01:00.000Z");
});

test("an unconfigured enrichment does not refresh cached scholarly evidence", async () => {
  const original = paper();
  const result = await enrichResearchWithOpenAlex([original], undefined, RUN_AT);
  assert.strictEqual(result.articles[0], original);
  assert.equal(result.articles[0]!.scholar!.checkedAt, "2026-08-05T00:00:00.000Z");
  assert.equal(result.status.attempted, 0);
});

test("failed enrichment does not refresh cached scholarly evidence", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("Unauthorized", { status: 401 }));
  t.mock.method(console, "warn", () => {});
  const original = paper();
  const result = await enrichResearchWithOpenAlex([original], "test-key", RUN_AT);
  assert.strictEqual(result.articles[0], original);
  assert.equal(result.articles[0]!.scholar!.checkedAt, "2026-08-05T00:00:00.000Z");
  assert.equal(result.status.failed, 1);
});

test("a search miss does not refresh cached scholarly evidence", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ results: [] }));
  const original = paper();
  const result = await enrichResearchWithOpenAlex([original], "test-key", RUN_AT);
  assert.strictEqual(result.articles[0], original);
  assert.equal(result.articles[0]!.scholar!.checkedAt, "2026-08-05T00:00:00.000Z");
});
