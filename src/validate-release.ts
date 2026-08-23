import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isObject, readJsonStrict } from "./runtime/storage.js";
import { validateDualLedgerPublication, validatePublication, validatePublicationArtifacts } from "./runtime/validation.js";
import { validatePipelineHealthArtifact } from "./runtime/health.js";
import type { DailyArchive, EventStore, PipelineHealth, ResearchRegistry, RunHistory, RunManifest } from "./types.js";
import { isPublishableResearch } from "./event-center.js";
import { SOURCES, X_SOURCES } from "./config.js";
import { validateEntitySourceBindings } from "./entity-catalog.js";
import type { CompanyProfile } from "./types.js";
import { validateWatchlistPreviewArtifact, validateWatchlistPreviewRelease, type WatchlistPreviewArtifact } from "./watchlist/preview.js";
import { validateWatchlistSnapshotShape, type CompanyThesisArtifact, type WatchlistSnapshot } from "./watchlist/contracts.js";
import { validateCurrentWatchlistHistoryFiles, validateWatchlistRelease } from "./watchlist/release-validation.js";
import { validateWatchlistChangePage, type WatchlistChangePage } from "./watchlist/change-page.js";
import { validateWatchlistMetrics, type WatchlistMetrics } from "./watchlist/metrics.js";
import { buildCompanyFeed, buildRouteFeed, validateWatchlistFeedManifest, type WatchlistFeedManifest } from "./watchlist/feeds.js";
import { buildWatchlistConfigCatalog, decodeWatchlistConfig, encodeWatchlistConfig } from "./watchlist/config.js";
import { buildWatchlistReviewIssueSeeds, validateWatchlistReviewIssueArtifact, type WatchlistReviewIssueArtifact } from "./project-insights.js";
import type { WatchlistPublicView } from "./watchlist/public-view.js";
import type { DashboardData } from "./site-data.js";
import type { ResearchDecisionCard } from "./research-decision-card.js";
import { rankResearchRecords } from "./research-registry.js";
import type { CompanyClaimLedger } from "./company-claim-ledger.js";
import type { BenchmarkResultLedger } from "./benchmark-result-ledger.js";
import { buildDualLedgerMetrics, canonicalCompanyEventOwners, isBenchmarkResultLedgerArtifact, isCompanyClaimLedgerArtifact, type DualLedgerMetrics } from "./dual-ledger.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function stableBytes(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function watchlistView(dashboard: DashboardData): WatchlistPublicView {
  if (!isObject(dashboard) || !isObject(dashboard.watchlist)) throw new Error("公开 dashboard 缺少 Watchlist 视图");
  return dashboard.watchlist as WatchlistPublicView;
}

async function validateWatchlistFeeds(root: string, view: WatchlistPublicView, manifest: WatchlistFeedManifest): Promise<void> {
  validateWatchlistFeedManifest(view, manifest);
  const baseUrl = "https://mbabby.github.io/physical-ai-news-cn";
  for (const { companyId, path } of manifest.companyFeeds) {
    const actual = await readFile(join(root, "site", path), "utf8");
    if (actual !== buildCompanyFeed(view, companyId, baseUrl)) throw new Error(`Watchlist 公司 Feed 与 current 快照不一致：${companyId}`);
  }
  for (const { route, path } of manifest.routeFeeds) {
    const actual = await readFile(join(root, "site", path), "utf8");
    if (actual !== buildRouteFeed(view, route, baseUrl)) throw new Error(`Watchlist 路线 Feed 与 current 快照不一致：${path}`);
  }
}

function validateWatchlistConfigCatalog(view: WatchlistPublicView): void {
  const catalog = buildWatchlistConfigCatalog(view);
  const encoded = encodeWatchlistConfig(catalog);
  const decoded = decodeWatchlistConfig(encoded, catalog);
  if (decoded.warnings.length || JSON.stringify(decoded.config) !== JSON.stringify(catalog)) {
    throw new Error("Watchlist 分享配置未严格绑定 current 快照公司和固定路线目录");
  }
}

function validateWatchlistIssueSeeds(view: WatchlistPublicView, artifact: WatchlistReviewIssueArtifact): void {
  if (!validateWatchlistReviewIssueArtifact(artifact)
    || artifact.week !== view.week
    || artifact.snapshotVersion !== view.snapshotVersion
    || stableBytes(artifact) !== stableBytes(buildWatchlistReviewIssueSeeds(view))) {
    throw new Error("Watchlist Review Issue 种子与 current 公开快照不一致");
  }
}

async function main(): Promise<void> {
  const manifest = await readJsonStrict<RunManifest>(join(root, "review", "run-manifest.json"), {
    label: "运行清单",
    validate: (value): value is RunManifest => isObject(value) && value.schemaVersion === 1 && typeof value.date === "string" && typeof value.status === "string" && isObject(value.quality) && Array.isArray(value.services),
  });
  if (!manifest) throw new Error("缺少运行清单");
  const archive = await readJsonStrict<DailyArchive>(join(root, "daily", `${manifest.date}.json`), { label: "当日日报", validate: (value): value is DailyArchive => isObject(value) && value.date === manifest.date && Array.isArray(value.articles) });
  const events = await readJsonStrict<EventStore>(join(root, "events", "index.json"), { label: "事件中心", validate: (value): value is EventStore => isObject(value) && Array.isArray(value.events) });
  const research = await readJsonStrict<ResearchRegistry>(join(root, "research", "registry.json"), { label: "论文池", validate: (value): value is ResearchRegistry => isObject(value) && Array.isArray(value.records) });
  const researchDecisionArtifact = await readJsonStrict<{ generatedAt: string; cards: ResearchDecisionCard[] }>(join(root, "research", "decision-cards.json"), { label: "研究决策卡", validate: (value): value is { generatedAt: string; cards: ResearchDecisionCard[] } => isObject(value) && typeof value.generatedAt === "string" && Array.isArray(value.cards) });
  const history = await readJsonStrict<RunHistory>(join(root, "review", "run-history.json"), { label: "运行历史", validate: (value): value is RunHistory => isObject(value) && value.schemaVersion === 1 && Array.isArray(value.runs) });
  const health = await readJsonStrict<PipelineHealth>(join(root, "review", "pipeline-health.json"), { label: "流水线健康状态", validate: (value): value is PipelineHealth => isObject(value) && value.schemaVersion === 1 && typeof value.latestRunId === "string" });
  const companies = await readJsonStrict<CompanyProfile[]>(join(root, "events", "companies.json"), { label: "公司实体主表", validate: (value): value is CompanyProfile[] => Array.isArray(value) });
  const companyClaimLedger = await readJsonStrict<CompanyClaimLedger>(join(root, "events", "company-claim-ledger.json"), { label: "公司 Claim Ledger", validate: isCompanyClaimLedgerArtifact });
  const benchmarkResultLedger = await readJsonStrict<BenchmarkResultLedger>(join(root, "research", "benchmark-result-ledger.json"), { label: "Benchmark Result Ledger", validate: isBenchmarkResultLedgerArtifact });
  const dualLedgerMetrics = await readJsonStrict<DualLedgerMetrics>(join(root, "review", "dual-ledger-metrics.json"), { label: "双账本指标", validate: (value): value is DualLedgerMetrics => isObject(value) && value.schemaVersion === 1 && typeof value.generatedAt === "string" });
  const watchlistPreview = await readJsonStrict<WatchlistPreviewArtifact>(join(root, "review", "watchlist-preview.json"), { label: "内部观察名单预览", validate: validateWatchlistPreviewArtifact });
  const watchlistSnapshot = await readJsonStrict<WatchlistSnapshot>(join(root, "watchlist", "current.json"), { label: "公开 Watchlist 快照", validate: validateWatchlistSnapshotShape });
  const watchlistTheses = await readJsonStrict<CompanyThesisArtifact>(join(root, "watchlist", "theses.json"), { label: "公开 Watchlist 判断" });
  const dashboard = await readJsonStrict<DashboardData>(join(root, "site", "data", "dashboard.json"), { label: "公开 dashboard", validate: (value): value is DashboardData => isObject(value) });
  const watchlistChangePage = await readJsonStrict<WatchlistChangePage>(join(root, "site", "data", "watchlist-changes.json"), { label: "公开 Watchlist 变化页", validate: (value): value is WatchlistChangePage => {
    try {
      validateWatchlistChangePage(value);
      return true;
    } catch {
      return false;
    }
  } });
  const watchlistMetrics = await readJsonStrict<WatchlistMetrics>(join(root, "metrics", "watchlist.json"), { label: "公开 Watchlist 指标", validate: (value): value is WatchlistMetrics => {
    try {
      validateWatchlistMetrics(value);
      return true;
    } catch {
      return false;
    }
  } });
  const watchlistFeedManifest = await readJsonStrict<WatchlistFeedManifest>(join(root, "site", "feeds", "manifest.json"), { label: "公开 Watchlist Feed 清单" });
  const watchlistIssueSeeds = await readJsonStrict<WatchlistReviewIssueArtifact>(join(root, "review", "watchlist-issue-seeds.json"), { label: "公开 Watchlist Review Issue 种子" });
  const communityMetricsBytes = await readFile(join(root, "metrics", "community.json"), "utf8");
  const publicCommunityMetricsBytes = await readFile(join(root, "site", "data", "community.json"), "utf8");
  if (!archive || !events || !research || !researchDecisionArtifact || !history || !health || !companies || !companyClaimLedger || !benchmarkResultLedger || !dualLedgerMetrics || !watchlistPreview || !watchlistSnapshot || !watchlistTheses || !dashboard || !watchlistChangePage || !watchlistMetrics || !watchlistFeedManifest || !watchlistIssueSeeds) throw new Error("发布产物不完整");
  if (communityMetricsBytes !== publicCommunityMetricsBytes) throw new Error("社区指标两个公开镜像不一致");
  await validateCurrentWatchlistHistoryFiles(root, watchlistSnapshot);
  const historyFiles = (await readdir(join(root, "watchlist", "history"))).filter((file) => /^\d{4}-W\d{2}-v\d+\.json$/.test(file)).sort();
  const watchlistHistory = await Promise.all(historyFiles.map((file) => readJsonStrict<WatchlistSnapshot>(join(root, "watchlist", "history", file), {
    label: `Watchlist 历史快照 ${file}`,
    validate: validateWatchlistSnapshotShape,
  })));
  if (watchlistHistory.some((item) => item === undefined)) throw new Error("Watchlist 历史快照不完整");
  const watchlistMarkdown = await readFile(join(root, "review", "watchlist-preview.md"), "utf8");
  validateWatchlistPreviewRelease({
    preview: watchlistPreview,
    markdown: watchlistMarkdown,
    manifestFinishedAt: manifest.finishedAt,
    manifestServices: manifest.services,
    archiveServices: archive.runtimeStatus ?? [],
  });
  const entityErrors = validateEntitySourceBindings(companies, [...SOURCES, ...X_SOURCES]);
  if (entityErrors.length) throw new Error(`实体—信源目录不一致：${entityErrors.join("；")}`);
  const readme = await readFile(join(root, "README.md"), "utf8");
  validateWatchlistRelease({
    snapshot: watchlistSnapshot,
    theses: watchlistTheses,
    dashboard,
    readme,
    changePage: watchlistChangePage,
    metrics: watchlistMetrics,
    companies,
    events: events.events,
    history: watchlistHistory as WatchlistSnapshot[],
  });
  const currentView = watchlistView(dashboard);
  await validateWatchlistFeeds(root, currentView, watchlistFeedManifest);
  validateWatchlistConfigCatalog(currentView);
  validateWatchlistIssueSeeds(currentView, watchlistIssueSeeds);
  const eligibleResearchIds = new Set(researchDecisionArtifact.cards.filter((card) => card.eligibleForTopResearch && card.gates.length === 0).map((card) => String(card.identity.paperId.value)));
  validateDualLedgerPublication({
    company: companyClaimLedger,
    benchmark: benchmarkResultLedger,
    companyIds: new Set(companies.map((company) => company.entityId).filter((value): value is string => Boolean(value))),
    companyEventOwners: canonicalCompanyEventOwners(companies, events.events),
    paperIds: new Set(research.records.map((record) => record.id)),
    decisionCards: researchDecisionArtifact.cards,
    expectedGeneratedAt: researchDecisionArtifact.generatedAt,
  });
  if (stableBytes(dualLedgerMetrics) !== stableBytes(buildDualLedgerMetrics(companyClaimLedger, benchmarkResultLedger))) {
    throw new Error("双账本指标与规范账本不一致");
  }
  const hydratedResearch = research.records.map((record) => ({
    ...record,
    article: { ...record.article, publishedAt: new Date(record.article.publishedAt), fetchedAt: new Date(record.article.fetchedAt) },
  }));
  const publicResearch = rankResearchRecords(hydratedResearch.filter((record) => isPublishableResearch(record.article) && eligibleResearchIds.has(record.id))).slice(0, 6);
  validatePublication({ archive, events, research: publicResearch, researchDecisionCards: researchDecisionArtifact.cards, readme, expectedDate: manifest.date });
  validatePublicationArtifacts(archive, manifest, history);
  const healthErrors = validatePipelineHealthArtifact(history, health);
  if (healthErrors.length) throw new Error(`流水线健康状态未通过：\n- ${healthErrors.join("\n- ")}`);
  console.log(`发布校验通过：${manifest.date}，公开 ${archive.articles.length} 条，运行状态 ${manifest.status}。`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
