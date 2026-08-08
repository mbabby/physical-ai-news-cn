import type { Article } from "./types.js";

const PUBLIC_PLACEHOLDERS = /暂无(?:中文简介|原文摘要)|中文简介暂未生成|暂未生成中文摘要|原文摘要[:：]|原文未提供摘要|请阅读(?:原文|论文原文)|自动摘要失败|未配置(?:模型|摘要服务)/i;

export function hasChineseText(value: string | undefined): value is string {
  return Boolean(value?.trim() && /[\u3400-\u9fff]/.test(value));
}

export function isPlaceholderCopy(value: string | undefined): boolean {
  return !value?.trim() || PUBLIC_PLACEHOLDERS.test(value);
}

/**
 * The single publishing gate used by every public surface. Raw titles,
 * excerpts and failed model output belong in the review/candidate layer.
 */
export function hasCompleteChineseCopy(article: Pick<Article, "titleZh" | "summaryZh">): boolean {
  return hasChineseText(article.titleZh) && hasChineseText(article.summaryZh)
    && !isPlaceholderCopy(article.titleZh) && !isPlaceholderCopy(article.summaryZh);
}

export function publicArticlesOnly<T extends Pick<Article, "titleZh" | "summaryZh">>(articles: T[]): T[] {
  return articles.filter(hasCompleteChineseCopy);
}

/** Reuse verified copy for the same source item when today's LLM call fails. */
export function preferKnownGoodArticles(current: Article[], historical: Article[]): Article[] {
  const known = new Map(historical.filter(hasCompleteChineseCopy).map((article) => [article.id, article]));
  return current.map((article) => {
    const prior = known.get(article.id);
    if (!prior || hasCompleteChineseCopy(article)) return article;
    return { ...article, titleZh: prior.titleZh, summaryZh: prior.summaryZh };
  });
}
