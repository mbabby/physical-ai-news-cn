import { createHash } from "node:crypto";
import { FETCH_TIMEOUT_MS } from "../config.js";
import type { Article, XSourceConfig } from "../types.js";

interface XResponse {
  data?: Array<{ id: string; text: string; author_id: string; created_at: string }>;
  includes?: { users?: Array<{ id: string; name: string; username: string }> };
}

function articleId(link: string): string {
  return createHash("sha256").update(link).digest("hex").slice(0, 16);
}

export function parseXResponse(payload: XResponse, source: XSourceConfig): Article[] {
  const people = new Map((payload.includes?.users ?? []).map((user) => [user.id, user]));
  const configured = new Map(source.accounts.map((account) => [account.handle.toLowerCase(), account]));
  return (payload.data ?? []).flatMap((post) => {
    const author = people.get(post.author_id);
    const account = author ? configured.get(author.username.toLowerCase()) : undefined;
    const publishedAt = new Date(post.created_at);
    if (!author || !account || Number.isNaN(publishedAt.getTime()) || !post.text.trim()) return [];
    const link = `https://x.com/${author.username}/status/${post.id}`;
    const isPerson = account.type === "人物";
    return [{
      id: articleId(link),
      title: `${account.label}：${post.text.replace(/\s+/g, " ").slice(0, 140)}`,
      link,
      publishedAt,
      fetchedAt: new Date(),
      source: `X · ${account.label}`,
      sourceWeight: source.weight,
      excerpt: post.text,
      tags: [],
      pulseKind: isPerson ? "人物观点" : "关键事件",
      speaker: account.label,
    }];
  });
}

export async function fetchXSource(source: XSourceConfig, bearerToken: string): Promise<Article[]> {
  const accounts = source.accounts.map((account) => `from:${account.handle}`).join(" OR ");
  const keywords = source.keywords.map((keyword) => keyword.includes(" ") ? `\"${keyword}\"` : keyword).join(" OR ");
  const query = `(${accounts}) (${keywords}) -is:retweet`;
  const url = new URL("https://api.x.com/2/tweets/search/recent");
  url.searchParams.set("query", query);
  url.searchParams.set("max_results", "100");
  url.searchParams.set("tweet.fields", "created_at,author_id");
  url.searchParams.set("expansions", "author_id");
  url.searchParams.set("user.fields", "name,username");
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { Authorization: `Bearer ${bearerToken}`, "User-Agent": "physical-ai-news-cn/1.0" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  return parseXResponse(await response.json() as XResponse, source);
}
