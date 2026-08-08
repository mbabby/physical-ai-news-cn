import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { SOURCES, X_SOURCES } from "../src/config.js";
import { buildEntityCoverage, validateEntitySourceBindings } from "../src/entity-catalog.js";
import type { CompanyProfile } from "../src/types.js";

test("checked-in company catalog is stable, traceable and source-consistent", async () => {
  const companies = JSON.parse(await readFile(new URL("../events/companies.json", import.meta.url), "utf8")) as CompanyProfile[];
  const errors = validateEntitySourceBindings(companies, [...SOURCES, ...X_SOURCES]);
  assert.deepEqual(errors, []);
  assert.ok(companies.length >= 45, `expected at least 45 curated entities, got ${companies.length}`);
  assert.ok(companies.every((company) => company.entityId && company.entityType && company.officialUrl));
  const coverage = buildEntityCoverage(companies, [...SOURCES, ...X_SOURCES]);
  assert.equal(coverage.total, companies.length);
  assert.ok(coverage.labs >= 2);
  assert.ok(coverage.withAutomatedFirstPartySource >= 12);
});

test("catalog validation rejects broken forward and reverse source bindings", () => {
  const company: CompanyProfile = { entityId: "example", entityType: "公司", name: "Example", region: "北美", stage: "创业公司", routes: ["VLA 与具身模型"], thesis: "test", officialUrl: "https://example.com", sourceIds: ["missing"] };
  const errors = validateEntitySourceBindings([company], [{ id: "official-example", entityIds: ["ghost"], type: "rss", name: "Example", url: "https://example.com/feed", weight: 10, keywords: [], tier: "官方公司与实验室", status: "已启用", publicationPolicy: "可作为一手证据" }]);
  assert.ok(errors.some((error) => error.includes("不存在的信源")));
  assert.ok(errors.some((error) => error.includes("不存在的实体")));
});
