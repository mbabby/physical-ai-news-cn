import assert from "node:assert/strict";
import test from "node:test";
import { buildProgressExplainers } from "../src/progress-explainers/materialize.js";
import { renderProgressExplainersMarkdown, replaceProgressExplainersReadme } from "../src/progress-explainers/markdown.js";
import { validateProgressExplainersArtifact, validateExplainerDependencies } from "../src/progress-explainers/validate.js";
import { approvedReview, draft, model, previousArtifact, source } from "./helpers/progress-explainers.js";

test("materializes a reviewed grounded card with stable identity", async () => {
  const result = await buildProgressExplainers({ sources: [source()], now: new Date("2026-09-10T00:00:00Z"), model: model([draft(), approvedReview]) });
  assert.equal(result.artifact.status, "updated"); assert.equal(result.artifact.cards.length, 1);
  assert.equal(result.artifact.cards[0]!.id, "explainer-event-gripper-trial");
  assert.deepEqual(result.artifact.cards[0]!.evidence, source().evidence); assert.equal(result.report.requestsSucceeded, 2);
});

test("rejects unsupported language, entities, numbers, generic meaning, and missing field verdicts", async () => {
  const bad = draft({ factsZh: ["DexLab tested 12 objects.", "Acme 完成 99 次试验。"], meaningZh: "这很重要。" });
  const result = await buildProgressExplainers({ sources: [source()], now: new Date("2026-09-10T00:00:00Z"), model: model([bad, approvedReview]) });
  assert.deepEqual(result.artifact.cards, []); assert.equal(result.report.evidenceRejected + result.report.structureRejected + result.report.semanticRejected, 1);
});

test("withdrawal wins over model outage", async () => {
  const result = await buildProgressExplainers({ sources: [], previous: previousArtifact(), now: new Date("2026-09-10T00:00:00Z"), model: model([]) });
  assert.deepEqual(result.artifact.cards, []); assert.equal(result.artifact.status, "unavailable"); assert.equal(result.report.removed, 1);
});

test("unchanged dependencies retain content and timestamps without a model call", async () => {
  const previous = previousArtifact(); const result = await buildProgressExplainers({ sources: [source()], previous, now: new Date("2026-09-10T00:00:00Z"), model: model([]) });
  assert.equal(result.artifact.status, "no-new-content"); assert.equal(result.artifact.lastContentUpdatedAt, previous.lastContentUpdatedAt);
  assert.equal(result.artifact.cards[0]!.revision, previous.cards[0]!.revision); assert.equal(result.report.retained, 1);
});

test("strict validation rejects private fields, malformed URLs, and dependency drift", () => {
  const previous = previousArtifact(); assert.doesNotThrow(() => validateProgressExplainersArtifact(previous));
  assert.throws(() => validateProgressExplainersArtifact({ ...previous, rawModelOutput: "secret" }), /schema/i);
  assert.throws(() => validateProgressExplainersArtifact({ ...previous, cards: [{ ...previous.cards[0], rawModelOutput: "secret" }] }), /schema/i);
  assert.throws(() => validateProgressExplainersArtifact({ ...previous, cards: [{ ...previous.cards[0], evidence: [{ evidenceId: "x", url: "javascript:bad", source: "x" }] }] }), /url/i);
  assert.throws(() => validateExplainerDependencies(previous, [source({ revision: "changed" })]), /dependency/i);
});

test("renders escaped complete markdown and safely replaces one marked block", () => {
  const artifact = previousArtifact(); const markdown = renderProgressExplainersMarkdown({ ...artifact, cards: [{ ...artifact.cards[0]!, titleZh: "<试验>" }] });
  assert.match(markdown, /&lt;试验&gt;/); assert.match(markdown, /证据/); assert.match(markdown, /局限/);
  const readme = "before\n<!-- PROGRESS_EXPLAINERS:START -->\nold\n<!-- PROGRESS_EXPLAINERS:END -->\nafter";
  assert.match(replaceProgressExplainersReadme(readme, artifact), /^before[\s\S]*after$/);
  assert.throws(() => replaceProgressExplainersReadme(`${readme}\n${readme}`, artifact), /marker/i);
});
