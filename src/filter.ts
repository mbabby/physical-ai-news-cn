import type { Article, ArticleKind } from "./types.js";

const RULES: Array<{ kind: ArticleKind; tags: string[]; words: string[] }> = [
  { kind: "投融资", tags: ["投融资"], words: ["funding", "funded", "raises", "raised", "raise", "series a", "series b", "seed round", "venture round", "valuation", "acquisition", "investment", "investor", "backed", "融资", "投资", "收购", "估值", "融资轮", "战略投资"] },
  { kind: "产品发布", tags: ["产品"], words: ["launch", "release", "introducing", "announce", "unveil", "发布", "推出"] },
  { kind: "公司商业", tags: ["产业"], words: ["partnership", "contract", "revenue", "commercial", "customer", "合作", "订单", "商业化"] },
  { kind: "部署案例", tags: ["落地"], words: ["deploy", "deployment", "factory", "warehouse", "customer", "deployed", "部署"] },
  { kind: "开源项目", tags: ["开源"], words: ["github", "open source", "repository", "code", "release"] },
  { kind: "研究与数据", tags: ["研究"], words: ["paper", "dataset", "benchmark", "arxiv", "research", "数据集"] },
];

const PHYSICAL_AI_WORDS = ["robot", "robotics", "humanoid", "embodied", "physical ai", "vla", "vision-language-action", "isaac", "groot", "lerobot", "manipulation", "autonomous driving", "world model", "具身", "人形机器人", "机器人"];
const FUNDING_TITLE_WORDS = ["funding", "funded", "raises", "raised", "series a", "series b", "series c", "seed round", "venture round", "valuation", "acquisition", "investment round", "融资", "投资", "收购", "估值", "融资轮", "战略投资"];
// These headlines look like capital news but describe secondary-market flows,
// a listed stock, or an adjacent acquisition rather than a physical-AI company
// financing / M&A event. They add noise without helping an operator track the
// companies building the field.
const FINANCIAL_MARKET_NOISE = /融资净买入|融资余额|资金流向|股票|股价|证券|仪表.*收购|跨界.*机器人/i;
const PUBLIC_FALLBACK = /暂无原文摘要|请阅读原文|自动摘要失败|未配置|暂未生成中文摘要|中文简介暂未生成|原文未提供摘要/i;
// A feed may be useful for discovery without being a factual event. Keep
// rankings, weekly roundups and commentary in the review layer instead.
const AGGREGATE_OR_COMMENTARY = /\btop\s*\d+\b|roundup|weekly\s+(?:robotics|funding|news)|best\s+of|commentary|opinion|analysis|十大|盘点|汇总|合集|榜单|评论|观点|解读|综述|报告|周报|月报/i;

function normalizedTitle(title: string): string { return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim(); }
export function normalizeUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (key.startsWith("utm_") || key === "ref") url.searchParams.delete(key);
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}
function titleSimilarity(a: string, b: string): number {
  const left = new Set(normalizedTitle(a).split(" ").filter(Boolean));
  const right = new Set(normalizedTitle(b).split(" ").filter(Boolean));
  const shared = [...left].filter((word) => right.has(word)).length;
  return shared / Math.max(1, new Set([...left, ...right]).size);
}

export function classify(article: Article): Article | undefined {
  // HN is intentionally a discovery channel, not a homepage source. Without
  // an original excerpt we cannot verify enough context to publish it as news.
  if (article.source.startsWith("Hacker News") && !article.excerpt.trim()) return undefined;
  const text = `${article.title} ${article.excerpt}`.toLowerCase();
  const relevance = PHYSICAL_AI_WORDS.filter((word) => text.includes(word)).length;
  if (relevance === 0) return undefined;
  // Source semantics are stronger than generic words in a paper abstract.
  // Otherwise an arXiv paper containing "release" or "deployment" is
  // incorrectly presented as a product launch or customer deployment.
  if (article.source.startsWith("arXiv ·")) {
    return {
      ...article,
      kind: "研究与数据",
      tags: [...new Set(["研究", ...PHYSICAL_AI_WORDS.filter((word) => text.includes(word)).slice(0, 3)])],
      score: article.sourceWeight * 10 + relevance * 4 + 4,
    };
  }
  // “investment” buried in a long article is not a financing event. Require the
  // financing language to be in the headline, otherwise let product/deployment
  // classification win.
  const titleText = article.title.toLowerCase();
  if (FINANCIAL_MARKET_NOISE.test(article.title)) return undefined;
  const funding = FUNDING_TITLE_WORDS.some((word) => titleText.includes(word)) && !/top funding|funding roundup|weekly funding|funding news/.test(titleText);
  const rule = funding ? RULES[0] : RULES.slice(1).find((candidate) => candidate.words.some((word) => text.includes(word)));
  const kind = rule?.kind ?? "公司商业";
  const tags = [...new Set([...(rule?.tags ?? ["产业"]), ...PHYSICAL_AI_WORDS.filter((word) => text.includes(word)).slice(0, 3)])];
  const priority: Record<ArticleKind, number> = { "投融资": 40, "产品发布": 28, "公司商业": 24, "部署案例": 20, "开源项目": 14, "研究与数据": 4 };
  return { ...article, kind, tags, score: article.sourceWeight * 10 + relevance * 4 + priority[kind] };
}

export function filterAndRank(articles: Article[], windowHours: number, limit = 10): Article[] {
  const cutoff = Date.now() - windowHours * 3_600_000;
  const candidates = articles.filter((item) => item.publishedAt.getTime() >= cutoff).flatMap((item) => {
    const classified = classify(item); return classified ? [classified] : [];
  });
  const unique: Article[] = [];
  for (const article of candidates.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || b.publishedAt.getTime() - a.publishedAt.getTime())) {
    const duplicate = unique.find((kept) => normalizeUrl(kept.link) === normalizeUrl(article.link) || titleSimilarity(kept.title, article.title) >= 0.75);
    if (!duplicate) unique.push(article);
  }
  return unique.slice(0, limit);
}

/** Industry and research use separate quotas so a busy arXiv day cannot hide capital or deployment facts. */
export function filterIndustryAndRank(articles: Article[], windowHours: number, limit = 10): Article[] {
  return filterAndRank(articles.filter((article) => !article.source.startsWith("arXiv · Robotics")), windowHours, limit);
}

export function publicHoldReasons(article: Article, hasTrackedCompany: boolean, requireCompany = true): string[] {
  const reasons: string[] = [];
  const title = article.titleZh?.trim() ?? "";
  const summary = article.summaryZh?.trim() ?? "";
  if (!title || !summary || !/[\u3400-\u9fff]/.test(title) || !/[\u3400-\u9fff]/.test(summary) || PUBLIC_FALLBACK.test(summary)) reasons.push("缺少完整中文事实简介");
  if (AGGREGATE_OR_COMMENTARY.test(`${article.title} ${article.titleZh ?? ""} ${article.excerpt}`)) reasons.push("聚合盘点或评论性质内容");
  if (article.sourceTier === "线索发现层") reasons.push("线索来源尚未完成二次核验");
  if (requireCompany && !hasTrackedCompany) reasons.push("公司主体未确认");
  return reasons;
}
