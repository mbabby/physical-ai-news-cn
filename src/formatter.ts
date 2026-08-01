import type { Article, FetchFailure } from "./types.js";

function date(value: Date): string { return value.toISOString().slice(0, 10); }
function shortDate(value: Date): string { return value.toISOString().slice(5, 10); }

export function formatMarkdown(articles: Article[], windowHours: number, failures: FetchFailure[] = [], now = new Date()): string {
  const lines = [`# 物理 AI 每日资讯 — ${date(now)}`, "", `过去 ${windowHours} 小时 · ${articles.length} 条精选 · 投融资与产业动态优先`, ""];
  if (!articles.length) lines.push("暂无符合收录标准的资讯。");
  for (const article of articles) {
    const title = article.titleZh ?? article.title;
    const meta = [`${article.kind ?? "未分类"}`, article.source, shortDate(article.publishedAt), ...article.tags.slice(0, 2).map((tag) => `#${tag}`)].join(" · ");
    lines.push(`## [${title}](${article.link})`, "", article.summaryZh ?? "", `*${meta}*`, "");
  }
  if (failures.length) {
    lines.push("---", "", "## 抓取状态", "");
    for (const failure of failures) lines.push(`- ${failure.source}：失败（${failure.reason}）`);
    lines.push("");
  }
  lines.push("---", "", "*本页由自动化生成；链接与摘要仅供信息参考，请以原始来源为准。*");
  return lines.join("\n");
}

/** Convert a complete daily archive page into a subsection suitable for README. */
export function formatHomepageDigest(dailyMarkdown: string): string {
  return dailyMarkdown
    .replace(/^# 物理 AI 每日资讯 — (.+)$/m, "### 最新日报 · $1")
    .replace(/^## /gm, "#### ")
    .replace(/^---\n\n\*本页由自动化生成；链接与摘要仅供信息参考，请以原始来源为准。\*$/m, "");
}
