import { createHash } from "node:crypto";
import Parser from "rss-parser";
import { FETCH_TIMEOUT_MS } from "../config.js";
import { fetchWithRetry } from "../runtime/http.js";
import type { Article, RssSourceConfig } from "../types.js";

const parser = new Parser();

function articleId(link: string): string {
  return createHash("sha256").update(link).digest("hex").slice(0, 16);
}

function stringsFromMetadata(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap(stringsFromMetadata);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return stringsFromMetadata(record.name ?? record._ ?? record.value);
  }
  return [];
}

function itemAuthors(item: unknown): string[] {
  const raw = item as Record<string, unknown>;
  return [...new Set([
    ...stringsFromMetadata(raw.author),
    ...stringsFromMetadata(raw.creator),
    ...stringsFromMetadata(raw.authors),
    ...stringsFromMetadata(raw["dc:creator"]),
  ])];
}

export async function parseRssText(xml: string, source: RssSourceConfig): Promise<Article[]> {
  const feed = await parser.parseString(xml);
  const fetchedAt = new Date();
  return feed.items.flatMap((item) => {
    if (!item.title || !item.link || !(item.pubDate ?? item.isoDate)) return [];
    const publishedAt = new Date(item.pubDate ?? item.isoDate!);
    if (Number.isNaN(publishedAt.getTime())) return [];
    return [{
      id: articleId(item.link), title: item.title, link: item.link, publishedAt, fetchedAt,
      source: source.name, sourceWeight: source.weight,
      excerpt: item.contentSnippet ?? item.content ?? item.summary ?? "", tags: [], authors: itemAuthors(item),
    }];
  });
}

export async function fetchRssSource(source: RssSourceConfig): Promise<Article[]> {
  const isArxiv = source.name.startsWith("arXiv ·");
  const timeout = isArxiv ? 30_000 : FETCH_TIMEOUT_MS;
  const response = await fetchWithRetry(source.url, { headers: { "User-Agent": "physical-ai-news-cn/1.0" } }, { timeoutMs: timeout, attempts: isArxiv ? 3 : 2 });
  return parseRssText(await response.text(), source);
}
