import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_WINDOW_HOURS, MAX_DAILY_ARTICLES, SOURCES } from "./config.js";
import { fetchAlgoliaSource } from "./fetchers/hn.js";
import { fetchRssSource } from "./fetchers/rss.js";
import { filterAndRank } from "./filter.js";
import { formatHomepageDigest, formatHomepageWeekly, formatMarkdown, formatWeeklyMarkdown } from "./formatter.js";
import { CompatibleSummarizer } from "./summarize.js";
import type { Article, DailyArchive, DigestResult } from "./types.js";
import { isoWeek, readRecentDailyArticles, selectWeekly } from "./weekly.js";

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

async function collect(windowHours: number): Promise<DigestResult> {
  const results = await Promise.allSettled(SOURCES.map((source) => source.type === "rss" ? fetchRssSource(source) : fetchAlgoliaSource(source, windowHours)));
  const articles: Article[] = []; const failures: DigestResult["failures"] = [];
  results.forEach((result, index) => result.status === "fulfilled" ? articles.push(...result.value) : failures.push({ source: SOURCES[index].name, reason: result.reason instanceof Error ? result.reason.message : String(result.reason) }));
  return { articles, failures };
}

async function main(): Promise<void> {
  const windowHours = parseWindow(process.argv.slice(2));
  const collected = await collect(windowHours);
  const selected = filterAndRank(collected.articles, windowHours, MAX_DAILY_ARTICLES);
  const summarizer = new CompatibleSummarizer({ apiKey: process.env.LLM_API_KEY, baseUrl: process.env.LLM_BASE_URL, model: process.env.LLM_MODEL });
  const articles = await Promise.all(selected.map((article) => summarizer.summarize(article)));
  const now = new Date(); const outputDir = join(root, "daily"); const weeklyDir = join(root, "weekly");
  await mkdir(outputDir, { recursive: true });
  await mkdir(weeklyDir, { recursive: true });
  const path = join(outputDir, `${now.toISOString().slice(0, 10)}.md`);
  const markdown = formatMarkdown(articles, windowHours, collected.failures, now);
  await writeFile(path, markdown, "utf8");
  const archive: DailyArchive = { date: now.toISOString().slice(0, 10), articles };
  await writeFile(join(outputDir, `${archive.date}.json`), JSON.stringify(archive, null, 2) + "\n", "utf8");
  const weekly = selectWeekly(await readRecentDailyArticles(outputDir, now));
  const weeklyMarkdown = formatWeeklyMarkdown(weekly, isoWeek(now));
  await writeFile(join(weeklyDir, `${isoWeek(now)}.md`), weeklyMarkdown, "utf8");
  const readmePath = join(root, "README.md");
  await writeFile(readmePath, updateReadme(await readFile(readmePath, "utf8"), markdown, weeklyMarkdown), "utf8");
  console.log(`完成：收录 ${articles.length} 条资讯，写入 ${path}；更新本周精选 ${weekly.length} 条`);
}
main().catch((error) => { console.error("运行失败：", error); process.exitCode = 1; });
