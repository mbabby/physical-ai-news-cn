import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { researchEvidenceTags } from "../src/research-registry.js";
import type { Article } from "../src/types.js";

interface GoldCase { id: string; title: string; excerpt: string; expectedTags: string[]; }
interface GoldSet { schemaVersion: number; kind: string; cases: GoldCase[]; }

const gold = JSON.parse(readFileSync(new URL("./fixtures/research-gold-v1.json", import.meta.url), "utf8")) as GoldSet;

test("matches the 20-case research evidence gold set with zero trusted-tag false positives", () => {
  assert.equal(gold.schemaVersion, 1);
  assert.equal(gold.kind, "research");
  assert.equal(gold.cases.length, 20);
  assert.equal(new Set(gold.cases.map(({ id }) => id)).size, 20);
  for (const item of gold.cases) {
    const article: Article = {
      id: item.id, title: item.title, excerpt: item.excerpt, link: `https://arxiv.org/abs/${item.id}`,
      publishedAt: new Date("2026-08-01"), fetchedAt: new Date("2026-08-23"), source: "arXiv · Robotics", sourceWeight: 9, tags: ["研究"],
    };
    assert.deepEqual(researchEvidenceTags(article), item.expectedTags, item.id);
  }
});
