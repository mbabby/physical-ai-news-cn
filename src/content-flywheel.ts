import type { Article, DailyArchive, DiscoveredSource, SourceConfig, SourceRegistry, SourceRegistryEntry, WeeklyArticle } from "./types.js";

const DISCOVERY_WORDS = ["robot", "robotics", "humanoid", "embodied", "physical ai", "vla", "world model"];
const REGISTRY_WINDOW_DAYS = 30;

function clamp(value: number, minimum: number, maximum: number): number { return Math.min(maximum, Math.max(minimum, value)); }
function host(value: string): string | undefined { try { return new URL(value).hostname.replace(/^www\./, ""); } catch { return undefined; } }

export function applyRegistryWeights(sources: SourceConfig[], registry?: SourceRegistry): SourceConfig[] {
  const byName = new Map(registry?.sources.map((entry) => [entry.name, entry]) ?? []);
  return sources.map((source) => {
    const entry = byName.get(source.name);
    const totalRuns = (entry?.successfulRuns ?? 0) + (entry?.failedRuns ?? 0);
    let adjustment = 0;
    if (totalRuns >= 5 && (entry?.reliability ?? 1) < 0.6) adjustment = -2;
    else if (totalRuns >= 5 && (entry?.reliability ?? 1) < 0.8) adjustment = -1;
    else if (totalRuns >= 5 && (entry?.reliability ?? 0) >= 0.9 && (entry?.selectedArticles ?? 0) >= 3) adjustment = 1;
    return { ...source, weight: clamp(source.weight + adjustment, 1, 10) };
  });
}

export function discoverSourceCandidates(articles: Article[], configuredSources: SourceConfig[]): DiscoveredSource[] {
  const configuredDomains = new Set(configuredSources.flatMap((source) => source.type === "rss" ? [host(source.url)] : []).filter(Boolean));
  const seen = new Set<string>();
  return articles.flatMap((article) => {
    if (!article.source.startsWith("Hacker News") || !DISCOVERY_WORDS.some((word) => article.title.toLowerCase().includes(word))) return [];
    const domain = host(article.link);
    if (!domain || domain === "news.ycombinator.com" || configuredDomains.has(domain) || seen.has(domain)) return [];
    seen.add(domain);
    return [{ domain, title: article.title, link: article.link }];
  });
}

export function buildSourceRegistry(archives: DailyArchive[], configuredSources: SourceConfig[], effectiveSources = configuredSources, now = new Date()): SourceRegistry {
  const cutoff = now.getTime() - REGISTRY_WINDOW_DAYS * 24 * 3_600_000;
  const recent = archives.filter((archive) => new Date(`${archive.date}T23:59:59.999Z`).getTime() >= cutoff);
  const sources = configuredSources.map((source): SourceRegistryEntry => {
    const effectiveWeight = effectiveSources.find((item) => item.name === source.name)?.weight ?? source.weight;
    const outcomes = recent.flatMap((archive) => archive.sourceOutcomes ?? []).filter((outcome) => outcome.source === source.name);
    const successfulRuns = outcomes.filter((outcome) => outcome.status === "success").length;
    const failedRuns = outcomes.filter((outcome) => outcome.status === "failure").length;
    const selectedArticles = recent.flatMap((archive) => archive.articles).filter((article) => article.source === source.name).length;
    const reliability = outcomes.length ? Number((successfulRuns / outcomes.length).toFixed(2)) : undefined;
    const recommendation = outcomes.length >= 5 && (reliability ?? 1) < 0.8 ? "排查" : selectedArticles === 0 && recent.length >= 14 ? "观察" : "保留";
    return { name: source.name, type: source.type, configuredWeight: source.weight, effectiveWeight, successfulRuns, failedRuns, selectedArticles, reliability, recommendation };
  });
  return { updatedAt: now.toISOString(), windowDays: REGISTRY_WINDOW_DAYS, sources };
}

export function aggregateSourceCandidates(archives: DailyArchive[]): Array<DiscoveredSource & { days: number }> {
  const grouped = new Map<string, { item: DiscoveredSource; dates: Set<string> }>();
  for (const archive of archives) for (const candidate of archive.discoveredSources ?? []) {
    const value = grouped.get(candidate.domain) ?? { item: candidate, dates: new Set<string>() };
    value.dates.add(archive.date); grouped.set(candidate.domain, value);
  }
  return [...grouped.values()].filter((value) => value.dates.size >= 2).map((value) => ({ ...value.item, days: value.dates.size })).sort((a, b) => b.days - a.days);
}

export function selectWatchlistCandidates(articles: WeeklyArticle[]): WeeklyArticle[] {
  return articles.filter((article) => article.sourceWeight >= 7 && Boolean(article.excerpt.trim()) && (article.score ?? 0) >= 85).slice(0, 5);
}

export function formatWatchlistMarkdown(articles: WeeklyArticle[], week: string): string {
  const lines = ["# 常青资源观察名单", "", `自动更新 · ${week}`, "", "这里的内容已通过基础可信度与相关性筛选，但尚未进入常青资源主目录。它们需要在后续日报、源码活跃度或行业采用中继续获得证据。", ""];
  if (!articles.length) lines.push("本周暂无达到观察名单阈值的新条目。");
  for (const article of articles) lines.push(`## [${article.titleZh ?? article.title}](${article.link})`, "", article.summaryZh ?? "暂无原文摘要，请阅读原文。", "", `- 候选原因：${article.selectionReason}`, `- 来源：${article.source} · ${article.kind ?? "未分类"}`, "");
  lines.push("---", "", "*观察名单由自动化生成；进入主资源目录前仍需人工或社区复核。*");
  return lines.join("\n");
}

export function formatReviewMarkdown(registry: SourceRegistry, candidates: Array<DiscoveredSource & { days: number }>, watchlist: WeeklyArticle[], week: string): string {
  const lines = [`# 内容飞轮审核建议 — ${week}`, "", "本页由自动化生成，供维护者在每周例行审核时快速决策。", "", "## 待接入信源", ""];
  if (!candidates.length) lines.push("本周没有在至少两个独立日期重复出现的新来源域名。");
  for (const candidate of candidates) lines.push(`- **${candidate.domain}**：在 ${candidate.days} 个日期出现；样例：[${candidate.title}](${candidate.link})。建议检查是否存在官方 RSS、Atom、Releases 或新闻页。`);
  lines.push("", "## 待晋升常青资源", "");
  if (!watchlist.length) lines.push("本周没有达到观察名单阈值的新条目。");
  for (const article of watchlist) lines.push(`- [${article.titleZh ?? article.title}](${article.link})：${article.selectionReason}`);
  lines.push("", "## 信源维护", "");
  for (const source of registry.sources.filter((item) => item.recommendation !== "保留")) lines.push(`- **${source.name}**：${source.recommendation}；成功 ${source.successfulRuns} 次，失败 ${source.failedRuns} 次，入选 ${source.selectedArticles} 条。`);
  if (!registry.sources.some((item) => item.recommendation !== "保留")) lines.push("本周没有需要排查或降级的已接入信源。");
  lines.push("", "## 权重变动规则", "", "当某信源累计至少 5 次运行后：成功率低于 80% 自动降 1 分，低于 60% 自动降 2 分；成功率至少 90%、且近 30 天入选至少 3 条时自动升 1 分。所有变动限制在 1–10 分。", "");
  return lines.join("\n");
}
