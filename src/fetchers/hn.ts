import { createHash } from "node:crypto";
import { FETCH_TIMEOUT_MS } from "../config.js";
import type { AlgoliaSourceConfig, Article } from "../types.js";

export interface AlgoliaHit { title: string | null; url: string | null; objectID: string; created_at: string }
export interface AlgoliaResponse { hits: AlgoliaHit[] }

function articleId(link: string): string { return createHash("sha256").update(link).digest("hex").slice(0, 16); }

export function parseAlgoliaResponse(data: AlgoliaResponse, source: AlgoliaSourceConfig): Article[] {
  const fetchedAt = new Date();
  return data.hits.flatMap((hit) => {
    if (!hit.title) return [];
    const publishedAt = new Date(hit.created_at);
    if (Number.isNaN(publishedAt.getTime())) return [];
    const link = hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`;
    return [{ id: articleId(link), title: hit.title, link, publishedAt, fetchedAt, source: source.name,
      sourceWeight: source.weight, excerpt: "", tags: [] }];
  });
}

export async function fetchAlgoliaSource(source: AlgoliaSourceConfig, windowHours: number): Promise<Article[]> {
  const sinceUnix = Math.floor(Date.now() / 1000) - windowHours * 3600;
  const url = new URL("https://hn.algolia.com/api/v1/search_by_date");
  url.searchParams.set("query", source.query);
  url.searchParams.set("tags", "story");
  url.searchParams.set("numericFilters", `created_at_i>=${sinceUnix}`);
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  return parseAlgoliaResponse((await response.json()) as AlgoliaResponse, source);
}
