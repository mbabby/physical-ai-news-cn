import { createHash } from "node:crypto";
import Parser from "rss-parser";
import { FETCH_TIMEOUT_MS } from "../config.js";
import { fetchWithRetry } from "../runtime/http.js";
import type { Article, RssSourceConfig } from "../types.js";

// Google News RSS exposes the original publisher as
// `<source url="publisher-home">Publisher</source>`. rss-parser drops this
// non-core field unless explicitly retained.
const parser = new Parser({ customFields: { item: [["source", "source"]] } });

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

function itemPublisher(item: unknown): { publisher?: string; publisherUrl?: string } {
  const raw = item as Record<string, unknown>;
  const source = raw.source;
  if (typeof source === "string") return { publisher: source.trim() || undefined };
  if (!source || typeof source !== "object") return {};
  const record = source as Record<string, unknown>;
  const attributes = record.$ && typeof record.$ === "object" ? record.$ as Record<string, unknown> : {};
  const publisher = stringsFromMetadata(record._ ?? record.name ?? record.value)[0];
  const publisherUrl = typeof attributes.url === "string" ? attributes.url : typeof record.url === "string" ? record.url : undefined;
  return { publisher, publisherUrl };
}

function decodeXml(value: string): string {
  return value.replace(/^<!\[CDATA\[|\]\]>$/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").trim();
}

function publisherMetadataByLink(xml: string): Map<string, { publisher?: string; publisherUrl?: string }> {
  const output = new Map<string, { publisher?: string; publisherUrl?: string }>();
  for (const block of xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? []) {
    const link = block.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i)?.[1];
    const source = block.match(/<source\b([^>]*)>([\s\S]*?)<\/source>/i);
    if (!link || !source) continue;
    const publisherUrl = source[1].match(/\burl=["']([^"']+)["']/i)?.[1];
    output.set(decodeXml(link), { publisher: decodeXml(source[2]) || undefined, publisherUrl: publisherUrl ? decodeXml(publisherUrl) : undefined });
  }
  return output;
}

export async function parseRssText(xml: string, source: RssSourceConfig): Promise<Article[]> {
  const feed = await parser.parseString(xml);
  const fetchedAt = new Date();
  const publisherByLink = source.tier === "线索发现层" ? publisherMetadataByLink(xml) : new Map();
  return feed.items.flatMap((item) => {
    if (!item.title || !item.link || !(item.pubDate ?? item.isoDate)) return [];
    const publishedAt = new Date(item.pubDate ?? item.isoDate!);
    if (Number.isNaN(publishedAt.getTime())) return [];
    const origin = source.tier === "线索发现层" ? { ...itemPublisher(item), ...publisherByLink.get(item.link) } : undefined;
    return [{
      id: articleId(item.link), title: item.title, link: item.link, publishedAt, fetchedAt,
      source: source.name, sourceWeight: source.weight,
      excerpt: item.contentSnippet ?? item.content ?? item.summary ?? "", tags: [], authors: itemAuthors(item),
      discoveryOrigin: origin ? { aggregatorLink: item.link, ...origin } : undefined,
    }];
  });
}

export async function fetchRssSource(source: RssSourceConfig): Promise<Article[]> {
  const isArxiv = source.name.startsWith("arXiv ·");
  const timeout = isArxiv ? 30_000 : FETCH_TIMEOUT_MS;
  const response = await fetchWithRetry(source.url, { headers: { "User-Agent": "physical-ai-news-cn/1.0" } }, { timeoutMs: timeout, attempts: isArxiv ? 3 : 2 });
  return parseRssText(await response.text(), source);
}
