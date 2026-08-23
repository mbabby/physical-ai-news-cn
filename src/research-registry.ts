import { createHash } from "node:crypto";
import type { Article, ResearchClaim, ResearchClaimKind, ResearchRecord, ResearchRegistry } from "./types.js";
import { hasCompleteChineseResearchCopy } from "./publication.js";

const textOf = (article: Article): string => `${article.title}\n${article.excerpt}\n${article.authors?.join("|") ?? ""}\n${article.scholar?.workId ?? ""}\n${article.scholar?.citedByCount ?? ""}\n${article.scholar?.isRetracted ?? false}`;
export function arxivVersion(link: string): number | undefined {
  return Number(link.match(/v(\d+)(?:$|[?#])/i)?.[1]) || undefined;
}

const CLAIM_ORDER: ResearchClaimKind[] = ["真实机器人", "基准", "开源"];
const CLAIM_PATTERNS: Record<ResearchClaimKind, RegExp> = {
  "真实机器人": /\breal[- ]world\b|\breal[- ]robot\b|\bon[-]robot\b|\bphysical robot\b|实机|真实机器人|真机/i,
  "基准": /\bbenchmark\b|基准|\blibero\b|\brlbench\b|\bcalvin\b|\bmaniskill\b|\brobomimic\b|\bbridgedata\b/i,
  "开源": /github\.com|code (?:is )?available|open[- ]source|开源|(?:code|weights|dataset|repository) (?:is|are|has been|have been) released/i,
};
const CONTEXT_PATTERN = /\b(?:related work|prior work|previous work|existing (?:work|methods?|studies)|unlike|compared with prior)\b/i;
const FUTURE_PATTERN = /\b(?:will|plan(?:s|ned)? to|intend(?:s|ed)? to|to be|upon acceptance|after publication)\b.{0,60}\b(?:releas(?:e|ed)|publish(?:ed)?|open[- ]source|available)\b|\b(?:releas(?:e|ed)|publish(?:ed)?|open[- ]source)\b.{0,30}\b(?:later|future|soon)\b/i;
const NEGATION_PATTERN = /\b(?:no|not|without|never|neither|lack(?:s|ed|ing)?|does not|do not|did not|isn't|aren't|cannot)\b/i;
const SIMULATION_ONLY_PATTERN = /\b(?:only|solely|exclusively)\s+(?:in\s+)?simulat(?:ion|ed)|simulat(?:ion|ed)[^.!?]{0,50}\bonly\b/i;

function claimSentences(article: Article): Array<{ sourceField: "title" | "abstract"; text: string }> {
  const split = (value: string): string[] => value.split(/\n+|(?<=[.!?。！？])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
  return [
    ...split(article.title).map((text) => ({ sourceField: "title" as const, text })),
    ...split(article.excerpt).map((text) => ({ sourceField: "abstract" as const, text })),
  ];
}

function classifyClaim(kind: ResearchClaimKind, article: Article): ResearchClaim {
  const candidates = claimSentences(article).filter(({ text }) => CLAIM_PATTERNS[kind].test(text));
  const classified = candidates.map(({ sourceField, text }) => {
    const contextual = CONTEXT_PATTERN.test(text);
    const prospective = kind === "开源" && FUTURE_PATTERN.test(text);
    const negating = NEGATION_PATTERN.test(text) || (kind === "真实机器人" && SIMULATION_ONLY_PATTERN.test(text));
    const status = contextual ? "unknown" : prospective ? "announced" : negating ? "contradicted" : "verified";
    const polarity = contextual ? "contextual" : prospective ? "prospective" : negating ? "negating" : "supporting";
    return { kind, status, sourceField, sourceUrl: article.link, excerpt: text, polarity } satisfies ResearchClaim;
  });
  const verified = classified.filter((claim) => claim.status === "verified");
  const preferredVerified = kind === "基准"
    ? verified.find((claim) => /\blibero\b|\brlbench\b|\bcalvin\b|\bmaniskill\b|\brobomimic\b|\bbridgedata\b/i.test(claim.excerpt)) ?? verified[0]
    : verified[0];
  return classified.find((claim) => claim.status === "contradicted")
    ?? preferredVerified
    ?? classified.find((claim) => claim.status === "announced")
    ?? classified[0]
    ?? { kind, status: "unknown", sourceField: "none", sourceUrl: article.link, excerpt: "", polarity: "absent" };
}

/** Important claims always have an explicit state, including absence. */
export function researchClaims(article: Article): ResearchClaim[] {
  return CLAIM_ORDER.map((kind) => classifyClaim(kind, article));
}

export function researchEvidenceTags(article: Article): Array<"真实机器人" | "基准" | "开源"> {
  return researchClaims(article).filter((claim) => claim.status === "verified").map((claim) => claim.kind);
}

export function researchAuthorityLabels(article: Article): string[] {
  const value = `${article.authors?.join(" ") ?? ""} ${article.scholar?.authors.map((author) => `${author.name} ${author.institutions.join(" ")}`).join(" ") ?? ""} ${article.scholar?.institutions.join(" ") ?? ""}`.toLowerCase();
  const labels: Array<[string, RegExp]> = [
    ["Google DeepMind", /google deepmind|deepmind|danijar hafner|karol hausman|ted xiao/],
    ["Physical Intelligence", /physical intelligence|sergey levine|chelsea finn/],
    ["NVIDIA Research", /nvidia research|jim fan/],
    ["Meta AI", /meta ai|yann lecun|kaiming he/],
    ["Stanford", /stanford|fei-?fei li|dieter fox|jeannette bohg|shuran song/],
    ["UC Berkeley", /uc berkeley|berkeley|pieter abbeel/],
    ["MIT", /mit csail|massachusetts institute of technology|russ tedrake|pulkit agrawal/],
    ["CMU", /carnegie mellon|cmu robotics/],
    ["ETH Zurich", /eth zurich|marco hutter/],
    ["清华大学", /tsinghua|清华大学/],
    ["上海人工智能实验室", /shanghai ai lab|上海人工智能实验室/],
  ];
  return labels.filter(([, pattern]) => pattern.test(value)).map(([label]) => label).slice(0, 2);
}

function notableAuthor(article: Article): string | undefined {
  return [...(article.scholar?.authors ?? [])]
    .sort((a, b) => (b.totalCitations ?? 0) - (a.totalCitations ?? 0) || (b.hIndex ?? 0) - (a.hIndex ?? 0))[0]?.name;
}

function isComplete(article: Article): boolean {
  return hasCompleteChineseResearchCopy(article) && !article.scholar?.isRetracted;
}

function promotion(record: ResearchRecord): ResearchRecord["status"] {
  if (record.article.scholar?.isRetracted) return "已撤稿";
  if (!isComplete(record.article)) return "待复核";
  const evidence = record.evidenceTags.length;
  const citations = record.article.scholar?.citedByCount ?? 0;
  const observedDays = record.seenDates?.length ?? record.appearances;
  if (evidence >= 2 && ((record.authorityLabels.length > 0 && observedDays >= 4) || citations >= 250)) return "里程碑精读候选";
  if ((record.authorityLabels.length > 0 && evidence >= 1 && observedDays >= 3) || (citations >= 50 && evidence >= 1)) return "常青资源候选";
  if (evidence >= 1 && observedDays >= 2) return "候选资源";
  return "新论文";
}

/** Merge a 30-day pool and preserve source-backed metadata when one optional API call degrades. */
export function updateResearchRegistry(previous: ResearchRegistry | undefined, articles: Article[], now = new Date()): ResearchRegistry {
  const previousById = new Map((previous?.records ?? []).map((record) => [record.id, record]));
  const date = now.toISOString();
  const observedDate = date.slice(0, 10);
  const records = articles.map((incoming) => {
    const normalizedIncoming: Article = {
      ...incoming,
      kind: "研究与数据",
      tags: [...new Set(["研究", ...incoming.tags.filter((tag) => tag !== "产品" && tag !== "落地")])],
    };
    const prior = previousById.get(incoming.id);
    const article = prior?.article.scholar && !normalizedIncoming.scholar
      ? { ...normalizedIncoming, scholar: prior.article.scholar }
      : normalizedIncoming;
    const hash = createHash("sha256").update(textOf(article)).digest("hex").slice(0, 16);
    const version = arxivVersion(article.link);
    const changes = [...(prior?.changes ?? [])];
    if (!prior) changes.push({ date, kind: "新收录", detail: "进入近 30 天论文池。" });
    else if (article.scholar?.isRetracted && !prior.article.scholar?.isRetracted) changes.push({ date, kind: "撤稿", detail: "OpenAlex 标记该论文为撤稿，已从公开研究卡下架。" });
    else if (version && prior.arxivVersion && version > prior.arxivVersion) changes.push({ date, kind: "版本更新", detail: `arXiv 更新至 v${version}，等待中文简介与事实快照刷新。` });
    else if (prior.factHash !== hash) changes.push({ date, kind: "元数据更新", detail: "作者、机构、引用或来源元数据已更新。" });
    const record: ResearchRecord = {
      id: article.id, article, firstSeenAt: prior?.firstSeenAt ?? date, lastCheckedAt: date,
      lastShownAt: prior?.lastShownAt, arxivVersion: version, factHash: hash,
      status: prior?.status ?? "新论文", seenDates: [...new Set([...(prior?.seenDates ?? (prior?.firstSeenAt ? [prior.firstSeenAt.slice(0, 10)] : [])), observedDate])].sort(), appearances: (prior?.appearances ?? 0) + 1,
      evidenceTags: researchEvidenceTags(article), researchClaims: researchClaims(article), authorityLabels: researchAuthorityLabels(article), notableAuthor: notableAuthor(article), changes: changes.slice(-12),
    };
    record.status = promotion(record);
    return record;
  });
  return { updatedAt: date, records };
}

export function rankResearchRecords(records: ResearchRecord[]): ResearchRecord[] {
  const statusScore: Record<ResearchRecord["status"], number> = { "里程碑精读候选": 24, "常青资源候选": 18, "候选资源": 10, "新论文": 5, "待复核": -100, "已撤稿": -1000 };
  return [...records].filter((record) => record.status !== "已撤稿" && record.status !== "待复核")
    .sort((a, b) => (statusScore[b.status] + b.evidenceTags.length * 7 + b.authorityLabels.length * 12 + Math.min(10, Math.log10((b.article.scholar?.citedByCount ?? 0) + 1) * 3) + b.article.publishedAt.getTime() / 1e14) - (statusScore[a.status] + a.evidenceTags.length * 7 + a.authorityLabels.length * 12 + Math.min(10, Math.log10((a.article.scholar?.citedByCount ?? 0) + 1) * 3) + a.article.publishedAt.getTime() / 1e14));
}

export function researchPromotionMarkdown(registry: ResearchRegistry): string {
  const groups: Array<[ResearchRecord["status"], string]> = [["候选资源", "候选资源"], ["常青资源候选", "常青资源候选"], ["里程碑精读候选", "里程碑精读候选"]];
  const lines = ["# 研究晋升队列", "", "自动依据跨日观测、真实机器人/基准/开源证据、作者与实验室信号、引用和撤稿状态生成候选；重复运行不会累计跨日观测。常青资源与里程碑精读仍需人工确认。", ""];
  for (const [status, heading] of groups) {
    const items = rankResearchRecords(registry.records.filter((record) => record.status === status));
    lines.push(`## ${heading}`, "", ...(items.length ? items.map((record) => `- [${record.article.titleZh ?? record.article.title}](${record.article.link}) · 跨日观测 ${record.seenDates?.length ?? record.appearances} 天 · ${record.evidenceTags.join(" / ") || "待补证据"}${record.authorityLabels.length ? ` · ${record.authorityLabels.join(" / ")}` : ""}${record.article.scholar?.citedByCount !== undefined ? ` · 引用 ${record.article.scholar.citedByCount}` : ""}`) : ["- 暂无。"]), "");
  }
  const corrections = registry.records.flatMap((record) => record.changes.filter((change) => change.kind === "撤稿" || change.kind === "版本更新").map((change) => `- ${change.date.slice(0, 10)} · ${record.article.title} · ${change.detail}`));
  lines.push("## 自动纠错记录", "", ...(corrections.length ? corrections.slice(-20) : ["- 暂无需要公开的论文纠错。"]));
  return lines.join("\n");
}
