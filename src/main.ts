import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_WINDOW_HOURS, MAX_DAILY_ARTICLES, SOURCES, X_SOURCES } from "./config.js";
import { fetchAlgoliaSource } from "./fetchers/hn.js";
import { fetchRssSource } from "./fetchers/rss.js";
import { fetchXSource } from "./fetchers/x.js";
import { filterAndRank } from "./filter.js";
import { formatMarkdown, formatWeeklyMarkdown } from "./formatter.js";
import { pulseArticleIds, selectIndustryPulse } from "./pulse.js";
import { CompatibleSummarizer } from "./summarize.js";
import { applyRegistryWeights, aggregateSourceCandidates, buildSourceRegistry, discoverSourceCandidates, formatReviewMarkdown, formatWatchlistMarkdown, selectWatchlistCandidates } from "./content-flywheel.js";
import { dynamicSources, resolveCandidateFeeds, sourceNetworkSummary, updateCandidateRegistry } from "./source-pipeline.js";
import { formatCompanyRadar, formatIndustryMap, formatRecentEvents, formatResearchUpdates, upsertEvents } from "./event-center.js";
import type { Article, CandidateSourceRegistry, CompanyProfile, DailyArchive, DigestResult, EventStore, IndustryPulse, SourceConfig, SourceRegistry } from "./types.js";
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
function updateReadme(readme: string, events: EventStore, companies: CompanyProfile[], research: Article[], researchFallbackDate?: string): string {
  return replaceSection(replaceSection(replaceSection(readme, eventsStart, eventsEnd, formatRecentEvents(events.events)), companyStart, companyEnd, formatCompanyRadar(companies, events.events)), researchStart, researchEnd, formatResearchUpdates(research, researchFallbackDate));
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

function mergePulseSummaries(pulse: IndustryPulse, summaries: Article[]): IndustryPulse {
  const byId = new Map(summaries.map((article) => [article.id, article]));
  return {
    viewpoints: pulse.viewpoints.map((article) => byId.get(article.id) ?? article),
    events: pulse.events.map((article) => byId.get(article.id) ?? article),
  };
}

async function main(): Promise<void> {
  const windowHours = parseWindow(process.argv.slice(2));
  const now = new Date(); const outputDir = join(root, "daily"); const weeklyDir = join(root, "weekly"); const sourcesDir = join(root, "sources"); const reviewDir = join(root, "review"); const resourcesDir = join(root, "resources"); const eventsDir = join(root, "events");
  await Promise.all([mkdir(outputDir, { recursive: true }), mkdir(weeklyDir, { recursive: true }), mkdir(sourcesDir, { recursive: true }), mkdir(reviewDir, { recursive: true }), mkdir(resourcesDir, { recursive: true }), mkdir(eventsDir, { recursive: true })]);
  const candidatePath = join(sourcesDir, "candidates.json");
  const candidateRegistry = await readCandidateRegistry(candidatePath);
  const configuredSources = [...SOURCES, ...dynamicSources(candidateRegistry)];
  const activeSources = applyRegistryWeights(configuredSources, await readRegistry(join(sourcesDir, "registry.json")));
  const collected = await collect(activeSources, windowHours);
  const xCollected = await collectX(windowHours, process.env.X_BEARER_TOKEN);
  const selected = filterAndRank(collected.articles, windowHours, windowHours > DEFAULT_WINDOW_HOURS ? 60 : MAX_DAILY_ARTICLES);
  // arXiv's submission calendar has gaps on weekends. A three-day research
  // window keeps the homepage fresh without treating a quiet day as no news.
  const liveResearch = filterAndRank(collected.articles.filter((article) => article.source.startsWith("arXiv · Robotics")), Math.max(windowHours, 72), 6);
  const recentArchives = await readRecentDailyArchives(outputDir, now, 7);
  const cachedResearch = (await readRecentDailyArticles(outputDir, now)).filter((article) => article.source.startsWith("arXiv · Robotics"));
  const latestCachedResearchDate = recentArchives.filter((archive) => archive.articles.some((article) => article.source.startsWith("arXiv · Robotics"))).sort((a, b) => b.date.localeCompare(a.date))[0]?.date;
  const researchSelected = liveResearch.length ? liveResearch : filterAndRank(cachedResearch, 7 * 24, 6);
  const arxivFailed = collected.failures.some((failure) => failure.source.startsWith("arXiv · Robotics"));
  const researchFallbackDate = !liveResearch.length && arxivFailed ? latestCachedResearchDate : undefined;
  const xSelected = filterAndRank(xCollected.articles, windowHours, 5);
  const rawPulse = selectIndustryPulse(xSelected, selected);
  const summarizer = new CompatibleSummarizer({ apiKey: process.env.LLM_API_KEY, baseUrl: process.env.LLM_BASE_URL, model: process.env.LLM_MODEL });
  const articles = await Promise.all(selected.map((article) => summarizer.summarize(article)));
  const researchArticles = await Promise.all(researchSelected.map((article) => summarizer.summarize(article)));
  const eventPath = join(eventsDir, "index.json");
  const eventStore = upsertEvents(await readJson<EventStore>(eventPath), articles, now);
  const companies = await readJson<CompanyProfile[]>(join(eventsDir, "companies.json")) ?? [];
  await writeFile(eventPath, JSON.stringify(eventStore, null, 2) + "\n", "utf8");
  await writeFile(join(resourcesDir, "companies.md"), `# 公司与团队\n\n${formatCompanyRadar(companies, eventStore.events)}\n`, "utf8");
  await writeFile(join(resourcesDir, "industry-landscape-and-tech-routes.md"), formatIndustryMap(eventStore.events, companies), "utf8");
  const pulseSummaries = await Promise.all([...rawPulse.viewpoints, ...rawPulse.events.filter((event) => !selected.some((article) => article.id === event.id))].map((article) => summarizer.summarize(article)));
  const pulse = mergePulseSummaries(rawPulse, [...articles, ...pulseSummaries]);
  const visibleArticles = articles.filter((article) => !pulseArticleIds(pulse).has(article.id));
  const path = join(outputDir, `${now.toISOString().slice(0, 10)}.md`);
  const markdown = formatMarkdown(visibleArticles, windowHours, [...collected.failures, ...xCollected.failures], now, pulse, articles.length, sourceNetworkSummary(candidateRegistry));
  await writeFile(path, markdown, "utf8");
  const discoveredSources = await resolveCandidateFeeds(discoverSourceCandidates(collected.articles, configuredSources));
  const archiveArticles = [...articles, ...researchArticles.filter((article) => !articles.some((selectedArticle) => selectedArticle.id === article.id))];
  const archive: DailyArchive = { date: now.toISOString().slice(0, 10), articles: archiveArticles, industryPulse: pulse, sourceOutcomes: [...collected.sourceOutcomes, ...xCollected.sourceOutcomes], discoveredSources };
  await writeFile(join(outputDir, `${archive.date}.json`), JSON.stringify(archive, null, 2) + "\n", "utf8");
  const weekly = selectWeekly(await readRecentDailyArticles(outputDir, now));
  const week = isoWeek(now); const weeklyMarkdown = formatWeeklyMarkdown(weekly, week);
  await writeFile(join(weeklyDir, `${week}.md`), weeklyMarkdown, "utf8");
  const archives = await readRecentDailyArchives(outputDir, now, 30);
  const nextCandidateRegistry = updateCandidateRegistry(candidateRegistry, discoveredSources, archives, now);
  const registry = buildSourceRegistry(archives, configuredSources, activeSources, now);
  const watchlist = selectWatchlistCandidates(weekly);
  await writeFile(join(sourcesDir, "registry.json"), JSON.stringify(registry, null, 2) + "\n", "utf8");
  await writeFile(candidatePath, JSON.stringify(nextCandidateRegistry, null, 2) + "\n", "utf8");
  await writeFile(join(resourcesDir, "watchlist.md"), formatWatchlistMarkdown(watchlist, week), "utf8");
  await writeFile(join(reviewDir, `${week}.md`), formatReviewMarkdown(registry, aggregateSourceCandidates(archives), watchlist, week), "utf8");
  const readmePath = join(root, "README.md");
  await writeFile(readmePath, updateReadme(await readFile(readmePath, "utf8"), eventStore, companies, researchArticles, researchFallbackDate), "utf8");
  console.log(`完成：收录 ${articles.length} 条资讯、行业脉搏 ${pulse.viewpoints.length + pulse.events.length} 条；信源网络 ${nextCandidateRegistry.sources.length} 个候选，写入 ${path}`);
}
main().catch((error) => { console.error("运行失败：", error); process.exitCode = 1; });
