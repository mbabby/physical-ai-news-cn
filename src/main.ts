import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_WINDOW_HOURS, MAX_DAILY_ARTICLES, SOURCES, X_SOURCES } from "./config.js";
import { fetchAlgoliaSource } from "./fetchers/hn.js";
import { fetchRssSource } from "./fetchers/rss.js";
import { fetchGithubReleasesSource, fetchSitemapSource, fetchWebPageSource, fetchYoutubeSource } from "./fetchers/structured.js";
import { fetchXSource } from "./fetchers/x.js";
import { filterAndRank, filterIndustryAndRank, publicHoldReasons } from "./filter.js";
import { formatMarkdown, formatWeeklyMarkdown } from "./formatter.js";
import { pulseArticleIds, selectIndustryPulse } from "./pulse.js";
import { CompatibleSummarizer } from "./summarize.js";
import { applyRegistryWeights, aggregateSourceCandidates, buildSourceRegistry, discoverSourceCandidates, formatReviewMarkdown, formatWatchlistMarkdown, selectWatchlistCandidates } from "./content-flywheel.js";
import { dynamicSources, resolveCandidateFeeds, sourceNetworkSummary, updateCandidateRegistry } from "./source-pipeline.js";
import { buildCompanyDossiers, buildRouteCompetitionMap, buildRouteIndex, formatCompanyDossiers, formatCompanyRadar, formatIndustryMap, formatRecentEvents, formatResearchCards, isPublishableResearch, primaryEntityForArticle, rankResearchArticles, routeCorrections, upsertEvents } from "./event-center.js";
import { formatResourcePage } from "./resource-radar.js";
import { buildDashboard } from "./site-data.js";
import { enrichResearchWithOpenAlex } from "./openalex.js";
import { rankResearchRecords, researchPromotionMarkdown, updateResearchRegistry } from "./research-registry.js";
import { formatCandidateCompanyReview, updateCandidateCompanies } from "./company-candidates.js";
import { formatCompanyEntityReview, updateCompanyEntityRegistry } from "./company-entities.js";
import { formatSourceNetwork } from "./source-network.js";
import { formatShareableSummary } from "./shareable-summary.js";
import { buildCommunityReviewSeeds, buildProjectMetrics, formatCommunityReviewQueue, formatHomepageStatus, formatWeeklyReport } from "./project-insights.js";
import type { Article, CandidateArticle, CandidateCompanyRegistry, CandidateSourceRegistry, CompanyEntityRegistry, CompanyProfile, DailyArchive, DigestResult, EventStore, IndustryPulse, ResearchRegistry, RouteCompetitionMap, RunHistory, RunManifest, RuntimeStatus, SourceConfig, SourceRegistry } from "./types.js";
import { isoWeek, readRecentDailyArchives, readRecentDailyArticles, selectWeekly } from "./weekly.js";
import { hasCompleteChineseCopy, preferKnownGoodArticles, recoverPublishedResearchRecords } from "./publication.js";
import { FileTransaction, isArray, isObject, readJsonStrict, withFileLock } from "./runtime/storage.js";
import { validatePublication } from "./runtime/validation.js";
import { buildPipelineHealth, updateRunHistory } from "./runtime/health.js";
import { buildEntityCoverage, formatEntityCoverage, validateEntitySourceBindings } from "./entity-catalog.js";
import { buildCandidateVerificationArtifact, formatCandidateVerificationReview, verificationIssueSeeds } from "./candidate-verification.js";
import type { CandidateVerificationArtifact } from "./candidate-verification.js";
import { buildEventAnomalyReport } from "./event-anomalies.js";
import { buildReviewCaseArtifact, reviewCaseAlerts, reviewCaseGenerator, reviewCaseMetrics, serializeReviewCaseArtifact } from "./review-cases.js";
import type { ReviewCaseArtifact, ReviewCaseGenerator } from "./review-cases.js";
import { buildCompanyClaimLedger } from "./company-claim-ledger.js";
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
import { buildEvidenceEnrichmentPlan } from "./evidence-enrichment-planner.js";
import type { EvidenceEnrichmentArtifact } from "./evidence-enrichment-planner.js";
import { buildDomainHealth } from "./domain-health.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const eventsStart = "<!-- EVENT_CENTER_START -->";
const eventsEnd = "<!-- EVENT_CENTER_END -->";
const companyStart = "<!-- COMPANY_RADAR_START -->";
const companyEnd = "<!-- COMPANY_RADAR_END -->";
const researchStart = "<!-- RESEARCH_UPDATES_START -->";
const researchEnd = "<!-- RESEARCH_UPDATES_END -->";
const statusStart = "<!-- PROJECT_STATUS_START -->";
const statusEnd = "<!-- PROJECT_STATUS_END -->";
function parseWindow(argv: string[]): number { const value = Number(argv[argv.indexOf("--hours") + 1]); return argv.includes("--hours") && Number.isFinite(value) && value > 0 ? value : DEFAULT_WINDOW_HOURS; }

function replaceSection(readme: string, start: string, end: string, content: string): string {
  const expression = new RegExp(`${start}[\\s\\S]*?${end}`);
  if (!expression.test(readme)) throw new Error(`README 缺少占位标记：${start}`);
  return readme.replace(expression, `${start}\n\n${content}\n\n${end}`);
}
function updateReadme(readme: string, events: EventStore, companies: CompanyProfile[], research: ResearchRegistry["records"], researchPoolSize: number, metrics: ReturnType<typeof buildProjectMetrics>, refreshedAt: Date, researchFallbackDate?: string): string {
  const withStatus = replaceSection(readme, statusStart, statusEnd, formatHomepageStatus(metrics, companies.length, researchPoolSize));
  return replaceSection(replaceSection(replaceSection(withStatus, eventsStart, eventsEnd, formatRecentEvents(events.events, refreshedAt)), companyStart, companyEnd, formatCompanyRadar(companies, events.events, refreshedAt)), researchStart, researchEnd, formatResearchCards(research, researchFallbackDate));
}

async function readRegistry(path: string): Promise<SourceRegistry | undefined> {
  return readJsonStrict<SourceRegistry>(path, { optional: true, label: "信源注册表", validate: (value): value is SourceRegistry => isObject(value) && Array.isArray(value.sources) });
}
async function readCandidateRegistry(path: string): Promise<CandidateSourceRegistry | undefined> {
  return readJsonStrict<CandidateSourceRegistry>(path, { optional: true, label: "候选信源注册表", validate: (value): value is CandidateSourceRegistry => isObject(value) && Array.isArray(value.sources) });
}
async function readJson<T>(path: string): Promise<T | undefined> { return readJsonStrict<T>(path, { optional: true }); }

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

async function summarizeInSmallBatches(summarizer: CompatibleSummarizer, articles: Article[], batchSize = 2): Promise<Article[]> {
  const output: Article[] = [];
  for (let index = 0; index < articles.length; index += batchSize) {
    output.push(...await Promise.all(articles.slice(index, index + batchSize).map((article) => summarizer.summarize(article))));
  }
  return output;
}

async function summarizeWithCache(summarizer: CompatibleSummarizer, articles: Article[], historical: Article[]): Promise<Article[]> {
  const cached = new Map(historical.filter(hasCompleteChineseCopy).map((article) => [article.id, article]));
  const pending = articles.filter((article) => {
    const prior = cached.get(article.id);
    return !prior || prior.title !== article.title || prior.excerpt !== article.excerpt;
  });
  const refreshed = new Map((await summarizeInSmallBatches(summarizer, pending)).map((article) => [article.id, article]));
  return preferKnownGoodArticles(articles.map((article) => refreshed.get(article.id) ?? article), historical);
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

async function generate(): Promise<void> {
  const startedAt = new Date();
  const transaction = new FileTransaction();
  const writeFile = async (path: string, content: string, _encoding?: string): Promise<void> => { transaction.stage(path, content); };
  const windowHours = parseWindow(process.argv.slice(2));
  const now = new Date(); const outputDir = join(root, "daily"); const weeklyDir = join(root, "weekly"); const sourcesDir = join(root, "sources"); const reviewDir = join(root, "review"); const resourcesDir = join(root, "resources"); const eventsDir = join(root, "events"); const researchDir = join(root, "research"); const routesDir = join(root, "routes"); const metricsDir = join(root, "metrics");
  await Promise.all([mkdir(outputDir, { recursive: true }), mkdir(weeklyDir, { recursive: true }), mkdir(sourcesDir, { recursive: true }), mkdir(reviewDir, { recursive: true }), mkdir(resourcesDir, { recursive: true }), mkdir(eventsDir, { recursive: true }), mkdir(researchDir, { recursive: true }), mkdir(routesDir, { recursive: true }), mkdir(metricsDir, { recursive: true })]);
  const candidatePath = join(sourcesDir, "candidates.json");
  const companyCandidatePath = join(eventsDir, "company-candidates.json");
  const companyEntityPath = join(eventsDir, "company-entities.json");
  const candidateRegistry = await readCandidateRegistry(candidatePath);
  const companies = await readJsonStrict<CompanyProfile[]>(join(eventsDir, "companies.json"), { label: "公司档案", validate: isArray<CompanyProfile> }) ?? [];
  const catalogErrors = validateEntitySourceBindings(companies, [...SOURCES, ...X_SOURCES]);
  if (catalogErrors.length) throw new Error(`实体与信源目录不一致：\n- ${catalogErrors.join("\n- ")}`);
  const trackedCompanies = new Set(companies.map((company) => company.name));
  const priorRegistry = await readRegistry(join(sourcesDir, "registry.json"));
  const configuredSources = [...SOURCES, ...dynamicSources(candidateRegistry)];
  const registrySources = [...SOURCES, ...X_SOURCES, ...dynamicSources(candidateRegistry)];
  const activeSources = applyRegistryWeights(configuredSources, priorRegistry).filter((source) => source.status !== "已暂停");
  const activeXSources = applyRegistryWeights(X_SOURCES, priorRegistry).filter((source) => source.status !== "已暂停");
  await writeFile(join(resourcesDir, "entity-source-coverage.md"), formatEntityCoverage(buildEntityCoverage(companies, [...SOURCES, ...X_SOURCES]), now), "utf8");
  const collected = await collect(activeSources, windowHours);
  const xCollected = await collectX(activeXSources, windowHours, process.env.X_BEARER_TOKEN);
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
  const summarizer = new CompatibleSummarizer({ apiKey: process.env.LLM_API_KEY, baseUrl: process.env.LLM_BASE_URL, model: process.env.LLM_MODEL });
  const articles = await summarizeWithCache(summarizer, industrySelected, historicalArticles);
  const openAlex = await enrichResearchWithOpenAlex(researchCandidates, process.env.OPENALEX_API_KEY);
  // Twelve summaries absorb occasional LLM failures while leaving enough
  // complete cards to publish six. Any incomplete card remains private.
  const researchSelected = rankResearchArticles(openAlex.articles).slice(0, 12);
  const researchArticles = await summarizeWithCache(summarizer, researchSelected, [...registeredResearch, ...cachedResearch, ...historicalArticles]);
  // A public intelligence product must not oscillate between polished Chinese
  // cards and half-translated raw abstracts. The homepage falls back to the
  // latest complete cards; unfinished research stays in the candidate layer.
  const researchPool = uniqueArticles(preferKnownGoodArticles([...researchArticles, ...openAlex.articles, ...registeredResearch, ...cachedResearch], [...registeredResearch, ...cachedResearch, ...historicalArticles]));
  const researchRegistry = updateResearchRegistry(previousResearch, researchPool, now);
  const freshlyRankedResearch = rankResearchRecords(researchRegistry.records).filter((record) => isPublishableResearch(record.article));
  // The daily archives are the actual publication history. The registry may
  // temporarily lose complete copy when a provider returns a poorer refresh,
  // so using only the registry as the baseline allowed the homepage to shrink
  // from three cards to two across two otherwise successful runs.
  const archivedPublicRecords = recoverPublishedResearchRecords(recentArchives, previousResearch?.records ?? []);
  const registryPublicRecords = (previousResearch?.records ?? []).filter((record) => isPublishableResearch(record.article) && !record.article.scholar?.isRetracted)
    .map((record) => ({ ...record, article: { ...record.article, publishedAt: new Date(record.article.publishedAt), fetchedAt: new Date(record.article.fetchedAt) } }));
  const previousPublicRecords = [...new Map([...archivedPublicRecords, ...registryPublicRecords].map((record) => [record.id, record])).values()];
  const previousById = new Map(previousPublicRecords.map((record) => [record.id, record]));
  const fallbackOrder = rankResearchArticles(previousPublicRecords.map((record) => ({ ...record.article, publishedAt: new Date(record.article.publishedAt), fetchedAt: new Date(record.article.fetchedAt) })))
    .flatMap((article) => previousById.get(article.id) ? [previousById.get(article.id)!] : []);
  const publicResearchRecords = [...new Map([...freshlyRankedResearch, ...fallbackOrder].map((record) => [record.id, record])).values()].slice(0, 6);
  const shownResearchIds = new Set(publicResearchRecords.map((record) => record.id));
  researchRegistry.records.forEach((record) => { if (shownResearchIds.has(record.id)) record.lastShownAt = now.toISOString(); });
  const publicResearch = publicResearchRecords.map((record) => record.article);
  const researchDecisionCards = selectTopResearchDecisionCards(researchRegistry.records, { now });
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
  await mkdir(join(root, "site", "data"), { recursive: true });
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
  const pulseSummaries = await Promise.all([...rawPulse.viewpoints, ...rawPulse.events.filter((event) => !industrySelected.some((article) => article.id === event.id))].map((article) => summarizer.summarize(article)));
  const summarizedPulse = mergePulseSummaries(rawPulse, [...articles, ...pulseSummaries]);
  const pulse: IndustryPulse = {
    viewpoints: summarizedPulse.viewpoints.filter((article) => publicHoldReasons(article, true, false).length === 0),
    events: summarizedPulse.events.filter((article) => holdReasonsForCompanyArticle(article).length === 0),
  };
  const heldPulse = [...summarizedPulse.viewpoints.filter((article) => publicHoldReasons(article, true, false).length > 0).map((article) => candidateArticle(article, publicHoldReasons(article, true, false))), ...summarizedPulse.events.filter((article) => holdReasonsForCompanyArticle(article).length > 0).map((article) => candidateArticle(article, holdReasonsForCompanyArticle(article)))];
  const visibleArticles = publicArticles.filter((article) => !pulseArticleIds(pulse).has(article.id));
  const path = join(outputDir, `${now.toISOString().slice(0, 10)}.md`);
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
  const statuses = [summarizer.status(), openAlex.status];
  const researchCorrections = researchRegistry.records.flatMap((record) => record.changes.filter((change) => change.date.slice(0, 10) === now.toISOString().slice(0, 10) && (change.kind === "撤稿" || change.kind === "版本更新")).map((change) => ({ source: record.article.source, reason: `${change.kind}：${record.article.title}`, date: now.toISOString().slice(0, 10) })));
  const archive: DailyArchive = { date: now.toISOString().slice(0, 10), articles: archiveArticles, industryPulse: pulse, sourceOutcomes: [...collected.sourceOutcomes, ...xCollected.sourceOutcomes], candidates, runtimeStatus: statuses, discoveredSources, sourceCorrections: researchCorrections };
  await writeFile(join(outputDir, `${archive.date}.json`), JSON.stringify(archive, null, 2) + "\n", "utf8");
  await writeFile(join(reviewDir, "runtime-status.md"), formatRuntimeStatus(statuses, archive.sourceOutcomes ?? [], archive.date), "utf8");
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
  }, {
    maxPlansPerRun: 20,
    maxProbesPerPlan: 6,
    maxCandidateEvidencePerPlan: 5,
  }, now);
  // This output is review-only. Planner findings can never publish or upgrade
  // evidence automatically; they must re-enter entity, independence and
  // human-review gates first.
  await writeFile(join(reviewDir, "evidence-enrichment.json"), JSON.stringify(evidenceEnrichment, null, 2) + "\n", "utf8");
  // Build public data after verification so “正在发生” reflects evidence
  // found in this run instead of the previous review artifact.
  const companyClaimLedger = buildCompanyClaimLedger(companies, eventStore.events, { now });
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
  await writeFile(join(root, "site", "data", "dashboard.json"), JSON.stringify(buildDashboard(eventStore, companies, publicResearch, now, {
    activeSources: activeSources.length + activeXSources.length,
    periodLabel: `本周 ${isoWeek(now)} · 近 30 天滚动证据池`,
    candidateVerificationRecords: candidateVerification.records,
    companyClaimLedger,
    researchDecisionCards,
    researchIndustryEdges: researchIndustryRelations.edges,
  }), null, 2) + "\n", "utf8");
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
  const readmePath = join(root, "README.md");
  const readme = updateReadme(await readFile(readmePath, "utf8"), eventStore, companies, publicResearchRecords, researchRegistry.records.length, metrics, now, researchFallbackDate);
  validatePublication({ archive, events: eventStore, research: publicResearchRecords, readme, expectedDate: archive.date, previousCompleteResearchCount: previousPublicRecords.length });
  await writeFile(readmePath, readme, "utf8");
  const finishedAt = new Date();
  const runManifest: RunManifest = {
    schemaVersion: 1,
    runId: `${archive.date}-${startedAt.toISOString().replace(/[:.]/g, "-")}`,
    date: archive.date,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    status: archive.sourceOutcomes?.some((outcome) => outcome.status === "failure") || statuses.some((status) => status.status !== "成功") ? "degraded" : "success",
    quality: { publicIndustryItems: publicArticles.length, publicResearchItems: publicResearch.length, candidates: candidates.length, sourceFailures: archive.sourceOutcomes?.filter((outcome) => outcome.status === "failure").length ?? 0 },
    services: statuses,
    outputs: transaction.size + 4,
  };
  const previousRunHistory = await readJsonStrict<RunHistory>(join(reviewDir, "run-history.json"), {
    optional: true,
    label: "运行历史",
    validate: (value): value is RunHistory => isObject(value) && value.schemaVersion === 1 && Array.isArray(value.runs),
  });
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
  await transaction.commit();
  console.log(`完成：公开 ${publicArticles.length} 条资讯、候选 ${candidates.length} 条、行业脉搏 ${pulse.viewpoints.length + pulse.events.length} 条；信源网络 ${nextCandidateRegistry.sources.length} 个候选，写入 ${path}`);
}
async function main(): Promise<void> {
  await withFileLock(join(root, ".daily-generation.lock"), generate);
}
main().catch((error) => { console.error("运行失败：", error); process.exitCode = 1; });
