import type { Article, DailyArchive, ResearchRecord } from "./types.js";

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

/** Research cards are deliberately stricter than a news brief: the title
 * must be a real Chinese rendering (unless the source title was Chinese), and
 * the explanation must contain two factual sentences. */
export function hasCompleteChineseResearchCopy(article: Pick<Article, "title" | "titleZh" | "summaryZh">): boolean {
  if (!hasCompleteChineseCopy(article)) return false;
  const titleChinese = (article.titleZh?.match(/[\u3400-\u9fff]/g) ?? []).length;
  const sourceHasChinese = /[\u3400-\u9fff]/.test(article.title);
  if (titleChinese < 4 || (!sourceHasChinese && article.titleZh?.trim() === article.title.trim())) return false;
  const sentences = article.summaryZh?.match(/[。！？]/g)?.length ?? 0;
  return sentences >= 2;
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

/** A no-translation fallback for complete Chinese first-party announcements.
 * It is intentionally unavailable to research, media and discovery sources. */
export function withDeterministicChineseOfficialFallback(article: Article): Article {
  const mayReuseOriginalChinese = article.kind !== "研究与数据"
    && !article.source.startsWith("arXiv ·")
    && article.sourceTier === "官方公司与实验室"
    && article.sourceWeight >= 9
    && hasCompleteChineseCopy({ titleZh: article.title, summaryZh: article.excerpt });
  if (!mayReuseOriginalChinese || hasCompleteChineseCopy(article)) return article;
  return { ...article, titleZh: article.title.trim(), summaryZh: article.excerpt.trim() };
}

/** Recover the actual cards that cleared publication in recent archives.
 * Registry refreshes may update metadata or copy, but they must not erase a
 * previously published, still-valid Chinese card during an upstream outage. */
export function recoverPublishedResearchRecords(archives: DailyArchive[], previous: ResearchRecord[]): ResearchRecord[] {
  const previousById = new Map(previous.map((record) => [record.id, record]));
  const seen = new Set<string>();
  const records: ResearchRecord[] = [];
  for (const archive of [...archives].sort((a, b) => b.date.localeCompare(a.date))) {
    for (const raw of archive.articles) {
      if (seen.has(raw.id) || !raw.source.startsWith("arXiv · Robotics")) continue;
      const article = { ...raw, publishedAt: new Date(raw.publishedAt), fetchedAt: new Date(raw.fetchedAt) };
      if (!hasCompleteChineseResearchCopy(article)) continue;
      const prior = previousById.get(article.id);
      if (!prior || prior.article.scholar?.isRetracted) continue;
      seen.add(article.id);
      records.push({ ...prior, article: { ...article, scholar: prior.article.scholar ?? article.scholar } });
    }
  }
  return records;
}
