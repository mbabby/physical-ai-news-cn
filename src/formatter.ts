import type { Article, FetchFailure, IndustryPulse, WeeklyArticle } from "./types.js";
import { hasCompleteChineseCopy, publicArticlesOnly } from "./publication.js";

function date(value: Date): string { return value.toISOString().slice(0, 10); }
function shortDate(value: Date): string { return value.toISOString().slice(5, 10); }

function renderArticle(lines: string[], article: Article, heading = "##", forceResearch = false): void {
  const title = article.titleZh!;
  const tags = forceResearch ? ["研究", ...article.tags.filter((tag) => tag !== "产品" && tag !== "落地")] : article.tags;
  const meta = [forceResearch ? "研究与数据" : article.pulseKind ?? article.kind ?? "未分类", article.source, shortDate(article.publishedAt), ...[...new Set(tags)].slice(0, 2).map((tag) => `#${tag}`)].join(" · ");
  lines.push(`${heading} [${title}](${article.link})`, "", article.summaryZh!, `*${meta}*`, "");
}

export function formatMarkdown(articles: Article[], windowHours: number, _failures: FetchFailure[] = [], now = new Date(), pulse: IndustryPulse = { viewpoints: [], events: [] }, totalArticles = articles.length, sourceNetwork = "", research: Article[] = []): string {
  const publicNews = publicArticlesOnly(articles);
  const publicViewpoints = publicArticlesOnly(pulse.viewpoints);
  const publicPulseEvents = publicArticlesOnly(pulse.events);
  const publicResearch = publicArticlesOnly(research);
  const publishedIndustryCount = publicNews.length + publicViewpoints.length + publicPulseEvents.length;
  const lines = [`# 物理 AI 每日资讯 — ${date(now)}`, "", `过去 ${windowHours} 小时 · 产业与资本 ${Math.min(totalArticles, publishedIndustryCount)} 条 · 学术研究 ${publicResearch.length} 篇`, ""];
  if (publicViewpoints.length || publicPulseEvents.length) {
    lines.push("## 行业脉搏", "", "> 领军人物公开观点与已核验的关键产业事件；观点不等同于事实结论。", "");
    if (publicViewpoints.length) {
      lines.push("### 人物观点", "");
      for (const article of publicViewpoints) renderArticle(lines, article, "####");
    }
    if (publicPulseEvents.length) {
      lines.push("### 关键事件", "");
      for (const article of publicPulseEvents) renderArticle(lines, article, "####");
    }
  }
  if (publicNews.length) lines.push("## 今日其它资讯", "");
  if (!publicNews.length && !publicViewpoints.length && !publicPulseEvents.length && !publicResearch.length) lines.push("> 今日暂无达到发布阈值的高优先级事件。严格筛选不等于停止跟踪。", "", "**仍在跟踪**：官方发布、开源项目、行业部署与重点公司动态。", sourceNetwork ? `\n*${sourceNetwork}*` : "");
  for (const article of publicNews) renderArticle(lines, article, publicNews.length ? "###" : "##");
  if (publicResearch.length) {
    lines.push("## 学术与研究前沿", "", "> 近 30 天论文池每日重排；仅展示已完成中文事实简介的研究。", "");
    for (const article of publicResearch) renderArticle(lines, article, "###", true);
  }
  if (sourceNetwork) lines.push(`*${sourceNetwork}*`, "");
  lines.push("---", "", "*本页由自动化生成；链接与摘要仅供信息参考，请以原始来源为准。*");
  return lines.join("\n");
}

/** Convert a complete daily archive page into a subsection suitable for README. */
export function formatHomepageDigest(dailyMarkdown: string): string {
  return dailyMarkdown
    .replace(/^#### /gm, "###### ")
    .replace(/^### /gm, "##### ")
    .replace(/^## /gm, "#### ")
    .replace(/^# 物理 AI 每日资讯 — (.+)$/m, "### 最新日报 · $1")
    .replace(/^(过去 \d+ 小时 · .+)$/m, "> $1")
    .replace(/^---\n\n\*本页由自动化生成；链接与摘要仅供信息参考，请以原始来源为准。\*$/m, "");
}

export function formatWeeklyMarkdown(articles: WeeklyArticle[], week: string): string {
  const publicArticles = articles.filter(hasCompleteChineseCopy);
  const lines = [`# 物理 AI 本周精选 — ${week}`, "", `过去 7 天 · ${publicArticles.length} 条高影响事件 · 投融资与产业动态优先`, ""];
  if (!publicArticles.length) lines.push("本周暂无达到首页展示阈值的高影响事件。日报仍会持续更新。");
  for (const article of publicArticles) {
    const title = article.titleZh!;
    const meta = [`${article.kind ?? "未分类"}`, article.source, shortDate(article.publishedAt), ...article.tags.slice(0, 2).map((tag) => `#${tag}`)].join(" · ");
    lines.push(`## [${title}](${article.link})`, "", article.summaryZh!, "", `> 入选原因：${article.selectionReason}`, "", `*${meta}*`, "");
  }
  lines.push("---", "", "*本页由自动化生成；链接与摘要仅供信息参考，请以原始来源为准。*");
  return lines.join("\n");
}

export function formatHomepageWeekly(weeklyMarkdown: string): string {
  if (/过去 7 天 · 0 条高影响事件/.test(weeklyMarkdown)) return "> 本周尚未形成满足阈值的重大事件；可查看上方“最近确证”。";
  return weeklyMarkdown
    .replace(/^# 物理 AI 本周精选 — (.+)$/m, "> 自动周榜 · $1")
    .replace(/^(过去 7 天 · .+)$/m, "**$1**")
    .replace(/^## /gm, "#### ")
    .replace(/^---\n\n\*本页由自动化生成；链接与摘要仅供信息参考，请以原始来源为准。\*$/m, "");
}

export function formatRecentConfirmed(articles: Article[]): string {
  if (!articles.length) return "> 近期暂无可回溯的确证事件。";
  const lines = ["> 当日没有新事件时，这里展示过去 30 天最近确证的高可信进展。", ""];
  for (const article of articles.slice(0, 3)) lines.push(`- **${shortDate(article.publishedAt)}** · [${article.titleZh ?? article.title}](${article.link})`);
  return lines.join("\n");
}
