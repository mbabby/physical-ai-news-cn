import type { Article, RuntimeStatus, ScholarlyAuthor } from "./types.js";
import { fetchWithRetry, mapWithConcurrency } from "./runtime/http.js";

interface OpenAlexInstitution { display_name?: string }
interface OpenAlexAuthorship { author?: { id?: string; display_name?: string }; institutions?: OpenAlexInstitution[] }
interface OpenAlexWork { id?: string; display_name?: string; publication_date?: string; cited_by_count?: number; is_retracted?: boolean; authorships?: OpenAlexAuthorship[] }
interface OpenAlexAuthor { display_name?: string; cited_by_count?: number; summary_stats?: { h_index?: number }; last_known_institutions?: OpenAlexInstitution[] }

function words(value: string): Set<string> { return new Set(value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter((word) => word.length > 1)); }
function similarity(left: string, right: string): number {
  const a = words(left); const b = words(right); const shared = [...a].filter((word) => b.has(word)).length;
  return shared / Math.max(1, new Set([...a, ...b]).size);
}
function arxivDateCompatible(article: Article, candidate: OpenAlexWork): boolean {
  if (!candidate.publication_date) return false;
  const delta = Math.abs(article.publishedAt.getTime() - new Date(candidate.publication_date).getTime());
  return Number.isFinite(delta) && delta <= 370 * 86_400_000;
}
async function request<T>(url: URL): Promise<T> {
  const response = await fetchWithRetry(url, { headers: { "User-Agent": "physical-ai-news-cn/1.0" } }, { timeoutMs: 12_000, attempts: 3 });
  return response.json() as Promise<T>;
}
async function authorProfile(id: string, apiKey: string): Promise<ScholarlyAuthor | undefined> {
  const url = new URL(`https://api.openalex.org/authors/${encodeURIComponent(id)}`);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("select", "display_name,cited_by_count,summary_stats,last_known_institutions");
  const profile = await request<OpenAlexAuthor>(url);
  if (!profile.display_name) return undefined;
  return { name: profile.display_name, totalCitations: profile.cited_by_count, hIndex: profile.summary_stats?.h_index, institutions: (profile.last_known_institutions ?? []).flatMap((item) => item.display_name ? [item.display_name] : []) };
}

/**
 * Enrich recent arXiv papers with citation and affiliation data. We only keep
 * a match when title similarity and date agree, so a search miss can never
 * silently attach another paper's citation record.
 */
export interface OpenAlexEnrichmentResult { articles: Article[]; status: RuntimeStatus }

export async function enrichResearchWithOpenAlex(articles: Article[], apiKey?: string): Promise<OpenAlexEnrichmentResult> {
  if (!apiKey) return { articles, status: { component: "OpenAlex", status: "未配置", attempted: 0, succeeded: 0, failed: 0, detail: "未配置 OpenAlex；论文仍按来源元数据排序。" } };
  let succeeded = 0; let failed = 0;
  const enriched = await mapWithConcurrency(articles, 4, async (article) => {
    try {
      const url = new URL("https://api.openalex.org/works");
      url.searchParams.set("search", article.title);
      url.searchParams.set("per-page", "5");
      url.searchParams.set("api_key", apiKey);
      url.searchParams.set("select", "id,display_name,publication_date,cited_by_count,is_retracted,authorships");
      const response = await request<{ results?: OpenAlexWork[] }>(url);
      const candidate = (response.results ?? []).map((work) => ({ work, score: similarity(article.title, work.display_name ?? "") }))
        .filter(({ work, score }) => arxivDateCompatible(article, work) && score >= 0.78)
        .sort((a, b) => b.score - a.score)[0]?.work;
      if (!candidate?.id) { succeeded += 1; return article; }
      const matchedAuthors = (candidate.authorships ?? []).slice(0, 3);
      const profiles = await Promise.all(matchedAuthors.flatMap((item) => item.author?.id ? [authorProfile(item.author.id, apiKey).catch(() => undefined)] : []));
      const fallbackAuthors: ScholarlyAuthor[] = matchedAuthors.flatMap((item) => item.author?.display_name ? [{ name: item.author.display_name, institutions: (item.institutions ?? []).flatMap((institution) => institution.display_name ? [institution.display_name] : []) }] : []);
      const authors = profiles.filter((item): item is ScholarlyAuthor => Boolean(item));
      const institutions = [...new Set([...(candidate.authorships ?? []).flatMap((item) => item.institutions ?? []).flatMap((item) => item.display_name ? [item.display_name] : []), ...authors.flatMap((author) => author.institutions)])];
      succeeded += 1;
      return { ...article, authors: article.authors?.length ? article.authors : fallbackAuthors.map((author) => author.name), scholar: { provider: "OpenAlex" as const, workId: candidate.id, citedByCount: candidate.cited_by_count ?? 0, isRetracted: Boolean(candidate.is_retracted), institutions, authors: authors.length ? authors : fallbackAuthors, checkedAt: new Date().toISOString() } };
    } catch (error) {
      // Enrichment is optional: citation APIs must never block the daily feed.
      console.warn(`[openalex] enrichment skipped (${error instanceof Error ? error.message : String(error)})`);
      failed += 1;
      return article;
    }
  });
  return { articles: enriched, status: { component: "OpenAlex", status: failed ? "部分降级" : "成功", attempted: articles.length, succeeded, failed, detail: failed ? "部分论文元数据未能刷新，已保留原始来源数据。" : "论文引用与作者机构元数据已刷新。" } };
}
