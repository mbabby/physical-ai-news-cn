import type { Article, IndustryPulse } from "./types.js";

function unique(articles: Article[]): Article[] {
  const seen = new Set<string>();
  return articles.filter((article) => {
    if (seen.has(article.link)) return false;
    seen.add(article.link);
    return true;
  });
}

/**
 * 行业脉搏是日报的置顶入口：人物帖文是观点而非事实结论；关键事件则复用
 * 当天已通过相关性和可信度排序的新闻，避免用 X 单源制造产业结论。
 */
export function selectIndustryPulse(xArticles: Article[], selectedArticles: Article[]): IndustryPulse {
  const viewpoints = unique(xArticles.filter((article) => article.pulseKind === "人物观点").sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || b.publishedAt.getTime() - a.publishedAt.getTime())).slice(0, 2);
  const events = unique([
    ...xArticles.filter((article) => article.pulseKind === "关键事件"),
    ...selectedArticles.filter((article) => ["投融资", "产品发布", "公司商业", "部署案例"].includes(article.kind ?? "")),
  ]).slice(0, 3);
  return { viewpoints, events };
}

export function pulseArticleIds(pulse: IndustryPulse): Set<string> {
  return new Set([...pulse.events.map((article) => article.id)]);
}
