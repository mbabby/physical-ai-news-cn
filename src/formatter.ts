import type { Article, FetchFailure } from "./types.js";

function date(value: Date): string { return value.toISOString().slice(0, 10); }
function dateTime(value: Date): string { return value.toISOString().replace("T", " ").slice(0, 16) + " UTC"; }

export function formatMarkdown(articles: Article[], windowHours: number, failures: FetchFailure[] = [], now = new Date()): string {
  const lines = [`# 物理 AI 每日资讯 — ${date(now)}`, "", `最近 ${windowHours} 小时精选 ${articles.length} 条（产业优先，最多 10 条）。`, ""];
  if (!articles.length) lines.push("暂无符合收录标准的资讯。");
  for (const article of articles) {
    lines.push(`## ${article.titleZh ?? article.title}`, "", `- 原文：[${article.title}](${article.link})`, `- 来源：${article.source}（可信度权重 ${article.sourceWeight}/10）`, `- 发布时间：${dateTime(article.publishedAt)}`, `- 分类：${article.kind ?? "未分类"}`, `- 标签：${article.tags.map((tag) => `\`${tag}\``).join(" ") || "`待标注`"}`, "- 中文摘要：", article.summaryZh ?? "暂未生成摘要。", "");
  }
  if (failures.length) {
    lines.push("---", "", "## 抓取状态", "");
    for (const failure of failures) lines.push(`- ${failure.source}：失败（${failure.reason}）`);
    lines.push("");
  }
  lines.push("---", "", "*本页由自动化生成；链接与摘要仅供信息参考，请以原始来源为准。*");
  return lines.join("\n");
}
