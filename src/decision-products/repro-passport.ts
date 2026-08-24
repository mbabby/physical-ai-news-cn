import { validateBenchmarkResultLedger, type BenchmarkResultEntry, type BenchmarkResultLedger } from "../benchmark-result-ledger.js";
import type { LedgerField } from "../ledger-contracts.js";
import { canonicalOpenAlexWorkId, type ResearchDecisionCard } from "../research-decision-card.js";
import type { ResearchRecord } from "../types.js";
import { hasCompleteChinesePassportCopy, stableDecisionId, validateDecisionProductArtifact, type ReproducibilityPassport } from "./contracts.js";

const DEFAULT_LIMIT = 6;
const UNKNOWN = "unknown" as const;
const CANDIDATE_ID = /\bcandidate[-_.:/]+[a-z0-9][a-z0-9_.:/-]*/i;
const codeUnitCompare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

export interface BuildReproducibilityPassportsInput {
  records: ResearchRecord[];
  cards: ResearchDecisionCard[];
  benchmarkLedger: BenchmarkResultLedger;
  limit?: number;
}

function normalizedLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(DEFAULT_LIMIT, Math.max(0, Math.floor(limit)));
}

function indexUnique<T>(values: readonly T[], identity: (value: T) => string, label: string): Map<string, T> {
  const indexed = new Map<string, T>();
  for (const value of values) {
    const id = identity(value).trim();
    if (!id || id === UNKNOWN) throw new Error(`${label}缺少规范 identity`);
    if (indexed.has(id)) throw new Error(`${label}包含重复 identity：${id}`);
    indexed.set(id, value);
  }
  return indexed;
}

function verified<T>(field: LedgerField<T>): T | typeof UNKNOWN {
  return field.status === "verified" && field.value !== UNKNOWN && field.evidenceUrls.length > 0 ? field.value : UNKNOWN;
}

function hasVerifiedValue(field: LedgerField<unknown>): boolean {
  return field.status === "verified" && field.value !== UNKNOWN && field.evidenceUrls.length > 0;
}

function hasVerifiedNumericValue(field: LedgerField<unknown>): boolean {
  if (!hasVerifiedValue(field)) return false;
  if (typeof field.value === "number") return Number.isFinite(field.value);
  return typeof field.value === "string"
    && /(?:^|[^\p{L}\p{N}])[-+]?(?:\d+(?:,\d{3})*(?:\.\d+)?|\.\d+)(?=$|[^\p{L}\p{N}])/u.test(field.value);
}

function numericCoverage(entry: BenchmarkResultEntry): number {
  return [entry.fields.result, entry.fields.baseline, entry.fields.delta, entry.fields.realRobotTrials]
    .filter(hasVerifiedNumericValue).length;
}

function evaluationPriority(entry: BenchmarkResultEntry): number {
  const setting = verified(entry.fields.evaluationSetting);
  return setting === "real-robot" || setting === "mixed" ? 1 : 0;
}

function selectBenchmark(entries: BenchmarkResultEntry[]): BenchmarkResultEntry | undefined {
  return entries.filter((entry) => entry.gateCodes.length === 0)
    .sort((left, right) => evaluationPriority(right) - evaluationPriority(left)
      || numericCoverage(right) - numericCoverage(left)
      || codeUnitCompare(left.benchmarkKey, right.benchmarkKey))[0];
}

function projectBenchmark(entry: BenchmarkResultEntry | undefined): ReproducibilityPassport["benchmark"] {
  if (!entry) return { name: UNKNOWN, metric: UNKNOWN, result: UNKNOWN, baseline: UNKNOWN, delta: UNKNOWN, evidenceUrls: [] };
  const fields = {
    name: verified(entry.fields.benchmark),
    metric: verified(entry.fields.metric),
    result: verified(entry.fields.result),
    baseline: verified(entry.fields.baseline),
    delta: verified(entry.fields.delta),
  };
  const evidenceUrls = [...new Set([
    entry.fields.benchmark,
    entry.fields.metric,
    entry.fields.result,
    entry.fields.baseline,
    entry.fields.delta,
    entry.fields.realRobotTrials,
  ].filter(hasVerifiedValue).flatMap((field) => field.evidenceUrls))].sort(codeUnitCompare);
  return { ...fields, evidenceUrls };
}

function cardValue<T>(field: { value: T | typeof UNKNOWN; evidenceUrls: string[] }): T | typeof UNKNOWN {
  return field.value !== UNKNOWN && field.evidenceUrls.length > 0 ? field.value : UNKNOWN;
}

function completeEligibleCard(record: ResearchRecord, card: ResearchDecisionCard): boolean {
  if (!card.eligibleForTopResearch || card.gates.length > 0 || !card.completeness.completeOrUnknown) return false;
  if (record.status === "已撤稿" || record.article.scholar?.isRetracted !== false) return false;
  if (cardValue(card.openAlex.match) !== "matched" || cardValue(card.openAlex.retraction) !== false || cardValue(card.openAlex.freshness) !== "fresh") return false;
  if (cardValue(card.titleZh) === UNKNOWN || cardValue(card.factsZh) === UNKNOWN) return false;
  return hasCompleteChinesePassportCopy(card.titleZh.value, card.factsZh.value);
}

function rankReasons(record: ResearchRecord, card: ResearchDecisionCard, benchmark: ReproducibilityPassport["benchmark"]): string[] {
  const reasons: string[] = [];
  const embodiment = cardValue(card.embodiment);
  if (embodiment !== UNKNOWN && embodiment.includes("真实机器人")) reasons.push("真实机器人证据");
  if ([benchmark.metric, benchmark.result, benchmark.baseline, benchmark.delta].every((value) => value !== UNKNOWN)) reasons.push("精确基准比较");
  if (cardValue(card.artifacts.code) !== UNKNOWN) reasons.push("代码已公开");
  const labs = cardValue(card.lab);
  const scholar = record.article.scholar;
  const openAlexUrl = scholar?.workId
    ? scholar.workId.startsWith("http://") || scholar.workId.startsWith("https://")
      ? scholar.workId
      : `https://openalex.org/${scholar.workId.replace(/^.*\//, "")}`
    : undefined;
  const directKeyLab = labs !== UNKNOWN && Boolean(openAlexUrl && card.lab.evidenceUrls.includes(openAlexUrl))
    && labs.some((lab) => record.authorityLabels.includes(lab) && scholar!.institutions.includes(lab));
  if (directKeyLab) reasons.push("重点实验室");
  if (reasons.length === 0) reasons.push("OpenAlex 元数据已核验");
  return reasons;
}

function gaps(passport: Omit<ReproducibilityPassport, "gaps">): string[] {
  const result: string[] = [];
  for (const key of ["code", "data", "weights"] as const) if (passport.assets[key] === UNKNOWN) result.push(`assets.${key}`);
  for (const key of ["name", "metric", "result", "baseline", "delta"] as const) if (passport.benchmark[key] === UNKNOWN) result.push(`benchmark.${key}`);
  if (passport.realRobotTrials === UNKNOWN) result.push("realRobotTrials");
  if (passport.limitations === UNKNOWN) result.push("limitations");
  if (passport.authority.authors.length === 0) result.push("authority.authors");
  if (passport.authority.labs.length === 0) result.push("authority.labs");
  if (passport.authority.citedByCount === UNKNOWN) result.push("authority.citedByCount");
  if (passport.authority.checkedAt === UNKNOWN) result.push("authority.checkedAt");
  return result;
}

function validatePassport(passport: ReproducibilityPassport, generatedAt: string): void {
  validateDecisionProductArtifact({
    schemaVersion: 1,
    generatedAt,
    periodStart: generatedAt.slice(0, 10),
    topSignals: [],
    companyCards: [],
    researchPassports: [passport],
    subscriptions: { generatedAt, entries: [] },
  });
}

export function buildReproducibilityPassports(input: BuildReproducibilityPassportsInput): ReproducibilityPassport[] {
  const limit = normalizedLimit(input.limit);
  if (limit === 0) return [];
  validateBenchmarkResultLedger(input.benchmarkLedger);

  const recordsById = indexUnique(input.records, (record) => record.id, "研究注册表");
  const cardsById = indexUnique(input.cards, (card) => String(card.identity.paperId.value), "研究决策卡");
  for (const [paperId, card] of cardsById) {
    const record = recordsById.get(paperId);
    if (!record) throw new Error(`研究决策卡 ${paperId} 无法匹配规范研究记录`);
    if (card.identity.paperId.value !== record.id) throw new Error(`研究决策卡 ${paperId} identity 归属不一致`);
    const cardWorkIdValue = card.identity.openAlexWorkId.value === UNKNOWN ? undefined : card.identity.openAlexWorkId.value;
    const recordWorkIdValue = record.article.scholar?.workId;
    const cardWorkId = canonicalOpenAlexWorkId(cardWorkIdValue);
    const recordWorkId = canonicalOpenAlexWorkId(recordWorkIdValue);
    if ((cardWorkIdValue && !cardWorkId) || (recordWorkIdValue && !recordWorkId) || cardWorkId !== recordWorkId) {
      throw new Error(`研究决策卡 ${paperId} 的 OpenAlex identity 归属不一致`);
    }
  }
  for (const entry of input.benchmarkLedger.entries) {
    if (entry.decisionCardPaperId !== entry.paperId) throw new Error(`Benchmark ${entry.entryId} 的决策卡归属不一致`);
    const record = recordsById.get(entry.paperId);
    if (record && entry.sourceUrl !== record.article.link) throw new Error(`Benchmark ${entry.entryId} 的论文来源归属不一致`);
  }

  const entriesByPaper = new Map<string, BenchmarkResultEntry[]>();
  for (const entry of input.benchmarkLedger.entries) {
    const entries = entriesByPaper.get(entry.paperId) ?? [];
    entries.push(entry);
    entriesByPaper.set(entry.paperId, entries);
  }

  return [...cardsById.values()]
    .filter((card) => completeEligibleCard(recordsById.get(String(card.identity.paperId.value))!, card))
    .sort((left, right) => right.rankScore - left.rankScore
      || String(right.identity.paperId.value).localeCompare(String(left.identity.paperId.value)))
    .slice(0, limit)
    .map((card) => {
      const paperId = String(card.identity.paperId.value);
      const record = recordsById.get(paperId)!;
      if (CANDIDATE_ID.test(paperId)) throw new Error(`复现护照包含候选论文标识：${paperId}`);
      const selected = selectBenchmark(entriesByPaper.get(paperId) ?? []);
      const benchmark = projectBenchmark(selected);
      const scholar = record.article.scholar!;
      const authors = cardValue(card.author);
      const labs = cardValue(card.lab);
      const cost = cardValue(card.reproducibilityCost);
      const whyWorthAttention = cardValue(card.whyWorthAttention);
      const passportWithoutGaps: Omit<ReproducibilityPassport, "gaps"> = {
        passportId: stableDecisionId("research", paperId),
        paperId,
        titleZh: card.titleZh.value as string,
        factsZh: [...card.factsZh.value] as [string, string],
        sourceUrl: record.article.link,
        task: cardValue(card.task),
        embodiment: cardValue(card.embodiment),
        methods: UNKNOWN,
        benchmark,
        realRobotTrials: selected ? verified(selected.fields.realRobotTrials) : UNKNOWN,
        assets: {
          code: cardValue(card.artifacts.code),
          data: cardValue(card.artifacts.data),
          weights: cardValue(card.artifacts.weights),
        },
        reproducibilityCost: cost === UNKNOWN || card.reproducibilityCost.rationale === UNKNOWN
          ? { level: UNKNOWN, rationale: UNKNOWN }
          : { level: cost, rationale: card.reproducibilityCost.rationale },
        authority: {
          authors: authors === UNKNOWN ? [] : [...authors],
          labs: labs === UNKNOWN ? [] : [...labs],
          citedByCount: Number.isInteger(scholar.citedByCount) && scholar.citedByCount >= 0 ? scholar.citedByCount : UNKNOWN,
          checkedAt: Number.isFinite(Date.parse(scholar.checkedAt)) ? new Date(scholar.checkedAt).toISOString() : UNKNOWN,
        },
        limitations: cardValue(card.limitations),
        whyWorthAttention: whyWorthAttention === UNKNOWN
          ? "该论文具备完整中文事实卡与新鲜、匹配且未撤稿的 OpenAlex 元数据。"
          : whyWorthAttention,
        rankReasons: rankReasons(record, card, benchmark),
      };
      const passport = { ...passportWithoutGaps, gaps: gaps(passportWithoutGaps) } satisfies ReproducibilityPassport;
      validatePassport(passport, input.benchmarkLedger.generatedAt);
      return passport;
    });
}
