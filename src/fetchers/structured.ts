import { createHash } from "node:crypto";
import { FETCH_TIMEOUT_MS } from "../config.js";
import { fetchWithRetry } from "../runtime/http.js";
import type { Article, GithubReleasesSourceConfig, SitemapSourceConfig, WebPageSourceConfig, YoutubeSourceConfig } from "../types.js";
import { fetchRssSource } from "./rss.js";

function id(link: string): string { return createHash("sha256").update(link).digest("hex").slice(0, 16); }
function decode(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;|&#34;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/\s+/g, " ").trim();
}
function titleFromUrl(value: string): string {
  try {
    const part = new URL(value).pathname.split("/").filter(Boolean).at(-1) ?? "";
    return decodeURIComponent(part).replace(/[-_]+/g, " ").replace(/\.(?:html?|php)$/i, "").trim();
  } catch { return value; }
}
function parsedDate(value: string): Date | undefined {
  const match = value.match(/(?:20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}(?:日)?(?:[T\s][0-9:.+\-Z]+)?|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+20\d{2})/i)?.[0];
  if (!match) return undefined;
  const date = new Date(match.replace(/年|月/g, "-").replace(/日/g, ""));
  return Number.isNaN(date.getTime()) ? undefined : date;
}
function allowed(link: string, pattern?: string): boolean {
  if (!pattern) return true;
  try { return new RegExp(pattern, "i").test(link); } catch { return false; }
}
function anchorContext(html: string, offset: number, anchorLength: number): string {
  // Prefer the anchor's own semantic card. A wide sliding window can borrow a
  // date from the previous news card and falsely make an undated archive item
  // look current.
  const before = html.slice(0, offset);
  const containers = ["article", "li", "section", "div"]
    .map((tag) => ({ tag, start: before.toLowerCase().lastIndexOf(`<${tag}`) }))
    .filter((item) => item.start >= 0)
    .sort((a, b) => b.start - a.start);
  for (const container of containers) {
    const close = html.toLowerCase().indexOf(`</${container.tag}>`, offset + anchorLength);
    if (close >= 0 && close - container.start <= 4_000) return html.slice(container.start, close + container.tag.length + 3);
  }
  return html.slice(Math.max(0, offset - 120), Math.min(html.length, offset + anchorLength + 180));
}

/** Conservative company-news parser. Entries without an explicit nearby date
 * are ignored so the first crawl never republishes an undated archive as new. */
export function parseWebPage(html: string, source: WebPageSourceConfig, fetchedAt = new Date()): Article[] {
  const seen = new Set<string>(); const output: Article[] = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let link: string;
    try { link = new URL(match[1], source.url).toString(); } catch { continue; }
    if (!allowed(link, source.linkPattern) || seen.has(link)) continue;
    const title = decode(match[2]);
    if (title.length < 8 || title.length > 180) continue;
    const offset = match.index ?? 0;
    const context = decode(anchorContext(html, offset, match[0].length));
    const publishedAt = parsedDate(context);
    if (!publishedAt) continue;
    seen.add(link);
    output.push({ id: id(link), title, link, publishedAt, fetchedAt, source: source.name, sourceWeight: source.weight, excerpt: context.slice(0, 500), tags: [] });
    if (output.length >= (source.maxItems ?? 20)) break;
  }
  return output;
}

export function parseSitemap(xml: string, source: SitemapSourceConfig, fetchedAt = new Date()): Article[] {
  const output: Article[] = [];
  for (const block of xml.matchAll(/<url>([\s\S]*?)<\/url>/gi)) {
    const link = decode(block[1].match(/<loc>([\s\S]*?)<\/loc>/i)?.[1] ?? "");
    const lastmod = decode(block[1].match(/<lastmod>([\s\S]*?)<\/lastmod>/i)?.[1] ?? "");
    if (!link || !lastmod || !allowed(link, source.linkPattern)) continue;
    const publishedAt = new Date(lastmod);
    if (Number.isNaN(publishedAt.getTime())) continue;
    output.push({ id: id(link), title: titleFromUrl(link), link, publishedAt, fetchedAt, source: source.name, sourceWeight: source.weight, excerpt: "", tags: [] });
    if (output.length >= (source.maxItems ?? 50)) break;
  }
  return output;
}

export async function fetchWebPageSource(source: WebPageSourceConfig): Promise<Article[]> {
  const response = await fetchWithRetry(source.url, { headers: { "User-Agent": "physical-ai-news-cn/1.0" } }, { timeoutMs: FETCH_TIMEOUT_MS });
  return parseWebPage(await response.text(), source);
}
export async function fetchSitemapSource(source: SitemapSourceConfig): Promise<Article[]> {
  const response = await fetchWithRetry(source.url, { headers: { "User-Agent": "physical-ai-news-cn/1.0" } }, { timeoutMs: FETCH_TIMEOUT_MS });
  return parseSitemap(await response.text(), source);
}
export async function fetchGithubReleasesSource(source: GithubReleasesSourceConfig): Promise<Article[]> {
  return fetchRssSource({ ...source, type: "rss", url: `https://github.com/${source.repo}/releases.atom` });
}
export async function fetchYoutubeSource(source: YoutubeSourceConfig): Promise<Article[]> {
  return fetchRssSource({ ...source, type: "rss", url: `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(source.channelId)}` });
}
