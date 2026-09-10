import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { FileTransaction } from "../src/runtime/storage.js";
import { stageProgressExplainers, validateProgressExplainersPublication } from "../src/progress-explainers/publication.js";
import { buildProgressExplainers } from "../src/progress-explainers/materialize.js";
import { previousArtifact, source, model } from "./helpers/progress-explainers.js";

const template = "before\n<!-- PROGRESS_EXPLAINERS:START -->\nstale\n<!-- PROGRESS_EXPLAINERS:END -->\nafter";
test("commits explainer JSON and README together, and rejects a different projection", async () => {
  const root = await mkdtemp("/tmp/explainer-publication-");
  const transaction = new FileTransaction();
  const artifact = previousArtifact();
  const readme = stageProgressExplainers({ root, transaction, artifact, readme: template, sources: [source()] });
  assert.equal(transaction.size, 2);
  await assert.rejects(readFile(join(root, "README.md")));
  await transaction.commit();
  assert.equal(await readFile(join(root, "README.md"), "utf8"), readme);
  assert.equal(JSON.parse(await readFile(join(root, "site/data/progress-explainers.json"), "utf8")).cards[0].titleZh, "DexLab 机械手抓取试验");
  assert.throws(() => validateProgressExplainersPublication({ artifact, readme: template, sources: [source()] }), /projection/);
  assert.throws(() => validateProgressExplainersPublication({ artifact, readme, sources: [], expectedGeneratedAt: artifact.generatedAt }), /dependency/);
});

test("refuses invalid old artifacts and incomplete groups without staging anything", () => {
  const transaction = new FileTransaction();
  for (const [artifact, readme] of [[{ ...previousArtifact(), secret: true }, template], [previousArtifact(), "missing markers"]] as const) {
    assert.throws(() => stageProgressExplainers({ root: "/tmp/unused", transaction, artifact: artifact as ReturnType<typeof previousArtifact>, readme, sources: [source()] }));
    assert.equal(transaction.size, 0);
  }
});

test("withdrawal survives provider outage but failed exchange retains the complete old group", async () => {
  const root = await mkdtemp("/tmp/explainer-withdrawal-");
  const first = new FileTransaction();
  const oldReadme = stageProgressExplainers({ root, transaction: first, artifact: previousArtifact(), readme: template, sources: [source()] });
  await first.commit();
  const result = await buildProgressExplainers({ sources: [], previous: previousArtifact(), now: new Date("2026-09-10T00:00:00Z"), model: model([]) });
  const failed = new FileTransaction("failed", { failAfterSwaps: 1 });
  stageProgressExplainers({ root, transaction: failed, artifact: result.artifact, readme: oldReadme, sources: [] });
  await assert.rejects(failed.commit(), /事务/);
  assert.equal(await readFile(join(root, "README.md"), "utf8"), oldReadme);
  assert.equal(JSON.parse(await readFile(join(root, "site/data/progress-explainers.json"), "utf8")).cards.length, 1);
  const retry = new FileTransaction();
  stageProgressExplainers({ root, transaction: retry, artifact: result.artifact, readme: oldReadme, sources: [] });
  await retry.commit();
  assert.equal(JSON.parse(await readFile(join(root, "site/data/progress-explainers.json"), "utf8")).cards.length, 0);
  assert.doesNotMatch(await readFile(join(root, "README.md"), "utf8"), /DexLab/);
});
