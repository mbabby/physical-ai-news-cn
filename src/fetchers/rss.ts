import { createHash } from "node:crypto";
import Parser from "rss-parser";
import { FETCH_TIMEOUT_MS } from "../config.js";
import type { Article, RssSourceConfig } from "../types.js";

const parser = new Parser();

function articleId(link: string): string {
  return createHash("sha256").update(link).digest("hex").slice(0, 16);
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
      excerpt: item.contentSnippet ?? item.content ?? "", tags: [],
    }];
  });
}

export async function fetchRssSource(source: RssSourceConfig): Promise<Article[]> {
  const response = await fetch(source.url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { "User-Agent": "physical-ai-news-cn/1.0" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  return parseRssText(await response.text(), source);
}
