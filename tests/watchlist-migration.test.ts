import assert from "node:assert/strict";
import test from "node:test";
import { migrateThesisSeeds } from "../src/watchlist/migration.js";
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
