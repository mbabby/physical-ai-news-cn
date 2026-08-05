import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_WINDOW_HOURS, MAX_DAILY_ARTICLES, SOURCES, X_SOURCES } from "./config.js";
import { fetchAlgoliaSource } from "./fetchers/hn.js";
import { fetchRssSource } from "./fetchers/rss.js";
import { fetchXSource } from "./fetchers/x.js";
import { filterAndRank, publicHoldReasons } from "./filter.js";
import { formatMarkdown, formatWeeklyMarkdown } from "./formatter.js";
import { pulseArticleIds, selectIndustryPulse } from "./pulse.js";
import { CompatibleSummarizer } from "./summarize.js";
import { applyRegistryWeights, aggregateSourceCandidates, buildSourceRegistry, discoverSourceCandidates, formatReviewMarkdown, formatWatchlistMarkdown, selectWatchlistCandidates } from "./content-flywheel.js";
import { dynamicSources, resolveCandidateFeeds, sourceNetworkSummary, updateCandidateRegistry } from "./source-pipeline.js";
import { buildCompanyDossiers, buildRouteIndex, formatCompanyDossiers, formatCompanyRadar, formatIndustryMap, formatRecentEvents, formatResearchUpdates, isPublishableResearch, primaryEntityForArticle, rankResearchArticles, upsertEvents } from "./event-center.js";
import { formatResourcePage } from "./resource-radar.js";
import { buildDashboard } from "./site-data.js";
import { enrichResearchWithOpenAlex } from "./openalex.js";
import { formatCandidateCompanyReview, updateCandidateCompanies } from "./company-candidates.js";
import type { Article, CandidateArticle, CandidateCompanyRegistry, CandidateSourceRegistry, CompanyProfile, DailyArchive, DigestResult, EventStore, IndustryPulse, RuntimeStatus, SourceConfig, SourceRegistry } from "./types.js";
import { isoWeek, readRecentDailyArchives, readRecentDailyArticles, selectWeekly } from "./weekly.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const eventsStart = "<!-- EVENT_CENTER_START -->";
const eventsEnd = "<!-- EVENT_CENTER_END -->";
const companyStart = "<!-- COMPANY_RADAR_START -->";
const companyEnd = "<!-- COMPANY_RADAR_END -->";
const researchStart = "<!-- RESEARCH_UPDATES_START -->";
const researchEnd = "<!-- RESEARCH_UPDATES_END -->";
function parseWindow(argv: string[]): number { const value = Number(argv[argv.indexOf("--hours") + 1]); return argv.includes("--hours") && Number.isFinite(value) && value > 0 ? value : DEFAULT_WINDOW_HOURS; }

function replaceSection(readme: string, start: string, end: string, content: string): string {
  const expression = new RegExp(`${start}[\\s\\S]*?${end}`);
  if (!expression.test(readme)) throw new Error(`README 缺少占位标记：${start}`);
  return readme.replace(expression, `${start}\n\n${content}\n\n${end}`);
}
function updateReadme(readme: string, events: EventStore, companies: CompanyProfile[], research: Article[], refreshedAt: Date, researchFallbackDate?: string): string {
  return replaceSection(replaceSection(replaceSection(readme, eventsStart, eventsEnd, formatRecentEvents(events.events, refreshedAt)), companyStart, companyEnd, formatCompanyRadar(companies, events.events)), researchStart, researchEnd, formatResearchUpdates(research, researchFallbackDate));
}

async function readRegistry(path: string): Promise<SourceRegistry | undefined> {
  try { return JSON.parse(await readFile(path, "utf8")) as SourceRegistry; } catch { return undefined; }
}
async function readCandidateRegistry(path: string): Promise<CandidateSourceRegistry | undefined> {
  try { return JSON.parse(await readFile(path, "utf8")) as CandidateSourceRegistry; } catch { return undefined; }
}
async function readJson<T>(path: string): Promise<T | undefined> { try { return JSON.parse(await readFile(path, "utf8")) as T; } catch { return undefined; } }

async function collect(sources: SourceConfig[], windowHours: number): Promise<DigestResult> {
  const results = await Promise.allSettled(sources.map((source) => {
    if (source.type === "rss") return fetchRssSource(source);
    if (source.type === "algolia") return fetchAlgoliaSource(source, windowHours);
    throw new Error("X 信源必须通过带凭据的行业脉搏流程抓取");
  }));
  const articles: Article[] = []; const failures: DigestResult["failures"] = []; const sourceOutcomes: DigestResult["sourceOutcomes"] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") { articles.push(...result.value); sourceOutcomes.push({ source: sources[index].name, status: "success" }); return; }
    const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
    failures.push({ source: sources[index].name, reason }); sourceOutcomes.push({ source: sources[index].name, status: "failure", reason });
  });
  return { articles, failures, sourceOutcomes };
}

async function collectX(windowHours: number, bearerToken?: string): Promise<DigestResult> {
  if (!bearerToken) return { articles: [], failures: [], sourceOutcomes: [] };
  const results = await Promise.allSettled(X_SOURCES.map((source) => {
    if (source.type !== "x") throw new Error("行业脉搏只接受 X 信源");
    return fetchXSource(source, bearerToken);
  }));
  const articles: Article[] = []; const failures: DigestResult["failures"] = []; const sourceOutcomes: DigestResult["sourceOutcomes"] = [];
  results.forEach((result, index) => {
    const source = X_SOURCES[index];
    if (result.status === "fulfilled") { articles.push(...result.value); sourceOutcomes.push({ source: source.name, status: "success" }); return; }
    const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
    failures.push({ source: source.name, reason }); sourceOutcomes.push({ source: source.name, status: "failure", reason });
  });
  return { articles, failures, sourceOutcomes };
}

async function summarizeInSmallBatches(summarizer: CompatibleSummarizer, articles: Article[], batchSize = 1): Promise<Article[]> {
  const output: Article[] = [];
  for (let index = 0; index < articles.length; index += batchSize) {
    output.push(...await Promise.all(articles.slice(index, index + batchSize).map((article) => summarizer.summarize(article))));
  }
  return output;
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

async function main(): Promise<void> {
  const windowHours = parseWindow(process.argv.slice(2));
  const now = new Date(); const outputDir = join(root, "daily"); const weeklyDir = join(root, "weekly"); const sourcesDir = join(root, "sources"); const reviewDir = join(root, "review"); const resourcesDir = join(root, "resources"); const eventsDir = join(root, "events");
  await Promise.all([mkdir(outputDir, { recursive: true }), mkdir(weeklyDir, { recursive: true }), mkdir(sourcesDir, { recursive: true }), mkdir(reviewDir, { recursive: true }), mkdir(resourcesDir, { recursive: true }), mkdir(eventsDir, { recursive: true })]);
  const candidatePath = join(sourcesDir, "candidates.json");
  const companyCandidatePath = join(eventsDir, "company-candidates.json");
  const candidateRegistry = await readCandidateRegistry(candidatePath);
  const companies = await readJson<CompanyProfile[]>(join(eventsDir, "companies.json")) ?? [];
  const trackedCompanies = new Set(companies.map((company) => company.name));
  const configuredSources = [...SOURCES, ...dynamicSources(candidateRegistry)];
  const activeSources = applyRegistryWeights(configuredSources, await readRegistry(join(sourcesDir, "registry.json")));
  const collected = await collect(activeSources, windowHours);
  const xCollected = await collectX(windowHours, process.env.X_BEARER_TOKEN);
  const selected = filterAndRank(collected.articles, windowHours, windowHours > DEFAULT_WINDOW_HOURS ? 60 : MAX_DAILY_ARTICLES);
  const isResearchArticle = (article: Article) => article.source.startsWith("arXiv · Robotics");
  // Research has its own public gate: it needs a complete Chinese factual
  // brief, not a company identity. Corporate facts remain strict because the
  // homepage must never invent a company behind a funding headline.
  const industrySelected = selected.filter((article) => !isResearchArticle(article));
  // arXiv's submission calendar has gaps and one day's papers are too noisy
  // to represent a field. Keep a 30-day pool, refresh its scholarly metadata
  // daily, then only summarize the six highest-ranked candidates.
  const researchWindowHours = 30 * 24;
  const liveResearch = filterAndRank(collected.articles.filter((article) => article.source.startsWith("arXiv · Robotics")), researchWindowHours, 24);
  const recentArchives = await readRecentDailyArchives(outputDir, now, 7);
  const cachedResearch = (await readRecentDailyArticles(outputDir, now)).filter((article) => article.source.startsWith("arXiv · Robotics"));
  const latestCachedResearchDate = recentArchives.filter((archive) => archive.articles.some((article) => article.source.startsWith("arXiv · Robotics"))).sort((a, b) => b.date.localeCompare(a.date))[0]?.date;
  const researchCandidates = liveResearch.length ? liveResearch : filterAndRank(cachedResearch, researchWindowHours, 24);
  const arxivFailed = collected.failures.some((failure) => failure.source.startsWith("arXiv · Robotics"));
  const researchFallbackDate = !liveResearch.length && arxivFailed ? latestCachedResearchDate : undefined;
  const xSelected = filterAndRank(xCollected.articles, windowHours, 5);
  const rawPulse = selectIndustryPulse(xSelected, industrySelected);
  const summarizer = new CompatibleSummarizer({ apiKey: process.env.LLM_API_KEY, baseUrl: process.env.LLM_BASE_URL, model: process.env.LLM_MODEL });
  const articles = await summarizeInSmallBatches(summarizer, industrySelected);
  const openAlex = await enrichResearchWithOpenAlex(researchCandidates, process.env.OPENALEX_API_KEY);
  const researchSelected = rankResearchArticles(openAlex.articles).slice(0, 6);
  const researchArticles = await summarizeInSmallBatches(summarizer, researchSelected);
  // A public intelligence product must not oscillate between polished Chinese
  // cards and half-translated raw abstracts. The homepage falls back to the
  // latest complete cards; unfinished research stays in the candidate layer.
  const publicResearch = rankResearchArticles(uniqueArticles([...researchArticles, ...cachedResearch].filter(isPublishableResearch))).slice(0, 6);
  const holdReasonsForCompanyArticle = (article: Article) => publicHoldReasons(article, trackedCompanies.has(primaryEntityForArticle(article, companies) ?? ""));
  const publicArticles = articles.filter((article) => holdReasonsForCompanyArticle(article).length === 0);
  const heldArticles = articles.filter((article) => holdReasonsForCompanyArticle(article).length > 0).map((article) => candidateArticle(article, holdReasonsForCompanyArticle(article)));
  const eventPath = join(eventsDir, "index.json");
  const eventStore = upsertEvents(await readJson<EventStore>(eventPath), publicArticles, now, companies);
  await writeFile(eventPath, JSON.stringify(eventStore, null, 2) + "\n", "utf8");
  const companyDossiers = buildCompanyDossiers(companies, eventStore.events);
  await writeFile(join(eventsDir, "company-dossiers.json"), JSON.stringify(companyDossiers, null, 2) + "\n", "utf8");
  await writeFile(join(eventsDir, "route-index.json"), JSON.stringify(buildRouteIndex(companies, eventStore.events), null, 2) + "\n", "utf8");
  await mkdir(join(root, "site", "data"), { recursive: true });
  await writeFile(join(root, "site", "data", "dashboard.json"), JSON.stringify(buildDashboard(eventStore, companies, publicResearch, now), null, 2) + "\n", "utf8");
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
  const pulseSummaries = await Promise.all([...rawPulse.viewpoints, ...rawPulse.events.filter((event) => !selected.some((article) => article.id === event.id))].map((article) => summarizer.summarize(article)));
  const summarizedPulse = mergePulseSummaries(rawPulse, [...articles, ...pulseSummaries]);
  const pulse: IndustryPulse = {
    viewpoints: summarizedPulse.viewpoints.filter((article) => publicHoldReasons(article, true, false).length === 0),
    events: summarizedPulse.events.filter((article) => holdReasonsForCompanyArticle(article).length === 0),
  };
  const heldPulse = [...summarizedPulse.viewpoints.filter((article) => publicHoldReasons(article, true, false).length > 0).map((article) => candidateArticle(article, publicHoldReasons(article, true, false))), ...summarizedPulse.events.filter((article) => holdReasonsForCompanyArticle(article).length > 0).map((article) => candidateArticle(article, holdReasonsForCompanyArticle(article)))];
  const visibleArticles = publicArticles.filter((article) => !pulseArticleIds(pulse).has(article.id));
  const path = join(outputDir, `${now.toISOString().slice(0, 10)}.md`);
  const markdown = formatMarkdown(visibleArticles, windowHours, [...collected.failures, ...xCollected.failures], now, pulse, publicArticles.length, sourceNetworkSummary(candidateRegistry, SOURCES.length), publicResearch);
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
  const archive: DailyArchive = { date: now.toISOString().slice(0, 10), articles: archiveArticles, industryPulse: pulse, sourceOutcomes: [...collected.sourceOutcomes, ...xCollected.sourceOutcomes], candidates, runtimeStatus: statuses, discoveredSources };
  await writeFile(join(outputDir, `${archive.date}.json`), JSON.stringify(archive, null, 2) + "\n", "utf8");
  await writeFile(join(reviewDir, "runtime-status.md"), formatRuntimeStatus(statuses, archive.sourceOutcomes ?? [], archive.date), "utf8");
  const weekly = selectWeekly(await readRecentDailyArticles(outputDir, now));
  const week = isoWeek(now); const weeklyMarkdown = formatWeeklyMarkdown(weekly, week);
  await writeFile(join(weeklyDir, `${week}.md`), weeklyMarkdown, "utf8");
  const archives = await readRecentDailyArchives(outputDir, now, 30);
  const companyCandidates = updateCandidateCompanies(await readJson<CandidateCompanyRegistry>(companyCandidatePath), candidates, now);
  const nextCandidateRegistry = updateCandidateRegistry(candidateRegistry, discoveredSources, archives, now);
  const registry = buildSourceRegistry(archives, configuredSources, activeSources, now);
  const watchlist = selectWatchlistCandidates(weekly);
  await writeFile(join(sourcesDir, "registry.json"), JSON.stringify(registry, null, 2) + "\n", "utf8");
  await writeFile(candidatePath, JSON.stringify(nextCandidateRegistry, null, 2) + "\n", "utf8");
  await writeFile(companyCandidatePath, JSON.stringify(companyCandidates, null, 2) + "\n", "utf8");
  await writeFile(join(reviewDir, "company-candidates.md"), formatCandidateCompanyReview(companyCandidates), "utf8");
  await writeFile(join(resourcesDir, "watchlist.md"), formatWatchlistMarkdown(watchlist, week), "utf8");
  await writeFile(join(reviewDir, `${week}.md`), formatReviewMarkdown(registry, aggregateSourceCandidates(archives), watchlist, week), "utf8");
  const readmePath = join(root, "README.md");
  await writeFile(readmePath, updateReadme(await readFile(readmePath, "utf8"), eventStore, companies, publicResearch, now, researchFallbackDate), "utf8");
  console.log(`完成：公开 ${publicArticles.length} 条资讯、候选 ${candidates.length} 条、行业脉搏 ${pulse.viewpoints.length + pulse.events.length} 条；信源网络 ${nextCandidateRegistry.sources.length} 个候选，写入 ${path}`);
}
main().catch((error) => { console.error("运行失败：", error); process.exitCode = 1; });
