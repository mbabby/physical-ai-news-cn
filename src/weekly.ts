import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizeUrl } from "./filter.js";
import type { Article, ArticleKind, DailyArchive, WeeklyArticle } from "./types.js";

const KIND_BONUS: Record<ArticleKind, number> = { "投融资": 32, "产品发布": 18, "部署案例": 16, "公司商业": 14, "开源项目": 8, "研究与数据": 3 };
const IMPACT_WORDS = ["million", "billion", "valuation", "series", "funding", "raised", "investment", "acquisition", "order", "contract", "customer", "factory", "production", "deploy", "deployed", "量产", "订单", "客户", "工厂", "融资", "投资", "收购", "估值"];

function normalizedTitle(value: string): string { return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim(); }
function titleSimilarity(left: string, right: string): number {
  const a = new Set(normalizedTitle(left).split(" ").filter(Boolean));
  const b = new Set(normalizedTitle(right).split(" ").filter(Boolean));
  const shared = [...a].filter((word) => b.has(word)).length;
  return shared / Math.max(1, new Set([...a, ...b]).size);
}

function parseArticle(raw: Article): Article {
  return { ...raw, publishedAt: new Date(raw.publishedAt), fetchedAt: new Date(raw.fetchedAt) };
}

export async function readRecentDailyArticles(directory: string, now = new Date(), days = 7): Promise<Article[]> {
  const cutoff = now.getTime() - days * 24 * 3_600_000;
  const files = (await readdir(directory)).filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file));
  const archives = await Promise.all(files.map(async (file) => JSON.parse(await readFile(join(directory, file), "utf8")) as DailyArchive));
  return archives.flatMap((archive) => archive.articles.map(parseArticle)).filter((article) => article.publishedAt.getTime() >= cutoff);
}

function reason(article: Article, corroborated: boolean): string {
  const event = { "投融资": "披露投融资、并购或估值等资本信号", "产品发布": "代表产品或能力的重要发布", "部署案例": "展示了明确的真实场景部署", "公司商业": "反映公司合作或商业化进展", "开源项目": "带来可复用的开源能力", "研究与数据": "提供值得关注的研究或数据进展" }[article.kind ?? "公司商业"];
  return `${event}；${article.sourceWeight >= 9 ? "来源为一手官方发布" : "来源具备较高行业可信度"}${corroborated ? "，并获得多条日报交叉佐证" : ""}。`;
}

export function selectWeekly(articles: Article[], limit = 5): WeeklyArticle[] {
  const groups: Article[][] = [];
  for (const article of articles) {
    const group = groups.find((items) => items.some((item) => normalizeUrl(item.link) === normalizeUrl(article.link) || titleSimilarity(item.title, article.title) >= 0.75));
    if (group) group.push(article); else groups.push([article]);
  }
  const candidates = groups.map((group) => {
    const best = [...group].sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || b.sourceWeight - a.sourceWeight)[0];
    const text = `${best.title} ${best.excerpt}`.toLowerCase();
    const impact = IMPACT_WORDS.filter((word) => text.includes(word)).length * 4;
    const corroboration = Math.min(12, (group.length - 1) * 6);
    const weeklyScore = (best.score ?? best.sourceWeight * 10) + KIND_BONUS[best.kind ?? "公司商业"] + impact + corroboration;
    return { ...best, weeklyScore, selectionReason: reason(best, group.length > 1) };
  }).sort((a, b) => b.weeklyScore - a.weeklyScore || b.publishedAt.getTime() - a.publishedAt.getTime());

  const selected: WeeklyArticle[] = [];
  const kindCounts = new Map<ArticleKind, number>();
  for (const article of candidates) {
    const kind = article.kind ?? "公司商业";
    if ((kindCounts.get(kind) ?? 0) >= 2) continue;
    selected.push(article); kindCounts.set(kind, (kindCounts.get(kind) ?? 0) + 1);
    if (selected.length === limit) break;
  }
  return selected;
}

export function isoWeek(value: Date): string {
  const date = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
