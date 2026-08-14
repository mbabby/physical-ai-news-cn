import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isObject, readJsonStrict } from "./runtime/storage.js";
import { validatePublication, validatePublicationArtifacts } from "./runtime/validation.js";
import type { DailyArchive, EventStore, PipelineHealth, ResearchRegistry, RunHistory, RunManifest } from "./types.js";
import { isPublishableResearch, rankResearchArticles } from "./event-center.js";
import { SOURCES, X_SOURCES } from "./config.js";
import { validateEntitySourceBindings } from "./entity-catalog.js";
import type { CompanyProfile } from "./types.js";
import { validateWatchlistPreviewArtifact, validateWatchlistPreviewRelease, type WatchlistPreviewArtifact } from "./watchlist/preview.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

async function main(): Promise<void> {
  const manifest = await readJsonStrict<RunManifest>(join(root, "review", "run-manifest.json"), {
    label: "运行清单",
    validate: (value): value is RunManifest => isObject(value) && value.schemaVersion === 1 && typeof value.date === "string" && typeof value.status === "string" && isObject(value.quality) && Array.isArray(value.services),
  });
  if (!manifest) throw new Error("缺少运行清单");
  const archive = await readJsonStrict<DailyArchive>(join(root, "daily", `${manifest.date}.json`), { label: "当日日报", validate: (value): value is DailyArchive => isObject(value) && value.date === manifest.date && Array.isArray(value.articles) });
  const events = await readJsonStrict<EventStore>(join(root, "events", "index.json"), { label: "事件中心", validate: (value): value is EventStore => isObject(value) && Array.isArray(value.events) });
  const research = await readJsonStrict<ResearchRegistry>(join(root, "research", "registry.json"), { label: "论文池", validate: (value): value is ResearchRegistry => isObject(value) && Array.isArray(value.records) });
  const history = await readJsonStrict<RunHistory>(join(root, "review", "run-history.json"), { label: "运行历史", validate: (value): value is RunHistory => isObject(value) && value.schemaVersion === 1 && Array.isArray(value.runs) });
  const health = await readJsonStrict<PipelineHealth>(join(root, "review", "pipeline-health.json"), { label: "流水线健康状态", validate: (value): value is PipelineHealth => isObject(value) && value.schemaVersion === 1 && typeof value.latestRunId === "string" });
  const companies = await readJsonStrict<CompanyProfile[]>(join(root, "events", "companies.json"), { label: "公司实体主表", validate: (value): value is CompanyProfile[] => Array.isArray(value) });
  const watchlistPreview = await readJsonStrict<WatchlistPreviewArtifact>(join(root, "review", "watchlist-preview.json"), { label: "内部观察名单预览", validate: validateWatchlistPreviewArtifact });
  if (!archive || !events || !research || !history || !health || !companies || !watchlistPreview) throw new Error("发布产物不完整");
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
  const publicResearch = research.records.filter((record) => isPublishableResearch(record.article));
  const rankedIds = new Set(rankResearchArticles(publicResearch.map((record) => ({ ...record.article, publishedAt: new Date(record.article.publishedAt), fetchedAt: new Date(record.article.fetchedAt) }))).slice(0, 6).map((article) => article.id));
  validatePublication({ archive, events, research: publicResearch.filter((record) => rankedIds.has(record.id)), readme, expectedDate: manifest.date });
  validatePublicationArtifacts(archive, manifest, history);
  if (health.latestRunId !== manifest.runId || health.latestDate !== manifest.date) throw new Error("流水线健康状态没有指向最新运行");
  console.log(`发布校验通过：${manifest.date}，公开 ${archive.articles.length} 条，运行状态 ${manifest.status}。`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
