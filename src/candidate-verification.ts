import { createHash } from "node:crypto";
import { normalizeUrl } from "./filter.js";
import type { Article, CompanyProfile } from "./types.js";

export type VerificationStatus = "待复核" | "可人工审核" | "证据冲突" | "已拒绝" | "等待重试" | "停止自动重试";
export type VerificationGrade = "A" | "B" | "C" | "线索";

export interface CandidateVerificationEvidence {
  articleId: string;
  link: string;
  source: string;
  grade: VerificationGrade;
  publishedAt: string;
  title: string;
  amount?: string;
  round?: string;
}

export interface CandidateVerificationRecord {
  id: string;
  companyName: string;
  companyEntityId?: string;
  kind: "投融资" | "产品发布" | "部署案例";
  title: string;
  status: VerificationStatus;
  firstSeenAt: string;
  lastAttemptAt?: string;
  nextReviewAt?: string;
  attempts: number;
  evidenceHash: string;
  evidence: CandidateVerificationEvidence[];
  facts: { amount?: string; round?: string; eventDate?: string };
  conflicts: string[];
  failureReasons: string[];
  reviewSeed?: { title: string; body: string; labels: string[] };
}

export interface CandidateVerificationArtifact {
  schemaVersion: 1;
  generatedAt: string;
  records: CandidateVerificationRecord[];
}

const HIGH_VALUE_KINDS = new Set(["投融资", "产品发布", "部署案例"]);
const DISCOVERY = /google news|hacker news|\bhn\b|\bx\b|twitter|news\.google\.com/i;
// Do not treat a publisher containing “Capital” or “Ventures” as first-party:
// those words are common in media/source names. Investor evidence is A-grade
// only when the source explicitly identifies itself as an official investor
// announcement or portfolio notice.
const FIRST_PARTY = /监管|交易所|sec\b|nasdaq|nyse|投资机构官网|投资方公告|investor (?:announcement|news|relations)|official|官网/i;
const GENERIC_ENTITY = /^(?:行业公司|机器人公司|具身智能公司|人形机器人公司|公司|一家初创公司|待识别公司)$/i;
const ROUND = /(?:pre[-\s]?seed|seed|series\s+[a-f]|angel|strategic|种子轮|天使轮|pre[-\s]?[a-f]\s*轮|[a-f]\+?轮|战略融资)/i;
const AMOUNT = /(?:US\$|USD\s*|\$|人民币\s*)?\d+(?:[.,]\d+)?\s*(?:million|billion|m|bn|亿美元|亿元|万美元|万元|美元|元)/i;
const RETRY_DAYS = [1, 3, 7, 30] as const;

function host(link: string): string { try { return new URL(link).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } }
function compact(value: string): string { return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ""); }
function isoDay(value: Date | string): string { return new Date(value).toISOString().slice(0, 10); }
function unique<T>(values: T[]): T[] { return [...new Set(values)]; }
function addDays(value: Date, days: number): string { const date = new Date(value); date.setUTCDate(date.getUTCDate() + days); return date.toISOString(); }

function profileDomains(profile: CompanyProfile): string[] {
  const configured = profile.officialDomains ?? [];
  const official = host(profile.officialUrl);
  return unique([...configured.map((item) => item.replace(/^www\./, "").toLowerCase()), ...(official ? [official] : [])]);
}

function profileMatches(article: Article, profiles: CompanyProfile[]): CompanyProfile[] {
  const text = compact(`${article.title} ${article.titleZh ?? ""} ${article.summaryZh ?? ""}`);
  return profiles.filter((profile) => [profile.name, ...(profile.aliases ?? []), profile.legalName ?? ""]
    .filter((name) => compact(name).length >= 3)
    .some((name) => text.includes(compact(name))));
}

function extractedEntity(article: Article): string | undefined {
  const title = `${article.titleZh ?? ""} ${article.title}`.trim();
  if (/融资(?:周报|盘点|观察|评论)|funding\s+(?:roundup|weekly|review)/i.test(title)) return undefined;
  const patterns = article.kind === "投融资"
    ? [/^(.{2,52}?)(?:完成|获得|获|宣布|筹集|融资|收购|估值)/, /^(.{2,52}?)\s+(?:raises?|raised|secures?|secured|lands?|acquires?)\b/i]
    : [/^(.{2,52}?)(?:发布|推出|部署|交付|启用|签约|量产)/, /^(.{2,52}?)\s+(?:launches?|releases?|deploys?|ships?|unveils?)\b/i];
  for (const pattern of patterns) {
    const candidate = title.match(pattern)?.[1]?.replace(/^(?:一家|这家|某家)/, "").replace(/[：:，,。；;]+$/, "").trim();
    if (candidate && candidate.length <= 52 && !GENERIC_ENTITY.test(candidate) && !/投$|融资周报|盘点|观察|评论/i.test(candidate)) return candidate;
  }
  return undefined;
}

export function resolveCandidateCompany(article: Article, profiles: CompanyProfile[]): { name?: string; entityId?: string; error?: string } {
  const matches = profileMatches(article, profiles);
  if (matches.length > 1) return { error: `标题或简介同时匹配多个公司实体：${matches.map((item) => item.name).join("、")}` };
  if (matches.length === 1) return { name: matches[0].name, entityId: matches[0].entityId };
  const name = extractedEntity(article);
  return name ? { name } : { error: "无法唯一识别公司主体" };
}

function grade(article: Article, profile?: CompanyProfile): VerificationGrade {
  if (article.sourceTier === "线索发现层" || DISCOVERY.test(`${article.source} ${article.link}`)) return "线索";
  const articleHost = host(article.link);
  if (article.sourceTier === "官方公司与实验室" || (profile && profileDomains(profile).some((domain) => articleHost === domain || articleHost.endsWith(`.${domain}`))) || FIRST_PARTY.test(article.source)) return "A";
  if (article.sourceTier === "权威产业媒体" || article.sourceWeight >= 7) return "B";
  return "C";
}

function evidenceFor(article: Article, profile?: CompanyProfile): CandidateVerificationEvidence {
  const text = `${article.titleZh ?? article.title} ${article.title}`;
  return {
    articleId: article.id,
    link: article.link,
    source: article.source,
    grade: grade(article, profile),
    publishedAt: new Date(article.publishedAt).toISOString(),
    title: article.titleZh ?? article.title,
    amount: text.match(AMOUNT)?.[0]?.replace(/\s+/g, " "),
    round: text.match(ROUND)?.[0],
  };
}

function evidenceOrigin(item: CandidateVerificationEvidence): string {
  return `${item.grade}:${host(item.link) || compact(item.source)}`;
}

function factConflicts(evidence: CandidateVerificationEvidence[]): string[] {
  const amounts = unique(evidence.map((item) => item.amount && compact(item.amount)).filter(Boolean) as string[]);
  const rounds = unique(evidence.map((item) => item.round && compact(item.round)).filter(Boolean) as string[]);
  const conflicts: string[] = [];
  if (amounts.length > 1) conflicts.push("不同证据披露的融资金额不一致");
  if (rounds.length > 1) conflicts.push("不同证据披露的融资轮次不一致");
  return conflicts;
}

function eligibleForHumanReview(evidence: CandidateVerificationEvidence[]): boolean {
  if (evidence.some((item) => item.grade === "A")) return true;
  return new Set(evidence.filter((item) => item.grade === "B").map(evidenceOrigin)).size >= 2;
}

function evidenceHash(evidence: CandidateVerificationEvidence[]): string {
  const canonical = [...evidence].sort((a, b) => normalizeUrl(a.link).localeCompare(normalizeUrl(b.link)))
    .map((item) => [normalizeUrl(item.link), item.grade, item.amount ?? "", item.round ?? "", isoDay(item.publishedAt)].join("|"));
  return createHash("sha256").update(canonical.join("\n")).digest("hex").slice(0, 20);
}

function due(record: CandidateVerificationRecord | undefined, hash: string, now: Date): boolean {
  if (!record) return true;
  if (record.evidenceHash !== hash) return true;
  if (!record.nextReviewAt || record.status === "停止自动重试" || record.status === "已拒绝" || record.status === "可人工审核") return false;
  return new Date(record.nextReviewAt).getTime() <= now.getTime();
}

function statusAndRetry(attempts: number, conflicts: string[], eligible: boolean, rejected: string[], now: Date): Pick<CandidateVerificationRecord, "status" | "nextReviewAt"> {
  if (rejected.length) return { status: "已拒绝", nextReviewAt: undefined };
  if (conflicts.length) return { status: "证据冲突", nextReviewAt: attempts <= RETRY_DAYS.length ? addDays(now, RETRY_DAYS[Math.max(0, attempts - 1)]) : undefined };
  if (eligible) return { status: "可人工审核", nextReviewAt: undefined };
  if (attempts > RETRY_DAYS.length) return { status: "停止自动重试", nextReviewAt: undefined };
  return { status: attempts ? "等待重试" : "待复核", nextReviewAt: addDays(now, RETRY_DAYS[Math.max(0, attempts - 1)]) };
}

/**
 * Creates an internal-only review queue. Even A-grade evidence merely makes a
 * candidate eligible for human review; this function never writes an event or
 * a public company profile.
 */
export function buildCandidateVerificationArtifact(
  previous: CandidateVerificationArtifact | undefined,
  input: Article[],
  profiles: CompanyProfile[],
  now = new Date(),
): CandidateVerificationArtifact {
  const prior = new Map((previous?.records ?? []).map((record) => [record.id, record]));
  const grouped = new Map<string, { resolution: ReturnType<typeof resolveCandidateCompany>; articles: Article[] }>();
  for (const article of input.filter((item) => item.kind && HIGH_VALUE_KINDS.has(item.kind))) {
    const resolution = resolveCandidateCompany(article, profiles);
    const companyKey = resolution.entityId ?? compact(resolution.name ?? `unresolved-${article.id}`);
    const key = `${companyKey}:${article.kind}`;
    const group = grouped.get(key) ?? { resolution, articles: [] };
    group.articles.push(article); grouped.set(key, group);
  }

  const records: CandidateVerificationRecord[] = [];
  for (const [key, group] of grouped) {
    const profile = group.resolution.entityId ? profiles.find((item) => item.entityId === group.resolution.entityId) : profiles.find((item) => item.name === group.resolution.name);
    const evidence = [...new Map(group.articles.map((article) => {
      const item = evidenceFor(article, profile); return [normalizeUrl(item.link), item];
    })).values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    const hash = evidenceHash(evidence);
    const id = `verify-${createHash("sha256").update(key).digest("hex").slice(0, 14)}`;
    const saved = prior.get(id);
    const shouldAttempt = due(saved, hash, now);
    const attempts = shouldAttempt ? (saved?.attempts ?? 0) + 1 : saved?.attempts ?? 0;
    const conflicts = factConflicts(evidence);
    const rejected = group.resolution.error ? [group.resolution.error] : [];
    const publicEvidence = evidence.filter((item) => item.grade !== "线索");
    const eligible = !conflicts.length && !rejected.length && eligibleForHumanReview(publicEvidence);
    const result = shouldAttempt ? statusAndRetry(attempts, conflicts, eligible, rejected, now) : { status: saved!.status, nextReviewAt: saved!.nextReviewAt };
    const failureReasons = rejected.length ? rejected : conflicts.length ? conflicts : eligible ? [] : ["尚缺一条 A 级一手证据，或两个独立 B 级来源", ...(evidence.every((item) => item.grade === "线索") ? ["现有材料全部来自线索发现层，不能作为公开证据"] : [])];
    const best = group.articles.sort((a, b) => b.sourceWeight - a.sourceWeight || b.publishedAt.getTime() - a.publishedAt.getTime())[0];
    const facts = { amount: evidence.find((item) => item.amount)?.amount, round: evidence.find((item) => item.round)?.round, eventDate: evidence[0] ? isoDay(evidence[0].publishedAt) : undefined };
    const companyName = group.resolution.name ?? "待识别公司";
    records.push({
      id, companyName, companyEntityId: group.resolution.entityId, kind: best.kind as CandidateVerificationRecord["kind"], title: best.titleZh ?? best.title,
      status: result.status, firstSeenAt: saved?.firstSeenAt ?? now.toISOString(), lastAttemptAt: shouldAttempt ? now.toISOString() : saved?.lastAttemptAt,
      nextReviewAt: result.nextReviewAt, attempts, evidenceHash: hash, evidence, facts, conflicts, failureReasons,
      reviewSeed: eligible ? {
        title: `[证据复核] ${companyName} · ${best.kind} · ${facts.eventDate ?? "日期待确认"}`,
        body: [`候选主体：${companyName}`, `事件：${best.titleZh ?? best.title}`, `金额/轮次：${facts.amount ?? "待确认"} / ${facts.round ?? "待确认"}`, "", "证据：", ...publicEvidence.map((item) => `- [${item.grade}] ${item.source} · ${item.link}`), "", "该记录仅进入人工 Review；确认前不得写入公开页面。"].join("\n"),
        labels: ["evidence-review", best.kind === "投融资" ? "funding" : "product-deployment"],
      } : undefined,
    });
  }
  return { schemaVersion: 1, generatedAt: now.toISOString(), records: records.sort((a, b) => (a.status === "可人工审核" ? -1 : 0) - (b.status === "可人工审核" ? -1 : 0) || b.evidence.length - a.evidence.length || a.companyName.localeCompare(b.companyName, "zh-CN")) };
}

export function formatCandidateVerificationReview(artifact: CandidateVerificationArtifact): string {
  const lines = ["# 高价值公司 / 融资候选二次核验", "", "内部 Review 层：线索发现源永不直接晋升；达到证据门槛也只生成审核种子，不写入首页、事件中心或公司地图。", ""];
  if (!artifact.records.length) return [...lines, "暂无高价值候选。", ""].join("\n");
  for (const record of artifact.records) lines.push(`## ${record.companyName} · ${record.kind} · ${record.status}`, "", `- 尝试：${record.attempts}${record.nextReviewAt ? `；下次复核 ${record.nextReviewAt.slice(0, 10)}` : ""}`, `- 事实：${record.facts.amount ?? "金额待确认"} · ${record.facts.round ?? "轮次待确认"} · ${record.facts.eventDate ?? "日期待确认"}`, `- 证据：${record.evidence.map((item) => `[${item.grade} · ${item.source}](${item.link})`).join(" · ")}`, `- 结论：${record.failureReasons.join("；") || "证据包已达到人工审核门槛，尚未公开。"}`, "");
  return lines.join("\n");
}

export function verificationIssueSeeds(artifact: CandidateVerificationArtifact): Array<{ id: string; title: string; body: string; labels: string[] }> {
  return artifact.records.flatMap((record) => record.status === "可人工审核" && record.reviewSeed ? [{ id: record.id, ...record.reviewSeed }] : []);
}
