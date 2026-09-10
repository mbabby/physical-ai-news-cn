import assert from "node:assert/strict";
import test from "node:test";
import { buildProgressExplainers } from "../src/progress-explainers/materialize.js";
import { renderProgressExplainersMarkdown, replaceProgressExplainersReadme } from "../src/progress-explainers/markdown.js";
import { validateProgressExplainersArtifact, validateExplainerDependencies } from "../src/progress-explainers/validate.js";
import { approvedReview, draft, model, previousArtifact, source } from "./helpers/progress-explainers.js";

test("materializes a reviewed grounded card with stable identity", async () => {
  const result = await buildProgressExplainers({ sources: [source()], now: new Date("2026-09-10T00:00:00Z"), model: model([draft(), approvedReview]) });
  assert.equal(result.artifact.status, "updated"); assert.equal(result.artifact.cards.length, 1);
  assert.equal(result.artifact.cards[0]!.id, "explainer-event-gripper-trial-506abe96");
  assert.deepEqual(result.artifact.cards[0]!.evidence, source().evidence); assert.equal(result.report.requestsSucceeded, 2);
});

test("rejects unsupported language, entities, numbers, generic meaning, and missing field verdicts", async () => {
  const bad = draft({ factsZh: ["DexLab tested 12 objects.", "Acme 完成 99 次试验。"], meaningZh: "这很重要。" });
  const result = await buildProgressExplainers({ sources: [source()], now: new Date("2026-09-10T00:00:00Z"), model: model([bad, approvedReview]) });
  assert.deepEqual(result.artifact.cards, []); assert.equal(result.report.evidenceRejected + result.report.structureRejected + result.report.semanticRejected, 1);
});

for (const [name, invalid] of [
  ["English factual copy", draft({ factsZh: ["DexLab tested 12 objects.", draft().factsZh[1]] })],
  ["unsupported entity", draft({ factsZh: ["Acme 报告了覆盖 12 个物体的试验。", draft().factsZh[1]] })],
  ["unsupported number", draft({ factsZh: ["DexLab 报告了覆盖 99 个物体的试验。", draft().factsZh[1]] })],
  ["generic meaning", draft({ meaningZh: "这很重要。" })],
] as const) test(`rejects ${name}`, async () => {
  const result = await buildProgressExplainers({ sources: [source()], now: new Date("2026-09-10T00:00:00Z"), model: model([invalid, approvedReview]) });
  assert.equal(result.artifact.cards.length, 0);
});

test("rejects a missing independent review verdict", async () => {
  const fields = { ...approvedReview.fields }; delete (fields as Partial<typeof fields>)["meaningZh"];
  const result = await buildProgressExplainers({ sources: [source()], now: new Date("2026-09-10T00:00:00Z"), model: model([draft(), { approved: true, fields }]) });
  assert.equal(result.report.semanticRejected, 1);
});

test("rejects context escalation beyond the canonical evidence situation", async () => {
  const escalated = draft({ contexts: ["规模部署"], fieldRefs: { ...draft().fieldRefs, "contexts.0": ["fact:trial"] } });
  const result = await buildProgressExplainers({ sources: [source()], now: new Date("2026-09-10T00:00:00Z"), model: model([escalated, approvedReview]) });
  assert.equal(result.report.evidenceRejected, 1);
});

test("caps retained and new cards together at three and uses collision-resistant IDs", async () => {
  const previous = previousArtifact();
  previous.cards.push(...["old-2", "old-3"].map((id, index) => ({ ...previous.cards[0]!, id: `explainer-${id}`, canonicalId: `event:${id}`, sourceRevision: `r${index + 2}`, materiallyChangedAt: `2026-09-0${index + 6}T00:00:00Z` })));
  const sources = [source(), source({ canonicalId: "event:old-2", revision: "r2", materiallyChangedAt: "2026-09-06T00:00:00Z" }), source({ canonicalId: "event:old-3", revision: "r3", materiallyChangedAt: "2026-09-07T00:00:00Z" }), source({ canonicalId: "event:a/b", revision: "slash", materiallyChangedAt: "2026-09-09T00:00:00Z" })];
  const result = await buildProgressExplainers({ sources, previous, now: new Date("2026-09-10T00:00:00Z"), model: model([draft(), approvedReview]) });
  assert.equal(result.artifact.cards.length, 3); assert.equal(new Set(result.artifact.cards.map(card => card.id)).size, 3);
});

test("out-of-window changed sources cannot suppress recent candidates", async () => {
  const stale = [1, 2, 3].map(index => source({ canonicalId: `event:stale-${index}`, revision: `stale-${index}`, eventDate: "2026-01-01", materiallyChangedAt: `2026-09-0${index}T00:00:00Z` }));
  const result = await buildProgressExplainers({ sources: [...stale, source()], now: new Date("2026-09-10T00:00:00Z"), model: model([draft(), approvedReview]) });
  assert.deepEqual(result.artifact.cards.map(card => card.canonicalId), ["event:gripper-trial"]);
});

test("rejects malformed previous cards before retention", async () => {
  const previous = previousArtifact(); (previous.cards[0] as unknown as Record<string, unknown>).meaningZh = 42;
  await assert.rejects(() => buildProgressExplainers({ sources: [source()], previous, now: new Date("2026-09-10T00:00:00Z"), model: model([]) }), /schema/i);
});

test("rejects an empty generated fieldRefs array", async () => {
  const invalid = draft({ fieldRefs: { ...draft().fieldRefs, meaningZh: [] } });
  const result = await buildProgressExplainers({ sources: [source()], now: new Date("2026-09-10T00:00:00Z"), model: model([invalid, approvedReview]) });
  assert.equal(result.report.structureRejected, 1); assert.equal(result.artifact.cards.length, 0);
});

test("rejects generated comparison fields without Chinese explanations", async () => {
  const comparison = { beforeZh: "40%", afterZh: "60%", task: "grasp", conditions: "same setup" };
  const invalid = draft({ comparison, fieldRefs: { ...draft().fieldRefs, "comparison.beforeZh": ["fact:trial"], "comparison.afterZh": ["fact:result"], "comparison.task": ["fact:trial"], "comparison.conditions": ["fact:trial"] } });
  const review = { approved: true, fields: { ...approvedReview.fields, "comparison.beforeZh": true, "comparison.afterZh": true, "comparison.task": true, "comparison.conditions": true } };
  const result = await buildProgressExplainers({ sources: [source({ comparable: { before: "40%", after: "60%", task: "grasp", conditions: "same setup", evidenceIds: ["ev:paper"] } })], now: new Date("2026-09-10T00:00:00Z"), model: model([invalid, review]) });
  assert.equal(result.report.structureRejected, 1); assert.equal(result.artifact.cards.length, 0);
});

test("persisted cards reject empty refs and non-Chinese comparison explanations", () => {
  const emptyRefs = previousArtifact(); emptyRefs.cards[0]!.fieldRefs.meaningZh = [];
  assert.throws(() => validateProgressExplainersArtifact(emptyRefs), /schema/i);
  const comparison = previousArtifact(); comparison.cards[0]!.comparison = { beforeZh: "40%", afterZh: "60%", task: "grasp", conditions: "same setup" };
  Object.assign(comparison.cards[0]!.fieldRefs, { "comparison.beforeZh": ["fact:trial"], "comparison.afterZh": ["fact:result"], "comparison.task": ["fact:trial"], "comparison.conditions": ["fact:trial"] });
  assert.throws(() => validateProgressExplainersArtifact(comparison), /schema/i);
});

test("withdrawal wins over model outage", async () => {
  const result = await buildProgressExplainers({ sources: [], previous: previousArtifact(), now: new Date("2026-09-10T00:00:00Z"), model: model([]) });
  assert.deepEqual(result.artifact.cards, []); assert.equal(result.artifact.status, "unavailable"); assert.equal(result.report.removed, 1);
});

for (const failure of ["provider", "semantic"] as const) test(`newer ${failure} failures do not displace valid retained cards`, async () => {
  const previous = previousArtifact();
  const newer = [1, 2, 3].map((index) => source({ canonicalId: `event:newer-${index}`, revision: `newer-${index}`, materiallyChangedAt: `2026-09-09T0${index}:00:00Z` }));
  const rejected = Array.from({ length: 3 }, () => [draft(), { ...approvedReview, approved: false }]).flat();
  const result = await buildProgressExplainers({ sources: [source(), ...newer], previous, now: new Date("2026-09-10T00:00:00Z"), model: model(failure === "provider" ? [] : rejected) });
  assert.deepEqual(result.artifact.cards.map((card) => card.canonicalId), ["event:gripper-trial"]);
  assert.equal(result.artifact.cards[0]!.revision, previous.cards[0]!.revision);
  assert.equal(result.artifact.lastContentUpdatedAt, previous.lastContentUpdatedAt);
  assert.equal(result.report.retained, 1);
  assert.equal(result.report.removed, 0);
  assert.equal(result.report.failed, failure === "provider" ? 1 : 0);
  assert.equal(result.report.semanticRejected, failure === "semantic" ? 3 : 0);
});

test("only reviewed successful new cards can displace retained cards, with final publication counts", async () => {
  const previous = previousArtifact();
  const newer = [1, 2, 3, 4].map((index) => source({ canonicalId: `event:newer-${index}`, revision: `newer-${index}`, materiallyChangedAt: `2026-09-09T0${index}:00:00Z` }));
  const result = await buildProgressExplainers({ sources: [source(), ...newer], previous, now: new Date("2026-09-10T00:00:00Z"), model: model(Array.from({ length: 3 }, () => [draft(), approvedReview]).flat()) });
  assert.deepEqual(result.artifact.cards.map((card) => card.canonicalId), ["event:newer-4", "event:newer-3", "event:newer-2"]);
  assert.equal(result.report.retained, 0);
  assert.equal(result.report.removed, 1);
  assert.equal(result.report.requestsSucceeded, 6);
});

test("partial new success fills remaining places from valid retained cards", async () => {
  const previous = previousArtifact();
  const newer = [1, 2, 3].map((index) => source({ canonicalId: `event:newer-${index}`, revision: `newer-${index}`, materiallyChangedAt: `2026-09-09T0${index}:00:00Z` }));
  const result = await buildProgressExplainers({ sources: [source(), ...newer], previous, now: new Date("2026-09-10T00:00:00Z"), model: model([draft(), approvedReview]) });
  assert.deepEqual(result.artifact.cards.map((card) => card.canonicalId), ["event:newer-3", "event:gripper-trial"]);
  assert.equal(result.report.retained, 1);
  assert.equal(result.report.removed, 0);
  assert.equal(result.report.failed, 1);
});

test("withdrawn sources stay removed when every newer candidate fails", async () => {
  const newer = [1, 2, 3].map((index) => source({ canonicalId: `event:newer-${index}`, revision: `newer-${index}` }));
  const result = await buildProgressExplainers({ sources: newer, previous: previousArtifact(), now: new Date("2026-09-10T00:00:00Z"), model: model([]) });
  assert.deepEqual(result.artifact.cards, []);
  assert.equal(result.report.retained, 0);
  assert.equal(result.report.removed, 1);
  assert.equal(result.report.failed, 1);
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

test("Markdown reading block distinguishes states, dates and interpretation from facts", () => {
  for (const [status, label] of [["updated", "有新解读"], ["no-new-content", "本轮无新内容"], ["constrained", "本轮受限"], ["unavailable", "暂不可用"]] as const) {
    const text = renderProgressExplainersMarkdown({ ...previousArtifact(), status });
    assert.match(text, new RegExp(label));
    assert.match(text, /内容更新/);
    assert.match(text, /\*\*解读：\*\*/);
    assert.match(text, /\*\*事实：\*\*/);
  }
  const empty = renderProgressExplainersMarkdown({ ...previousArtifact(), status: "unavailable", cards: [], lastContentUpdatedAt: null });
  assert.match(empty, /尚未生成/);
  assert.match(empty, /不代表.*没有进展/);
});
