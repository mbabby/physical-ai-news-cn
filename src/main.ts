import { cp, mkdir, readdir, readFile, rm, writeFile as writeFileDirect } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_WINDOW_HOURS, MAX_DAILY_ARTICLES, SOURCES, X_SOURCES } from "./config.js";
import { fetchAlgoliaSource } from "./fetchers/hn.js";
import { fetchRssSource } from "./fetchers/rss.js";
import { fetchGithubReleasesSource, fetchSitemapSource, fetchWebPageSource, fetchYoutubeSource } from "./fetchers/structured.js";
import { fetchXSource } from "./fetchers/x.js";
import { filterAndRank, filterIndustryAndRank, publicHoldReasons } from "./filter.js";
import { formatMarkdown, formatWeeklyMarkdown } from "./formatter.js";
import { pulseArticleIds, selectIndustryPulse } from "./pulse.js";
import { CompatibleSummarizer, type SummaryLane } from "./summarize.js";
import { applyRegistryWeights, aggregateSourceCandidates, buildSourceRegistry, discoverSourceCandidates, formatReviewMarkdown, formatWatchlistMarkdown, selectWatchlistCandidates } from "./content-flywheel.js";
import { dynamicSources, resolveCandidateFeeds, sourceNetworkSummary, updateCandidateRegistry } from "./source-pipeline.js";
import { buildCompanyDossiers, buildRouteCompetitionMap, buildRouteIndex, formatCompanyDossiers, formatCompanyRadar, formatIndustryMap, formatRecentEvents, formatResearchCards, isPublishableResearch, primaryEntityForArticle, rankResearchArticles, routeCorrections, upsertEvents } from "./event-center.js";
import { formatResourcePage } from "./resource-radar.js";
import { buildDashboard, projectPublicationHealth } from "./site-data.js";
import { enrichResearchWithOpenAlex } from "./openalex.js";
import { rankResearchRecords, researchPromotionMarkdown, updateResearchRegistry } from "./research-registry.js";
import { formatCandidateCompanyReview, updateCandidateCompanies } from "./company-candidates.js";
import { formatCompanyEntityReview, updateCompanyEntityRegistry } from "./company-entities.js";
import { formatSourceNetwork } from "./source-network.js";
import { formatShareableSummary } from "./shareable-summary.js";
import { buildCommunityReviewSeeds, buildProjectMetrics, formatCommunityReviewQueue, formatHomepageStatus, formatWeeklyReport, stageWatchlistReviewIssueSeeds } from "./project-insights.js";
import type { Article, CandidateArticle, CandidateCompanyRegistry, CandidateSourceRegistry, CompanyEntityRegistry, CompanyProfile, DailyArchive, DigestResult, EventRecord, EventStore, IndustryPulse, ResearchRegistry, RouteCompetitionMap, RunHistory, RunManifest, RuntimeStatus, SourceConfig, SourceRegistry } from "./types.js";
import { isoWeek, readRecentDailyArchives, readRecentDailyArticles, selectWeekly } from "./weekly.js";
import { hasCompleteChineseCopy, newestKnownGoodById, preferKnownGoodArticles, recoverPublishedResearchRecords, withDeterministicChineseOfficialFallback } from "./publication.js";
import { FileTransaction, isArray, isObject, readJsonStrict, withFileLock } from "./runtime/storage.js";
import { shanghaiDailyDate, shanghaiDailyDateForTimestamp } from "./runtime/daily-date.js";
import { validateDecisionProductPublication, validatePublication } from "./runtime/validation.js";
import { buildPipelineHealth, updateRunHistory } from "./runtime/health.js";
import { buildEntityCoverage, formatEntityCoverage, validateEntitySourceBindings } from "./entity-catalog.js";
import { buildCandidateVerificationArtifact, formatCandidateVerificationReview, verificationIssueSeeds } from "./candidate-verification.js";
import type { CandidateVerificationArtifact } from "./candidate-verification.js";
import { buildEventAnomalyReport } from "./event-anomalies.js";
import { buildReviewCaseArtifact, reviewCaseAlerts, reviewCaseGenerator, reviewCaseMetrics, serializeReviewCaseArtifact } from "./review-cases.js";
import type { ReviewCaseArtifact, ReviewCaseGenerator } from "./review-cases.js";
import { buildCompanyClaimLedger, type CompanyClaimLedger } from "./company-claim-ledger.js";
import { buildBenchmarkResultLedger, type BenchmarkResultLedger } from "./benchmark-result-ledger.js";
import { buildDualLedgerMetrics, canonicalCompanyEventOwners, isBenchmarkResultLedgerArtifact, isCompanyClaimLedgerArtifact, validateDualLedgers } from "./dual-ledger.js";
import { selectTopResearchDecisionCards } from "./research-decision-card.js";
import { buildResearchIndustryRelationEdges } from "./research-industry-relations.js";
import type { RelationEvidenceCandidate } from "./research-industry-relations.js";
import {
  buildDecisionUnitArtifact,
  claimDecisionReference,
  decisionUnitId,
  eventDecisionReference,
  researchDecisionCardReference,
} from "./decision-units.js";
import type { DecisionFunnelTransition, DecisionUnitArtifact, DecisionUnitSeed } from "./decision-units.js";
import { buildReviewAssignmentArtifact } from "./review-assignment.js";
import type { ReviewAssignmentArtifact, ReviewOwner } from "./review-assignment.js";
import { buildAcceptedEvidenceEnrichmentTargets, buildEvidenceEnrichmentPlan } from "./evidence-enrichment-planner.js";
import type { EvidenceEnrichmentArtifact, EvidenceEnrichmentTarget } from "./evidence-enrichment-planner.js";
import { buildDomainHealth } from "./domain-health.js";
import { buildCompanyBoards } from "./company-boards.js";
import { derivePublication } from "./facts-contract.js";
import { buildThesisSeeds } from "./watchlist/seeds.js";
import { buildThesisSeedArtifact, migrateThesisSeeds, validateThesisDraftArtifact } from "./watchlist/migration.js";
import type { ThesisDraftArtifact } from "./watchlist/migration.js";
import { scoreThesisSeed, selectWatchlistSeeds } from "./watchlist/scoring.js";
import { WatchlistGenerator, type CanonicalFactExcerpt } from "./watchlist/generator.js";
import { buildCanonicalFactAtoms } from "./watchlist/validation.js";
import { buildWatchlistPreview, formatWatchlistPreviewMarkdown, stageWatchlistPreview, validateWatchlistPreviewArtifact, validateWatchlistPreviewRelease, type WatchlistPreviewArtifact } from "./watchlist/preview.js";
import { buildWatchlistPublicView, type WatchlistPublicView } from "./watchlist/public-view.js";
import { buildWatchlistChangePage } from "./watchlist/change-page.js";
import { buildWatchlistMetrics } from "./watchlist/metrics.js";
import { buildWatchlistFeedManifest } from "./watchlist/feeds.js";
import { formatWatchlistReadme } from "./watchlist/markdown.js";
import { buildWatchlistSnapshot } from "./watchlist/snapshot.js";
import { validateWatchlistSnapshotShape, type CompanyThesisArtifact, type WatchlistSnapshot } from "./watchlist/contracts.js";
import { mergeWatchlistThesisArtifact, stageWatchlistRelease } from "./watchlist/release-validation.js";
import { buildDecisionProductArtifact, buildDecisionProductRetentionReceipt, shouldDegradeResearchPassportProjection, stageDecisionProducts } from "./decision-products/materialize.js";
import { validateDecisionProductArtifact, type DecisionProductArtifact } from "./decision-products/contracts.js";
import { buildDecisionFeedManifest, renderDecisionFeed } from "./decision-products/subscriptions.js";
import { loadGrowthExperimentConfig } from "./top-signals-growth/contracts.js";
import { buildTopSignalsDraft, stageTopSignalsDraft } from "./top-signals-growth/materialize.js";
import { validatePublishedTopSignalsArtifact } from "./top-signals-growth/publish.js";
import type { PublishedTopSignalsArtifact } from "./top-signals-growth/render.js";
import {
  assertAcceptedEvidenceArtifact,
  assertCommunityTaskPublicArtifact,
  assertContributionLedgerArtifact,
  assertEvidenceIssueSnapshot,
  assertEvidenceTaskLedgerArtifact,
  assertEvidenceTaskSeedArtifact,
  migrateLegacyEvidenceIssueSnapshot,
  type AcceptedEvidenceArtifact,
  type CommunityTaskPublicArtifact,
  type ContributionLedgerArtifact,
  type EvidenceIssueSnapshot,
  type EvidenceTaskLedgerArtifact,
  type EvidenceTaskSeedArtifact,
} from "./community-evidence/contracts.js";
import { projectAcceptedEvidence } from "./community-evidence/contributions.js";
import { fetchEvidenceIssueSnapshot } from "./community-evidence/github-issues.js";
import { planEvidenceIssueActions } from "./community-evidence/task-ledger.js";
import { buildEvidenceTaskSeeds } from "./community-evidence/task-seeds.js";
import { buildCommunityEvidencePublication, type CommunityEvidencePublication } from "./community-evidence/publication.js";
import {
  assertAcceptedEvidenceRevalidationArtifact,
  revalidateAcceptedEvidence,
  type AcceptedEvidenceRevalidationArtifact,
  type AcceptedEvidenceRevalidationOptions,
} from "./community-evidence/revalidation.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pagesBaseUrl = "https://mbabby.github.io/physical-ai-news-cn";
const repositoryBaseUrl = "https://github.com/mbabby/physical-ai-news-cn";
const eventsStart = "<!-- EVENT_CENTER_START -->";
const eventsEnd = "<!-- EVENT_CENTER_END -->";
const companyStart = "<!-- COMPANY_RADAR_START -->";
const companyEnd = "<!-- COMPANY_RADAR_END -->";
const watchlistStart = "<!-- WATCHLIST_START -->";
const watchlistEnd = "<!-- WATCHLIST_END -->";
const researchStart = "<!-- RESEARCH_UPDATES_START -->";
const researchEnd = "<!-- RESEARCH_UPDATES_END -->";
const statusStart = "<!-- PROJECT_STATUS_START -->";
const statusEnd = "<!-- PROJECT_STATUS_END -->";

function exactArtifact<T>(assertArtifact: (value: unknown) => asserts value is T): (value: unknown) => value is T {
  return (value: unknown): value is T => {
    try { assertArtifact(value); return true; }
    catch { return false; }
  };
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateCommunityEvidenceProjection(input: {
  seeds: EvidenceTaskSeedArtifact;
  snapshot: EvidenceIssueSnapshot;
  ledger: EvidenceTaskLedgerArtifact;
  accepted: AcceptedEvidenceArtifact;
  contributions: ContributionLedgerArtifact;
  publicTasks: CommunityTaskPublicArtifact;
}): void {
  assertEvidenceTaskSeedArtifact(input.seeds);
  assertEvidenceIssueSnapshot(input.snapshot);
  assertEvidenceTaskLedgerArtifact(input.ledger);
  assertAcceptedEvidenceArtifact(input.accepted);
  assertContributionLedgerArtifact(input.contributions);
  assertCommunityTaskPublicArtifact(input.publicTasks);
  const generatedAt = input.ledger.generatedAt;
  if (input.seeds.generatedAt !== generatedAt || input.accepted.generatedAt !== generatedAt
    || input.contributions.generatedAt !== generatedAt || input.publicTasks.generatedAt !== generatedAt) {
    throw new Error("社区证据投影生成时钟不一致");
  }

  const seeds = new Map(input.seeds.seeds.map((seed) => [seed.id, seed]));
  const ledger = new Map(input.ledger.entries.map((entry) => [entry.taskId, entry]));
  const issues = new Map(input.snapshot.issues.map((issue) => [issue.taskId, issue]));
  const snapshotRequiredTaskIds = new Set([
    ...input.accepted.entries.map((entry) => entry.taskId),
    ...input.publicTasks.tasks.map((task) => task.id),
  ]);
  for (const entry of input.ledger.entries) {
    const seed = seeds.get(entry.taskId);
    if (seed && (seed.category !== entry.category || !sameValue(seed.subject, entry.subject)
      || seed.targetField !== entry.targetField || seed.materialVersion !== entry.materialVersion)) {
      throw new Error(`社区证据任务 ${entry.taskId} 与种子不一致`);
    }
    if (entry.issueNumber === null) {
      if (entry.state !== "ready" || !seed || issues.has(entry.taskId)) throw new Error(`社区证据 ready 任务 ${entry.taskId} 关系不一致`);
      continue;
    }
    const issue = issues.get(entry.taskId);
    if (!issue) {
      if (snapshotRequiredTaskIds.has(entry.taskId)
        || entry.issueUrl !== `https://github.com/${input.snapshot.repo}/issues/${entry.issueNumber}`) {
        throw new Error(`社区证据任务 ${entry.taskId} 缺少当前 Issue 关系`);
      }
      continue;
    }
    if (issue.number !== entry.issueNumber || issue.taskVersion !== entry.taskVersion
      || entry.issueUrl !== `https://github.com/${input.snapshot.repo}/issues/${issue.number}`
      || !issue.labels.includes(`evidence-task-${entry.category}`)) {
      throw new Error(`社区证据任务 ${entry.taskId} 与 Issue/版本关系不一致`);
    }
  }
  for (const issue of input.snapshot.issues) {
    const entry = ledger.get(issue.taskId);
    if (!entry || entry.issueNumber !== issue.number || entry.taskVersion !== issue.taskVersion) {
      throw new Error(`社区证据 Issue ${issue.number} 不能唯一解析到任务账本`);
    }
  }

  for (const entry of input.accepted.entries) {
    const task = ledger.get(entry.taskId);
    const issue = issues.get(entry.taskId);
    if (!task || !issue || task.state !== "accepted" || task.issueNumber !== entry.issueNumber
      || issue.number !== entry.issueNumber || issue.taskVersion !== task.taskVersion
      || task.category !== entry.category || !sameValue(task.subject, entry.subject) || task.targetField !== entry.targetField
      || !issue.acceptedEvidence.some((item) => item.contributor === entry.contributor && item.evidenceUrl === entry.evidenceUrl)) {
      throw new Error(`已采纳证据 ${entry.id} 与任务账本或 Issue 不一致`);
    }
  }

  for (const event of input.contributions.events) {
    const task = ledger.get(event.taskId);
    const issue = issues.get(event.taskId);
    if (!task || task.issueNumber !== event.issueNumber
      || (issue && (issue.number !== event.issueNumber || issue.taskVersion !== task.taskVersion))
      || task.category !== event.category
      || !sameValue(task.subject, event.subject) || task.targetField !== event.targetField
      || event.sourceUrl !== `https://github.com/${input.snapshot.repo}/issues/${event.issueNumber}`) {
      throw new Error(`社区贡献事件 ${event.id} 与任务账本或 Issue 不一致`);
    }
  }

  const pairIdentity = (value: { taskId: string; issueNumber: number; contributor: string; evidenceUrl: string }): string =>
    `${value.taskId}\n${value.issueNumber}\n${value.contributor}\n${value.evidenceUrl}`;
  const acceptedByPair = new Map(input.accepted.entries.map((entry) => [pairIdentity(entry), entry]));
  const historyByPair = new Map<string, ContributionLedgerArtifact["events"]>();
  for (const event of input.contributions.events) {
    const key = pairIdentity(event);
    const history = historyByPair.get(key) ?? [];
    history.push(event);
    historyByPair.set(key, history);
  }
  for (const [key, history] of historyByPair) {
    let active = false;
    let epochSubmitted = false;
    let epochAccepted = false;
    let epochPromoted = false;
    let lastTerminal: "corrected" | "withdrawn" | undefined;
    for (const event of history) {
      if (event.state === "submitted") {
        if (active || epochSubmitted) throw new Error(`社区贡献 ${key} 的 submitted 生命周期不合法`);
        epochSubmitted = true;
      } else if (event.state === "accepted") {
        if (epochAccepted) throw new Error(`社区贡献 ${key} 重复进入 accepted 生命周期`);
        epochAccepted = true;
        active = true;
      } else if (event.state === "promoted") {
        if (epochPromoted) throw new Error(`社区贡献 ${key} 重复进入 promoted 生命周期`);
        epochPromoted = true;
      } else {
        if (!epochAccepted) throw new Error(`社区贡献 ${key} 在未采纳时进入终止生命周期`);
        active = false;
        lastTerminal = event.state;
        epochSubmitted = false;
        epochAccepted = false;
        epochPromoted = false;
      }
    }
    if (epochPromoted && !epochAccepted) throw new Error(`社区贡献 ${key} 在未采纳时进入 promoted 生命周期`);
    const exemplar = history.at(-1)!;
    const issue = issues.get(exemplar.taskId);
    const currentPair = issue?.acceptedEvidence.some((item) => item.contributor === exemplar.contributor && item.evidenceUrl === exemplar.evidenceUrl) ?? false;
    const desired = issue?.labels.includes("source-withdrawn") ? "corrected"
      : issue?.labels.includes("accepted-evidence") ? "accepted" : undefined;
    const acceptedEntry = acceptedByPair.get(key);
    if (active) {
      if (!issue || !acceptedEntry || !currentPair || desired !== "accepted") {
        throw new Error(`社区贡献 ${key} 的活跃采纳生命周期与 Issue/accepted-evidence 不一致`);
      }
    } else if (acceptedEntry || (!issue && lastTerminal !== "corrected" && lastTerminal !== "withdrawn")
      || (currentPair && desired === "accepted")
      || (desired === "corrected" && lastTerminal !== "corrected")) {
      throw new Error(`社区贡献 ${key} 的终止生命周期与 Issue/accepted-evidence 不一致`);
    }
  }
  for (const entry of input.accepted.entries) {
    if (!historyByPair.has(pairIdentity(entry))) throw new Error(`已采纳证据 ${entry.id} 缺少贡献生命周期`);
  }

  const expectedPublicIds = input.ledger.entries
    .filter((entry) => (entry.state === "open" || entry.state === "contributed") && entry.issueNumber !== null)
    .map((entry) => entry.taskId).sort();
  if (!sameValue(input.publicTasks.tasks.map((task) => task.id).sort(), expectedPublicIds)) {
    throw new Error("公开社区任务与活跃任务账本集合不一致");
  }
  for (const item of input.publicTasks.tasks) {
    const task = ledger.get(item.id);
    const issue = issues.get(item.id);
    const seed = seeds.get(item.id);
    if (!task || !issue || task.issueNumber !== item.issueNumber || task.taskVersion !== item.version
      || task.state !== item.state || task.category !== item.category || !sameValue(task.subject, item.subject)
      || task.targetField !== item.targetField || (seed && (seed.contextZh !== item.contextZh || seed.generatedWeek !== item.generatedWeek))
      || task.issueUrl !== item.issueUrl) {
      throw new Error(`公开社区任务 ${item.id} 与种子、账本或 Issue 不一致`);
    }
  }

  const replanned = planEvidenceIssueActions({
    seeds: input.seeds,
    issues: input.snapshot,
    previousLedger: input.ledger,
    now: generatedAt,
  });
  if (!sameValue(replanned.ledger, input.ledger)) throw new Error("社区证据任务账本生命周期投影不一致");
  const replayed = projectAcceptedEvidence({
    issues: input.snapshot,
    taskLedger: input.ledger,
    previousAccepted: input.accepted,
    previousContributions: input.contributions,
    now: generatedAt,
  });
  if (!sameValue(replayed.accepted, input.accepted) || !sameValue(replayed.contributions, input.contributions)) {
    throw new Error("社区证据采纳或贡献生命周期投影不一致");
  }
}

export interface StageCommunityEvidenceArtifactsInput {
  root: string;
  transaction: Pick<FileTransaction, "stage">;
  seeds: EvidenceTaskSeedArtifact;
  now: Date;
  github?: {
    token?: string;
    repo?: string;
    fetchSnapshot?: () => Promise<EvidenceIssueSnapshot>;
  };
  revalidation?: {
    companies: CompanyProfile[];
    events: EventRecord[];
    companyClaimLedger: CompanyClaimLedger;
    researchDecisionCards: import("./research-decision-card.js").ResearchDecisionCard[];
    researchRecords: ResearchRegistry["records"];
    benchmarkResultLedger: BenchmarkResultLedger;
    decisionProducts: DecisionProductArtifact;
    pagesBaseUrl: string;
    sources: SourceConfig[];
    options?: AcceptedEvidenceRevalidationOptions;
  };
}

export interface StageCommunityEvidenceArtifactsResult {
  accepted: AcceptedEvidenceArtifact;
  enrichmentTargets: EvidenceEnrichmentTarget[];
  publication: CommunityEvidencePublication;
  status: RuntimeStatus;
  revalidation: AcceptedEvidenceRevalidationArtifact;
  revalidationStatus: RuntimeStatus;
}

/** Strictly project the GitHub review state and stage every community artifact
 * in the caller's daily transaction. Remote failure preserves the complete
 * prior projection instead of replacing public tasks with an empty view. */
export async function stageCommunityEvidenceArtifacts(input: StageCommunityEvidenceArtifactsInput): Promise<StageCommunityEvidenceArtifactsResult> {
  assertEvidenceTaskSeedArtifact(input.seeds);
  const now = input.now.toISOString();
  const reviewDir = join(input.root, "review");
  const previous = await Promise.all([
    readJsonStrict<EvidenceTaskSeedArtifact>(join(reviewDir, "evidence-task-seeds.json"), { optional: true, label: "社区证据任务种子", validate: exactArtifact(assertEvidenceTaskSeedArtifact) }),
    readJsonStrict<unknown>(join(reviewDir, "evidence-issue-snapshot.json"), { optional: true, label: "社区证据 Issue 快照" }),
    readJsonStrict<EvidenceTaskLedgerArtifact>(join(reviewDir, "evidence-task-ledger.json"), { optional: true, label: "社区证据任务账本", validate: exactArtifact(assertEvidenceTaskLedgerArtifact) }),
    readJsonStrict<AcceptedEvidenceArtifact>(join(reviewDir, "accepted-evidence.json"), { optional: true, label: "已采纳社区证据", validate: exactArtifact(assertAcceptedEvidenceArtifact) }),
    readJsonStrict<ContributionLedgerArtifact>(join(input.root, "community", "contributions.json"), { optional: true, label: "社区贡献账本", validate: exactArtifact(assertContributionLedgerArtifact) }),
    readJsonStrict<CommunityTaskPublicArtifact>(join(input.root, "site", "data", "community-tasks.json"), { optional: true, label: "公开社区任务", validate: exactArtifact(assertCommunityTaskPublicArtifact) }),
    readJsonStrict<AcceptedEvidenceRevalidationArtifact>(join(reviewDir, "accepted-evidence-revalidation.json"), { optional: true, label: "已采纳证据复核", validate: exactArtifact(assertAcceptedEvidenceRevalidationArtifact) }),
  ]);
  const [previousSeeds, previousSnapshotValue, previousLedger, previousAccepted, previousContributions, previousPublic, previousRevalidation] = previous;
  const previousSnapshot = previousSnapshotValue === undefined ? undefined : migrateLegacyEvidenceIssueSnapshot(previousSnapshotValue);
  const projectionCount = [previousSeeds, previousLedger, previousAccepted, previousContributions, previousPublic].filter(Boolean).length;
  if (projectionCount !== 0 && projectionCount !== 5) throw new Error("社区证据上一有效投影不完整；已停止发布且保留上一版。");
  const hasPreviousProjection = projectionCount === 5;
  if (previousRevalidation && !hasPreviousProjection) throw new Error("社区证据上一有效复核凭据缺少完整投影；已停止发布且保留上一版。");
  if (hasPreviousProjection) {
    if (!previousSnapshot) throw new Error("社区证据上一有效 Issue 快照缺失；已停止发布且保留上一版。");
    validateCommunityEvidenceProjection({
      seeds: previousSeeds!, snapshot: previousSnapshot, ledger: previousLedger!, accepted: previousAccepted!,
      contributions: previousContributions!, publicTasks: previousPublic!,
    });
  }

  const configured = Boolean(input.github?.token && input.github?.repo);
  let snapshot: EvidenceIssueSnapshot | undefined;
  let status: RuntimeStatus;
  let remoteFailed = false;
  if (configured) {
    try {
      snapshot = input.github?.fetchSnapshot
        ? await input.github.fetchSnapshot()
        : await fetchEvidenceIssueSnapshot({ repo: input.github!.repo!, token: input.github!.token!, now });
      assertEvidenceIssueSnapshot(snapshot);
      status = { component: "GitHub", status: "成功", attempted: 1, succeeded: 1, failed: 0, detail: "社区证据 Issue 快照已刷新并通过严格校验。" };
    } catch {
      remoteFailed = true;
      status = { component: "GitHub", status: "部分降级", attempted: 1, succeeded: 0, failed: 1, detail: "GitHub Issue 刷新失败；已保留上一有效社区任务与贡献投影。" };
    }
  } else {
    status = { component: "GitHub", status: "未配置", attempted: 0, succeeded: 0, failed: 0, detail: hasPreviousProjection
      ? "未配置 GitHub 上下文；已使用上一有效社区证据快照与投影。"
      : "未配置 GitHub 上下文；已初始化空的内部社区证据投影，未清除任何既有公开任务。" };
  }

  if (remoteFailed && !hasPreviousProjection) {
    throw new Error("GitHub Issue 刷新失败且没有上一有效社区证据投影；已停止发布。");
  }

  const serialize = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
  const performRevalidation = async (
    accepted: AcceptedEvidenceArtifact,
    runAt: Date,
    prior: AcceptedEvidenceRevalidationArtifact | undefined,
    options: AcceptedEvidenceRevalidationOptions,
  ) => {
    const runAtIso = runAt.toISOString();
    return revalidateAcceptedEvidence({
      accepted,
      previous: prior,
      companies: input.revalidation?.companies ?? [],
      events: input.revalidation?.events ?? [],
      companyClaimLedger: input.revalidation?.companyClaimLedger ?? { generatedAt: runAtIso, limit: 0, companies: [], metrics: { populatedFields: 0, totalFields: 0, fieldCompletenessRate: 1, staleClaimCount: 0, staleEvidenceCount: 0, eligibleEventCount: 0, attributedEventCount: 0, eventCoverageRate: 0, selectedCompanyCount: 0, companiesWithEligibleEvents: 0 } },
      researchDecisionCards: input.revalidation?.researchDecisionCards ?? [],
      researchRecords: input.revalidation?.researchRecords ?? [],
      benchmarkResultLedger: input.revalidation?.benchmarkResultLedger ?? { generatedAt: runAtIso, entries: [] },
      decisionProducts: input.revalidation?.decisionProducts ?? { schemaVersion: 1, generatedAt: runAtIso, periodStart: runAtIso.slice(0, 10), topSignals: [], companyCards: [], researchPassports: [], subscriptions: { generatedAt: runAtIso, entries: [] } },
      pagesBaseUrl: input.revalidation?.pagesBaseUrl ?? pagesBaseUrl,
      sources: input.revalidation?.sources ?? [],
      now: runAt,
    }, options);
  };
  const revalidationBaseline = previousRevalidation ?? (hasPreviousProjection
    ? (await performRevalidation(previousAccepted!, new Date(previousLedger!.generatedAt), undefined, { maxTargets: 0 })).artifact
    : undefined);
  if (!snapshot && hasPreviousProjection) {
    input.transaction.stage(join(reviewDir, "evidence-task-seeds.json"), serialize(previousSeeds));
    input.transaction.stage(join(reviewDir, "evidence-task-ledger.json"), serialize(previousLedger));
    input.transaction.stage(join(reviewDir, "accepted-evidence.json"), serialize(previousAccepted));
    input.transaction.stage(join(input.root, "community", "contributions.json"), serialize(previousContributions));
    input.transaction.stage(join(input.root, "site", "data", "community-tasks.json"), serialize(previousPublic));
    if (previousSnapshot) input.transaction.stage(join(reviewDir, "evidence-issue-snapshot.json"), serialize(previousSnapshot));
    input.transaction.stage(join(reviewDir, "accepted-evidence-revalidation.json"), serialize(revalidationBaseline));
    const publication = buildCommunityEvidencePublication({
      seeds: previousSeeds!, ledger: previousLedger!, accepted: previousAccepted!, contributions: previousContributions!,
      previousTasks: previousPublic!, repository: previousSnapshot!.repo, generatedAt: previousLedger!.generatedAt,
    });
    const revalidationStatus: RuntimeStatus = previousAccepted!.entries.length === 0
      ? {
        component: "EvidenceRevalidation", status: "成功", attempted: 0, succeeded: 0, failed: 0,
        detail: "上一有效社区投影没有已采纳证据，无需复核。",
      }
      : {
        component: "EvidenceRevalidation", status: "部分降级", attempted: previousAccepted!.entries.length, succeeded: 0,
        failed: previousAccepted!.entries.length,
        detail: "GitHub 快照未刷新；复核凭据与社区投影一起保留上一有效版本，未授权新的规范晋升。",
      };
    return { accepted: previousAccepted!, enrichmentTargets: buildAcceptedEvidenceEnrichmentTargets(previousAccepted!), publication, status, revalidation: revalidationBaseline!, revalidationStatus };
  }

  snapshot ??= previousSnapshot ?? { schemaVersion: 1, fetchedAt: now, repo: input.github?.repo ?? "mbabby/physical-ai-news-cn", issues: [] };
  assertEvidenceIssueSnapshot(snapshot);
  const emptyLedger: EvidenceTaskLedgerArtifact = { schemaVersion: 1, generatedAt: now, entries: [] };
  const emptyAccepted: AcceptedEvidenceArtifact = { schemaVersion: 1, generatedAt: now, entries: [] };
  const emptyContributions: ContributionLedgerArtifact = { schemaVersion: 1, generatedAt: now, events: [] };
  const planned = planEvidenceIssueActions({ seeds: input.seeds, issues: snapshot, previousLedger: previousLedger ?? emptyLedger, now });
  const baseProjection = projectAcceptedEvidence({
    issues: snapshot,
    taskLedger: planned.ledger,
    previousAccepted: previousAccepted ?? emptyAccepted,
    previousContributions: previousContributions ?? emptyContributions,
    now,
  });
  const revalidation = await performRevalidation(
    baseProjection.accepted,
    input.now,
    revalidationBaseline,
    input.revalidation?.options ?? { maxTargets: 0 },
  );
  const projection = projectAcceptedEvidence({
    issues: snapshot,
    taskLedger: planned.ledger,
    previousAccepted: baseProjection.accepted,
    previousContributions: baseProjection.contributions,
    revalidation: revalidation.artifact,
    now,
  });
  const publication = buildCommunityEvidencePublication({
    seeds: input.seeds,
    ledger: planned.ledger,
    accepted: projection.accepted,
    contributions: projection.contributions,
    previousTasks: previousPublic,
    repository: snapshot.repo,
    generatedAt: now,
  });
  const publicArtifact = publication.taskArtifact;
  assertEvidenceTaskLedgerArtifact(planned.ledger);
  assertAcceptedEvidenceArtifact(projection.accepted);
  assertContributionLedgerArtifact(projection.contributions);
  assertCommunityTaskPublicArtifact(publicArtifact);
  validateCommunityEvidenceProjection({
    seeds: input.seeds,
    snapshot,
    ledger: planned.ledger,
    accepted: projection.accepted,
    contributions: projection.contributions,
    publicTasks: publicArtifact,
  });
  input.transaction.stage(join(reviewDir, "evidence-task-seeds.json"), serialize(input.seeds));
  input.transaction.stage(join(reviewDir, "evidence-issue-snapshot.json"), serialize(snapshot));
  input.transaction.stage(join(reviewDir, "evidence-task-ledger.json"), serialize(planned.ledger));
  input.transaction.stage(join(reviewDir, "accepted-evidence.json"), serialize(projection.accepted));
  input.transaction.stage(join(reviewDir, "accepted-evidence-revalidation.json"), serialize(revalidation.artifact));
  input.transaction.stage(join(input.root, "community", "contributions.json"), serialize(projection.contributions));
  input.transaction.stage(join(input.root, "site", "data", "community-tasks.json"), serialize(publicArtifact));
  return { accepted: projection.accepted, enrichmentTargets: buildAcceptedEvidenceEnrichmentTargets(projection.accepted), publication, status, revalidation: revalidation.artifact, revalidationStatus: revalidation.status };
}

export type DailyGenerationFailureCode =
  | "corrupt-watchlist-current"
  | "corrupt-watchlist-history"
  | "corrupt-dual-ledger"
  | "corrupt-top-signals-publication"
  | "invalid-company-id"
  | "evidence-withdrawal"
  | "transaction-swap-failure"
  | "generation-failed";

/** Stable production failure receipt. The raw cause stays private. */
export class DailyGenerationError extends Error {
  readonly status = "failed" as const;

  constructor(readonly code: DailyGenerationFailureCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DailyGenerationError";
  }
}

function parseWindow(argv: string[]): number { const value = Number(argv[argv.indexOf("--hours") + 1]); return argv.includes("--hours") && Number.isFinite(value) && value > 0 ? value : DEFAULT_WINDOW_HOURS; }

export interface CliOptions {
  fixtureMode: boolean;
  fixtureRoot: string | undefined;
}

export function parseCliOptions(argv: string[]): CliOptions {
  const fixtureMode = argv.includes("--fixture") || argv.includes("--fixture-mode");
  const outputRootIndex = argv.indexOf("--output-root");
  const fixtureRootIndex = argv.indexOf("--fixture-root");
  const rootFlag = outputRootIndex >= 0 ? "--output-root" : "--fixture-root";
  const rootIndex = outputRootIndex >= 0 ? outputRootIndex : fixtureRootIndex;
  const fixtureRoot = rootIndex >= 0 ? argv[rootIndex + 1] : undefined;
  if (rootIndex >= 0 && (!fixtureRoot || !fixtureRoot.trim() || fixtureRoot.startsWith("--"))) throw new Error(`${rootFlag} requires a path`);
  if (fixtureRoot && !fixtureMode) throw new Error(`${rootFlag} requires --fixture`);
  return { fixtureMode, fixtureRoot };
}

function replaceSection(readme: string, start: string, end: string, content: string): string {
  const expression = new RegExp(`${start}[\\s\\S]*?${end}`);
  if (!expression.test(readme)) throw new Error(`README 缺少占位标记：${start}`);
  return readme.replace(expression, `${start}\n\n${content}\n\n${end}`);
}
function updateReadme(readme: string, events: EventStore, companies: CompanyProfile[], research: ResearchRegistry["records"], researchPoolSize: number, metrics: ReturnType<typeof buildProjectMetrics>, refreshedAt: Date, researchFallbackDate?: string, watchlist?: WatchlistPublicView): string {
  const withStatus = replaceSection(readme, statusStart, statusEnd, formatHomepageStatus(metrics, companies.length, researchPoolSize));
  const withEvents = replaceSection(withStatus, eventsStart, eventsEnd, formatRecentEvents(events.events, refreshedAt));
  const withWatchlist = replaceSection(withEvents, watchlistStart, watchlistEnd, watchlist ? formatWatchlistReadme(watchlist) : "");
  const withCompanies = replaceSection(withWatchlist, companyStart, companyEnd, formatCompanyRadar(companies, events.events, refreshedAt));
  return replaceSection(withCompanies, researchStart, researchEnd, formatResearchCards(research, researchFallbackDate));
}

async function readRegistry(path: string): Promise<SourceRegistry | undefined> {
  return readJsonStrict<SourceRegistry>(path, { optional: true, label: "信源注册表", validate: (value): value is SourceRegistry => isObject(value) && Array.isArray(value.sources) });
}
async function readCandidateRegistry(path: string): Promise<CandidateSourceRegistry | undefined> {
  return readJsonStrict<CandidateSourceRegistry>(path, { optional: true, label: "候选信源注册表", validate: (value): value is CandidateSourceRegistry => isObject(value) && Array.isArray(value.sources) });
}
async function readJson<T>(path: string): Promise<T | undefined> { return readJsonStrict<T>(path, { optional: true }); }

async function readWatchlistHistory(directory: string): Promise<WatchlistSnapshot[]> {
  let files: string[];
  try {
    files = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const snapshots = await Promise.all(files.filter((file) => file.endsWith(".json")).sort().map(async (file) => {
    try {
      const identity = /^(\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3]))-v([1-9]\d*)\.json$/.exec(file);
      if (!identity) throw new Error("Watchlist 历史快照文件名不符合规范身份");
      const snapshot = await readJsonStrict<WatchlistSnapshot>(join(directory, file), {
        label: `Watchlist 历史快照 ${file}`,
        validate: validateWatchlistSnapshotShape,
      });
      if (!snapshot || snapshot.week !== identity[1] || snapshot.snapshotVersion !== Number(identity[2])) {
        throw new Error("Watchlist 历史快照文件名与 payload 身份不一致");
      }
      return snapshot;
    } catch (error) {
      throw new DailyGenerationError("corrupt-watchlist-history", "Watchlist 历史快照损坏；已停止发布并保留上一版。", { cause: error });
    }
  }));
  return snapshots;
}

function hasWithdrawnWatchlistEvidence(theses: CompanyThesisArtifact, snapshots: WatchlistSnapshot[], events: EventRecord[]): boolean {
  const required = new Set(snapshots.flatMap((snapshot) => [...snapshot.forwardRadar, ...snapshot.validatedMomentum]
    .map((entry) => `${entry.thesisId}\0${entry.thesisVersion}`)));
  const eventById = new Map(events.map((event) => [event.id, event]));
  return theses.theses
    .filter((thesis) => required.has(`${thesis.thesisId}\0${thesis.thesisVersion}`))
    .some((thesis) => thesis.factReferenceIds.some((eventId) => {
      const event = eventById.get(eventId) as (EventRecord & { evidenceState?: "withdrawn" }) | undefined;
      return Boolean(event && derivePublication({ evidence: event.evidence, evidenceState: event.evidenceState }).evidenceState === "withdrawn");
    }));
}

async function restoreWatchlistCurrentFromHistory(root: string, history: WatchlistSnapshot[]): Promise<void> {
  const latest = [...history].sort((left, right) => left.week.localeCompare(right.week) || left.snapshotVersion - right.snapshotVersion).at(-1);
  if (!latest) return;
  const recovery = new FileTransaction("watchlist-current-recovery");
  recovery.stage(join(root, "watchlist", "current.json"), `${JSON.stringify(latest, null, 2)}\n`);
  try {
    await recovery.commit();
  } catch (error) {
    throw new DailyGenerationError("transaction-swap-failure", "Watchlist current 恢复事务失败；已保留不可变历史。", { cause: error });
  }
}

async function collect(sources: SourceConfig[], windowHours: number): Promise<DigestResult> {
  const results = await Promise.allSettled(sources.map((source) => {
    if (source.type === "rss") return fetchRssSource(source);
    if (source.type === "algolia") return fetchAlgoliaSource(source, windowHours);
    if (source.type === "webpage") return fetchWebPageSource(source);
    if (source.type === "sitemap") return fetchSitemapSource(source);
    if (source.type === "github-releases") return fetchGithubReleasesSource(source);
    if (source.type === "youtube") return fetchYoutubeSource(source);
    throw new Error("X 信源必须通过带凭据的行业脉搏流程抓取");
  }));
  const articles: Article[] = []; const failures: DigestResult["failures"] = []; const sourceOutcomes: DigestResult["sourceOutcomes"] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      const source = sources[index];
      articles.push(...result.value.map((article) => ({ ...article, sourceTier: source.tier })));
      sourceOutcomes.push({ source: source.name, status: "success", fetchedArticles: result.value.length }); return;
    }
    const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
    failures.push({ source: sources[index].name, reason }); sourceOutcomes.push({ source: sources[index].name, status: "failure", reason, fetchedArticles: 0 });
  });
  return { articles, failures, sourceOutcomes };
}

async function collectX(sources: SourceConfig[], windowHours: number, bearerToken?: string): Promise<DigestResult> {
  if (!bearerToken) return { articles: [], failures: [], sourceOutcomes: [] };
  const results = await Promise.allSettled(sources.map((source) => {
    if (source.type !== "x") throw new Error("行业脉搏只接受 X 信源");
    return fetchXSource(source, bearerToken);
  }));
  const articles: Article[] = []; const failures: DigestResult["failures"] = []; const sourceOutcomes: DigestResult["sourceOutcomes"] = [];
  results.forEach((result, index) => {
    const source = sources[index];
    if (result.status === "fulfilled") { articles.push(...result.value.map((article) => ({ ...article, sourceTier: source.tier }))); sourceOutcomes.push({ source: source.name, status: "success", fetchedArticles: result.value.length }); return; }
    const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
    failures.push({ source: source.name, reason }); sourceOutcomes.push({ source: source.name, status: "failure", reason, fetchedArticles: 0 });
  });
  return { articles, failures, sourceOutcomes };
}

type SummaryClient = Pick<CompatibleSummarizer, "summarize"> & { recordCacheHits?: (count: number, lane: SummaryLane) => void };
type DailySummarizer = SummaryClient & Pick<CompatibleSummarizer, "status">;

async function summarizeInSmallBatches(summarizer: SummaryClient, articles: Article[], lane: SummaryLane, batchSize = 2): Promise<Article[]> {
  const output: Article[] = [];
  for (let index = 0; index < articles.length; index += batchSize) {
    output.push(...await Promise.all(articles.slice(index, index + batchSize).map((article) => summarizer.summarize(article, lane))));
  }
  return output;
}

export async function summarizeWithCache(summarizer: SummaryClient, articles: Article[], historical: Article[], lane: SummaryLane = "industry"): Promise<Article[]> {
  const cached = newestKnownGoodById(historical);
  const pending = articles.filter((article) => {
    const prior = cached.get(article.id);
    return !prior || prior.title !== article.title || prior.excerpt !== article.excerpt;
  });
  summarizer.recordCacheHits?.(articles.length - pending.length, lane);
  const refreshed = new Map((await summarizeInSmallBatches(summarizer, pending, lane)).map((article) => [article.id, article]));
  return preferKnownGoodArticles(articles.map((article) => refreshed.get(article.id) ?? article), historical)
    .map(withDeterministicChineseOfficialFallback);
}

function mergePulseSummaries(pulse: IndustryPulse, summaries: Article[]): IndustryPulse {
  const byId = new Map(summaries.map((article) => [article.id, article]));
  return {
    viewpoints: pulse.viewpoints.map((article) => byId.get(article.id) ?? article),
    events: pulse.events.map((article) => byId.get(article.id) ?? article),
  };
}
function uniqueArticles(articles: Article[]): Article[] {
  const seen = new Set<string>();
  return articles.filter((article) => {
    if (seen.has(article.id)) return false;
    seen.add(article.id);
    return true;
  });
}

function candidateArticle(article: Article, reasons: string[]): CandidateArticle {
  const stage = reasons.includes("缺少完整中文事实简介") ? "待中文事实简介" : reasons.includes("公司主体未确认") ? "待公司主体确认" : "不适合公开资讯";
  return { ...article, stage, holdReasons: reasons };
}
function formatRuntimeStatus(statuses: RuntimeStatus[], outcomes: DigestResult["sourceOutcomes"], date: string): string {
  const sourceFailures = outcomes.filter((outcome) => outcome.status === "failure");
  const lines = [`# 运行状态 · ${date}`, "", "本文件用于排错，不是公开资讯内容。不会记录密钥、请求正文或模型供应商凭据。", "", "## 信源", ""];
  if (sourceFailures.length) lines.push(...sourceFailures.map((item) => `- 失败 · ${item.source}：${item.reason ?? "未知原因"}`));
  else lines.push("- 成功 · 本轮已启用信源均完成抓取。");
  lines.push("", "## 服务", "", ...statuses.map((item) => `- ${item.component} · **${item.status}** · 请求 ${item.attempted}，成功 ${item.succeeded}，失败 ${item.failed}。${item.detail}`));
  lines.push("", "## 提交", "", "- 提交状态由 GitHub Actions 的“Commit updated digest”步骤报告；该步骤会同时提交日报、事件、页面数据与首页。");
  return lines.join("\n");
}

/** Candidate verification has its own durable IDs, so retain it as a distinct
 * review stream rather than attempting to reverse-map it to a display title. */
function candidateVerificationReviewGenerator(artifact: CandidateVerificationArtifact): ReviewCaseGenerator {
  return {
    id: "candidate-verification",
    *generate() {
      const records = [...artifact.records]
        .filter((record) => record.status !== "已拒绝")
        .sort((a, b) => b.impactScore - a.impactScore || (a.nextReviewAt ?? "").localeCompare(b.nextReviewAt ?? "") || a.id.localeCompare(b.id))
        .slice(0, 20);
      for (const record of records) {
        const missingEvidence = [...new Set([...record.failureReasons, ...record.conflicts])];
        const nextAction = record.status === "可人工审核"
          ? "由人工确认是否采纳证据包；确认前不得写入公开事件中心"
          : record.nextReviewAt
            ? `在 ${record.nextReviewAt.slice(0, 10)} 前复核证据包`
            : "核对主体、原始证据与冲突字段";
        yield {
          type: "article" as const,
          subjectId: record.id,
          createdAt: record.firstSeenAt,
          impactScore: record.impactScore,
          evidenceCount: record.independentEvidenceCount,
          hasConflict: record.conflicts.length > 0,
          missingEvidence,
          nextAction,
        };
      }
    },
  };
}

function formatMetric(value: number | undefined, suffix = ""): string { return value === undefined ? "无样本" : `${value}${suffix}`; }

/** Private review receipt. It deliberately names SLO and ownership gaps but
 * contains no publication controls and is never consumed by homepage builders. */
function formatReviewCasesMarkdown(artifact: ReviewCaseArtifact): string {
  const active = artifact.cases.filter((item) => item.state === "open" || item.state === "in_progress").length;
  const alerts = (code: "overdue" | "unowned" | "no-next-action") => artifact.alerts.filter((item) => item.code === code);
  const metrics = artifact.metrics;
  const lines = [
    `# 审查工作项 · ${artifact.generatedAt.slice(0, 10)}`,
    "",
    "内部审查队列；候选进入本文件不等于获准公开，也不会自动写入事件中心、公司档案或首页。",
    "",
    "## 队列",
    "",
    `- 工作项：${artifact.cases.length}（活跃 ${active}）`,
    `- 已超时：${alerts("overdue").length}`, `- 无 owner：${alerts("unowned").length}`, `- 无 nextAction：${alerts("no-next-action").length}`,
    "",
    "## SLO",
    "",
    `- 首次响应 P90：${formatMetric(metrics.firstResponseP90Hours, " 小时")}`,
    `- 首次响应 SLO 达标：${metrics.sloComplianceRate.met}/${metrics.sloComplianceRate.eligible}（${formatMetric(metrics.sloComplianceRate.rate === undefined ? undefined : metrics.sloComplianceRate.rate * 100, "%")}）`,
    `- 到期 Top 20 探查覆盖：${metrics.dueTop20ProbeCoverage.covered}/${metrics.dueTop20ProbeCoverage.eligible}（${formatMetric(metrics.dueTop20ProbeCoverage.rate === undefined ? undefined : metrics.dueTop20ProbeCoverage.rate * 100, "%")}）`,
    `- 活跃积压年龄 P50 / P90 / 最大：${formatMetric(metrics.backlogAgeHours.p50, " 小时")} / ${formatMetric(metrics.backlogAgeHours.p90, " 小时")} / ${formatMetric(metrics.backlogAgeHours.max, " 小时")}`,
    "",
    "## 告警",
    "",
    ...(artifact.alerts.length ? artifact.alerts.map((alert) => `- **${alert.severity} · ${alert.code}**：${alert.message}`) : ["- 无告警。"]),
    "",
  ];
  return lines.join("\n");
}

export interface GenerateOptions {
  root?: string;
  now?: Date;
  topSignalsDraftNow?: Date;
  collect?: typeof collect;
  collectX?: typeof collectX;
  summarizer?: DailySummarizer;
  transaction?: FileTransaction;
  communityEvidenceSeeds?: EvidenceTaskSeedArtifact;
  fetchCommunityEvidenceSnapshot?: () => Promise<EvidenceIssueSnapshot>;
  fetchAcceptedEvidence?: typeof fetch;
  resolveAcceptedEvidenceHost?: (hostname: string) => Promise<string[]>;
  sleepAcceptedEvidence?: (ms: number) => Promise<void>;
  acceptedEvidenceTimeoutMs?: number;
}

/** Production daily orchestration with fixture seams for deterministic release verification. */
async function generateDaily(options: GenerateOptions): Promise<RunManifest> {
  const now = options.now ?? new Date();
  const dailyDate = shanghaiDailyDate(now);
  const topSignalsDraftNow = options.topSignalsDraftNow ?? now;
  const outputRoot = options.root ?? root;
  const startedAt = now;
  const transaction = options.transaction ?? new FileTransaction();
  const writeFile = async (path: string, content: string, _encoding?: string): Promise<void> => { transaction.stage(path, content); };
  const windowHours = parseWindow(process.argv.slice(2));
  const outputDir = join(outputRoot, "daily"); const weeklyDir = join(outputRoot, "weekly"); const sourcesDir = join(outputRoot, "sources"); const reviewDir = join(outputRoot, "review"); const resourcesDir = join(outputRoot, "resources"); const eventsDir = join(outputRoot, "events"); const researchDir = join(outputRoot, "research"); const routesDir = join(outputRoot, "routes"); const metricsDir = join(outputRoot, "metrics");
  await Promise.all([mkdir(outputDir, { recursive: true }), mkdir(weeklyDir, { recursive: true }), mkdir(sourcesDir, { recursive: true }), mkdir(reviewDir, { recursive: true }), mkdir(resourcesDir, { recursive: true }), mkdir(eventsDir, { recursive: true }), mkdir(researchDir, { recursive: true }), mkdir(routesDir, { recursive: true }), mkdir(metricsDir, { recursive: true })]);
  const candidatePath = join(sourcesDir, "candidates.json");
  const companyCandidatePath = join(eventsDir, "company-candidates.json");
  const companyEntityPath = join(eventsDir, "company-entities.json");
  let previousCompanyClaimLedger: CompanyClaimLedger | undefined;
  let previousBenchmarkResultLedger: BenchmarkResultLedger | undefined;
  let previousDecisionProductArtifact: DecisionProductArtifact | undefined;
  let publishedTopSignals: PublishedTopSignalsArtifact | undefined;
  try {
    [previousCompanyClaimLedger, previousBenchmarkResultLedger, previousDecisionProductArtifact] = await Promise.all([
      readJsonStrict<CompanyClaimLedger>(join(eventsDir, "company-claim-ledger.json"), {
        optional: true, label: "公司 Claim Ledger", validate: isCompanyClaimLedgerArtifact,
      }),
      readJsonStrict<BenchmarkResultLedger>(join(researchDir, "benchmark-result-ledger.json"), {
        optional: true, label: "Benchmark Result Ledger", validate: isBenchmarkResultLedgerArtifact,
      }),
      readJsonStrict<DecisionProductArtifact>(join(outputRoot, "site", "data", "decision-products.json"), {
        optional: true,
        label: "上一版 Decision Product",
        validate: (value): value is DecisionProductArtifact => {
          try { validateDecisionProductArtifact(value); return true; }
          catch { return false; }
        },
      }),
    ]);
  } catch (error) {
    throw new DailyGenerationError("corrupt-dual-ledger", "双账本或 Decision Product 历史状态损坏；已停止发布并保留上一版。", { cause: error });
  }
  try {
    publishedTopSignals = await readJsonStrict<PublishedTopSignalsArtifact>(join(outputRoot, "weekly", "top-signals", "latest.json"), {
      optional: true,
      label: "上一期已发布 Top Signals",
      validate: (value): value is PublishedTopSignalsArtifact => {
        try { validatePublishedTopSignalsArtifact(value); return true; }
        catch { return false; }
      },
    });
  } catch (error) {
    throw new DailyGenerationError("corrupt-top-signals-publication", "已发布 Top Signals 状态损坏；已停止日报并保留上一版公开内容。", { cause: error });
  }
  const candidateRegistry = await readCandidateRegistry(candidatePath);
  const companies = await readJsonStrict<CompanyProfile[]>(join(eventsDir, "companies.json"), { label: "公司档案", validate: isArray<CompanyProfile> }) ?? [];
  const invalidCompany = companies.find((company) => !company.entityId || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(company.entityId));
  if (invalidCompany) throw new DailyGenerationError("invalid-company-id", "公司档案包含不合法的规范 ID；已停止发布并保留上一版。");
  const catalogErrors = validateEntitySourceBindings(companies, [...SOURCES, ...X_SOURCES]);
  if (catalogErrors.length) throw new Error(`实体与信源目录不一致：\n- ${catalogErrors.join("\n- ")}`);
  const trackedCompanies = new Set(companies.map((company) => company.name));
  const priorRegistry = await readRegistry(join(sourcesDir, "registry.json"));
  const configuredSources = [...SOURCES, ...dynamicSources(candidateRegistry)];
  const registrySources = [...SOURCES, ...X_SOURCES, ...dynamicSources(candidateRegistry)];
  const activeSources = applyRegistryWeights(configuredSources, priorRegistry).filter((source) => source.status !== "已暂停");
  const activeXSources = applyRegistryWeights(X_SOURCES, priorRegistry).filter((source) => source.status !== "已暂停");
  await writeFile(join(resourcesDir, "entity-source-coverage.md"), formatEntityCoverage(buildEntityCoverage(companies, [...SOURCES, ...X_SOURCES]), now), "utf8");
  const collected = await (options.collect ?? collect)(activeSources, windowHours);
  const xCollected = await (options.collectX ?? collectX)(activeXSources, windowHours, process.env.X_BEARER_TOKEN);
  // Research has its own public gate: it needs a complete Chinese factual
  // brief, not a company identity. Corporate facts remain strict because the
  // homepage must never invent a company behind a funding headline.
  // Rank after splitting: a busy arXiv day must not use up the industry's
  // daily quota before funding, product and deployment sources are assessed.
  const industrySelected = filterIndustryAndRank(collected.articles, windowHours, windowHours > DEFAULT_WINDOW_HOURS ? 60 : MAX_DAILY_ARTICLES);
  // arXiv's submission calendar has gaps and one day's papers are too noisy
  // to represent a field. Merge live results with all rolling archives, then
  // refresh the pool's scholarly metadata and rerank it every day.
  const researchWindowHours = 30 * 24;
  const liveResearch = filterAndRank(collected.articles.filter((article) => article.source.startsWith("arXiv · Robotics")), researchWindowHours, 24);
  const recentArchives = await readRecentDailyArchives(outputDir, now, 30);
  const historicalArticles = recentArchives.flatMap((archive) => archive.articles.map((article) => ({ ...article, publishedAt: new Date(article.publishedAt), fetchedAt: new Date(article.fetchedAt) })));
  const cachedResearch = (await readRecentDailyArticles(outputDir, now, 30)).filter((article) => article.source.startsWith("arXiv · Robotics"));
  const previousResearch = await readJson<ResearchRegistry>(join(researchDir, "registry.json"));
  const researchCutoff = now.getTime() - researchWindowHours * 3_600_000;
  const registeredResearch = (previousResearch?.records ?? []).map((record) => ({ ...record.article, publishedAt: new Date(record.article.publishedAt), fetchedAt: new Date(record.article.fetchedAt) }))
    .filter((article) => article.publishedAt.getTime() >= researchCutoff);
  const latestCachedResearchDate = recentArchives.filter((archive) => archive.articles.some((article) => article.source.startsWith("arXiv · Robotics"))).sort((a, b) => b.date.localeCompare(a.date))[0]?.date;
  const researchCandidates = rankResearchArticles(uniqueArticles([...liveResearch, ...cachedResearch, ...registeredResearch])).slice(0, 36);
  const arxivFailed = collected.failures.some((failure) => failure.source.startsWith("arXiv · Robotics"));
  const researchFallbackDate = !liveResearch.length && arxivFailed ? latestCachedResearchDate : undefined;
  const xSelected = filterAndRank(xCollected.articles, windowHours, 5);
  const rawPulse = selectIndustryPulse(xSelected, industrySelected);
  const llmSettings = { apiKey: process.env.LLM_API_KEY, baseUrl: process.env.LLM_BASE_URL, model: process.env.LLM_MODEL };
  const summarizer = options.summarizer ?? new CompatibleSummarizer(llmSettings);
  const articles = await summarizeWithCache(summarizer, industrySelected, historicalArticles, "industry");
  const openAlex = await enrichResearchWithOpenAlex(researchCandidates, process.env.OPENALEX_API_KEY);
  // Twelve summaries absorb occasional LLM failures while leaving enough
  // complete cards to publish six. Any incomplete card remains private.
  const researchSelected = rankResearchArticles(openAlex.articles).slice(0, 12);
  const researchArticles = await summarizeWithCache(summarizer, researchSelected, [...registeredResearch, ...cachedResearch, ...historicalArticles], "research");
  // A public intelligence product must not oscillate between polished Chinese
  // cards and half-translated raw abstracts. The homepage falls back to the
  // latest complete cards; unfinished research stays in the candidate layer.
  const researchPool = uniqueArticles(preferKnownGoodArticles([...researchArticles, ...openAlex.articles, ...registeredResearch, ...cachedResearch], [...registeredResearch, ...cachedResearch, ...historicalArticles]));
  const researchRegistry = updateResearchRegistry(previousResearch, researchPool, now);
  const researchDecisionCards = selectTopResearchDecisionCards(researchRegistry.records, { now });
  const eligibleResearchIds = new Set(researchDecisionCards.filter((card) => card.eligibleForTopResearch && card.gates.length === 0).map((card) => String(card.identity.paperId.value)));
  const freshlyRankedResearch = rankResearchRecords(researchRegistry.records).filter((record) => isPublishableResearch(record.article) && eligibleResearchIds.has(record.id));
  // The daily archives are the actual publication history. The registry may
  // temporarily lose complete copy when a provider returns a poorer refresh,
  // so using only the registry as the baseline allowed the homepage to shrink
  // from three cards to two across two otherwise successful runs.
  const archivedPublicRecords = recoverPublishedResearchRecords(recentArchives, previousResearch?.records ?? []);
  const registryPublicRecords = (previousResearch?.records ?? []).filter((record) => isPublishableResearch(record.article) && !record.article.scholar?.isRetracted && eligibleResearchIds.has(record.id))
    .map((record) => ({ ...record, article: { ...record.article, publishedAt: new Date(record.article.publishedAt), fetchedAt: new Date(record.article.fetchedAt) } }));
  const previousPublicRecords = [...new Map([...archivedPublicRecords, ...registryPublicRecords].map((record) => [record.id, record])).values()];
  const previousById = new Map(previousPublicRecords.map((record) => [record.id, record]));
  const fallbackOrder = rankResearchArticles(previousPublicRecords.filter((record) => eligibleResearchIds.has(record.id)).map((record) => ({ ...record.article, publishedAt: new Date(record.article.publishedAt), fetchedAt: new Date(record.article.fetchedAt) })))
    .flatMap((article) => previousById.get(article.id) ? [previousById.get(article.id)!] : []);
  const publicResearchRecords = [...new Map([...freshlyRankedResearch, ...fallbackOrder].map((record) => [record.id, record])).values()].slice(0, 6);
  const shownResearchIds = new Set(publicResearchRecords.map((record) => record.id));
  researchRegistry.records.forEach((record) => { if (shownResearchIds.has(record.id)) record.lastShownAt = now.toISOString(); });
  const publicResearch = publicResearchRecords.map((record) => record.article);
  const relationEvidenceCandidates = await readJson<RelationEvidenceCandidate[]>(join(reviewDir, "research-industry-evidence.json")) ?? [];
  const researchIndustryRelations = buildResearchIndustryRelationEdges(researchRegistry.records, companies, relationEvidenceCandidates, { now });
  const hasFundingCrossEvidence = (article: Article): boolean => {
    if (article.kind !== "投融资" || article.sourceTier === "官方公司与实验室") return true;
    const entity = primaryEntityForArticle(article, companies);
    if (!entity) return false;
    const articleHost = (() => { try { return new URL(article.link).hostname; } catch { return article.link; } })();
    return articles.some((other) => {
      if (other.id === article.id || other.kind !== "投融资" || other.sourceTier === "线索发现层") return false;
      const otherHost = (() => { try { return new URL(other.link).hostname; } catch { return other.link; } })();
      return otherHost !== articleHost && primaryEntityForArticle(other, companies) === entity;
    });
  };
  const holdReasonsForCompanyArticle = (article: Article) => {
    const reasons = publicHoldReasons(article, trackedCompanies.has(primaryEntityForArticle(article, companies) ?? ""));
    if (article.kind === "投融资" && article.sourceTier === "权威产业媒体" && !hasFundingCrossEvidence(article)) reasons.push("融资缺少一手或独立媒体交叉证据");
    return reasons;
  };
  const publicArticles = articles.filter((article) => holdReasonsForCompanyArticle(article).length === 0);
  const heldArticles = articles.filter((article) => holdReasonsForCompanyArticle(article).length > 0).map((article) => candidateArticle(article, holdReasonsForCompanyArticle(article)));
  const eventPath = join(eventsDir, "index.json");
  const eventStore = upsertEvents(await readJson<EventStore>(eventPath), publicArticles, now, companies);
  await writeFile(eventPath, JSON.stringify(eventStore, null, 2) + "\n", "utf8");
  const companyDossiers = buildCompanyDossiers(companies, eventStore.events);
  await writeFile(join(eventsDir, "company-dossiers.json"), JSON.stringify(companyDossiers, null, 2) + "\n", "utf8");
  await writeFile(join(eventsDir, "route-index.json"), JSON.stringify(buildRouteIndex(companies, eventStore.events), null, 2) + "\n", "utf8");
  const previousRouteMap = await readJson<RouteCompetitionMap>(join(routesDir, "competition.json"));
  const routeMap = buildRouteCompetitionMap(eventStore.events, companies, now);
  const corrections = routeCorrections(previousRouteMap, routeMap);
  await writeFile(join(routesDir, "competition.json"), JSON.stringify(routeMap, null, 2) + "\n", "utf8");
  await writeFile(join(routesDir, "corrections.json"), JSON.stringify(corrections, null, 2) + "\n", "utf8");
  await writeFile(join(reviewDir, "route-corrections.md"), ["# 路线图纠错记录", "", ...(corrections.length ? corrections.map((item) => `- ${item.date.slice(0, 10)} · ${item.route} · ${item.company} · ${item.kind}：${item.detail}`) : ["- 本轮没有路线结论变化。"]), ""].join("\n"), "utf8");
  await mkdir(join(outputRoot, "site", "data"), { recursive: true });
  await writeFile(join(researchDir, "registry.json"), JSON.stringify(researchRegistry, null, 2) + "\n", "utf8");
  await writeFile(join(researchDir, "decision-cards.json"), JSON.stringify({ generatedAt: now.toISOString(), cards: researchDecisionCards }, null, 2) + "\n", "utf8");
  await writeFile(join(researchDir, "industry-relations.json"), JSON.stringify(researchIndustryRelations, null, 2) + "\n", "utf8");
  await writeFile(join(reviewDir, "research-industry-relation-metrics.json"), JSON.stringify({
    schemaVersion: 1,
    generatedAt: researchIndustryRelations.generatedAt,
    metrics: researchIndustryRelations.metrics,
  }, null, 2) + "\n", "utf8");
  await writeFile(join(resourcesDir, "research-promotion.md"), researchPromotionMarkdown(researchRegistry) + "\n", "utf8");
  await writeFile(join(resourcesDir, "companies.md"), formatCompanyDossiers(companyDossiers) + "\n", "utf8");
  await writeFile(join(resourcesDir, "industry-landscape-and-tech-routes.md"), formatIndustryMap(eventStore.events, companies), "utf8");
  const resourceCatalog = await readJson<Record<"models" | "datasets" | "tools", Array<{ name: string; link: string; description: string; group: string; rank: number }>>>(join(resourcesDir, "resource-catalog.json"));
  if (resourceCatalog) {
    const radarArticles = [...publicArticles, ...researchArticles, ...cachedResearch];
    await Promise.all([
      writeFile(join(resourcesDir, "models-and-open-source.md"), formatResourcePage("models", resourceCatalog, radarArticles, now), "utf8"),
      writeFile(join(resourcesDir, "datasets-and-benchmarks.md"), formatResourcePage("datasets", resourceCatalog, radarArticles, now), "utf8"),
      writeFile(join(resourcesDir, "simulation-and-tools.md"), formatResourcePage("tools", resourceCatalog, radarArticles, now), "utf8"),
    ]);
  }
  const pulseCandidates = uniqueArticles([...rawPulse.viewpoints, ...rawPulse.events.filter((event) => !industrySelected.some((article) => article.id === event.id))]);
  const pulseSummaries = await summarizeWithCache(summarizer, pulseCandidates, [...articles, ...historicalArticles], "pulse");
  const summarizedPulse = mergePulseSummaries(rawPulse, [...articles, ...pulseSummaries]);
  const pulse: IndustryPulse = {
    viewpoints: summarizedPulse.viewpoints.filter((article) => publicHoldReasons(article, true, false).length === 0),
    events: summarizedPulse.events.filter((article) => holdReasonsForCompanyArticle(article).length === 0),
  };
  const heldPulse = [...summarizedPulse.viewpoints.filter((article) => publicHoldReasons(article, true, false).length > 0).map((article) => candidateArticle(article, publicHoldReasons(article, true, false))), ...summarizedPulse.events.filter((article) => holdReasonsForCompanyArticle(article).length > 0).map((article) => candidateArticle(article, holdReasonsForCompanyArticle(article)))];
  const visibleArticles = publicArticles.filter((article) => !pulseArticleIds(pulse).has(article.id));
  const path = join(outputDir, `${dailyDate}.md`);
  const markdown = formatMarkdown(visibleArticles, windowHours, [...collected.failures, ...xCollected.failures], now, pulse, publicArticles.length, sourceNetworkSummary(candidateRegistry, registrySources.length), publicResearch);
  await writeFile(path, markdown, "utf8");
  const discoveredSources = await resolveCandidateFeeds(discoverSourceCandidates(collected.articles, configuredSources));
  const heldResearch = researchArticles
    .filter((article) => !isPublishableResearch(article))
    .map((article) => candidateArticle(article, publicHoldReasons(article, true, false)));
  // The JSON archive is the source for public pages. Keep it as strict as the
  // homepage: incomplete or unverified material belongs only in candidates.
  const archiveArticles = uniqueArticles([...publicArticles, ...publicResearch]);
  const candidates = uniqueArticles([...heldArticles, ...heldPulse, ...heldResearch]).map((article) => article as CandidateArticle);
  const statuses: RuntimeStatus[] = [summarizer.status(), openAlex.status];
  const researchCorrections = researchRegistry.records.flatMap((record) => record.changes.filter((change) => shanghaiDailyDateForTimestamp(change.date) === dailyDate && (change.kind === "撤稿" || change.kind === "版本更新")).map((change) => ({ source: record.article.source, reason: `${change.kind}：${record.article.title}`, date: dailyDate })));
  const archive: DailyArchive = { date: dailyDate, articles: archiveArticles, industryPulse: pulse, sourceOutcomes: [...collected.sourceOutcomes, ...xCollected.sourceOutcomes], candidates, runtimeStatus: statuses, discoveredSources, sourceCorrections: researchCorrections };
  const archives = [...recentArchives.filter((item) => item.date !== archive.date), archive].sort((a, b) => a.date.localeCompare(b.date));
  const weeklyArticles = archives.flatMap((item) => item.articles.map((article) => ({ ...article, publishedAt: new Date(article.publishedAt), fetchedAt: new Date(article.fetchedAt) })));
  const weekly = selectWeekly(weeklyArticles, 10);
  const week = isoWeek(now); const weeklyMarkdown = formatWeeklyMarkdown(weekly, week);
  await writeFile(join(weeklyDir, `${week}.md`), weeklyMarkdown, "utf8");
  await writeFile(join(weeklyDir, "shareable-summary.md"), formatShareableSummary(eventStore, publicResearch, week), "utf8");
  const companyCandidates = updateCandidateCompanies(await readJson<CandidateCompanyRegistry>(companyCandidatePath), candidates, now, companies);
  // Secondary verification is an internal-only evidence queue. It consumes
  // held candidates from the rolling archive, but never writes public events
  // or company profiles. A corrupt/legacy queue must not stop the daily
  // intelligence product; the deterministic evidence pool can rebuild it.
  const verificationPath = join(reviewDir, "candidate-verification.json");
  const previousVerification = await readJson<CandidateVerificationArtifact>(verificationPath).catch(() => undefined);
  const verificationArchives = [...(await readRecentDailyArchives(outputDir, now, 60)).filter((item) => item.date !== archive.date), archive];
  const verificationInput = uniqueArticles(verificationArchives.flatMap((item) => (item.candidates ?? []).map((article) => ({
    ...article,
    publishedAt: new Date(article.publishedAt),
    fetchedAt: new Date(article.fetchedAt),
  }))));
  // Active enrichment reuses the already-collected rolling corpus. It never
  // performs an unbounded search here: configured source collection remains
  // the only network boundary, while verification records every probe target,
  // result and retry reason for audit.
  const verificationEvidencePool = uniqueArticles([
    ...verificationArchives.flatMap((item) => [...item.articles, ...(item.candidates ?? [])].map((article) => ({
      ...article,
      publishedAt: new Date(article.publishedAt),
      fetchedAt: new Date(article.fetchedAt),
      eventDate: article.eventDate ? new Date(article.eventDate) : undefined,
    }))),
    ...collected.articles,
    ...xCollected.articles,
  ]);
  const candidateVerification = buildCandidateVerificationArtifact(previousVerification, verificationInput, companies, now, {
    evidencePool: verificationEvidencePool,
    sources: registrySources,
    maxEnrichmentAttempts: 20,
  });
  await writeFile(verificationPath, JSON.stringify(candidateVerification, null, 2) + "\n", "utf8");
  await writeFile(join(reviewDir, "candidate-verification.md"), formatCandidateVerificationReview(candidateVerification) + "\n", "utf8");
  await writeFile(join(reviewDir, "candidate-verification-issue-seeds.json"), JSON.stringify({
    generatedAt: candidateVerification.generatedAt,
    seeds: verificationIssueSeeds(candidateVerification),
  }, null, 2) + "\n", "utf8");
  const companyClaimLedger = buildCompanyClaimLedger(companies, eventStore.events, { now, previous: previousCompanyClaimLedger });
  const benchmarkResultLedger = buildBenchmarkResultLedger(researchRegistry.records, researchDecisionCards, { now, previous: previousBenchmarkResultLedger });
  validateDualLedgers({
    company: companyClaimLedger,
    benchmark: benchmarkResultLedger,
    companyIds: new Set(companies.map((company) => company.entityId).filter((value): value is string => Boolean(value))),
    companyEventOwners: canonicalCompanyEventOwners(companies, eventStore.events),
    paperIds: new Set(researchRegistry.records.map((record) => record.id)),
    decisionCards: researchDecisionCards,
    expectedGeneratedAt: now.toISOString(),
  });
  const evidenceTaskSeeds = options.communityEvidenceSeeds ?? buildEvidenceTaskSeeds({
    generatedAt: now.toISOString(),
    generatedWeek: isoWeek(now),
    companyCandidates,
    events: eventStore,
    researchRecords: researchRegistry.records,
    researchCards: researchDecisionCards,
  });
  // Build public data after verification so “正在发生” reflects evidence
  // found in this run instead of the previous review artifact.
  const dualLedgerMetrics = buildDualLedgerMetrics(companyClaimLedger, benchmarkResultLedger);
  const companyBoards = buildCompanyBoards(companies, eventStore.events, {
    now,
    claimLedger: companyClaimLedger,
    minimumSampleSize: 10,
    limit: 5,
  });
  const watchlistSeeds = buildThesisSeeds({
    companies,
    events: eventStore.events,
    boards: companyBoards,
    claimLedger: companyClaimLedger,
    generatedAt: now.toISOString(),
  });
  const previousWatchlistDrafts = await readJsonStrict<ThesisDraftArtifact>(join(reviewDir, "watchlist-drafts.json"), {
    optional: true,
    label: "内部观察名单草稿",
    validate: validateThesisDraftArtifact,
  });
  const watchlistDrafts = migrateThesisSeeds(previousWatchlistDrafts, watchlistSeeds, {
    generatedAt: now.toISOString(),
    methodologyVersion: "v1",
  });
  await writeFile(join(reviewDir, "watchlist-seeds.json"), JSON.stringify(buildThesisSeedArtifact(watchlistDrafts, watchlistSeeds), null, 2) + "\n", "utf8");
  await writeFile(join(reviewDir, "watchlist-drafts.json"), JSON.stringify(watchlistDrafts, null, 2) + "\n", "utf8");
  const selectedWatchlistSeeds = selectWatchlistSeeds(watchlistSeeds.map((seed) => scoreThesisSeed(seed, { now })), {
    totalLimit: 10,
    perTrackTarget: 5,
    maxRouteShare: 0.4,
  });
  const previousWatchlistPreview = await readJsonStrict<WatchlistPreviewArtifact>(join(reviewDir, "watchlist-preview.json"), {
    optional: true,
    label: "内部观察名单预览",
    validate: validateWatchlistPreviewArtifact,
  });
  const canonicalWatchlistFacts = Object.fromEntries(eventStore.events.map((event): [string, CanonicalFactExcerpt] => [event.id, {
    excerpt: [event.title, ...event.facts].join("；"),
    officialNames: [...new Set([event.primaryEntity, event.productDeployment?.product].filter((value): value is string => Boolean(value)))],
    factAtoms: buildCanonicalFactAtoms([event]),
  }]));
  const watchlistGenerator = new WatchlistGenerator(llmSettings, canonicalWatchlistFacts, { now: () => now });
  const watchlistPreview = await buildWatchlistPreview({
    selected: selectedWatchlistSeeds,
    companies,
    canonicalEvents: eventStore.events,
    claimLedger: companyClaimLedger,
    previous: previousWatchlistPreview,
    generator: watchlistGenerator,
    now,
  });
  stageWatchlistPreview(transaction, reviewDir, watchlistPreview.preview);
  statuses.push(watchlistPreview.status);
  if (!validateWatchlistPreviewArtifact(watchlistPreview.preview)) throw new Error("Watchlist 内部预览不符合发布前契约");
  validateWatchlistPreviewRelease({
    preview: watchlistPreview.preview,
    markdown: formatWatchlistPreviewMarkdown(watchlistPreview.preview),
    manifestFinishedAt: now.toISOString(),
    manifestServices: statuses,
    archiveServices: archive.runtimeStatus ?? [],
  });
  const watchlistDir = join(outputRoot, "watchlist");
  const watchlistHistory = await readWatchlistHistory(join(watchlistDir, "history"));
  let previousWatchlistSnapshot: WatchlistSnapshot | undefined;
  try {
    previousWatchlistSnapshot = await readJsonStrict<WatchlistSnapshot>(join(watchlistDir, "current.json"), {
      optional: true,
      label: "公开 Watchlist 快照",
      validate: validateWatchlistSnapshotShape,
    });
  } catch (error) {
    await restoreWatchlistCurrentFromHistory(outputRoot, watchlistHistory);
    throw new DailyGenerationError("corrupt-watchlist-current", "Watchlist current 快照损坏；已停止发布并保留上一版。", { cause: error });
  }
  const previousPublicTheses = await readJsonStrict<CompanyThesisArtifact>(join(watchlistDir, "theses.json"), {
    optional: true,
    label: "公开 Watchlist 判断",
  });
  if (Boolean(previousWatchlistSnapshot) !== Boolean(previousPublicTheses)) {
    throw new Error("Watchlist 公开工件不完整；已停止发布且保留上一版。");
  }
  if (previousWatchlistSnapshot && previousPublicTheses
    && hasWithdrawnWatchlistEvidence(previousPublicTheses, [...watchlistHistory, previousWatchlistSnapshot], eventStore.events)) {
    throw new DailyGenerationError("evidence-withdrawal", "Watchlist 规范证据已撤回；已停止发布并保留上一版。");
  }
  const methodologyVersions = [...new Set(watchlistPreview.preview.theses.map((thesis) => thesis.methodologyVersion))];
  if (methodologyVersions.length > 1) throw new Error("Watchlist 预览包含多个方法论版本");
  const watchlistWeek = isoWeek(now);
  const priorWeek = isoWeek(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1_000));
  const previousWeekBaseline = watchlistHistory
    .filter((snapshot) => snapshot.week === priorWeek)
    .sort((left, right) => right.snapshotVersion - left.snapshotVersion)[0];
  const routeByCompanyId = new Map([...selectedWatchlistSeeds.forwardRadar, ...selectedWatchlistSeeds.validatedMomentum]
    .map((seed) => [seed.companyId, seed.routes[0]] as const));
  const watchlistSnapshot = buildWatchlistSnapshot({
    theses: watchlistPreview.preview.theses,
    previous: previousWatchlistSnapshot,
    previousWeekBaseline,
    week: watchlistWeek,
    methodologyVersion: methodologyVersions[0] ?? previousWatchlistSnapshot?.methodologyVersion ?? "v1",
    generatedAt: now.toISOString(),
    primaryRouteByCompanyId: Object.fromEntries(watchlistPreview.preview.theses.map((thesis) => {
      const route = routeByCompanyId.get(thesis.companyId);
      if (!route) throw new Error(`Watchlist 缺少公司 ${thesis.companyId} 的主路线`);
      return [thesis.companyId, route];
    })),
    routeShareExceptionReason: "当前达到公开门槛的样本量有限，暂保留路线集中度并在后续周次复核。",
  });
  const watchlistTheses = mergeWatchlistThesisArtifact({
    snapshot: watchlistSnapshot,
    histories: watchlistHistory,
    previous: previousPublicTheses,
    candidates: watchlistPreview.preview.theses,
  });
  const watchlistView = buildWatchlistPublicView({
    snapshot: watchlistSnapshot,
    thesisArtifact: watchlistTheses,
    companies,
    events: eventStore.events,
  });
  const watchlistChangePageViews = [
    watchlistView,
    ...watchlistHistory.map((snapshot) => buildWatchlistPublicView({
      snapshot,
      thesisArtifact: watchlistTheses,
      companies,
      events: eventStore.events,
    })),
  ];
  const watchlistChangePage = buildWatchlistChangePage({
    current: watchlistSnapshot,
    snapshots: [...watchlistHistory, watchlistSnapshot],
    views: watchlistChangePageViews,
  });
  const decisionSeeds: DecisionUnitSeed[] = [
    ...eventStore.events
      .filter((event) => event.status !== "已归档" && event.status !== "待复核")
      .map((event) => ({ actorId: "public-intelligence", decisionKey: `event:${event.id}`, references: [eventDecisionReference(event.id)] })),
    ...researchDecisionCards
      .filter((card) => card.eligibleForTopResearch && card.identity.paperId.value !== "unknown")
      .map((card) => ({
        actorId: "public-intelligence",
        decisionKey: `research:${card.identity.paperId.value}`,
        references: [researchDecisionCardReference(String(card.identity.paperId.value))],
      })),
    ...companyClaimLedger.companies.flatMap((company) => company.claims
      .filter((claim) => claim.evidenceState === "verified" && claim.evidenceIds.length > 0)
      .map((claim) => ({
        actorId: "public-intelligence",
        decisionKey: `claim:${company.companyId}:${claim.claimType}`,
        references: [claimDecisionReference({ companyId: company.companyId, claimType: claim.claimType, evidenceIds: claim.evidenceIds })],
      }))),
  ];
  const decisionTransitions: DecisionFunnelTransition[] = decisionSeeds.map((seed) => ({
    unitId: decisionUnitId(seed.actorId, seed.decisionKey),
    eventId: `${decisionUnitId(seed.actorId, seed.decisionKey)}:public-shortlist`,
    toStage: "shortlisted",
    actorId: "daily-pipeline",
    at: now.toISOString(),
    detail: "Qualified fact reference entered the public decision shortlist",
  }));
  const previousDecisionUnits = await readJsonStrict<DecisionUnitArtifact>(join(reviewDir, "decision-units.json"), {
    optional: true,
    label: "用户决策单元",
    validate: (value): value is DecisionUnitArtifact => isObject(value) && value.schemaVersion === 1 && Array.isArray(value.units),
  });
  const decisionUnits = buildDecisionUnitArtifact(previousDecisionUnits, decisionSeeds, decisionTransitions, now);
  await writeFile(join(reviewDir, "decision-units.json"), JSON.stringify(decisionUnits, null, 2) + "\n", "utf8");
  const decisionProductInput = {
    generatedAt: now,
    events: eventStore.events,
    companies,
    companyClaimLedger,
    researchRecords: researchRegistry.records,
    researchDecisionCards,
    benchmarkResultLedger,
    watchlist: watchlistView,
    researchPassportProjectionDegraded: shouldDegradeResearchPassportProjection({
      previousArtifact: previousDecisionProductArtifact,
      researchDecisionCards,
      runtimeStatuses: statuses,
    }),
  };
  const currentDecisionProducts = buildDecisionProductArtifact(decisionProductInput);
  const decisionProducts = buildDecisionProductArtifact({ ...decisionProductInput, previousArtifact: previousDecisionProductArtifact });
  const decisionProductRetentionReceipt = buildDecisionProductRetentionReceipt({
    currentArtifact: currentDecisionProducts,
    artifact: decisionProducts,
    previousArtifact: previousDecisionProductArtifact,
  });
  const growthConfig = await loadGrowthExperimentConfig(outputRoot);
  const growthDraft = buildTopSignalsDraft({ artifact: decisionProducts, now: topSignalsDraftNow, config: growthConfig });
  if (growthDraft.status === "in-experiment") {
    stageTopSignalsDraft({ root: outputRoot, transaction, draft: growthDraft.draft });
  }
  const communityEvidence = await stageCommunityEvidenceArtifacts({
    root: outputRoot,
    transaction,
    seeds: evidenceTaskSeeds,
    now,
    github: {
      token: process.env.GITHUB_TOKEN,
      repo: process.env.GITHUB_REPOSITORY,
      fetchSnapshot: options.fetchCommunityEvidenceSnapshot,
    },
    revalidation: {
      companies,
      events: eventStore.events,
      companyClaimLedger,
      researchDecisionCards,
      researchRecords: researchRegistry.records,
      benchmarkResultLedger,
      decisionProducts,
      pagesBaseUrl,
      sources: registrySources,
      options: {
        fetchImpl: options.fetchAcceptedEvidence,
        resolveHost: options.resolveAcceptedEvidenceHost,
        sleep: options.sleepAcceptedEvidence,
        timeoutMs: options.acceptedEvidenceTimeoutMs,
      },
    },
  });
  statuses.push(communityEvidence.status);
  statuses.push(communityEvidence.revalidationStatus);
  const previousEnrichment = await readJsonStrict<EvidenceEnrichmentArtifact>(join(reviewDir, "evidence-enrichment.json"), {
    optional: true,
    label: "定向取证计划",
    validate: (value): value is EvidenceEnrichmentArtifact => isObject(value) && value.schemaVersion === 1 && Array.isArray(value.plans),
  });
  const evidenceEnrichment = buildEvidenceEnrichmentPlan({
    verification: candidateVerification,
    companies,
    sources: registrySources,
    evidencePool: verificationEvidencePool,
    previous: previousEnrichment,
    acceptedEvidence: communityEvidence.accepted,
  }, {
    maxPlansPerRun: 20,
    maxProbesPerPlan: 6,
    maxCandidateEvidencePerPlan: 5,
  }, now);
  // This output is review-only. Planner findings can never publish or upgrade
  // evidence automatically; they must re-enter entity, independence and
  // human-review gates first.
  await writeFile(join(reviewDir, "evidence-enrichment.json"), JSON.stringify(evidenceEnrichment, null, 2) + "\n", "utf8");
  await writeFile(join(outputDir, `${archive.date}.json`), JSON.stringify(archive, null, 2) + "\n", "utf8");
  await writeFile(join(reviewDir, "runtime-status.md"), formatRuntimeStatus(statuses, archive.sourceOutcomes ?? [], archive.date), "utf8");
  const anomalyReport = buildEventAnomalyReport(eventStore, archives, now);
  await writeFile(join(reviewDir, "event-anomalies.json"), JSON.stringify(anomalyReport, null, 2) + "\n", "utf8");
  await writeFile(join(reviewDir, "event-anomalies.md"), [
    `# 事件时效与候选积压监控 · ${archive.date}`,
    "",
    "本文件用于内部质量控制，不会用虚构内容填补空窗。",
    "",
    `- 近 30 天公开产业事件：${anomalyReport.metrics.publicIndustryEvents30d}`,
    `- 近 7 天真实新增事件：${anomalyReport.metrics.newPublicIndustryEvents7d}`,
    `- 候选积压：${anomalyReport.metrics.candidateBacklog}`,
    `- arXiv 产业库污染：${anomalyReport.metrics.arxivIndustryEvents}`,
    "",
    "## 告警",
    "",
    ...(anomalyReport.alerts.length ? anomalyReport.alerts.map((alert) => `- **${alert.severity} · ${alert.code}**：${alert.message}`) : ["- 无异常。"]),
    "",
  ].join("\n"), "utf8");
  const finishedAt = options.now ?? new Date();
  const runManifest: RunManifest = {
    schemaVersion: 1,
    runId: `${archive.date}-${startedAt.toISOString().replace(/[:.]/g, "-")}`,
    date: archive.date,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    status: archive.sourceOutcomes?.some((outcome) => outcome.status === "failure") || statuses.some((status) => status.status !== "成功") ? "degraded" : "success",
    quality: { publicIndustryItems: publicArticles.length, publicResearchItems: publicResearch.length, candidates: candidates.length, sourceFailures: archive.sourceOutcomes?.filter((outcome) => outcome.status === "failure").length ?? 0 },
    services: statuses,
    // The final transaction count remains assigned after dashboard staging.
    outputs: 0,
  };
  const previousRunHistory = await readJsonStrict<RunHistory>(join(reviewDir, "run-history.json"), {
    optional: true,
    label: "运行历史",
    validate: (value): value is RunHistory => isObject(value) && value.schemaVersion === 1 && Array.isArray(value.runs),
  });
  const dashboardRunHistory = updateRunHistory(previousRunHistory, runManifest);
  const dashboardPipelineHealth = buildPipelineHealth(dashboardRunHistory, finishedAt);
  const publicationHealth = projectPublicationHealth(dashboardPipelineHealth, runManifest, anomalyReport.metrics.candidateBacklog);
  const dashboard = buildDashboard(eventStore, companies, publicResearch, now, {
    activeSources: activeSources.length + activeXSources.length,
    periodLabel: `本周 ${isoWeek(now)} · 近 30 天滚动证据池`,
    companyClaimLedger,
    researchDecisionCards,
    researchIndustryEdges: researchIndustryRelations.edges,
    watchlist: watchlistView,
    decisionProducts,
    communityEvidence: communityEvidence.publication,
    publicationHealth,
  });
  const companyEntities = updateCompanyEntityRegistry(await readJson<CompanyEntityRegistry>(companyEntityPath), companies, companyCandidates, now);
  const nextCandidateRegistry = updateCandidateRegistry(candidateRegistry, discoveredSources, archives, now);
  const registry = buildSourceRegistry(archives, registrySources, [...activeSources, ...activeXSources], now);
  const watchlist = selectWatchlistCandidates(weekly);
  await writeFile(join(sourcesDir, "registry.json"), JSON.stringify(registry, null, 2) + "\n", "utf8");
  await writeFile(join(resourcesDir, "source-network.md"), formatSourceNetwork(registry), "utf8");
  await writeFile(candidatePath, JSON.stringify(nextCandidateRegistry, null, 2) + "\n", "utf8");
  await writeFile(companyCandidatePath, JSON.stringify(companyCandidates, null, 2) + "\n", "utf8");
  await writeFile(join(reviewDir, "company-candidates.md"), formatCandidateCompanyReview(companyCandidates), "utf8");
  await writeFile(companyEntityPath, JSON.stringify(companyEntities, null, 2) + "\n", "utf8");
  await writeFile(join(reviewDir, "company-entity-promotions.md"), formatCompanyEntityReview(companyEntities), "utf8");
  await writeFile(join(resourcesDir, "watchlist.md"), formatWatchlistMarkdown(watchlist, week), "utf8");
  await writeFile(join(reviewDir, `${week}.md`), formatReviewMarkdown(registry, aggregateSourceCandidates(archives), watchlist, week), "utf8");
  // This is a separate, private decision queue. Reading the prior artifact
  // preserves human states and audit trails; deterministic upserts make a
  // same-day rerun a no-op when candidate evidence has not changed.
  const reviewCasesPath = join(reviewDir, "cases.json");
  const previousReviewCases = await readJsonStrict<ReviewCaseArtifact>(reviewCasesPath, {
    optional: true,
    label: "审查工作项",
    validate: (value): value is ReviewCaseArtifact => isObject(value) && value.schemaVersion === 1 && Array.isArray(value.cases),
  });
  const broadReviewCases = buildReviewCaseArtifact(previousReviewCases, [
    reviewCaseGenerator({
      articles: candidates.filter((article) => article.kind !== "研究与数据"),
      companies: companyCandidates.companies.filter((company) => company.status === "观察中" || company.status === "已交叉核验"),
      sources: [],
      papers: [],
    }),
    candidateVerificationReviewGenerator(candidateVerification),
  ], now);
  // P0 keeps the operational queue intentionally narrow: high-value industry
  // articles and companies only. Research/source review remains in its own
  // registry until the first SLO has proven sustainable.
  const scopedCases = broadReviewCases.cases
    .filter((item) => (item.type === "article" || item.type === "company") && (item.priority === "P0" || item.priority === "P1"))
    .slice(0, 40);
  const reviewCases: ReviewCaseArtifact = {
    ...broadReviewCases,
    cases: scopedCases,
    alerts: reviewCaseAlerts(scopedCases, now),
    metrics: reviewCaseMetrics(scopedCases, now),
  };
  await writeFile(reviewCasesPath, serializeReviewCaseArtifact(reviewCases), "utf8");
  await writeFile(join(reviewDir, "case-metrics.json"), JSON.stringify({
    schemaVersion: 1,
    generatedAt: reviewCases.generatedAt,
    metrics: reviewCases.metrics,
    alerts: reviewCases.alerts,
  }, null, 2) + "\n", "utf8");
  await writeFile(join(reviewDir, "cases.md"), formatReviewCasesMarkdown(reviewCases), "utf8");
  const ownerConfig = await readJsonStrict<{ owners: ReviewOwner[] }>(join(reviewDir, "owners-config.json"), {
    optional: true,
    label: "审查负责人配置",
    validate: (value): value is { owners: ReviewOwner[] } => isObject(value) && Array.isArray(value.owners),
  });
  const previousAssignments = await readJsonStrict<ReviewAssignmentArtifact>(join(reviewDir, "assignments.json"), {
    optional: true,
    label: "审查分派结果",
    validate: (value): value is ReviewAssignmentArtifact => isObject(value) && value.schemaVersion === 1 && Array.isArray(value.assignments),
  });
  const reviewAssignments = buildReviewAssignmentArtifact(reviewCases.cases, ownerConfig?.owners ?? [], previousAssignments, now);
  await writeFile(join(reviewDir, "assignments.json"), JSON.stringify(reviewAssignments, null, 2) + "\n", "utf8");
  // The claim ledger reads only already-public A/B-evidence events. Candidate
  // verification stays out of this input, so an unknown financing item remains
  // unknown rather than being promoted into a company capital assertion.
  await writeFile(join(eventsDir, "company-claim-ledger.json"), JSON.stringify(companyClaimLedger, null, 2) + "\n", "utf8");
  await writeFile(join(researchDir, "benchmark-result-ledger.json"), JSON.stringify(benchmarkResultLedger, null, 2) + "\n", "utf8");
  await writeFile(join(reviewDir, "dual-ledger-metrics.json"), JSON.stringify(dualLedgerMetrics, null, 2) + "\n", "utf8");
  await writeFile(join(reviewDir, "company-claim-ledger-metrics.json"), JSON.stringify({
    schemaVersion: 1,
    generatedAt: companyClaimLedger.generatedAt,
    metrics: companyClaimLedger.metrics,
  }, null, 2) + "\n", "utf8");
  const metrics = buildProjectMetrics(archives, eventStore, registry, companyCandidates, now);
  await writeFile(join(metricsDir, "weekly.json"), JSON.stringify(metrics, null, 2) + "\n", "utf8");
  await writeFile(join(weeklyDir, `${week}-report.md`), formatWeeklyReport(eventStore, researchRegistry.records, metrics, week, now), "utf8");
  await writeFile(join(reviewDir, "community-queue.md"), formatCommunityReviewQueue(archives, companyCandidates, nextCandidateRegistry, week), "utf8");
  await writeFile(join(reviewDir, "issue-seeds.json"), JSON.stringify({ generatedAt: now.toISOString(), week, seeds: buildCommunityReviewSeeds(archives, companyCandidates, nextCandidateRegistry) }, null, 2) + "\n", "utf8");
  const readmePath = join(outputRoot, "README.md");
  const legacyReadme = updateReadme(await readFile(readmePath, "utf8"), eventStore, companies, publicResearchRecords, researchRegistry.records.length, metrics, now, researchFallbackDate, watchlistView);
  const readme = stageDecisionProducts({
    root: outputRoot,
    transaction,
    artifact: decisionProducts,
    readme: legacyReadme,
    repositoryUrl: repositoryBaseUrl,
    pagesUrl: pagesBaseUrl,
    watchlist: watchlistView,
    retentionReceipt: decisionProductRetentionReceipt,
    retentionSource: decisionProductRetentionReceipt.previousArtifactSha256 ? previousDecisionProductArtifact : undefined,
    publishedTopSignals,
  });
  const watchlistMetrics = buildWatchlistMetrics({
    snapshot: watchlistSnapshot,
    theses: watchlistTheses,
    view: watchlistView,
    changePage: watchlistChangePage,
    feeds: buildWatchlistFeedManifest(watchlistView),
    readme,
  });
  const decisionFeedManifest = buildDecisionFeedManifest(decisionProducts);
  validateDecisionProductPublication({
    artifact: decisionProducts,
    expectedArtifact: buildDecisionProductArtifact({ ...decisionProductInput, previousArtifact: previousDecisionProductArtifact }),
    dashboard,
    readme,
    feedManifest: decisionFeedManifest,
    feeds: Object.fromEntries(decisionFeedManifest.feeds.map((feed) => [feed.path, renderDecisionFeed(decisionProducts, feed.route, {
      repositoryUrl: repositoryBaseUrl,
      pagesUrl: pagesBaseUrl,
      watchlist: watchlistView,
    })])),
    expectedGeneratedAt: now.toISOString(),
    companyEventOwners: canonicalCompanyEventOwners(companies, eventStore.events),
    benchmarkResultLedger,
    repositoryUrl: repositoryBaseUrl,
    pagesUrl: pagesBaseUrl,
    watchlist: watchlistView,
    publishedTopSignals,
  });
  const watchlistRelease = { snapshot: watchlistSnapshot, theses: watchlistTheses, dashboard, readme, changePage: watchlistChangePage, metrics: watchlistMetrics, companies, events: eventStore.events, history: watchlistHistory };
  validatePublication({
    archive,
    events: eventStore,
    research: publicResearchRecords,
    researchDecisionCards,
    readme,
    expectedDate: archive.date,
    previousCompleteResearchCount: previousPublicRecords.length,
    watchlist: watchlistRelease,
  });
  // This public-only artifact shares the Watchlist snapshot transaction. The
  // older review/issue-seeds.json remains a private maintainer queue and is
  // intentionally unreachable from GitHub Issue automation.
  stageWatchlistReviewIssueSeeds({ transaction, root: outputRoot, view: watchlistView });
  await stageWatchlistRelease({ transaction, root: outputRoot, ...watchlistRelease, feeds: { baseUrl: pagesBaseUrl } });
  runManifest.outputs = transaction.size + 4;
  const runHistory = updateRunHistory(previousRunHistory, runManifest);
  const pipelineHealth = buildPipelineHealth(runHistory, finishedAt);
  const domainHealth = buildDomainHealth({
    articles: archiveArticles,
    events: eventStore.events,
    candidateVerification,
    companies,
    runtimeStatuses: statuses,
    runHistory,
    expectations: [
      { domain: "industry", expected: 1 },
      { domain: "funding", expected: 1 },
      { domain: "product-deployment", expected: 1 },
      { domain: "research", expected: 6 },
      { domain: "llm", expected: 1 },
      { domain: "openalex", expected: 1 },
      { domain: "release", expected: 1 },
    ],
  }, finishedAt);
  await writeFile(join(reviewDir, "run-manifest.json"), JSON.stringify(runManifest, null, 2) + "\n", "utf8");
  await writeFile(join(reviewDir, "run-history.json"), JSON.stringify(runHistory, null, 2) + "\n", "utf8");
  await writeFile(join(reviewDir, "pipeline-health.json"), JSON.stringify(pipelineHealth, null, 2) + "\n", "utf8");
  await writeFile(join(reviewDir, "domain-health.json"), JSON.stringify(domainHealth, null, 2) + "\n", "utf8");
  try {
    await transaction.commit();
  } catch (error) {
    throw new DailyGenerationError("transaction-swap-failure", "日报输出事务失败；已回滚并保留上一版。", { cause: error });
  }
  console.log(`完成：公开 ${publicArticles.length} 条资讯、候选 ${candidates.length} 条、行业脉搏 ${pulse.viewpoints.length + pulse.events.length} 条；信源网络 ${nextCandidateRegistry.sources.length} 个候选，写入 ${path}`);
  return runManifest;
}

export async function generate(options: GenerateOptions = {}): Promise<RunManifest> {
  try {
    return await generateDaily(options);
  } catch (error) {
    if (error instanceof DailyGenerationError) throw error;
    throw new DailyGenerationError("generation-failed", "日报生成失败；已停止发布并保留上一版。", { cause: error });
  }
}

const FIXTURE_NOW = new Date("2026-08-24T08:05:05.893Z");
const FIXTURE_TOP_SIGNALS_NOW = new Date("2026-09-03T12:00:00.000Z");
const FIXTURE_REPOSITORY = "mbabby/physical-ai-news-cn";
const fixtureCollection: typeof collect = async () => ({ articles: [], failures: [], sourceOutcomes: [] });
const fixtureXCollection: typeof collectX = async () => ({ articles: [], failures: [], sourceOutcomes: [] });
const FIXTURE_INPUT_PATHS = [
  `daily/${FIXTURE_NOW.toISOString().slice(0, 10)}.json`,
  "research/benchmark-result-ledger.json",
  "research/decision-cards.json",
  "site/data/decision-products.json",
  "research/registry.json",
  "sources/registry.json",
  "watchlist/current.json",
  "watchlist/theses.json",
] as const;
const FIXTURE_SEED_PATHS = [
  "README.md", "daily", "weekly", "sources", "review", "resources", "events", "experiments", "research", "routes",
  "metrics", "site/data", "site/feeds", "watchlist", "community",
] as const;
const FIXTURE_RESET_PATHS = [
  "review/evidence-task-seeds.json", "review/evidence-issue-snapshot.json", "review/evidence-task-ledger.json",
  "review/accepted-evidence.json", "review/accepted-evidence-revalidation.json", "community/contributions.json",
  "site/data/community-tasks.json",
] as const;

async function assertFixtureRoot(outputRoot: string): Promise<void> {
  try {
    const [readme, companies, metrics] = await Promise.all([
      readFile(join(outputRoot, "README.md"), "utf8"),
      readJsonStrict<unknown>(join(outputRoot, "events", "companies.json")),
      readJsonStrict<unknown>(join(outputRoot, "metrics", "community.json")),
    ]);
    if (!readme.includes("物理 AI 产业情报库") || !Array.isArray(companies) || !isObject(metrics)) throw new Error("unrecognized fixture root");
  } catch (error) {
    throw new Error(`fixture root is not a recognized Physical AI publication checkout: ${outputRoot}`, { cause: error });
  }
}

async function prepareFixtureCliRoot(outputRoot: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(outputRoot);
  } catch (error) {
    throw new Error(`fixture output root must be an existing empty directory or a recognized checkout: ${outputRoot}`, { cause: error });
  }
  if (entries.length > 0) {
    await assertFixtureRoot(outputRoot);
    return;
  }
  await Promise.all(FIXTURE_SEED_PATHS.map(async (path) => {
    try { await cp(join(root, path), join(outputRoot, path), { recursive: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }));
  await Promise.all(FIXTURE_RESET_PATHS.map((path) => rm(join(outputRoot, path), { force: true })));
  await assertFixtureRoot(outputRoot);
}

async function snapshotFixtureInputs(outputRoot: string): Promise<Map<string, Buffer | undefined>> {
  const snapshot = new Map<string, Buffer | undefined>();
  await Promise.all(FIXTURE_INPUT_PATHS.map(async (path) => {
    try { snapshot.set(path, await readFile(join(outputRoot, path))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      snapshot.set(path, undefined);
    }
  }));
  const historyRoot = join(outputRoot, "watchlist", "history");
  try {
    for (const entry of await readdir(historyRoot, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const path = join("watchlist", "history", entry.name);
      snapshot.set(path, await readFile(join(outputRoot, path)));
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return snapshot;
}

async function restoreFixtureInputs(outputRoot: string, snapshot: Map<string, Buffer | undefined>): Promise<void> {
  await Promise.all([
    rm(join(outputRoot, "watchlist", "current.json"), { force: true }),
    rm(join(outputRoot, "watchlist", "theses.json"), { force: true }),
    rm(join(outputRoot, "watchlist", "history"), { recursive: true, force: true }),
  ]);
  await Promise.all([...snapshot].map(async ([path, content]) => {
    const target = join(outputRoot, path);
    if (content === undefined) await rm(target, { force: true });
    else {
      await mkdir(dirname(target), { recursive: true });
      await writeFileDirect(target, content);
    }
  }));
}

async function prepareFixtureInputs(outputRoot: string): Promise<void> {
  await Promise.all([
    rm(join(outputRoot, "daily", `${FIXTURE_NOW.toISOString().slice(0, 10)}.json`), { force: true }),
    rm(join(outputRoot, "research", "benchmark-result-ledger.json"), { force: true }),
    rm(join(outputRoot, "research", "decision-cards.json"), { force: true }),
    rm(join(outputRoot, "site", "data", "decision-products.json"), { force: true }),
    rm(join(outputRoot, "watchlist", "current.json"), { force: true }),
    rm(join(outputRoot, "watchlist", "theses.json"), { force: true }),
    rm(join(outputRoot, "watchlist", "history"), { recursive: true, force: true }),
    writeFileDirect(join(outputRoot, "research", "registry.json"), `${JSON.stringify({
      updatedAt: FIXTURE_NOW.toISOString(),
      records: [],
    }, null, 2)}\n`, "utf8"),
    writeFileDirect(join(outputRoot, "sources", "registry.json"), `${JSON.stringify({
      updatedAt: FIXTURE_NOW.toISOString(),
      windowDays: 30,
      sources: [],
    }, null, 2)}\n`, "utf8"),
  ]);
  await mkdir(join(outputRoot, "watchlist", "history"), { recursive: true });
}

export async function runFixtureGeneration(outputRoot: string, transaction?: FileTransaction): Promise<RunManifest> {
  await assertFixtureRoot(outputRoot);
  const fixtureInputs = await snapshotFixtureInputs(outputRoot);
  const environmentKeys = ["LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL", "OPENALEX_API_KEY", "X_BEARER_TOKEN", "GITHUB_TOKEN", "GITHUB_REPOSITORY"] as const;
  const previousEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  for (const key of environmentKeys) delete process.env[key];
  process.env.GITHUB_TOKEN = "offline-fixture-token";
  process.env.GITHUB_REPOSITORY = FIXTURE_REPOSITORY;
  globalThis.fetch = async () => { throw new Error("fixture mode blocks external network access"); };
  const seeds: EvidenceTaskSeedArtifact = {
    schemaVersion: 1,
    generatedAt: FIXTURE_NOW.toISOString(),
    generatedWeek: isoWeek(FIXTURE_NOW),
    seeds: [],
  };
  const snapshot: EvidenceIssueSnapshot = {
    schemaVersion: 1,
    fetchedAt: FIXTURE_NOW.toISOString(),
    repo: FIXTURE_REPOSITORY,
    issues: [],
  };
  try {
    await prepareFixtureInputs(outputRoot);
    return await generate({
      root: outputRoot,
      now: FIXTURE_NOW,
      topSignalsDraftNow: FIXTURE_TOP_SIGNALS_NOW,
      collect: fixtureCollection,
      collectX: fixtureXCollection,
      communityEvidenceSeeds: seeds,
      fetchCommunityEvidenceSnapshot: async () => snapshot,
      transaction,
    });
  } catch (error) {
    await restoreFixtureInputs(outputRoot, fixtureInputs);
    throw error;
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of environmentKeys) {
      const value = previousEnvironment[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const outputRoot = options.fixtureRoot ? resolve(options.fixtureRoot) : root;
  if (options.fixtureMode && options.fixtureRoot) await prepareFixtureCliRoot(outputRoot);
  else if (options.fixtureMode) await assertFixtureRoot(outputRoot);
  await withFileLock(join(outputRoot, ".daily-generation.lock"), () => options.fixtureMode ? runFixtureGeneration(outputRoot) : generate());
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    const failure = error instanceof DailyGenerationError ? error : new DailyGenerationError("generation-failed", "日报生成失败；已停止发布并保留上一版。");
    console.error(`运行失败：${failure.status}:${failure.code}`);
    process.exitCode = 1;
  });
}
