import assert from "node:assert/strict";
import test from "node:test";
import { buildBenchmarkResultLedger, validateBenchmarkResultLedger } from "../src/benchmark-result-ledger.js";
import { materializeResearchDecisionCard } from "../src/research-decision-card.js";
import type { BenchmarkResultLedger } from "../src/benchmark-result-ledger.js";
import type { Article, ResearchRecord } from "../src/types.js";

const NOW = new Date("2026-08-10T00:00:00.000Z");
const SOURCE_URL = "https://arxiv.org/abs/2608.00001v2";

function article(overrides: Partial<Article> = {}): Article {
  return {
    id: "arxiv:2608.00001",
    title: "LIBERO evaluation on real robots",
    titleZh: "真实机器人上的 LIBERO 评测",
    summaryZh: "论文在 LIBERO 上评测机器人策略。结果与基线均由原文给出。",
    link: SOURCE_URL,
    publishedAt: new Date("2026-08-01T00:00:00.000Z"),
    fetchedAt: new Date("2026-08-09T00:00:00.000Z"),
    source: "arXiv · Robotics",
    sourceWeight: 9,
    excerpt: "We evaluate success rate on LIBERO in 120 real-robot trials, from 56.7% to 74.7%. Code is available at github.com/example/libero-policy.",
    tags: ["研究"],
    scholar: {
      provider: "OpenAlex",
      workId: "W260800001",
      citedByCount: 12,
      isRetracted: false,
      institutions: ["Example Lab"],
      authors: [{ name: "Alice", institutions: ["Example Lab"] }],
      checkedAt: "2026-08-09T00:00:00.000Z",
    },
    ...overrides,
  };
}

function record(overrides: Partial<ResearchRecord> = {}): ResearchRecord {
  const currentArticle = overrides.article ?? article();
  return {
    id: currentArticle.id,
    article: currentArticle,
    firstSeenAt: "2026-08-09T00:00:00.000Z",
    lastCheckedAt: "2026-08-09T00:00:00.000Z",
    arxivVersion: 2,
    factHash: "fact-v2",
    status: "候选资源",
    seenDates: ["2026-08-09"],
    appearances: 1,
    evidenceTags: ["真实机器人", "基准", "开源"],
    authorityLabels: ["Example Lab"],
    changes: [],
    ...overrides,
  };
}

function build(records: ResearchRecord[], previous?: BenchmarkResultLedger) {
  const cards = records.map((item) => materializeResearchDecisionCard(item, { now: NOW }));
  return buildBenchmarkResultLedger(records, cards, { now: NOW, previous });
}

function buildAt(records: ResearchRecord[], now: Date, previous?: BenchmarkResultLedger) {
  const cards = records.map((item) => materializeResearchDecisionCard(item, { now }));
  return buildBenchmarkResultLedger(records, cards, { now, previous });
}

test("materializes an exact, evidence-bound LIBERO comparison and explicit unknown assets", () => {
  const ledger = build([record()]);
  assert.equal(ledger.generatedAt, NOW.toISOString());
  assert.equal(ledger.entries.length, 1);

  const entry = ledger.entries[0]!;
  assert.match(entry.entryId, /^benchmark-result-/);
  assert.equal(entry.paperId, "arxiv:2608.00001");
  assert.deepEqual(entry.gateCodes, []);
  assert.deepEqual(entry.fields.benchmark, {
    value: "LIBERO", status: "verified", evidenceIds: ["arxiv:2608.00001:benchmark"],
    evidenceUrls: [SOURCE_URL], observedAt: NOW.toISOString(), verifiedAt: NOW.toISOString(),
  });
  assert.equal(entry.fields.metric.value, "success rate");
  assert.equal(entry.fields.result.value, "74.7%");
  assert.equal(entry.fields.baseline.value, "56.7%");
  assert.equal(entry.fields.delta.value, "+18 percentage points");
  assert.equal(entry.fields.evaluationSetting.value, "real-robot");
  assert.equal(entry.fields.realRobotTrials.value, 120);
  assert.equal(entry.fields.code.value, "https://github.com/example/libero-policy");
  assert.equal(entry.fields.data.status, "unknown");
  assert.equal(entry.fields.data.value, "unknown");
  assert.deepEqual(entry.fields.data.evidenceIds, []);
  assert.equal(entry.fields.weights.status, "unknown");
  assert.deepEqual(entry.corrections, []);
});

test("keeps contextual, negated, and simulation-only benchmark results unknown", () => {
  const cases: Array<[string, string, string]> = [
    ["related", "Related work evaluates LIBERO from 56.7% to 74.7%.", "benchmark-not-verified"],
    ["negated", "We do not evaluate on LIBERO from 56.7% to 74.7%.", "benchmark-not-verified"],
    ["simulation", "We evaluate success rate on LIBERO only in simulation, from 56.7% to 74.7%.", "simulation-only"],
  ];
  for (const [id, excerpt, gate] of cases) {
    const item = record({
      id,
      article: article({ id, link: `https://arxiv.org/abs/${id}v1`, excerpt, scholar: { ...article().scholar!, workId: `W-${id}` } }),
      arxivVersion: 1,
      evidenceTags: ["基准"],
    });
    const entry = build([item]).entries[0]!;
    assert.ok(entry, `${id} should leave an internal review entry`);
    assert.ok(entry.gateCodes.includes(gate));
    assert.equal(entry.fields.benchmark.status, "unknown");
    assert.equal(entry.fields.result.status, "unknown");
    assert.equal(entry.fields.baseline.status, "unknown");
    assert.equal(entry.fields.delta.status, "unknown");
  }
});

test("blocks simulation-only evidence even when it follows a neutral benchmark sentence", () => {
  const item = record({
    article: article({ excerpt: "We evaluate LIBERO. On LIBERO, success rate is 74.7% vs 56.7%, only in simulation." }),
    evidenceTags: ["基准"],
  });
  const entry = build([item]).entries[0]!;
  assert.ok(entry.gateCodes.includes("simulation-only"));
  assert.equal(entry.fields.result.status, "unknown");
});

test("does not verify code that is only promised for a future release", () => {
  const future = record({
    evidenceTags: ["基准"],
    article: article({
      excerpt: "We evaluate success rate on LIBERO in 120 real-robot trials, 74.7% vs 56.7%. Code will be released later at github.com/example/future. Weights will be released later at huggingface.co/example/future-weights.",
    }),
  });
  const entry = build([future]).entries[0]!;
  assert.equal(entry.fields.result.value, "74.7%");
  assert.equal(entry.fields.code.status, "unknown");
  assert.equal(entry.fields.code.value, "unknown");
  assert.equal(entry.fields.weights.status, "unknown");
});

test("selects the exact comparison sentence when an earlier benchmark sentence has no numbers", () => {
  const item = record({
    article: article({
      excerpt: "We evaluate success rate on LIBERO. On LIBERO, success rate is 74.7% vs 56.7%.",
    }),
    evidenceTags: ["基准"],
  });
  const entry = build([item]).entries[0]!;
  assert.deepEqual(entry.gateCodes, []);
  assert.equal(entry.fields.result.value, "74.7%");
  assert.equal(entry.fields.baseline.value, "56.7%");
  assert.equal(entry.fields.delta.value, "+18 percentage points");
});

test("blocks retracted and OpenAlex-ambiguous papers from verified result fields", () => {
  const retracted = record({
    id: "retracted",
    status: "已撤稿",
    article: article({ id: "retracted", link: "https://arxiv.org/abs/retractedv1", scholar: { ...article().scholar!, workId: "W-retracted", isRetracted: true } }),
  });
  const duplicateA = record({ id: "duplicate-a", article: article({ id: "duplicate-a", link: "https://arxiv.org/abs/duplicate-av1", scholar: { ...article().scholar!, workId: "W-duplicate" } }) });
  const duplicateB = record({ id: "duplicate-b", article: article({ id: "duplicate-b", link: "https://arxiv.org/abs/duplicate-bv1", scholar: { ...article().scholar!, workId: "W-duplicate" } }) });
  const ambiguousIds = new Set(["W-duplicate"]);
  const cards = [retracted, duplicateA, duplicateB].map((item) => materializeResearchDecisionCard(item, { now: NOW, ambiguousWorkIds: ambiguousIds }));
  const ledger = buildBenchmarkResultLedger([retracted, duplicateA, duplicateB], cards, { now: NOW });

  for (const entry of ledger.entries) {
    assert.equal(entry.fields.result.status, "unknown");
    assert.ok(entry.gateCodes.includes(entry.paperId === "retracted" ? "retracted" : "openalex-ambiguous"));
  }
});

test("tracks version and evidence-backed result corrections without citation-only noise", () => {
  const first = build([record()]);
  const citationOnly = record({ article: article({ scholar: { ...article().scholar!, citedByCount: 999 } }) });
  assert.deepEqual(build([citationOnly], first), first);

  const revised = record({
    arxivVersion: 3,
    factHash: "fact-v3",
    article: article({
      link: "https://arxiv.org/abs/2608.00001v3",
      excerpt: "We evaluate success rate on LIBERO in 120 real-robot trials, from 56.7% to 76.1%. Code is available at github.com/example/libero-policy.",
    }),
  });
  const second = build([revised], first);
  const correctionPaths = second.entries[0]!.corrections.map((item) => item.fieldPath);
  assert.ok(correctionPaths.includes("arxivVersion"));
  assert.ok(correctionPaths.includes("fields.result"));
  assert.ok(correctionPaths.includes("fields.delta"));
  assert.deepEqual(build([revised], second), second);
});

test("does not create correction noise when unchanged evidence is rebuilt later", () => {
  const first = buildAt([record()], NOW);
  const later = buildAt([record()], new Date("2026-08-11T00:00:00.000Z"), first);
  assert.deepEqual(later.entries[0]!.corrections, []);
});

test("retains an unknown tombstone and source-withdrawn history when benchmark evidence disappears", () => {
  const first = build([record()]);
  const withdrawn = record({
    article: article({ title: "A general robot policy", excerpt: "We present a general robot policy without benchmark results." }),
    evidenceTags: [],
  });
  const second = build([withdrawn], first);
  assert.equal(second.entries.length, 1);
  assert.equal(second.entries[0]!.fields.benchmark.status, "unknown");
  assert.ok(second.entries[0]!.gateCodes.includes("benchmark-evidence-withdrawn"));
  assert.ok(second.entries[0]!.corrections.some((item) => item.reason === "source-withdrawn"));
});

test("uses an internal unknown entry instead of throwing when the aggregate claim is not verified", () => {
  const item = record({
    article: article({
      title: "A general robot policy",
      excerpt: "We do not evaluate LIBERO in the ablation. In the main evaluation, LIBERO success rate is 74.7% vs 56.7%.",
    }),
    evidenceTags: [],
  });
  const entry = build([item]).entries[0]!;
  assert.ok(entry.gateCodes.includes("benchmark-claim-not-verified"));
  assert.equal(entry.fields.result.status, "unknown");
});

test("does not attribute one comparison to multiple benchmarks", () => {
  const item = record({
    article: article({
      title: "Multi-benchmark robot policy",
      excerpt: "We evaluate LIBERO and RLBench, reporting success rate 74.7% vs 56.7%.",
    }),
    evidenceTags: ["基准"],
  });
  const entries = build([item]).entries;
  assert.equal(entries.length, 2);
  assert.ok(entries.every((entry) => entry.fields.result.status === "unknown"));
  assert.ok(entries.every((entry) => entry.gateCodes.includes("benchmark-comparison-ambiguous")));
});

test("validates decision-card identity continuity", () => {
  const ledger = build([record()]);
  assert.doesNotThrow(() => validateBenchmarkResultLedger(ledger));
  const invalid = structuredClone(ledger);
  invalid.entries[0]!.decisionCardPaperId = "arxiv:different-paper";
  assert.throws(() => validateBenchmarkResultLedger(invalid), /decision card paper ID/i);
});
