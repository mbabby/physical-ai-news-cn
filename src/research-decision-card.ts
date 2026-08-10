import type { Article, ResearchRecord } from "./types.js";
import { hasCompleteChineseResearchCopy } from "./publication.js";

/** `unknown` is a deliberate public value, never a placeholder for a guessed fact. */
export type Unknown = "unknown";
export type KnownOrUnknown<T> = T | Unknown;

export interface EvidenceBacked<T> {
  value: KnownOrUnknown<T>;
  /** Direct source URLs supporting this field. Empty only when the value is `unknown`. */
  evidenceUrls: string[];
}

export type DecisionEvidenceField =
  | "identity" | "title" | "facts" | "task" | "embodiment" | "datasetTrainingScale"
  | "benchmark" | "baselineDelta" | "realRobotTrials" | "artifacts.code"
  | "artifacts.weights" | "artifacts.data" | "artifacts.projectPage" | "artifacts.license"
  | "limitations" | "reproducibilityCost" | "author" | "lab" | "openAlex.match"
  | "openAlex.retraction" | "openAlex.freshness" | "whyWorthAttention";

export interface ResearchDecisionCard {
  identity: {
    paperId: EvidenceBacked<string>;
    openAlexWorkId: EvidenceBacked<string>;
    version: EvidenceBacked<number>;
  };
  titleZh: EvidenceBacked<string>;
  /** Exactly the first two already-published Chinese factual sentences. */
  factsZh: EvidenceBacked<[string, string]>;
  task: EvidenceBacked<string[]>;
  embodiment: EvidenceBacked<string[]>;
  datasetTrainingScale: EvidenceBacked<string>;
  benchmark: EvidenceBacked<string[]>;
  baselineDelta: EvidenceBacked<string>;
  realRobotTrials: EvidenceBacked<number>;
  artifacts: {
    code: EvidenceBacked<string>;
    weights: EvidenceBacked<string>;
    data: EvidenceBacked<string>;
    projectPage: EvidenceBacked<string>;
    license: EvidenceBacked<string>;
  };
  limitations: EvidenceBacked<string[]>;
  reproducibilityCost: EvidenceBacked<"low" | "medium" | "high"> & { rationale: Unknown | string };
  author: EvidenceBacked<string[]>;
  lab: EvidenceBacked<string[]>;
  openAlex: {
    match: EvidenceBacked<"matched" | "missing" | "ambiguous">;
    retraction: EvidenceBacked<boolean>;
    freshness: EvidenceBacked<"fresh" | "stale">;
  };
  whyWorthAttention: EvidenceBacked<string>;
  fieldEvidence: Record<DecisionEvidenceField, string[]>;
  completeness: {
    totalFields: number;
    knownFields: number;
    unknownFields: number;
    completeOrUnknown: boolean;
  };
  gates: Array<{ code: string; detail: string }>;
  eligibleForTopResearch: boolean;
  rankScore: number;
}

export interface DecisionCardOptions {
  now?: Date;
  /** A checked OpenAlex record older than this cannot enter the Top 12. */
  maxOpenAlexAgeDays?: number;
  /** A duplicate work identity across distinct paper IDs is unsafe to select. */
  ambiguousWorkIds?: ReadonlySet<string>;
}

const UNKNOWN: Unknown = "unknown";
const sourceUrl = (article: Article): string[] => article.link ? [article.link] : [];
const unknown = <T>(): EvidenceBacked<T> => ({ value: UNKNOWN, evidenceUrls: [] });
const known = <T>(value: T, evidenceUrls: string[]): EvidenceBacked<T> => ({ value, evidenceUrls: [...new Set(evidenceUrls)] });
const isKnown = <T>(field: EvidenceBacked<T>): boolean => field.value !== UNKNOWN;

function sourceAbstract(article: Article): string {
  // Technical claims are extracted from the title and original abstract only;
  // the translated summary is used solely for the already-published Chinese copy.
  return `${article.title}\n${article.excerpt}`.replace(/[ \t]+/g, " ").replace(/\n+/g, "\n").trim();
}

function sourceSentence(value: string, pattern: RegExp): string | undefined {
  return value.split(/\n+|(?<=[.!?。！？])\s+/).find((sentence) => pattern.test(sentence))?.trim();
}

function chineseFacts(article: Article): EvidenceBacked<[string, string]> {
  const sentences = (article.summaryZh ?? "").match(/[^。！？]+[。！？]/g)?.map((item) => item.trim()).filter(Boolean) ?? [];
  return sentences.length >= 2 ? known([sentences[0]!, sentences[1]!], sourceUrl(article)) : unknown();
}

function extractLabels(text: string, rules: Array<[string, RegExp]>): string[] {
  return rules.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
}

function extractUrls(text: string): string[] {
  return [...new Set((text.match(/(?:https?:\/\/|www\.)[^\s)<>,;]+|github\.com\/[\w.-]+\/[\w.-]+(?:\/[\w./#?=-]+)?/gi) ?? [])
    .map((value) => value.replace(/[.。]+$/, ""))
    .map((value) => value.startsWith("http") ? value : `https://${value}`))];
}

function firstUrl(text: string, test: RegExp): string | undefined {
  return extractUrls(text).find((url) => test.test(url));
}

function openAlexUrl(workId: string | undefined): string[] {
  if (!workId) return [];
  return [workId.startsWith("http://") || workId.startsWith("https://") ? workId : `https://openalex.org/${workId.replace(/^.*\//, "")}`];
}

function openAlexFreshness(checkedAt: string | undefined, now: Date, maxAgeDays: number): EvidenceBacked<"fresh" | "stale"> {
  if (!checkedAt) return unknown();
  const checked = new Date(checkedAt).getTime();
  if (!Number.isFinite(checked)) return unknown();
  const age = Math.max(0, now.getTime() - checked) / 86_400_000;
  return known(age <= maxAgeDays ? "fresh" : "stale", []);
}

function rankScore(record: ResearchRecord, now: Date): number {
  const status: Record<ResearchRecord["status"], number> = { "里程碑精读候选": 50, "常青资源候选": 40, "候选资源": 30, "新论文": 20, "待复核": -100, "已撤稿": -1000 };
  const citations = record.article.scholar?.citedByCount ?? 0;
  const ageDays = Math.max(0, now.getTime() - record.article.publishedAt.getTime()) / 86_400_000;
  const freshness = ageDays <= 7 ? 8 : ageDays <= 30 ? 4 : 0;
  return status[record.status] + record.evidenceTags.length * 8 + record.authorityLabels.length * 7 + Math.min(12, Math.log10(citations + 1) * 4) + freshness;
}

function fieldEvidence(card: Omit<ResearchDecisionCard, "fieldEvidence" | "completeness" | "gates" | "eligibleForTopResearch">): Record<DecisionEvidenceField, string[]> {
  return {
    identity: [...card.identity.paperId.evidenceUrls, ...card.identity.openAlexWorkId.evidenceUrls, ...card.identity.version.evidenceUrls],
    title: card.titleZh.evidenceUrls, facts: card.factsZh.evidenceUrls, task: card.task.evidenceUrls, embodiment: card.embodiment.evidenceUrls,
    datasetTrainingScale: card.datasetTrainingScale.evidenceUrls, benchmark: card.benchmark.evidenceUrls, baselineDelta: card.baselineDelta.evidenceUrls,
    realRobotTrials: card.realRobotTrials.evidenceUrls, "artifacts.code": card.artifacts.code.evidenceUrls, "artifacts.weights": card.artifacts.weights.evidenceUrls,
    "artifacts.data": card.artifacts.data.evidenceUrls, "artifacts.projectPage": card.artifacts.projectPage.evidenceUrls, "artifacts.license": card.artifacts.license.evidenceUrls,
    limitations: card.limitations.evidenceUrls, reproducibilityCost: card.reproducibilityCost.evidenceUrls, author: card.author.evidenceUrls, lab: card.lab.evidenceUrls,
    "openAlex.match": card.openAlex.match.evidenceUrls, "openAlex.retraction": card.openAlex.retraction.evidenceUrls, "openAlex.freshness": card.openAlex.freshness.evidenceUrls,
    whyWorthAttention: card.whyWorthAttention.evidenceUrls,
  };
}

/** Materialize a schema-complete decision card without inventing research facts. */
export function materializeResearchDecisionCard(record: ResearchRecord, options: DecisionCardOptions = {}): ResearchDecisionCard {
  const now = options.now ?? new Date();
  const maxOpenAlexAgeDays = options.maxOpenAlexAgeDays ?? 30;
  const article = record.article;
  const abstract = sourceAbstract(article);
  const paperEvidence = sourceUrl(article);
  const scholar = article.scholar;
  const scholarEvidence = openAlexUrl(scholar?.workId);
  const ambiguous = Boolean(scholar?.workId && options.ambiguousWorkIds?.has(scholar.workId));
  const match = ambiguous ? known("ambiguous" as const, scholarEvidence) : scholar?.workId ? known("matched" as const, scholarEvidence) : known("missing" as const, paperEvidence);
  const freshness = openAlexFreshness(scholar?.checkedAt, now, maxOpenAlexAgeDays);
  if (freshness.value !== UNKNOWN) freshness.evidenceUrls = scholarEvidence;

  const taskLabels = extractLabels(abstract, [
    ["机器人操作", /manipulation|manipulate|pick[- ]and[- ]place/i], ["抓取", /grasping|grasp/i],
    ["机器人导航", /navigation|navigate/i], ["机器人运动", /locomotion|locomote/i],
  ]);
  const embodimentLabels = extractLabels(abstract, [
    ["真实机器人", /real[- ]robot|physical robot|on[- ]robot/i], ["人形机器人", /humanoid/i],
    ["四足机器人", /quadruped/i], ["移动操作机器人", /mobile manipulator/i], ["机械臂", /robot arm|manipulator arm/i],
  ]);
  const benchmarkLabels = extractLabels(abstract, [
    ["LIBERO", /\blibero\b/i], ["RLBench", /\brlbench\b/i], ["CALVIN", /\bcalvin\b/i],
    ["ManiSkill", /\bmaniskill\b/i], ["RoboMimic", /\brobomimic\b/i], ["BridgeData", /\bbridge(?:data)?\b/i],
  ]);
  const scale = sourceSentence(abstract, /\b\d+(?:[,.]\d+)?\s*(?:million|billion|thousand|k|m)?\s*(?:demonstrations?|trajectories|episodes|hours?|images?|videos?|robots?|tasks?)\b/i);
  const delta = sourceSentence(abstract, /(?:outperform|improv(?:e|es|ed|ement)|better than|gain(?:s|ed)?|\+\s*\d|\d+(?:\.\d+)?%)/i);
  const realRobotCount = abstract.match(/\b(\d+)\s+(?:real[- ]robot\s+)?(?:trials|rollouts|episodes)\b/i)?.[1];
  const code = firstUrl(abstract, /github\.com/i);
  const weights = firstUrl(abstract, /huggingface\.co\/(?!datasets)/i);
  const data = firstUrl(abstract, /huggingface\.co\/datasets|kaggle\.com\/datasets|zenodo\.org/i);
  const projectPage = firstUrl(abstract, /project|\.ai\//i);
  const license = abstract.match(/\b(Apache[- ]?2\.0|MIT License|BSD[- ]?(?:2|3)[- ]Clause|CC[- ]BY[- ]?4\.0)\b/i)?.[1];
  const limitation = sourceSentence(abstract, /\b(limit(?:ation|ed|s)?|only|fails?|failure|cannot|does not)\b/i);
  const costSentence = sourceSentence(abstract, /low[- ]cost|single[- ]GPU|consumer[- ]GPU|\b(?:8|16|32|64|128)\s*GPUs?\b|large[- ]scale|billion[- ]parameter/i);
  const costLevel: "low" | "medium" | "high" | undefined = costSentence?.match(/low[- ]cost|single[- ]GPU|consumer[- ]GPU/i) ? "low" : costSentence?.match(/large[- ]scale|billion[- ]parameter|\b(?:32|64|128)\s*GPUs?\b/i) ? "high" : costSentence?.match(/\b(?:8|16)\s*GPUs?\b/i) ? "medium" : undefined;
  const authors = [...new Set([...(article.authors ?? []), ...(scholar?.authors.map((author) => author.name) ?? [])])];
  const labs = [...new Set([...(scholar?.institutions ?? []), ...record.authorityLabels])];
  const why: string[] = [];
  if (record.evidenceTags.length) why.push(`原文摘要明确出现${record.evidenceTags.join("、")}证据`);
  if (labs.length) why.push(`OpenAlex 作者/机构元数据包含${labs.slice(0, 2).join("、")}`);
  if ((scholar?.citedByCount ?? 0) > 0) why.push(`OpenAlex 记录引用 ${scholar!.citedByCount}`);
  const base = {
    identity: { paperId: known(record.id, paperEvidence), openAlexWorkId: scholar?.workId ? known(scholar.workId, scholarEvidence) : unknown<string>(), version: record.arxivVersion ? known(record.arxivVersion, paperEvidence) : unknown<number>() },
    titleZh: article.titleZh ? known(article.titleZh, paperEvidence) : unknown<string>(),
    factsZh: chineseFacts(article),
    task: taskLabels.length ? known(taskLabels, paperEvidence) : unknown<string[]>(),
    embodiment: embodimentLabels.length ? known(embodimentLabels, paperEvidence) : unknown<string[]>(),
    datasetTrainingScale: scale ? known(scale, paperEvidence) : unknown<string>(),
    benchmark: benchmarkLabels.length ? known(benchmarkLabels, paperEvidence) : unknown<string[]>(),
    baselineDelta: delta ? known(delta, paperEvidence) : unknown<string>(),
    realRobotTrials: realRobotCount ? known(Number(realRobotCount), paperEvidence) : unknown<number>(),
    artifacts: {
      code: code ? known(code, [...paperEvidence, code]) : unknown<string>(),
      weights: weights ? known(weights, [...paperEvidence, weights]) : unknown<string>(),
      data: data ? known(data, [...paperEvidence, data]) : unknown<string>(),
      projectPage: projectPage ? known(projectPage, [...paperEvidence, projectPage]) : unknown<string>(),
      license: license ? known(license, paperEvidence) : unknown<string>(),
    },
    limitations: limitation ? known([limitation], paperEvidence) : unknown<string[]>(),
    reproducibilityCost: costLevel ? { ...known(costLevel, paperEvidence), rationale: costSentence! } : { ...unknown<"low" | "medium" | "high">(), rationale: UNKNOWN },
    author: authors.length ? known(authors, scholarEvidence.length ? scholarEvidence : paperEvidence) : unknown<string[]>(),
    lab: labs.length ? known(labs, scholarEvidence) : unknown<string[]>(),
    openAlex: { match, retraction: scholar ? known(scholar.isRetracted, scholarEvidence) : unknown<boolean>(), freshness },
    whyWorthAttention: why.length ? known(`${why.join("；")}。`, [...paperEvidence, ...scholarEvidence]) : unknown<string>(),
    rankScore: rankScore(record, now),
  };
  const fields = fieldEvidence(base);
  const fieldValues: Array<EvidenceBacked<unknown>> = [
    base.identity.paperId, base.identity.openAlexWorkId, base.identity.version, base.titleZh, base.factsZh, base.task, base.embodiment, base.datasetTrainingScale, base.benchmark, base.baselineDelta, base.realRobotTrials,
    base.artifacts.code, base.artifacts.weights, base.artifacts.data, base.artifacts.projectPage, base.artifacts.license, base.limitations, base.reproducibilityCost, base.author, base.lab, base.openAlex.match, base.openAlex.retraction, base.openAlex.freshness, base.whyWorthAttention,
  ];
  const knownFields = fieldValues.filter(isKnown).length;
  const gates: Array<{ code: string; detail: string }> = [];
  if (!hasCompleteChineseResearchCopy(article)) gates.push({ code: "incomplete-chinese-copy", detail: "中文标题或两句事实简介未完成。" });
  if (record.status === "待复核") gates.push({ code: "review-required", detail: "研究记录仍处于待复核状态。" });
  if (record.status === "已撤稿" || scholar?.isRetracted) gates.push({ code: "retracted", detail: "OpenAlex 或研究记录标记为已撤稿。" });
  if (match.value === "missing") gates.push({ code: "openalex-missing", detail: "未获得可核验的 OpenAlex work identity。" });
  if (match.value === "ambiguous") gates.push({ code: "openalex-ambiguous", detail: "同一 OpenAlex work identity 对应多个论文记录，拒绝自动选择。" });
  if (freshness.value === "stale") gates.push({ code: "openalex-stale", detail: `OpenAlex 检查时间超过 ${maxOpenAlexAgeDays} 天。` });
  if (freshness.value === UNKNOWN) gates.push({ code: "openalex-freshness-unknown", detail: "无法核验 OpenAlex 元数据的新鲜度。" });
  return { ...base, fieldEvidence: fields, completeness: { totalFields: fieldValues.length, knownFields, unknownFields: fieldValues.length - knownFields, completeOrUnknown: fieldValues.every((field) => field.value === UNKNOWN || field.evidenceUrls.length > 0) }, gates, eligibleForTopResearch: gates.length === 0 };
}

function duplicateOpenAlexWorkIds(records: readonly ResearchRecord[]): Set<string> {
  const paperIdsByWorkId = new Map<string, Set<string>>();
  for (const record of records) {
    const workId = record.article.scholar?.workId;
    if (!workId) continue;
    const paperIds = paperIdsByWorkId.get(workId) ?? new Set<string>();
    paperIds.add(record.id);
    paperIdsByWorkId.set(workId, paperIds);
  }
  return new Set([...paperIdsByWorkId].filter(([, paperIds]) => paperIds.size > 1).map(([workId]) => workId));
}

/** Deterministic ordering; paper ID is the final tiebreaker. */
export function rankResearchDecisionCards(records: readonly ResearchRecord[], options: Omit<DecisionCardOptions, "ambiguousWorkIds"> = {}): ResearchDecisionCard[] {
  const ambiguousWorkIds = duplicateOpenAlexWorkIds(records);
  return records.map((record) => materializeResearchDecisionCard(record, { ...options, ambiguousWorkIds }))
    .sort((left, right) => right.rankScore - left.rankScore || right.identity.paperId.value.toString().localeCompare(left.identity.paperId.value.toString()));
}

/** Top 12 is selected only after complete-copy, OpenAlex identity/freshness and retraction gates pass. */
export function selectTopResearchDecisionCards(records: readonly ResearchRecord[], options: Omit<DecisionCardOptions, "ambiguousWorkIds"> = {}): ResearchDecisionCard[] {
  return rankResearchDecisionCards(records, options).filter((card) => card.eligibleForTopResearch).slice(0, 12);
}
