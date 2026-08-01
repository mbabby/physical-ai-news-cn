import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_WINDOW_HOURS, MAX_DAILY_ARTICLES, SOURCES } from "./config.js";
import { fetchAlgoliaSource } from "./fetchers/hn.js";
import { fetchRssSource } from "./fetchers/rss.js";
import { filterAndRank } from "./filter.js";
import { formatHomepageDigest, formatHomepageWeekly, formatMarkdown, formatWeeklyMarkdown } from "./formatter.js";
import { CompatibleSummarizer } from "./summarize.js";
import { applyRegistryWeights, aggregateSourceCandidates, buildSourceRegistry, discoverSourceCandidates, formatReviewMarkdown, formatWatchlistMarkdown, selectWatchlistCandidates } from "./content-flywheel.js";
import type { Article, DailyArchive, DigestResult, SourceConfig, SourceRegistry } from "./types.js";
import { isoWeek, readRecentDailyArchives, readRecentDailyArticles, selectWeekly } from "./weekly.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readmeStart = "<!-- DAILY_DIGEST_START -->";
const readmeEnd = "<!-- DAILY_DIGEST_END -->";
const weeklyStart = "<!-- WEEKLY_DIGEST_START -->";
const weeklyEnd = "<!-- WEEKLY_DIGEST_END -->";
function parseWindow(argv: string[]): number { const value = Number(argv[argv.indexOf("--hours") + 1]); return argv.includes("--hours") && Number.isFinite(value) && value > 0 ? value : DEFAULT_WINDOW_HOURS; }

function replaceSection(readme: string, start: string, end: string, content: string): string {
  const expression = new RegExp(`${start}[\\s\\S]*?${end}`);
  if (!expression.test(readme)) throw new Error(`README 缺少占位标记：${start}`);
  return readme.replace(expression, `${start}\n\n${content}\n\n${end}`);
}
function updateReadme(readme: string, dailyMarkdown: string, weeklyMarkdown: string): string {
  return replaceSection(replaceSection(readme, readmeStart, readmeEnd, formatHomepageDigest(dailyMarkdown)), weeklyStart, weeklyEnd, formatHomepageWeekly(weeklyMarkdown));
}

async function readRegistry(path: string): Promise<SourceRegistry | undefined> {
  try { return JSON.parse(await readFile(path, "utf8")) as SourceRegistry; } catch { return undefined; }
}

async function collect(sources: SourceConfig[], windowHours: number): Promise<DigestResult> {
  const results = await Promise.allSettled(sources.map((source) => source.type === "rss" ? fetchRssSource(source) : fetchAlgoliaSource(source, windowHours)));
  const articles: Article[] = []; const failures: DigestResult["failures"] = []; const sourceOutcomes: DigestResult["sourceOutcomes"] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") { articles.push(...result.value); sourceOutcomes.push({ source: sources[index].name, status: "success" }); return; }
    const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
    failures.push({ source: sources[index].name, reason }); sourceOutcomes.push({ source: sources[index].name, status: "failure", reason });
  });
  return { articles, failures, sourceOutcomes };
}

async function main(): Promise<void> {
  const windowHours = parseWindow(process.argv.slice(2));
  const now = new Date(); const outputDir = join(root, "daily"); const weeklyDir = join(root, "weekly"); const sourcesDir = join(root, "sources"); const reviewDir = join(root, "review"); const resourcesDir = join(root, "resources");
  await Promise.all([mkdir(outputDir, { recursive: true }), mkdir(weeklyDir, { recursive: true }), mkdir(sourcesDir, { recursive: true }), mkdir(reviewDir, { recursive: true }), mkdir(resourcesDir, { recursive: true })]);
  const activeSources = applyRegistryWeights(SOURCES, await readRegistry(join(sourcesDir, "registry.json")));
  const collected = await collect(activeSources, windowHours);
  const selected = filterAndRank(collected.articles, windowHours, MAX_DAILY_ARTICLES);
  const summarizer = new CompatibleSummarizer({ apiKey: process.env.LLM_API_KEY, baseUrl: process.env.LLM_BASE_URL, model: process.env.LLM_MODEL });
  const articles = await Promise.all(selected.map((article) => summarizer.summarize(article)));
  const path = join(outputDir, `${now.toISOString().slice(0, 10)}.md`);
  const markdown = formatMarkdown(articles, windowHours, collected.failures, now);
  await writeFile(path, markdown, "utf8");
  const archive: DailyArchive = { date: now.toISOString().slice(0, 10), articles, sourceOutcomes: collected.sourceOutcomes, discoveredSources: discoverSourceCandidates(collected.articles, SOURCES) };
  await writeFile(join(outputDir, `${archive.date}.json`), JSON.stringify(archive, null, 2) + "\n", "utf8");
  const weekly = selectWeekly(await readRecentDailyArticles(outputDir, now));
  const week = isoWeek(now); const weeklyMarkdown = formatWeeklyMarkdown(weekly, week);
  await writeFile(join(weeklyDir, `${week}.md`), weeklyMarkdown, "utf8");
  const archives = await readRecentDailyArchives(outputDir, now, 30);
  const registry = buildSourceRegistry(archives, SOURCES, activeSources, now);
  const watchlist = selectWatchlistCandidates(weekly);
  await writeFile(join(sourcesDir, "registry.json"), JSON.stringify(registry, null, 2) + "\n", "utf8");
  await writeFile(join(resourcesDir, "watchlist.md"), formatWatchlistMarkdown(watchlist, week), "utf8");
  await writeFile(join(reviewDir, `${week}.md`), formatReviewMarkdown(registry, aggregateSourceCandidates(archives), watchlist, week), "utf8");
  const readmePath = join(root, "README.md");
  await writeFile(readmePath, updateReadme(await readFile(readmePath, "utf8"), markdown, weeklyMarkdown), "utf8");
  console.log(`完成：收录 ${articles.length} 条资讯，写入 ${path}；更新本周精选 ${weekly.length} 条、观察名单 ${watchlist.length} 条与信源档案`);
}
main().catch((error) => { console.error("运行失败：", error); process.exitCode = 1; });
