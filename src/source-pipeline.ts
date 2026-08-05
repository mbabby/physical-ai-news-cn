import type { CandidateSource, CandidateSourceRegistry, DailyArchive, DiscoveredSource, RssSourceConfig } from "./types.js";

const SHADOW_DAYS = 14;
const MAX_DYNAMIC_SOURCES = 8;

function sourceName(domain: string): string { return `自动发现 · ${domain}`; }

export function findFeedUrl(html: string, pageUrl: string): string | undefined {
  const matches = [...html.matchAll(/<link\b[^>]*>/gi)].map((match) => match[0]);
  for (const tag of matches) {
    const rel = /\brel\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1]?.toLowerCase() ?? "";
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1]?.toLowerCase() ?? "";
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (href && rel.includes("alternate") && /(rss|atom|xml)/.test(type)) return new URL(href, pageUrl).toString();
  }
  try {
    const url = new URL(pageUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    if (url.hostname === "github.com" && parts.length >= 2) return `https://github.com/${parts[0]}/${parts[1]}/releases.atom`;
  } catch {}
  return undefined;
}

export async function resolveCandidateFeeds(candidates: DiscoveredSource[]): Promise<DiscoveredSource[]> {
  const results = await Promise.all(candidates.slice(0, 6).map(async (candidate) => {
    const githubFeed = findFeedUrl("", candidate.link);
    if (githubFeed) return { ...candidate, feedUrl: githubFeed };
    try {
      const response = await fetch(candidate.link, { signal: AbortSignal.timeout(8_000), headers: { "User-Agent": "physical-ai-news-cn/1.0" } });
      if (!response.ok) return candidate;
      return { ...candidate, feedUrl: findFeedUrl(await response.text(), candidate.link) };
    } catch { return candidate; }
  }));
  return results;
}

function dayDifference(left: string, right: Date): number { return Math.floor((right.getTime() - new Date(left).getTime()) / 86_400_000); }

export function updateCandidateRegistry(existing: CandidateSourceRegistry | undefined, discovered: DiscoveredSource[], archives: DailyArchive[], now = new Date()): CandidateSourceRegistry {
  const byDomain = new Map((existing?.sources ?? []).map((source) => [source.domain, source]));
  for (const item of discovered) {
    const prior = byDomain.get(item.domain);
    byDomain.set(item.domain, {
      domain: item.domain, title: item.title, link: item.link, feedUrl: item.feedUrl ?? prior?.feedUrl,
      status: prior?.status ?? (item.feedUrl ? "影子观察" : "候选"),
      firstSeenAt: prior?.firstSeenAt ?? now.toISOString(), lastSeenAt: now.toISOString(),
      successfulRuns: prior?.successfulRuns ?? 0, failedRuns: prior?.failedRuns ?? 0, selectedArticles: prior?.selectedArticles ?? 0,
    });
  }
  const next = [...byDomain.values()].map((candidate) => {
    const outcomes = archives.flatMap((archive) => archive.sourceOutcomes ?? []).filter((outcome) => outcome.source === sourceName(candidate.domain));
    const successfulRuns = outcomes.filter((outcome) => outcome.status === "success").length;
    const failedRuns = outcomes.filter((outcome) => outcome.status === "failure").length;
    const selectedArticles = archives.flatMap((archive) => archive.articles).filter((article) => article.source === sourceName(candidate.domain)).length;
    let status = candidate.status;
    if (!candidate.feedUrl) status = "候选";
    else if (status === "影子观察" && dayDifference(candidate.firstSeenAt, now) >= SHADOW_DAYS && successfulRuns >= 5 && selectedArticles >= 2) status = "已启用";
    else if (status === "已启用" && successfulRuns + failedRuns >= 5 && successfulRuns / (successfulRuns + failedRuns) < 0.6) status = "已暂停";
    return { ...candidate, status, successfulRuns, failedRuns, selectedArticles };
  });
  return { updatedAt: now.toISOString(), sources: next.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)) };
}

export function dynamicSources(registry?: CandidateSourceRegistry): RssSourceConfig[] {
  return (registry?.sources ?? []).filter((source) => (source.status === "影子观察" || source.status === "已启用") && Boolean(source.feedUrl)).slice(0, MAX_DYNAMIC_SOURCES).map((source) => ({
    type: "rss", name: sourceName(source.domain), url: source.feedUrl!, weight: source.status === "已启用" ? 6 : 3,
    keywords: ["robot", "robotics", "humanoid", "embodied", "physical ai", "vla", "world model"],
  }));
}

export function sourceNetworkSummary(registry?: CandidateSourceRegistry, baseSourceCount = 0): string {
  const sources = registry?.sources ?? [];
  if (!sources.length) return baseSourceCount ? `信源：${baseSourceCount} 个基础信源已接入` : "";
  const active = sources.filter((source) => source.status === "已启用").length;
  const shadow = sources.filter((source) => source.status === "影子观察").length;
  const base = baseSourceCount ? `${baseSourceCount} 个基础信源已接入` : "基础信源已接入";
  return `信源：${base} · 自动发现 ${active} 个已启用、${shadow} 个影子观察`;
}
