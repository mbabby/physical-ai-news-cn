import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_WINDOW_HOURS, MAX_DAILY_ARTICLES, SOURCES } from "./config.js";
import { fetchAlgoliaSource } from "./fetchers/hn.js";
import { fetchRssSource } from "./fetchers/rss.js";
import { filterAndRank } from "./filter.js";
import { formatMarkdown } from "./formatter.js";
import { CompatibleSummarizer } from "./summarize.js";
import type { Article, DigestResult } from "./types.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
function parseWindow(argv: string[]): number { const value = Number(argv[argv.indexOf("--hours") + 1]); return argv.includes("--hours") && Number.isFinite(value) && value > 0 ? value : DEFAULT_WINDOW_HOURS; }

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
  const now = new Date(); const outputDir = join(root, "daily");
  await mkdir(outputDir, { recursive: true });
  const path = join(outputDir, `${now.toISOString().slice(0, 10)}.md`);
  await writeFile(path, formatMarkdown(articles, windowHours, collected.failures, now), "utf8");
  console.log(`完成：收录 ${articles.length} 条资讯，写入 ${path}`);
}
main().catch((error) => { console.error("运行失败：", error); process.exitCode = 1; });
