import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { BenchmarkResultEntry, BenchmarkResultLedger, BenchmarkResultFields } from "../src/benchmark-result-ledger.js";
import { stableDecisionId } from "../src/decision-products/contracts.js";
import { buildReproducibilityPassports } from "../src/decision-products/repro-passport.js";
import type { LedgerField, LedgerFieldStatus } from "../src/ledger-contracts.js";
import type { ResearchDecisionCard } from "../src/research-decision-card.js";
import type { Article, ResearchRecord } from "../src/types.js";

const PAPER_URL = "https://arxiv.org/abs/2608.00001v1";
const OPENALEX_URL = "https://openalex.org/W260800001";
const TRIALS_URL = "https://evidence.example/real-robot-trials";
const CHECKED_AT = "2026-08-20T00:00:00.000Z";

function article(id = "arxiv:2608.00001", overrides: Partial<Article> = {}): Article {
  return {
    id,
    title: "LIBERO policy evaluation",
    titleZh: "LIBERO 机器人策略评测",
    summaryZh: "论文在 LIBERO 上评测机器人策略。原文报告了结果与基线。",
    link: PAPER_URL,
    publishedAt: new Date("2026-08-18T00:00:00.000Z"),
    fetchedAt: new Date("2026-08-20T00:00:00.000Z"),
    source: "arXiv · Robotics",
    sourceWeight: 9,
    excerpt: "We evaluate LIBERO in 120 real-robot trials.",
    tags: ["研究"],
    authors: ["Alice"],
    scholar: {
      provider: "OpenAlex",
      workId: "W260800001",
      citedByCount: 12,
      isRetracted: false,
      institutions: ["Example Lab"],
      authors: [{ name: "Alice", institutions: ["Example Lab"] }],
      checkedAt: CHECKED_AT,
    },
    ...overrides,
  };
}

function record(id = "arxiv:2608.00001", overrides: Partial<ResearchRecord> = {}): ResearchRecord {
  const currentArticle = overrides.article ?? article(id);
  return {
    id,
    article: currentArticle,
    firstSeenAt: CHECKED_AT,
    lastCheckedAt: CHECKED_AT,
    arxivVersion: 1,
    factHash: `fact-${id}`,
    status: "候选资源",
    seenDates: ["2026-08-20"],
    appearances: 1,
    evidenceTags: ["真实机器人", "基准", "开源"],
    authorityLabels: ["Example Lab"],
    changes: [],
    ...overrides,
  };
}

function backed<T>(value: T, evidenceUrls = [PAPER_URL]) {
  return { value, evidenceUrls };
}

function completeCard(id = "arxiv:2608.00001", overrides: Partial<ResearchDecisionCard> = {}): ResearchDecisionCard {
  const card: ResearchDecisionCard = {
    identity: {
      paperId: backed(id),
      openAlexWorkId: backed("W260800001", [OPENALEX_URL]),
      version: backed(1),
    },
    titleZh: backed("LIBERO 机器人策略评测"),
    factsZh: backed<[string, string]>(["论文在 LIBERO 上评测机器人策略。", "原文报告了结果与基线。"]),
    task: backed(["机器人操作"]),
    embodiment: backed(["真实机器人", "机械臂"]),
    datasetTrainingScale: backed("Training uses 50,000 demonstrations."),
    benchmark: backed(["LIBERO"]),
    baselineDelta: backed("74.7% vs 56.7%."),
    realRobotTrials: backed(999),
    artifacts: {
      code: backed("https://github.com/example/libero-policy"),
      data: { value: "unknown", evidenceUrls: [] },
      weights: { value: "unknown", evidenceUrls: [] },
      projectPage: { value: "unknown", evidenceUrls: [] },
      license: backed("Apache-2.0"),
    },
    limitations: { value: "unknown", evidenceUrls: [] },
    reproducibilityCost: { value: "medium", evidenceUrls: [PAPER_URL], rationale: "Training uses 8 GPUs." },
    author: backed(["Alice"], [OPENALEX_URL]),
    lab: backed(["Example Lab"], [OPENALEX_URL]),
    openAlex: {
      match: backed("matched", [OPENALEX_URL]),
      retraction: backed(false, [OPENALEX_URL]),
      freshness: backed("fresh", [OPENALEX_URL]),
    },
    whyWorthAttention: backed("原文摘要明确出现真实机器人、基准、开源证据。"),
    fieldEvidence: {} as ResearchDecisionCard["fieldEvidence"],
    completeness: { totalFields: 25, knownFields: 22, unknownFields: 3, completeOrUnknown: true },
    gates: [],
    eligibleForTopResearch: true,
    rankScore: 100,
  };
  return { ...card, ...overrides };
}

function field<T>(value: T | "unknown" = "unknown", status: LedgerFieldStatus = value === "unknown" ? "unknown" : "verified", url = PAPER_URL): LedgerField<T> {
  return value === "unknown" || status === "unknown" ? {
    value: "unknown", status: "unknown", evidenceIds: [], evidenceUrls: [], observedAt: "unknown", verifiedAt: "unknown",
  } : {
    value, status, evidenceIds: [`evidence-${String(value)}`], evidenceUrls: [url], observedAt: CHECKED_AT, verifiedAt: CHECKED_AT,
  };
}

function fields(overrides: Partial<BenchmarkResultFields> = {}): BenchmarkResultFields {
  return {
    benchmark: field("LIBERO"),
    metric: field("success rate"),
    result: field("74.7%"),
    baseline: field("56.7%"),
    delta: field("+18 percentage points"),
    evaluationSetting: field("real-robot"),
    realRobotTrials: field(120),
    code: field("https://github.com/example/libero-policy"),
    data: field<string>(),
    weights: field<string>(),
    ...overrides,
  };
}

function entry(benchmarkKey = "LIBERO", overrides: Partial<BenchmarkResultEntry> = {}): BenchmarkResultEntry {
  const paperId = overrides.paperId ?? "arxiv:2608.00001";
  return {
    entryId: `benchmark-result-${createHash("sha256").update(`${paperId}\n${benchmarkKey.toLowerCase()}`).digest("hex").slice(0, 16)}`,
    paperId,
    decisionCardPaperId: paperId,
    benchmarkKey,
    arxivVersion: 1,
    sourceUrl: PAPER_URL,
    fields: fields({ benchmark: field(benchmarkKey) }),
    gateCodes: [],
    corrections: [],
    ...overrides,
  };
}

function ledger(entries: BenchmarkResultEntry[] = [entry()]): BenchmarkResultLedger {
  return { generatedAt: CHECKED_AT, entries };
}

test("passport binds benchmark numbers and real-robot trials only from verified ledger fields", () => {
  const comparison = entry("LIBERO", { fields: fields({ realRobotTrials: field(120, "verified", TRIALS_URL) }) });
  const [passport] = buildReproducibilityPassports({ records: [record()], cards: [completeCard()], benchmarkLedger: ledger([comparison]), limit: 6 });
  assert.deepEqual(passport!.benchmark, {
    name: "LIBERO",
    metric: "success rate",
    result: "74.7%",
    baseline: "56.7%",
    delta: "+18 percentage points",
    evidenceUrls: [PAPER_URL, TRIALS_URL],
  });
  assert.equal(passport!.realRobotTrials, 120);
  assert.notEqual(passport!.realRobotTrials, completeCard().realRobotTrials.value);
  assert.equal(passport!.passportId, stableDecisionId("research", "arxiv:2608.00001"));
});

test("passport keeps ambiguous or unverified benchmark comparison fields unknown", () => {
  const comparison = entry("LIBERO", { fields: fields({
    result: {
      value: "unknown", status: "conflicted", evidenceIds: ["result-conflict"], evidenceUrls: [PAPER_URL],
      observedAt: CHECKED_AT, verifiedAt: CHECKED_AT, conflictingValues: ["74.7%", "75.1%"],
    },
    baseline: field<string>(),
    delta: field("+18 percentage points", "developing"),
  }) });
  const [passport] = buildReproducibilityPassports({ records: [record()], cards: [completeCard()], benchmarkLedger: ledger([comparison]) });
  assert.equal(passport!.benchmark.result, "unknown");
  assert.equal(passport!.benchmark.baseline, "unknown");
  assert.equal(passport!.benchmark.delta, "unknown");
  assert.deepEqual(passport!.benchmark.evidenceUrls, [PAPER_URL]);
  assert.ok(passport!.gaps.includes("benchmark.result"));
  assert.ok(passport!.gaps.includes("benchmark.baseline"));
  assert.ok(passport!.gaps.includes("benchmark.delta"));
});

test("passport blocks retraction and every OpenAlex degradation state", () => {
  const base = { records: [record()], benchmarkLedger: ledger() };
  const rejected = [
    completeCard(undefined, { openAlex: { ...completeCard().openAlex, retraction: backed(true, [OPENALEX_URL]) } }),
    completeCard(undefined, { openAlex: { ...completeCard().openAlex, retraction: { value: "unknown", evidenceUrls: [] } } }),
    completeCard(undefined, { openAlex: { ...completeCard().openAlex, match: backed("missing") } }),
    completeCard(undefined, { openAlex: { ...completeCard().openAlex, match: backed("ambiguous") } }),
    completeCard(undefined, { openAlex: { ...completeCard().openAlex, freshness: backed("stale") } }),
    completeCard(undefined, { openAlex: { ...completeCard().openAlex, freshness: { value: "unknown", evidenceUrls: [] } } }),
  ];
  for (const card of rejected) assert.deepEqual(buildReproducibilityPassports({ ...base, cards: [card] }), []);
  assert.deepEqual(buildReproducibilityPassports({ records: [record(undefined, { status: "已撤稿" })], cards: [completeCard()], benchmarkLedger: ledger() }), []);
  const retractedMetadata = article(undefined, { scholar: { ...article().scholar!, isRetracted: true } });
  assert.deepEqual(buildReproducibilityPassports({ records: [record(undefined, { article: retractedMetadata })], cards: [completeCard()], benchmarkLedger: ledger() }), []);
});

test("passport omits a normal OpenAlex-missing card without aborting valid cards", () => {
  const missingRecord = record("paper-missing", { article: article("paper-missing", { scholar: undefined }) });
  const missingCard = completeCard("paper-missing", {
    identity: { ...completeCard().identity, paperId: backed("paper-missing"), openAlexWorkId: { value: "unknown", evidenceUrls: [] } },
    openAlex: {
      match: backed("missing"),
      retraction: { value: "unknown", evidenceUrls: [] },
      freshness: { value: "unknown", evidenceUrls: [] },
    },
    eligibleForTopResearch: false,
    gates: [{ code: "openalex-missing", detail: "未获得 OpenAlex identity" }],
  });
  const passports = buildReproducibilityPassports({
    records: [missingRecord, record()], cards: [missingCard, completeCard()], benchmarkLedger: ledger(),
  });
  assert.deepEqual(passports.map((passport) => passport.paperId), ["arxiv:2608.00001"]);
});

test("passport rejects apparently eligible OpenAlex states without direct evidence", () => {
  for (const field of ["match", "retraction", "freshness"] as const) {
    const card = completeCard();
    card.openAlex[field] = { ...card.openAlex[field], evidenceUrls: [] } as never;
    assert.deepEqual(buildReproducibilityPassports({ records: [record()], cards: [card], benchmarkLedger: ledger() }), []);
  }
});

test("passport requires eligible complete fresh matched cards with complete Chinese facts", () => {
  const incomplete = completeCard();
  incomplete.titleZh = { value: "unknown", evidenceUrls: [] };
  const english = completeCard();
  english.titleZh = backed("LIBERO robot policy evaluation");
  english.factsZh = backed<[string, string]>(["The policy is evaluated on LIBERO.", "The paper reports a baseline comparison."]);
  const incompleteSentence = completeCard();
  incompleteSentence.factsZh = backed<[string, string]>(["论文在 LIBERO 上评测机器人策略", "原文报告了结果。并报告了基线。"]);
  for (const card of [
    completeCard(undefined, { eligibleForTopResearch: false }),
    completeCard(undefined, { gates: [{ code: "review-required", detail: "待复核" }] }),
    completeCard(undefined, { completeness: { totalFields: 25, knownFields: 1, unknownFields: 24, completeOrUnknown: false } }),
    incomplete,
    english,
    incompleteSentence,
  ]) {
    assert.deepEqual(buildReproducibilityPassports({ records: [record()], cards: [card], benchmarkLedger: ledger() }), []);
  }
});

test("passport omits malformed non-string facts without aborting valid cards", () => {
  const malformed = completeCard("paper-malformed", {
    identity: { ...completeCard().identity, paperId: backed("paper-malformed"), openAlexWorkId: backed("W-malformed", ["https://openalex.org/W-malformed"]) },
  });
  malformed.factsZh = backed(["论文包含一条事实。", 42] as unknown as [string, string]);
  const malformedRecord = record("paper-malformed", {
    article: article("paper-malformed", { link: "https://arxiv.org/abs/malformedv1", scholar: { ...article().scholar!, workId: "W-malformed" } }),
  });
  const passports = buildReproducibilityPassports({
    records: [malformedRecord, record()], cards: [malformed, completeCard()], benchmarkLedger: ledger(),
  });
  assert.deepEqual(passports.map((passport) => passport.paperId), ["arxiv:2608.00001"]);
});

test("passport derives explicit gaps and publishes public string rank reasons only", () => {
  const sparse = completeCard();
  sparse.artifacts.code = { value: "unknown", evidenceUrls: [] };
  sparse.lab = { value: "unknown", evidenceUrls: [] };
  const [passport] = buildReproducibilityPassports({
    records: [record()], cards: [sparse], benchmarkLedger: ledger([entry("LIBERO", { fields: fields({ realRobotTrials: field<number>() }) })]),
  });
  assert.deepEqual(passport!.assets, { code: "unknown", data: "unknown", weights: "unknown" });
  assert.ok(passport!.gaps.includes("assets.code"));
  assert.ok(passport!.gaps.includes("assets.data"));
  assert.ok(passport!.gaps.includes("assets.weights"));
  assert.ok(passport!.gaps.includes("realRobotTrials"));
  assert.ok(passport!.gaps.includes("limitations"));
  assert.deepEqual(passport!.rankReasons, ["真实机器人证据", "精确基准比较"]);
  assert.doesNotMatch(JSON.stringify(passport), /rankScore|internalScore|candidate-/i);
});

test("passport labels a key laboratory only when the canonical label has direct OpenAlex institution evidence", () => {
  const [positive] = buildReproducibilityPassports({ records: [record()], cards: [completeCard()], benchmarkLedger: ledger() });
  assert.ok(positive!.rankReasons.includes("重点实验室"));

  const launderedRecord = record(undefined, {
    authorityLabels: ["Physical Intelligence"],
    article: article(undefined, {
      authors: ["Sergey Levine"],
      scholar: {
        ...article().scholar!,
        institutions: ["Ordinary University"],
        authors: [{ name: "Sergey Levine", institutions: ["Ordinary University"] }],
      },
    }),
  });
  const launderedCard = completeCard(undefined, { lab: backed(["Ordinary University", "Physical Intelligence"], [OPENALEX_URL]) });
  const [laundered] = buildReproducibilityPassports({ records: [launderedRecord], cards: [launderedCard], benchmarkLedger: ledger() });
  assert.ok(!laundered!.rankReasons.includes("重点实验室"));
});

test("passport selects one benchmark by evaluation setting, verified numeric coverage, then name", () => {
  const mixed = entry("CALVIN", {
    fields: fields({ benchmark: field("CALVIN"), evaluationSetting: field("mixed"), realRobotTrials: field<number>() }),
  });
  const realRobot = entry("RLBench", {
    fields: fields({ benchmark: field("RLBench"), evaluationSetting: field("real-robot") }),
  });
  const simulation = entry("LIBERO", { fields: fields({ evaluationSetting: field("simulation") }) });
  const [passport] = buildReproducibilityPassports({ records: [record()], cards: [completeCard()], benchmarkLedger: ledger([simulation, realRobot, mixed]) });
  assert.equal(passport!.benchmark.name, "RLBench");
});

test("passport benchmark selection counts actual numeric values rather than verified prose", () => {
  const textual = entry("CALVIN", {
    fields: fields({
      benchmark: field("CALVIN"),
      result: field("best reported result"),
      baseline: field("prior method"),
      delta: field("substantial improvement"),
      realRobotTrials: field<number>(),
    }),
  });
  const numeric = entry("RLBench", {
    fields: fields({
      benchmark: field("RLBench"),
      result: field("74.7%"),
      baseline: field<string>(),
      delta: field<string>(),
      realRobotTrials: field(12),
    }),
  });
  const [passport] = buildReproducibilityPassports({ records: [record()], cards: [completeCard()], benchmarkLedger: ledger([textual, numeric]) });
  assert.equal(passport!.benchmark.name, "RLBench");
});

test("passport rejects mismatched card and ledger ownership", () => {
  assert.throws(
    () => buildReproducibilityPassports({ records: [record()], cards: [completeCard("arxiv:other")], benchmarkLedger: ledger() }),
    /匹配|归属|identity/i,
  );
  const mismatched = entry("LIBERO", { decisionCardPaperId: "arxiv:other" });
  assert.throws(
    () => buildReproducibilityPassports({ records: [record()], cards: [completeCard()], benchmarkLedger: ledger([mismatched]) }),
    /decision card paper ID|归属|匹配/i,
  );
  const wrongSource = entry("LIBERO", { sourceUrl: "https://arxiv.org/abs/2608.99999v1" });
  assert.throws(
    () => buildReproducibilityPassports({ records: [record()], cards: [completeCard()], benchmarkLedger: ledger([wrongSource]) }),
    /来源|归属|匹配/i,
  );
});

test("passport ordering, stable identities, default cap, and invalid limits are deterministic", () => {
  const records = Array.from({ length: 8 }, (_, index) => {
    const id = `paper-${index}`;
    return record(id, { article: article(id, { id, link: `https://arxiv.org/abs/2608.0000${index}v1`, scholar: { ...article().scholar!, workId: `W-${index}` } }) });
  });
  const cards = records.map((item, index) => completeCard(item.id, {
    identity: { ...completeCard().identity, paperId: backed(item.id), openAlexWorkId: backed(`W-${index}`, [`https://openalex.org/W-${index}`]) },
    rankScore: index,
  }));
  const input = { records, cards, benchmarkLedger: ledger([]) };
  const first = buildReproducibilityPassports(input);
  const second = buildReproducibilityPassports({ ...input, records: [...records].reverse(), cards: [...cards].reverse() });
  assert.equal(first.length, 6);
  assert.deepEqual(first.map((item) => item.paperId), ["paper-7", "paper-6", "paper-5", "paper-4", "paper-3", "paper-2"]);
  assert.deepEqual(second, first);
  assert.deepEqual(buildReproducibilityPassports({ ...input, limit: -1 }), []);
  assert.equal(buildReproducibilityPassports({ ...input, limit: Number.NaN }).length, 6);
  assert.equal(buildReproducibilityPassports({ ...input, limit: Number.POSITIVE_INFINITY }).length, 6);
  assert.equal(buildReproducibilityPassports({ ...input, limit: 99 }).length, 6);

  const tieRecords = ["paper-Z", "paper-a"].map((id, index) => record(id, {
    article: article(id, { link: `https://arxiv.org/abs/tie-${index}v1`, scholar: { ...article().scholar!, workId: `W-tie-${index}` } }),
  }));
  const tieCards = tieRecords.map((item, index) => completeCard(item.id, {
    identity: { ...completeCard().identity, paperId: backed(item.id), openAlexWorkId: backed(`W-tie-${index}`, [`https://openalex.org/W-tie-${index}`]) },
    rankScore: 1,
  }));
  assert.equal(buildReproducibilityPassports({ records: tieRecords, cards: tieCards, benchmarkLedger: ledger([]), limit: 1 })[0]!.paperId, "paper-Z");
});
