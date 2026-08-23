import { createHash } from "node:crypto";
import { deriveLedgerCorrections, ledgerField, unknownLedgerField, validateLedgerField, type LedgerCorrection, type LedgerField } from "./ledger-contracts.js";
import type { ResearchDecisionCard } from "./research-decision-card.js";
import { researchClaims } from "./research-registry.js";
import type { ResearchRecord } from "./types.js";

export type BenchmarkEvaluationSetting = "real-robot" | "simulation" | "mixed" | "unknown";

export const BENCHMARK_GATE_CODES = [
  "benchmark-claim-not-verified",
  "benchmark-comparison-ambiguous",
  "benchmark-evidence-withdrawn",
  "benchmark-not-verified",
  "contradicted-claim",
  "incomplete-chinese-copy",
  "openalex-ambiguous",
  "openalex-freshness-unknown",
  "openalex-missing",
  "openalex-stale",
  "retracted",
  "review-required",
  "simulation-only",
  "unverified-evidence-tag",
] as const;
export type BenchmarkGateCode = typeof BENCHMARK_GATE_CODES[number];

export interface BenchmarkResultFields {
  benchmark: LedgerField<string>;
  metric: LedgerField<string>;
  result: LedgerField<string>;
  baseline: LedgerField<string>;
  delta: LedgerField<string>;
  evaluationSetting: LedgerField<BenchmarkEvaluationSetting>;
  realRobotTrials: LedgerField<number>;
  code: LedgerField<string>;
  data: LedgerField<string>;
  weights: LedgerField<string>;
}

export interface BenchmarkResultEntry {
  entryId: string;
  paperId: string;
  decisionCardPaperId: string;
  benchmarkKey: string;
  arxivVersion: number | "unknown";
  sourceUrl: string;
  fields: BenchmarkResultFields;
  gateCodes: BenchmarkGateCode[];
  corrections: LedgerCorrection[];
}

export interface BenchmarkResultLedger {
  generatedAt: string;
  entries: BenchmarkResultEntry[];
}

export interface BuildBenchmarkResultLedgerOptions {
  now?: Date;
  previous?: BenchmarkResultLedger;
}

interface ParsedComparison {
  metric?: string;
  result?: string;
  baseline?: string;
  delta?: string;
}

const UNKNOWN = "unknown" as const;
const BENCHMARKS: Array<[string, RegExp]> = [
  ["LIBERO", /\blibero\b/i],
  ["RLBench", /\brlbench\b/i],
  ["CALVIN", /\bcalvin\b/i],
  ["ManiSkill", /\bmaniskill\b/i],
  ["RoboMimic", /\brobomimic\b/i],
  ["BridgeData", /\bbridge(?:data)?\b/i],
];
const CONTEXTUAL = /\b(?:related work|prior work|previous work|existing (?:work|methods?|studies))\b/i;
const NEGATED = /\b(?:no|not|without|never|does not|do not|did not|cannot)\b/i;
const SIMULATION_ONLY = /\b(?:only|solely|exclusively)\s+(?:in\s+)?simulation\b|\bsimulation\s+only\b/i;

function canonicalBenchmarkName(value: string): string | undefined {
  return BENCHMARKS.find(([name]) => name.toLowerCase() === value.trim().toLowerCase())?.[0];
}

function stableEntryId(paperId: string, benchmark: string): string {
  const digest = createHash("sha256").update(`${paperId}\n${benchmark.toLowerCase()}`).digest("hex").slice(0, 16);
  return `benchmark-result-${digest}`;
}

function exactComparison(text: string): ParsedComparison {
  const fromTo = text.match(/\bfrom\s+(\d+(?:\.\d+)?)%\s+to\s+(\d+(?:\.\d+)?)%/i);
  const versus = text.match(/\b(\d+(?:\.\d+)?)%\s+vs\.?\s+(\d+(?:\.\d+)?)%/i);
  const explicitDelta = text.match(/\+\s*(\d+(?:\.\d+)?)\s+percentage points?\b/i);
  const comparison = fromTo ? { baseline: fromTo[1]!, result: fromTo[2]! } : versus ? { result: versus[1]!, baseline: versus[2]! } : undefined;
  const metric = text.match(/\b(success rate|task success rate|accuracy|return|score)\b/i)?.[1]?.toLowerCase();
  if (!comparison) return { metric, delta: explicitDelta ? `+${explicitDelta[1]} percentage points` : undefined };
  const numericDelta = Number(comparison.result) - Number(comparison.baseline);
  return {
    metric,
    result: `${comparison.result}%`,
    baseline: `${comparison.baseline}%`,
    delta: explicitDelta ? `+${explicitDelta[1]} percentage points` : `${numericDelta >= 0 ? "+" : ""}${Number(numericDelta.toFixed(10))} percentage points`,
  };
}

function sourceSentences(record: ResearchRecord): string[] {
  return record.article.excerpt.split(/\n+|(?<=[.!?])\s+/).map((value) => value.trim()).filter(Boolean);
}

function mentionedBenchmarks(record: ResearchRecord, card: ResearchDecisionCard): string[] {
  const cardBenchmarks = card.benchmark.value === UNKNOWN ? [] : card.benchmark.value.flatMap((value) => {
    const canonical = canonicalBenchmarkName(value);
    return canonical ? [canonical] : [];
  });
  const source = `${record.article.title}\n${record.article.excerpt}`;
  return [...new Set([...cardBenchmarks, ...BENCHMARKS.filter(([, pattern]) => pattern.test(source)).map(([name]) => name)])].sort();
}

function benchmarkSentences(record: ResearchRecord, benchmark: string): string[] {
  const benchmarkPattern = BENCHMARKS.find(([name]) => name === benchmark)?.[1];
  return benchmarkPattern ? sourceSentences(record).filter((sentence) => benchmarkPattern.test(sentence)) : [];
}

function supportingBenchmarkSentence(record: ResearchRecord, benchmark: string): string | undefined {
  return benchmarkSentences(record, benchmark).find((sentence) => !CONTEXTUAL.test(sentence) && !NEGATED.test(sentence));
}

function exactComparisonSentence(record: ResearchRecord, benchmark: string): string | undefined {
  return benchmarkSentences(record, benchmark).find((sentence) => {
    if (CONTEXTUAL.test(sentence) || NEGATED.test(sentence)) return false;
    const parsed = exactComparison(sentence);
    return parsed.result !== undefined || parsed.baseline !== undefined || parsed.delta !== undefined;
  });
}

function knownField<T>(paperId: string, field: string, value: T, evidenceUrls: string[], now: string): LedgerField<T> {
  return ledgerField({
    value,
    status: "verified",
    evidenceIds: [`${paperId}:${field}`],
    evidenceUrls,
    observedAt: now,
    verifiedAt: now,
  });
}

function cardFor(record: ResearchRecord, cards: readonly ResearchDecisionCard[]): ResearchDecisionCard | undefined {
  return cards.find((card) => card.identity.paperId.value === record.id);
}

function unknownFields(): BenchmarkResultFields {
  return {
    benchmark: unknownLedgerField<string>(),
    metric: unknownLedgerField<string>(),
    result: unknownLedgerField<string>(),
    baseline: unknownLedgerField<string>(),
    delta: unknownLedgerField<string>(),
    evaluationSetting: unknownLedgerField<BenchmarkEvaluationSetting>(),
    realRobotTrials: unknownLedgerField<number>(),
    code: unknownLedgerField<string>(),
    data: unknownLedgerField<string>(),
    weights: unknownLedgerField<string>(),
  };
}

function gateCodes(
  record: ResearchRecord,
  card: ResearchDecisionCard,
  supportingSentence: string | undefined,
  comparisonSentence: string | undefined,
  hasVerifiedBenchmarkClaim: boolean,
): BenchmarkGateCode[] {
  const gates = card.gates.map((gate) => gate.code as BenchmarkGateCode);
  if (!supportingSentence) gates.push("benchmark-not-verified");
  if (!hasVerifiedBenchmarkClaim) gates.push("benchmark-claim-not-verified");
  if ([supportingSentence, comparisonSentence].some((sentence) => sentence && SIMULATION_ONLY.test(sentence))) gates.push("simulation-only");
  if (comparisonSentence && BENCHMARKS.filter(([, pattern]) => pattern.test(comparisonSentence)).length > 1) gates.push("benchmark-comparison-ambiguous");
  if (record.status === "已撤稿" || record.article.scholar?.isRetracted) gates.push("retracted");
  return [...new Set(gates)].sort();
}

function materializeEntry(record: ResearchRecord, card: ResearchDecisionCard, benchmark: string, now: string): BenchmarkResultEntry {
  const benchmarkClaim = researchClaims(record.article).find((claim) => claim.kind === "基准" && claim.status === "verified");
  const realRobotClaim = researchClaims(record.article).find((claim) => claim.kind === "真实机器人" && claim.status === "verified");
  const supportingSentence = supportingBenchmarkSentence(record, benchmark);
  const comparisonSentence = exactComparisonSentence(record, benchmark);
  const gates = gateCodes(record, card, supportingSentence, comparisonSentence, Boolean(benchmarkClaim));
  const comparison = exactComparison(comparisonSentence ?? "");
  const evidenceUrls = benchmarkClaim ? [benchmarkClaim.sourceUrl] : [];
  const comparisonField = (field: "metric" | "result" | "baseline" | "delta") => {
    const value = comparison[field];
    return value ? knownField(record.id, field, value, evidenceUrls, now) : unknownLedgerField<string>();
  };
  const assetField = (field: "code" | "data" | "weights"): LedgerField<string> => {
    const asset = card.artifacts[field];
    return asset.value === UNKNOWN ? unknownLedgerField<string>() : knownField(record.id, field, asset.value, asset.evidenceUrls, now);
  };
  const realRobotTrials = card.realRobotTrials.value;
  const fields: BenchmarkResultFields = gates.length ? unknownFields() : {
    benchmark: knownField(record.id, "benchmark", benchmark, evidenceUrls, now),
    metric: comparisonField("metric"),
    result: comparisonField("result"),
    baseline: comparisonField("baseline"),
    delta: comparisonField("delta"),
    evaluationSetting: realRobotClaim ? knownField(record.id, "evaluation-setting", "real-robot" as const, [realRobotClaim.sourceUrl], now) : unknownLedgerField<BenchmarkEvaluationSetting>(),
    realRobotTrials: realRobotTrials === UNKNOWN ? unknownLedgerField<number>() : knownField(record.id, "real-robot-trials", realRobotTrials, card.realRobotTrials.evidenceUrls, now),
    code: assetField("code"),
    data: assetField("data"),
    weights: assetField("weights"),
  };
  return {
    entryId: stableEntryId(record.id, benchmark),
    paperId: record.id,
    decisionCardPaperId: record.id,
    benchmarkKey: benchmark,
    arxivVersion: record.arxivVersion ?? UNKNOWN,
    sourceUrl: record.article.link,
    fields,
    gateCodes: gates,
    corrections: [],
  };
}

const FIELD_PATHS = ["benchmark", "metric", "result", "baseline", "delta", "evaluationSetting", "realRobotTrials", "code", "data", "weights"] as const;
const LEDGER_KEYS = ["generatedAt", "entries"] as const;
const ENTRY_KEYS = ["entryId", "paperId", "decisionCardPaperId", "benchmarkKey", "arxivVersion", "sourceUrl", "fields", "gateCodes", "corrections"] as const;

function hasExactKeys(value: unknown, keys: readonly string[]): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function versionField(entry: Pick<BenchmarkResultEntry, "paperId" | "arxivVersion" | "sourceUrl">, observedAt: string): LedgerField<number> {
  return entry.arxivVersion === UNKNOWN ? unknownLedgerField<number>() : knownField(entry.paperId, "arxiv-version", entry.arxivVersion, [entry.sourceUrl], observedAt);
}

function withCorrections(entry: BenchmarkResultEntry, previous: BenchmarkResultEntry | undefined, now: string, previousGeneratedAt: string | undefined): BenchmarkResultEntry {
  if (!previous) return entry;
  let corrections = [...previous.corrections];
  const previousVersion = versionField(previous, previousGeneratedAt ?? now);
  const nextVersion = clockStableField(previousVersion, versionField(entry, now));
  corrections = deriveLedgerCorrections({
    ledgerType: "benchmark-result",
    subjectId: entry.entryId,
    fieldPath: "arxivVersion",
    before: previousVersion,
    after: nextVersion,
    previousCorrections: corrections,
    correctedAt: now,
  });
  for (const field of FIELD_PATHS) {
    const before: LedgerField<unknown> = previous.fields[field];
    const after: LedgerField<unknown> = clockStableField(before, entry.fields[field]);
    corrections = deriveLedgerCorrections<unknown>({
      ledgerType: "benchmark-result",
      subjectId: entry.entryId,
      fieldPath: `fields.${field}`,
      before,
      after,
      previousCorrections: corrections,
      correctedAt: now,
    });
  }
  return { ...entry, corrections };
}

function clockStableField<T>(before: LedgerField<T>, after: LedgerField<T>): LedgerField<T> {
  const material = (field: LedgerField<T>) => JSON.stringify({
    value: field.value,
    status: field.status,
    evidenceIds: field.evidenceIds,
    evidenceUrls: field.evidenceUrls,
    conflictingValues: field.conflictingValues,
  });
  return material(before) === material(after) ? { ...after, observedAt: before.observedAt } : after;
}

export function buildBenchmarkResultLedger(
  records: readonly ResearchRecord[],
  cards: readonly ResearchDecisionCard[],
  options: BuildBenchmarkResultLedgerOptions = {},
): BenchmarkResultLedger {
  const now = (options.now ?? new Date()).toISOString();
  const previousById = new Map((options.previous?.entries ?? []).map((entry) => [entry.entryId, entry]));
  const recordsById = new Map(records.map((record) => [record.id, record]));
  const entries = records.flatMap((record) => {
    const card = cardFor(record, cards);
    if (!card) return [];
    return mentionedBenchmarks(record, card).map((benchmark) => {
      const entry = materializeEntry(record, card, benchmark, now);
      return withCorrections(entry, previousById.get(entry.entryId), now, options.previous?.generatedAt);
    });
  });
  const currentIds = new Set(entries.map((entry) => entry.entryId));
  for (const previous of options.previous?.entries ?? []) {
    const record = recordsById.get(previous.paperId);
    if (!record || currentIds.has(previous.entryId) || !canonicalBenchmarkName(previous.benchmarkKey)) continue;
    const tombstone: BenchmarkResultEntry = {
      ...previous,
      arxivVersion: record.arxivVersion ?? UNKNOWN,
      sourceUrl: record.article.link,
      fields: unknownFields(),
      gateCodes: ["benchmark-evidence-withdrawn"],
      corrections: [],
    };
    entries.push(withCorrections(tombstone, previous, now, options.previous?.generatedAt));
  }
  entries.sort((left, right) => left.entryId.localeCompare(right.entryId));
  return { generatedAt: now, entries };
}

export function validateBenchmarkResultLedger(ledger: BenchmarkResultLedger): void {
  if (!hasExactKeys(ledger, LEDGER_KEYS) || !Array.isArray(ledger.entries)) throw new Error("Invalid benchmark ledger schema");
  if (!Number.isFinite(new Date(ledger.generatedAt).getTime())) throw new Error("Benchmark ledger generatedAt must be an ISO timestamp");
  const ids = new Set<string>();
  for (const entry of ledger.entries) {
    if (!hasExactKeys(entry, ENTRY_KEYS)) throw new Error("Invalid benchmark entry schema");
    if (!hasExactKeys(entry.fields, FIELD_PATHS)) throw new Error(`Invalid benchmark field schema: ${entry.entryId}`);
    if (!Array.isArray(entry.gateCodes) || entry.gateCodes.some((gate) => !BENCHMARK_GATE_CODES.includes(gate))) {
      throw new Error(`Invalid benchmark gate code: ${entry.entryId}`);
    }
    if (ids.has(entry.entryId)) throw new Error(`Duplicate benchmark result entry: ${entry.entryId}`);
    ids.add(entry.entryId);
    if (!canonicalBenchmarkName(entry.benchmarkKey)) throw new Error(`Benchmark entry lacks a canonical benchmark identity: ${entry.entryId}`);
    if (entry.decisionCardPaperId !== entry.paperId) throw new Error(`Benchmark decision card paper ID does not match ${entry.paperId}`);
    if (entry.entryId !== stableEntryId(entry.paperId, entry.benchmarkKey)) throw new Error(`Unstable benchmark result entry ID: ${entry.entryId}`);
    for (const field of FIELD_PATHS) validateLedgerField<unknown>(entry.fields[field]);
    for (const correction of entry.corrections) {
      if (correction.ledgerType !== "benchmark-result" || correction.subjectId !== entry.entryId) {
        throw new Error(`Benchmark correction identity does not match ${entry.entryId}`);
      }
    }
  }
}
