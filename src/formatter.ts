import type { Article, FetchFailure, IndustryPulse, WeeklyArticle } from "./types.js";

function date(value: Date): string { return value.toISOString().slice(0, 10); }
function shortDate(value: Date): string { return value.toISOString().slice(5, 10); }

function renderArticle(lines: string[], article: Article, heading = "##"): void {
  const title = article.titleZh ?? article.title;
  const meta = [article.pulseKind ?? article.kind ?? "未分类", article.source, shortDate(article.publishedAt), ...article.tags.slice(0, 2).map((tag) => `#${tag}`)].join(" · ");
  lines.push(`${heading} [${title}](${article.link})`, "", article.summaryZh ?? "暂无原文摘要，请阅读原文。", `*${meta}*`, "");
}

export function formatMarkdown(articles: Article[], windowHours: number, _failures: FetchFailure[] = [], now = new Date(), pulse: IndustryPulse = { viewpoints: [], events: [] }, totalArticles = articles.length, sourceNetwork = ""): string {
  const lines = [`# 物理 AI 每日资讯 — ${date(now)}`, "", `过去 ${windowHours} 小时 · ${totalArticles} 条精选 · 投融资与产业动态优先`, ""];
  if (pulse.viewpoints.length || pulse.events.length) {
    lines.push("## 行业脉搏", "", "> 领军人物公开观点与已核验的关键产业事件；观点不等同于事实结论。", "");
    if (pulse.viewpoints.length) {
      lines.push("### 人物观点", "");
      for (const article of pulse.viewpoints) renderArticle(lines, article, "####");
    }
    if (pulse.events.length) {
      lines.push("### 关键事件", "");
      for (const article of pulse.events) renderArticle(lines, article, "####");
    }
  }
  if (articles.length) lines.push("## 今日其它资讯", "");
  if (!articles.length && !pulse.viewpoints.length && !pulse.events.length) lines.push("> 今日暂无达到发布阈值的高优先级事件。严格筛选不等于停止跟踪。", "", "**仍在跟踪**：官方发布、开源项目、行业部署与重点公司动态。", sourceNetwork ? `\n*${sourceNetwork}*` : "");
  for (const article of articles) renderArticle(lines, article, articles.length ? "###" : "##");
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
  const lines = [`# 物理 AI 本周精选 — ${week}`, "", `过去 7 天 · ${articles.length} 条高影响事件 · 投融资与产业动态优先`, ""];
  if (!articles.length) lines.push("本周暂无达到首页展示阈值的高影响事件。日报仍会持续更新。");
  for (const article of articles) {
    const title = article.titleZh ?? article.title;
    const meta = [`${article.kind ?? "未分类"}`, article.source, shortDate(article.publishedAt), ...article.tags.slice(0, 2).map((tag) => `#${tag}`)].join(" · ");
    lines.push(`## [${title}](${article.link})`, "", article.summaryZh ?? "暂无原文摘要，请阅读原文。", "", `> 入选原因：${article.selectionReason}`, "", `*${meta}*`, "");
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
