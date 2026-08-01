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
  const text = `${article.title} ${article.excerpt}`.toLowerCase();
  const relevance = PHYSICAL_AI_WORDS.filter((word) => text.includes(word)).length;
  if (relevance === 0) return undefined;
  const rule = RULES.find((candidate) => candidate.words.some((word) => text.includes(word)));
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
