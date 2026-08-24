import { hasCompleteChineseCopy, hasCompleteChineseResearchCopy } from "../publication.js";
import type { DailyArchive, EventStore, ResearchRecord, RunHistory, RunManifest } from "../types.js";
import { blockingHistoryContinuityErrors } from "./health.js";
import { validateFacts } from "../facts-contract.js";
import { validateWatchlistRelease, type WatchlistReleaseValidationInput } from "../watchlist/release-validation.js";
import type { ResearchDecisionCard } from "../research-decision-card.js";
import type { CompanyClaimLedger } from "../company-claim-ledger.js";
import type { BenchmarkResultLedger } from "../benchmark-result-ledger.js";
import { validateDualLedgers } from "../dual-ledger.js";
import { validateDecisionProductArtifact, type DecisionProductArtifact } from "../decision-products/contracts.js";
import { buildDecisionFeedManifest, renderDecisionFeed } from "../decision-products/subscriptions.js";
import type { DashboardData } from "../site-data.js";
import type { WatchlistPublicView } from "../watchlist/public-view.js";

export interface PublicationValidationInput {
  archive: DailyArchive;
  events: EventStore;
  research: ResearchRecord[];
  researchDecisionCards: ResearchDecisionCard[];
  readme: string;
  expectedDate: string;
  previousCompleteResearchCount?: number;
  watchlist?: WatchlistReleaseValidationInput;
}

export function validateDualLedgerPublication(input: {
  company: CompanyClaimLedger;
  benchmark: BenchmarkResultLedger;
  companyIds: ReadonlySet<string>;
  companyEventOwners?: ReadonlyMap<string, string>;
  paperIds: ReadonlySet<string>;
  decisionCards: readonly ResearchDecisionCard[];
  expectedGeneratedAt: string;
}): void {
  validateDualLedgers(input);
}

export interface DecisionProductPublicationValidationInput {
  artifact: unknown;
  expectedArtifact: DecisionProductArtifact;
  dashboard: Pick<DashboardData, "generatedAt" | "decisionProducts" | "topSignals" | "companyRadar" | "research">;
  readme: string;
  feedManifest: unknown;
  feeds: Readonly<Record<string, string>>;
  expectedGeneratedAt: string;
  companyEventOwners: ReadonlyMap<string, string>;
  benchmarkResultLedger: BenchmarkResultLedger;
  repositoryUrl: string;
  pagesUrl: string;
  watchlist: WatchlistPublicView;
}

const stableBytes = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

function orderedIds(value: unknown, key: string): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => item && typeof item === "object" && key in item ? String((item as Record<string, unknown>)[key]) : "");
}

function assertSameIds(actual: string[], expected: string[], label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label}身份或顺序与 Decision Product 不一致`);
}

function validatePassportBenchmarkEvidence(artifact: DecisionProductArtifact, ledger: BenchmarkResultLedger): void {
  const entriesByPaper = new Map<string, BenchmarkResultLedger["entries"]>();
  for (const entry of ledger.entries) entriesByPaper.set(entry.paperId, [...(entriesByPaper.get(entry.paperId) ?? []), entry]);
  const fieldNames = { name: "benchmark", metric: "metric", result: "result", baseline: "baseline", delta: "delta" } as const;
  for (const passport of artifact.researchPassports) {
    for (const [publicField, ledgerField] of Object.entries(fieldNames) as Array<[keyof typeof fieldNames, typeof fieldNames[keyof typeof fieldNames]]>) {
      const value = passport.benchmark[publicField];
      if (value === "unknown") continue;
      const bound = (entriesByPaper.get(passport.paperId) ?? []).some((entry) => {
        const field = entry.fields[ledgerField];
        return field.status === "verified" && field.value === value && field.evidenceUrls.length > 0
          && field.evidenceUrls.every((url) => passport.benchmark.evidenceUrls.includes(url));
      });
      if (!bound) throw new Error(`Research Passport 已知 Benchmark 字段缺少账本证据：${passport.paperId}.${publicField}`);
    }
  }
}

/** Validate the shared materialized product and every public projection without re-ranking. */
export function validateDecisionProductPublication(input: DecisionProductPublicationValidationInput): void {
  validateDecisionProductArtifact(input.expectedArtifact);
  validateDecisionProductArtifact(input.artifact);
  const artifact = input.artifact;
  if (stableBytes(artifact) !== stableBytes(input.expectedArtifact)) throw new Error("Decision Product 与规范输入重建结果不一致");
  if (artifact.generatedAt !== input.expectedGeneratedAt || artifact.subscriptions.generatedAt !== artifact.generatedAt
    || input.dashboard.generatedAt !== artifact.generatedAt) throw new Error("Decision Product、运行清单与 dashboard 生成时间不一致");
  if (!input.dashboard.decisionProducts || stableBytes(input.dashboard.decisionProducts) !== stableBytes(artifact)) {
    throw new Error("dashboard 内嵌 Decision Product 与公开工件不一致");
  }
  assertSameIds(orderedIds(input.dashboard.topSignals, "signalId"), artifact.topSignals.map((item) => item.signalId), "dashboard Top Signals");
  assertSameIds(orderedIds(input.dashboard.companyRadar, "cardId"), artifact.companyCards.map((item) => item.cardId), "dashboard 公司卡");
  assertSameIds(orderedIds(input.dashboard.research, "passportId"), artifact.researchPassports.map((item) => item.passportId), "dashboard Research Passports");
  const readmeIds = [...input.readme.matchAll(/<!-- decision-signal:([^ ]+) -->/g)].map((match) => match[1]!);
  assertSameIds(readmeIds, artifact.topSignals.map((item) => item.signalId), "README Top Signals");
  for (const card of artifact.companyCards) for (const change of card.recentChanges) {
    if (input.companyEventOwners.get(change.eventId) !== card.companyId) throw new Error(`公司卡事件归属不一致：${card.companyId}:${change.eventId}`);
  }
  validatePassportBenchmarkEvidence(artifact, input.benchmarkResultLedger);
  const expectedManifest = buildDecisionFeedManifest(artifact);
  if (stableBytes(input.feedManifest) !== stableBytes(expectedManifest)) throw new Error("Decision Feed manifest 与公开工件不一致");
  for (const feed of expectedManifest.feeds) {
    const expected = renderDecisionFeed(artifact, feed.route, input);
    if (input.feeds[feed.path] !== expected) throw new Error(`Decision Feed 字节或 GUID 顺序不一致：${feed.path}`);
  }
}

export function validatePublication(input: PublicationValidationInput): void {
  const errors: string[] = [];
  if (input.archive.date !== input.expectedDate) errors.push(`日报日期 ${input.archive.date} 与运行日期 ${input.expectedDate} 不一致`);
  const articleIds = input.archive.articles.map((article) => article.id);
  if (new Set(articleIds).size !== articleIds.length) errors.push("日报含重复文章 ID");
  for (const article of input.archive.articles) {
    if (!hasCompleteChineseCopy(article)) errors.push(`公开文章缺少完整中文事实简介：${article.id}`);
    if (!/^https?:\/\//.test(article.link)) errors.push(`公开文章链接无效：${article.id}`);
  }
  const eventIds = input.events.events.map((event) => event.id);
  if (new Set(eventIds).size !== eventIds.length) errors.push("事件中心含重复事件 ID");
  for (const event of input.events.events) {
    if (!event.evidence.length || event.evidence.some((evidence) => !/^https?:\/\//.test(evidence.link))) errors.push(`事件缺少可追溯证据：${event.id}`);
    if (event.status === "已确证") {
      const contract = validateFacts({
        type: event.type,
        eventDate: event.eventDate ?? event.occurredAt,
        firstSeenAt: event.firstSeenAt,
        verifiedAt: event.lastVerifiedAt,
        materiallyChangedAt: event.lastUpdatedAt,
        public: true,
        evidence: event.evidence.map((item) => ({ id: item.link, link: item.link, source: item.source, grade: item.grade, publishedAt: item.publishedAt })),
      });
      if (!contract.valid) errors.push(`已确证事件违反公开事实契约：${event.id}（${contract.issues.map((issue) => issue.code).join(", ")}）`);
    }
  }
  const researchMinimum = Math.min(6, input.previousCompleteResearchCount ?? 0);
  if (input.research.length < researchMinimum) errors.push(`研究卡从 ${researchMinimum} 篇倒退到 ${input.research.length} 篇`);
  const decisionCardsById = new Map<string, ResearchDecisionCard[]>();
  for (const card of input.researchDecisionCards) {
    const paperId = String(card.identity.paperId.value);
    const cards = decisionCardsById.get(paperId) ?? [];
    cards.push(card);
    decisionCardsById.set(paperId, cards);
  }
  for (const record of input.research) {
    if (!hasCompleteChineseResearchCopy(record.article)) errors.push(`公开研究卡缺少完整中文标题或两句事实简介：${record.id}`);
    if (record.article.scholar?.isRetracted) errors.push(`公开研究卡包含已撤稿论文：${record.id}`);
    const cards = decisionCardsById.get(record.id) ?? [];
    if (cards.length === 0) errors.push(`公开研究记录缺少研究决策卡：${record.id}`);
    else if (cards.length > 1) errors.push(`公开研究记录存在重复研究决策卡：${record.id}`);
    else if (!cards[0]!.eligibleForTopResearch || cards[0]!.gates.length > 0) errors.push(`公开研究记录未通过研究发布门槛：${record.id}（${cards[0]!.gates.map((gate) => gate.code).join(", ") || "eligible=false"}）`);
  }
  if (/暂无中文简介|暂未生成中文摘要|中文简介暂未生成/.test(input.readme)) errors.push("README 出现公开占位简介");
  if (errors.length) throw new Error(`发布质量门槛未通过：\n- ${errors.join("\n- ")}`);
  if (input.watchlist) validateWatchlistRelease(input.watchlist);
}

const validIsoDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
const validTimestamp = (value: string): boolean => Number.isFinite(Date.parse(value));

/** Cross-file contract validation. Publication copy may evolve, but these
 * invariants must remain stable for the workflow, dashboard and reviewers. */
export function validatePublicationArtifacts(archive: DailyArchive, manifest: RunManifest, history?: RunHistory): void {
  const errors: string[] = [];
  if (manifest.schemaVersion !== 1) errors.push(`不支持的运行清单版本：${manifest.schemaVersion}`);
  if (!validIsoDate(manifest.date) || manifest.date !== archive.date) errors.push("运行清单与日报日期不一致");
  if (!manifest.runId.startsWith(`${manifest.date}-`)) errors.push("runId 未包含运行日期前缀");
  if (!validTimestamp(manifest.startedAt) || !validTimestamp(manifest.finishedAt)) errors.push("运行清单时间戳无效");
  else if (Date.parse(manifest.finishedAt) < Date.parse(manifest.startedAt)) errors.push("运行结束时间早于开始时间");
  if (!Number.isInteger(manifest.outputs) || manifest.outputs < 1) errors.push("输出文件计数无效");
  for (const [name, count] of Object.entries(manifest.quality)) {
    if (!Number.isInteger(count) || count < 0) errors.push(`质量计数无效：${name}`);
  }
  const publicTotal = manifest.quality.publicIndustryItems + manifest.quality.publicResearchItems;
  if (publicTotal !== archive.articles.length) errors.push(`公开条目计数不一致：manifest=${publicTotal}，archive=${archive.articles.length}`);
  if (manifest.quality.candidates !== (archive.candidates?.length ?? 0)) errors.push("候选条目计数与日报不一致");
  const sourceFailures = archive.sourceOutcomes?.filter((outcome) => outcome.status === "failure").length ?? 0;
  if (manifest.quality.sourceFailures !== sourceFailures) errors.push("失败信源计数与日报不一致");
  const sourceNames = archive.sourceOutcomes?.map((outcome) => outcome.source) ?? [];
  if (new Set(sourceNames).size !== sourceNames.length) errors.push("日报含重复信源状态");
  const serviceNames = manifest.services.map((service) => service.component);
  if (new Set(serviceNames).size !== serviceNames.length) errors.push("运行清单含重复服务状态");
  for (const service of manifest.services) {
    if (service.attempted < service.succeeded + service.failed) errors.push(`${service.component} 请求计数小于成功与失败之和`);
  }
  const archiveServices = new Map((archive.runtimeStatus ?? []).map((service) => [service.component, service]));
  for (const service of manifest.services) {
    const archived = archiveServices.get(service.component);
    if (!archived || archived.status !== service.status || archived.attempted !== service.attempted || archived.succeeded !== service.succeeded || archived.failed !== service.failed) {
      errors.push(`${service.component} 状态在运行清单与日报间不一致`);
    }
  }
  for (const article of [...archive.articles, ...(archive.candidates ?? [])]) {
    if (!article.id || !article.source || !/^https:\/\//.test(article.link)) errors.push(`文章基础契约不完整：${article.id || "unknown"}`);
    if (!validTimestamp(String(article.publishedAt)) || !validTimestamp(String(article.fetchedAt))) errors.push(`文章时间戳无效：${article.id || "unknown"}`);
  }
  if (history) {
    if (history.schemaVersion !== 1 || history.runs[0]?.runId !== manifest.runId) errors.push("运行历史没有以当前清单为最新记录");
    errors.push(...blockingHistoryContinuityErrors(history));
  }
  if (errors.length) throw new Error(`发布产物契约未通过：\n- ${errors.join("\n- ")}`);
}
