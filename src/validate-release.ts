import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isObject, readJsonStrict } from "./runtime/storage.js";
import { validatePublication } from "./runtime/validation.js";
import type { DailyArchive, EventStore, ResearchRegistry } from "./types.js";
import { isPublishableResearch, rankResearchArticles } from "./event-center.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

async function main(): Promise<void> {
  const manifest = await readJsonStrict<{ date: string; status: string }>(join(root, "review", "run-manifest.json"), {
    label: "运行清单",
    validate: (value): value is { date: string; status: string } => isObject(value) && typeof value.date === "string" && typeof value.status === "string",
  });
  if (!manifest) throw new Error("缺少运行清单");
  const archive = await readJsonStrict<DailyArchive>(join(root, "daily", `${manifest.date}.json`), { label: "当日日报", validate: (value): value is DailyArchive => isObject(value) && value.date === manifest.date && Array.isArray(value.articles) });
  const events = await readJsonStrict<EventStore>(join(root, "events", "index.json"), { label: "事件中心", validate: (value): value is EventStore => isObject(value) && Array.isArray(value.events) });
  const research = await readJsonStrict<ResearchRegistry>(join(root, "research", "registry.json"), { label: "论文池", validate: (value): value is ResearchRegistry => isObject(value) && Array.isArray(value.records) });
  if (!archive || !events || !research) throw new Error("发布产物不完整");
  const readme = await readFile(join(root, "README.md"), "utf8");
  const publicResearch = research.records.filter((record) => isPublishableResearch(record.article));
  const rankedIds = new Set(rankResearchArticles(publicResearch.map((record) => ({ ...record.article, publishedAt: new Date(record.article.publishedAt), fetchedAt: new Date(record.article.fetchedAt) }))).slice(0, 6).map((article) => article.id));
  validatePublication({ archive, events, research: publicResearch.filter((record) => rankedIds.has(record.id)), readme, expectedDate: manifest.date });
  console.log(`发布校验通过：${manifest.date}，公开 ${archive.articles.length} 条，运行状态 ${manifest.status}。`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
