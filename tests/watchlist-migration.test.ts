import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildThesisSeedArtifact, migrateThesisSeeds, validateThesisDraftArtifact } from "../src/watchlist/migration.js";
import { readJsonStrict } from "../src/runtime/storage.js";
import type { ThesisDraftArtifact } from "../src/watchlist/migration.js";
import type { ThesisSeed } from "../src/watchlist/seeds.js";

const FIRST_RUN = { generatedAt: "2026-08-13T01:00:00.000Z", methodologyVersion: "v1" };
const LATER_RUN = { generatedAt: "2026-08-14T01:00:00.000Z", methodologyVersion: "v1" };

const seed: ThesisSeed = {
  companyId: "company-alpha", companyName: "Company Alpha", track: "validated-momentum",
  routes: ["VLA 与具身模型"], factReferenceIds: ["event-a"], evidenceGrade: "A",
  verifiedSensitiveFields: ["amount"], unknownSensitiveFields: ["valuation", "customer", "revenue", "order"],
  evidenceSummary: ["Company Alpha completed a deployment"],
};

test("rerunning identical seeds keeps the complete artifact unchanged", () => {
  const first = migrateThesisSeeds(undefined, [seed], FIRST_RUN);
  const second = migrateThesisSeeds(first, [seed], LATER_RUN);

  assert.deepEqual(second, first);
});

test("material seed changes create the next draft version and retain its creation time", () => {
  const first = migrateThesisSeeds(undefined, [seed], FIRST_RUN);
  const second = migrateThesisSeeds(first, [{ ...seed, factReferenceIds: ["event-a", "event-b"] }], LATER_RUN);

  assert.equal(second.drafts[0]?.draftVersion, 2);
  assert.equal(second.drafts[0]?.createdAt, FIRST_RUN.generatedAt);
  assert.equal(second.drafts[0]?.updatedAt, LATER_RUN.generatedAt);
  assert.equal(second.generatedAt, LATER_RUN.generatedAt);
});

test("uses only canonical seed fields to calculate draft hashes", () => {
  const first = migrateThesisSeeds(undefined, [seed], FIRST_RUN);
  const seedWithMetadata = { ...seed, ignoredMetadata: "not part of the seed contract" };

  const second = migrateThesisSeeds(first, [seedWithMetadata], LATER_RUN);

  assert.deepEqual(second, first);
});

test("sorts drafts stably and removes seeds that are no longer present", () => {
  const beta: ThesisSeed = { ...seed, companyId: "company-beta", companyName: "Company Beta", track: "forward-radar" };
  const first = migrateThesisSeeds(undefined, [seed, beta], FIRST_RUN);
  const second = migrateThesisSeeds(first, [seed], LATER_RUN);

  assert.deepEqual(first.drafts.map((draft) => draft.seed.companyId), ["company-beta", "company-alpha"]);
  assert.deepEqual(second.drafts.map((draft) => draft.seed.companyId), ["company-alpha"]);
  assert.equal(second.drafts[0]?.updatedAt, FIRST_RUN.generatedAt);
});

test("rejects semantically corrupt previous draft artifacts", () => {
  const valid = migrateThesisSeeds(undefined, [seed], FIRST_RUN);
  const corruptions: ThesisDraftArtifact[] = [
    { ...valid, generatedAt: "2026-08-13" },
    { ...valid, drafts: [{ ...valid.drafts[0]!, inputHash: "0".repeat(64) }] },
    { ...valid, drafts: [{ ...valid.drafts[0]!, seed: { ...valid.drafts[0]!.seed, routes: ["not-a-route" as never] } }] },
    { ...valid, drafts: [{ ...valid.drafts[0]!, seed: { ...valid.drafts[0]!.seed, factReferenceIds: ["candidate-verification-123"] } }] },
  ];

  for (const artifact of corruptions) assert.equal(validateThesisDraftArtifact(artifact), false);
});

test("readJsonStrict blocks a draft artifact whose stored hash was tampered with", async () => {
  const directory = await mkdtemp(join(tmpdir(), "watchlist-draft-"));
  const path = join(directory, "drafts.json");
  const valid = migrateThesisSeeds(undefined, [seed], FIRST_RUN);
  await writeFile(path, JSON.stringify({ ...valid, drafts: [{ ...valid.drafts[0]!, inputHash: "0".repeat(64) }] }), "utf8");

  await assert.rejects(
    () => readJsonStrict(path, { optional: true, label: "内部观察名单草稿", validate: validateThesisDraftArtifact }),
    /结构不合法.*保留上一版/,
  );
});

test("same-input seed artifacts remain byte-stable across later runs", () => {
  const firstDrafts = migrateThesisSeeds(undefined, [seed], FIRST_RUN);
  const laterDrafts = migrateThesisSeeds(firstDrafts, [seed], LATER_RUN);
  const first = JSON.stringify(buildThesisSeedArtifact(firstDrafts, [seed]), null, 2) + "\n";
  const second = JSON.stringify(buildThesisSeedArtifact(laterDrafts, [seed]), null, 2) + "\n";

  assert.equal(second, first);
});
