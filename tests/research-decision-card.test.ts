import assert from "node:assert/strict";
import test from "node:test";
import { materializeResearchDecisionCard, rankResearchDecisionCards, selectTopResearchDecisionCards } from "../src/research-decision-card.js";
import type { Article, ResearchRecord } from "../src/types.js";

const checkedAt = "2026-08-09T00:00:00Z";
function article(overrides: Partial<Article> = {}): Article {
  return {
    id: "arxiv:2608.00001", title: "A manipulation benchmark on real robots", titleZh: "面向真实机器人的操作基准",
    summaryZh: "论文提出用于真实机器人的操作基准。它在 LIBERO 上比较基线并公开代码。",
    link: "https://arxiv.org/abs/2608.00001v2", publishedAt: new Date("2026-08-01"), fetchedAt: new Date("2026-08-09"), source: "arXiv · Robotics", sourceWeight: 9,
    excerpt: "We evaluate robot manipulation on 12 real-robot trials and LIBERO, improving success by 12.5% over the baseline. Code: github.com/example/repo. Training uses 50,000 demonstrations. Limitations include only tabletop tasks.",
    tags: ["研究"], authors: ["Alice"], scholar: { provider: "OpenAlex", workId: "W1", citedByCount: 9, isRetracted: false, institutions: ["Example Lab"], authors: [{ name: "Alice", institutions: ["Example Lab"] }], checkedAt },
    ...overrides,
  };
}
function record(overrides: Partial<ResearchRecord> = {}): ResearchRecord {
  const currentArticle = overrides.article ?? article();
  return { id: currentArticle.id, article: currentArticle, firstSeenAt: checkedAt, lastCheckedAt: checkedAt, arxivVersion: 2, factHash: "hash", status: "候选资源", seenDates: ["2026-08-09"], appearances: 1, evidenceTags: ["真实机器人", "基准", "开源"], authorityLabels: ["Example Lab"], notableAuthor: "Alice", changes: [], ...overrides };
}

test("materializes a source-backed Chinese decision card", () => {
  const card = materializeResearchDecisionCard(record(), { now: new Date("2026-08-10") });
  assert.deepEqual(card.factsZh.value, ["论文提出用于真实机器人的操作基准。", "它在 LIBERO 上比较基线并公开代码。"]);
  assert.deepEqual(card.task.value, ["机器人操作"]);
  assert.deepEqual(card.benchmark.value, ["LIBERO"]);
  assert.equal(card.datasetTrainingScale.value, "Training uses 50,000 demonstrations.");
  assert.equal(card.realRobotTrials.value, 12);
  assert.equal(card.artifacts.code.value, "https://github.com/example/repo");
  assert.equal(card.baselineDelta.value, "We evaluate robot manipulation on 12 real-robot trials and LIBERO, improving success by 12.5% over the baseline.");
  assert.equal(card.completeness.completeOrUnknown, true);
  assert.deepEqual(card.gates, []);
  assert.deepEqual(card.fieldEvidence.benchmark, ["https://arxiv.org/abs/2608.00001v2"]);
});

test("uses explicit unknowns instead of inventing missing research details", () => {
  const sparse = record({ article: article({ excerpt: "A robotics paper.", scholar: { ...article().scholar!, checkedAt } }) });
  const card = materializeResearchDecisionCard(sparse, { now: new Date("2026-08-10") });
  assert.equal(card.datasetTrainingScale.value, "unknown");
  assert.equal(card.artifacts.weights.value, "unknown");
  assert.equal(card.reproducibilityCost.value, "unknown");
  assert.equal(card.completeness.completeOrUnknown, true);
});

test("projects only verified evidence into public research fields", () => {
  const card = materializeResearchDecisionCard(record({ article: article({
    id: "claims",
    title: "Simulation-only policy with future artifacts",
    excerpt: "Experiments are only in simulation and no real robot trials are performed. Related work uses LIBERO. Code will be released later.",
    summaryZh: "论文只在仿真中评估策略。作者仅宣布未来会发布代码。",
    link: "https://arxiv.org/abs/2608.00007v1",
    scholar: { ...article().scholar!, workId: "W-claims" },
  }) }), { now: new Date("2026-08-10") });
  assert.equal(card.embodiment.value, "unknown");
  assert.equal(card.benchmark.value, "unknown");
  assert.equal(card.artifacts.code.value, "unknown");
  assert.ok(card.gates.some((gate) => gate.code === "contradicted-claim"));
});

test("LAWM-3D cannot display badges contradicted by its factual Chinese summary", () => {
  const lawm = article({
    id: "arxiv:2608.05706",
    title: "LAWM-3D: Learning 3D-Aware Latent Actions from Human Videos for Generalizable Robot World Models",
    titleZh: "LAWM-3D：从人类视频学习三维感知潜在动作",
    excerpt: "Built on human video pretraining and robot fine-tuning, experiments show improved generation quality and physical consistency.",
    summaryZh: "LAWM-3D 从人类视频学习三维感知潜在动作。摘要未提供真实机器人、具体基准或开源证据。",
    link: "https://arxiv.org/abs/2608.05706v1",
    scholar: { ...article().scholar!, workId: "W-LAWM-3D" },
  });
  const card = materializeResearchDecisionCard(record({ id: lawm.id, article: lawm, evidenceTags: ["真实机器人", "基准", "开源"] }), { now: new Date("2026-08-10") });
  assert.equal(card.embodiment.value, "unknown");
  assert.equal(card.benchmark.value, "unknown");
  assert.equal(card.artifacts.code.value, "unknown");
  assert.ok(!String(card.whyWorthAttention.value).includes("真实机器人"));
  assert.ok(!String(card.whyWorthAttention.value).includes("基准"));
  assert.ok(!String(card.whyWorthAttention.value).includes("开源"));
});

test("blocks retracted, stale, and ambiguous OpenAlex records from Top research", () => {
  const retracted = record({ id: "retracted", article: article({ id: "retracted", scholar: { ...article().scholar!, workId: "W-retracted", isRetracted: true } }) });
  const stale = record({ id: "stale", article: article({ id: "stale", scholar: { ...article().scholar!, workId: "W-stale", checkedAt: "2026-05-01T00:00:00Z" } }) });
  const duplicateA = record({ id: "a", article: article({ id: "a", scholar: { ...article().scholar!, workId: "W-duplicate" } }) });
  const duplicateB = record({ id: "b", article: article({ id: "b", scholar: { ...article().scholar!, workId: "W-duplicate" } }) });
  const ranked = rankResearchDecisionCards([retracted, stale, duplicateA, duplicateB], { now: new Date("2026-08-10") });
  assert.ok(ranked.every((card) => !card.eligibleForTopResearch));
  assert.ok(ranked.find((card) => card.identity.paperId.value === "a")?.gates.some((gate) => gate.code === "openalex-ambiguous"));
  assert.ok(ranked.find((card) => card.identity.paperId.value === "stale")?.gates.some((gate) => gate.code === "openalex-stale"));
  assert.deepEqual(selectTopResearchDecisionCards([retracted, stale, duplicateA, duplicateB], { now: new Date("2026-08-10") }), []);
});

test("selects a deterministic Top 12 and is idempotent", () => {
  const records = Array.from({ length: 14 }, (_, index) => record({
    id: `paper-${String(index).padStart(2, "0")}`,
    article: article({ id: `paper-${String(index).padStart(2, "0")}`, scholar: { ...article().scholar!, workId: `W-${index}` } }),
    evidenceTags: [], authorityLabels: [],
  }));
  const first = selectTopResearchDecisionCards([...records].reverse(), { now: new Date("2026-08-10") }).map((card) => card.identity.paperId.value);
  const second = selectTopResearchDecisionCards(records, { now: new Date("2026-08-10") }).map((card) => card.identity.paperId.value);
  assert.equal(first.length, 12);
  assert.deepEqual(first, second);
  assert.deepEqual(first, ["paper-13", "paper-12", "paper-11", "paper-10", "paper-09", "paper-08", "paper-07", "paper-06", "paper-05", "paper-04", "paper-03", "paper-02"]);
});
