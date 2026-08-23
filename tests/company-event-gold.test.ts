import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolveArticleEntity } from "../src/entity-resolution.js";
import type { Article, CompanyProfile } from "../src/types.js";

interface Fixture { profiles: Array<{ name: string; aliases: string[] }>; cases: Array<{ id: string; title: string; expected?: string; mentioned?: string[]; disposition: "public" | "review" }> }

test("matches the 20-case company event attribution gold set", async () => {
  const fixture = JSON.parse(await readFile(new URL("./fixtures/company-event-gold-v1.json", import.meta.url), "utf8")) as Fixture;
  const profiles = fixture.profiles.map((item): CompanyProfile => ({ ...item, region: "测试", routes: ["部署与商业化"], thesis: "测试", officialUrl: `https://${item.name.toLowerCase().replace(/[^a-z]+/g, "-")}.example` }));
  assert.equal(fixture.cases.length, 20);
  for (const item of fixture.cases) {
    const article: Article = { id: item.id, title: item.title, link: `https://example.com/${item.id}`, publishedAt: new Date("2026-08-01"), fetchedAt: new Date("2026-08-01"), source: "Test", sourceWeight: 8, excerpt: "", tags: [], kind: "产品发布" };
    const actual = resolveArticleEntity(article, profiles);
    assert.equal(actual.canonicalSubject, item.expected, item.id);
    assert.equal(actual.disposition, item.disposition, item.id);
    if (item.mentioned) assert.deepEqual(actual.mentionedEntities.sort(), item.mentioned.sort(), item.id);
  }
});
