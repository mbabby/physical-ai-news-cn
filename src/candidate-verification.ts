import { createHash } from "node:crypto";
import { normalizeUrl } from "./filter.js";
import { enrichCandidateEvidence, candidateImpactScore, discoveryOrigins } from "./candidate-enrichment.js";
import type { CandidateEnrichmentAttempt, DiscoveryOrigin } from "./candidate-enrichment.js";
import type { Article, CompanyProfile, SourceConfig } from "./types.js";

export type VerificationStatus = "待复核" | "可人工审核" | "证据冲突" | "已拒绝" | "等待重试" | "停止自动重试";
export type VerificationGrade = "A" | "B" | "C" | "线索";
export type PublicVerificationStatus = "confirmed" | "corroborated" | "developing" | "candidate";
export type EvidenceSourceClass = "company-official" | "regulatory" | "investor-official" | "authoritative-media" | "industry-media" | "other" | "discovery";
export type FieldVerificationStatus = "confirmed" | "corroborated" | "single-source" | "conflicting" | "unknown";

export interface FieldVerification {
  status: FieldVerificationStatus;
  /** Only source-extracted values are retained. Missing values stay absent. */
  value?: string;
  independentSourceCount: number;
  evidenceArticleIds: string[];
}

export interface CandidateVerificationEvidence {
  articleId: string;
  link: string;
  source: string;
  grade: VerificationGrade;
  sourceClass: EvidenceSourceClass;
  score: number;
  independentOrigin: string;
  publishedAt: string;
  title: string;
  amount?: string;
  round?: string;
  /** Explicit event date only; publication time is not silently promoted to an event fact. */
  eventDate?: string;
}

export interface CandidateVerificationRecord {
  id: string;
  companyName: string;
  companyEntityId?: string;
  kind: "投融资" | "产品发布" | "部署案例";
  title: string;
  status: VerificationStatus;
  publicStatus: PublicVerificationStatus;
  /** Stable machine-facing alias used by public-layer selectors. */
  publicationState: PublicVerificationStatus;
  confidenceScore: number;
  independentEvidenceCount: number;
  /** Impact decides which due candidate gets scarce enrichment capacity first. */
  impactScore: number;
  /** Discovery provenance is retained but never scored as publication proof. */
  discoveryOrigins: DiscoveryOrigin[];
  /** Append-only audit of active source-corpus scans and query targets. */
  enrichmentAttempts: CandidateEnrichmentAttempt[];
  firstSeenAt: string;
  lastAttemptAt?: string;
  nextReviewAt?: string;
  attempts: number;
  evidenceHash: string;
  evidence: CandidateVerificationEvidence[];
  facts: { amount?: string; round?: string; eventDate?: string };
  fieldVerification: {
    amount: FieldVerification;
    round: FieldVerification;
    eventDate: FieldVerification;
  };
  conflicts: string[];
  failureReasons: string[];
  reviewSeed?: { title: string; body: string; labels: string[] };
}

export interface CandidateVerificationArtifact {
  schemaVersion: 1;
  generatedAt: string;
  records: CandidateVerificationRecord[];
}

export interface CandidateVerificationOptions {
  /** Rolling official/media/public corpus already fetched by the daily job. */
  evidencePool?: Article[];
  /** Enabled/observed source catalogue used to construct auditable probe targets. */
  sources?: SourceConfig[];
  /** Bounds work per run while ensuring high-impact candidates go first. */
  maxEnrichmentAttempts?: number;
}

const HIGH_VALUE_KINDS = new Set(["投融资", "产品发布", "部署案例"]);
const DISCOVERY = /google news|hacker news|\bhn\b|\bx\b|twitter|news\.google\.com/i;
// Do not treat a publisher containing “Capital” or “Ventures” as first-party:
// those words are common in media/source names. Investor evidence is A-grade
// only when the source explicitly identifies itself as an official investor
// announcement or portfolio notice.
const FIRST_PARTY = /监管|交易所|sec\b|nasdaq|nyse|投资机构官网|投资方公告|investor (?:announcement|news|relations)|official|官网/i;
const REGULATORY = /监管|交易所|\bsec\b|nasdaq|nyse/i;
const INVESTOR_OFFICIAL = /投资机构官网|投资方公告|investor (?:announcement|news|relations)|portfolio (?:news|announcement)/i;
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
  // Subject identity is resolved from headlines only. A company mentioned in
  // an abstract/body can be an investor, customer, lab or comparison target.
  const text = compact(`${article.title} ${article.titleZh ?? ""}`);
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
  const extracted = extractedEntity(article);
  if (extracted) {
    const identity = compact(extracted);
    const exact = profiles.filter((profile) => [profile.name, ...(profile.aliases ?? []), profile.legalName ?? ""]
      .filter(Boolean).some((name) => compact(name) === identity));
    if (exact.length > 1) return { error: `标题主体同时匹配多个公司实体：${exact.map((item) => item.name).join("、")}` };
    if (exact.length === 1) return { name: exact[0].name, entityId: exact[0].entityId };
    return { name: extracted };
  }
  const matches = profileMatches(article, profiles);
  if (matches.length > 1) return { error: `标题或简介同时匹配多个公司实体：${matches.map((item) => item.name).join("、")}` };
  if (matches.length === 1) return { name: matches[0].name, entityId: matches[0].entityId };
  return { error: "无法唯一识别公司主体" };
}

function grade(article: Article, profile?: CompanyProfile): VerificationGrade {
  if (article.sourceTier === "线索发现层" || DISCOVERY.test(`${article.source} ${article.link}`)) return "线索";
  const articleHost = host(article.link);
  if (article.sourceTier === "官方公司与实验室" || (profile && profileDomains(profile).some((domain) => articleHost === domain || articleHost.endsWith(`.${domain}`))) || FIRST_PARTY.test(article.source)) return "A";
  if (article.sourceTier === "权威产业媒体" || article.sourceWeight >= 7) return "B";
  return "C";
}

function sourceClass(article: Article, profile?: CompanyProfile): EvidenceSourceClass {
  if (article.sourceTier === "线索发现层" || DISCOVERY.test(`${article.source} ${article.link}`)) return "discovery";
  const articleHost = host(article.link);
  if (profile && profileDomains(profile).some((domain) => articleHost === domain || articleHost.endsWith(`.${domain}`))) return "company-official";
  if (REGULATORY.test(article.source)) return "regulatory";
  if (INVESTOR_OFFICIAL.test(article.source)) return "investor-official";
  if (article.sourceTier === "官方公司与实验室") return "company-official";
  if (article.sourceTier === "权威产业媒体" || article.sourceWeight >= 7) return "authoritative-media";
  if (article.sourceWeight >= 5) return "industry-media";
  return "other";
}

function sourceScore(value: EvidenceSourceClass): number {
  switch (value) {
    case "company-official":
    case "regulatory": return 50;
    case "investor-official": return 45;
    case "authoritative-media": return 30;
    case "industry-media": return 20;
    case "other": return 10;
    case "discovery": return 0;
  }
}

function independentOrigin(article: Article): string {
  const articleHost = host(article.link);
  if (articleHost) return articleHost;
  return compact(article.source).replace(/(?:官方|官网|新闻|媒体)$/u, "") || compact(article.source);
}

function evidenceFor(article: Article, profile?: CompanyProfile): CandidateVerificationEvidence {
  const text = `${article.titleZh ?? article.title} ${article.title}`;
  const classified = sourceClass(article, profile);
  return {
    articleId: article.id,
    link: article.link,
    source: article.source,
    grade: grade(article, profile),
    sourceClass: classified,
    score: sourceScore(classified),
    independentOrigin: independentOrigin(article),
    publishedAt: new Date(article.publishedAt).toISOString(),
    title: article.titleZh ?? article.title,
    amount: text.match(AMOUNT)?.[0]?.replace(/\s+/g, " "),
    round: text.match(ROUND)?.[0],
    eventDate: article.eventDate ? isoDay(article.eventDate) : undefined,
  };
}

function normalizeStoredEvidence(item: CandidateVerificationEvidence): CandidateVerificationEvidence {
  const inferredClass: EvidenceSourceClass = item.sourceClass ?? (item.grade === "A" ? "company-official" : item.grade === "B" ? "authoritative-media" : item.grade === "线索" ? "discovery" : "other");
  return {
    ...item,
    sourceClass: inferredClass,
    score: Number.isFinite(item.score) ? item.score : sourceScore(inferredClass),
    independentOrigin: item.independentOrigin || host(item.link) || compact(item.source),
  };
}

function evidenceOrigin(item: CandidateVerificationEvidence): string {
  return item.independentOrigin || host(item.link) || compact(item.source);
}

function independentEvidence(evidence: CandidateVerificationEvidence[]): CandidateVerificationEvidence[] {
  const byOrigin = new Map<string, CandidateVerificationEvidence>();
  for (const item of evidence) {
    const origin = evidenceOrigin(item);
    const saved = byOrigin.get(origin);
    if (!saved || item.score > saved.score || (item.score === saved.score && item.publishedAt > saved.publishedAt)) byOrigin.set(origin, item);
  }
  const byReport = new Map<string, CandidateVerificationEvidence>();
  for (const item of byOrigin.values()) {
    // Exact headline copies on different hosts are normally wire syndication,
    // not independent corroboration. First-party statements remain distinct.
    const firstParty = ["company-official", "regulatory", "investor-official"].includes(item.sourceClass);
    const reportKey = firstParty ? `first-party:${evidenceOrigin(item)}` : compact(item.title);
    const saved = byReport.get(reportKey);
    if (!saved || item.score > saved.score) byReport.set(reportKey, item);
  }
  return [...byReport.values()];
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
  const independent = independentEvidence(evidence);
  if (independent.some((item) => item.grade === "A")) return true;
  return independent.filter((item) => item.grade === "B").length >= 2;
}

function fieldVerification(
  evidence: CandidateVerificationEvidence[],
  field: "amount" | "round" | "eventDate",
  conflicts: boolean,
): FieldVerification {
  const withValue = independentEvidence(evidence).filter((item) => Boolean(item[field]));
  if (!withValue.length) return { status: "unknown", independentSourceCount: 0, evidenceArticleIds: [] };
  const values = unique(withValue.map((item) => item[field]!).filter(Boolean));
  const articleIds = withValue.map((item) => item.articleId);
  if (conflicts || values.length > 1) return { status: "conflicting", independentSourceCount: withValue.length, evidenceArticleIds: articleIds };
  const status: FieldVerificationStatus = withValue.some((item) => ["company-official", "regulatory", "investor-official"].includes(item.sourceClass))
    ? "confirmed"
    : withValue.filter((item) => item.grade === "B").length >= 2 ? "corroborated" : "single-source";
  return { status, value: values[0], independentSourceCount: withValue.length, evidenceArticleIds: articleIds };
}

function confidence(evidence: CandidateVerificationEvidence[], conflicts: string[], subjectBlocked: boolean): { score: number; status: PublicVerificationStatus } {
  const independent = independentEvidence(evidence.filter((item) => item.grade !== "线索"));
  const score = Math.max(0, independent.reduce((sum, item) => sum + item.score, 0) - conflicts.length * 30 - (subjectBlocked ? 100 : 0));
  if (subjectBlocked || conflicts.length) return { score, status: "candidate" };
  if (independent.some((item) => ["company-official", "regulatory", "investor-official"].includes(item.sourceClass))) return { score, status: "confirmed" };
  if (new Set(independent.filter((item) => item.grade === "B").map(evidenceOrigin)).size >= 2 || score >= 60) return { score, status: "corroborated" };
  if (score >= 20) return { score, status: "developing" };
  return { score, status: "candidate" };
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
  options: CandidateVerificationOptions = {},
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
  const orderedGroups = [...grouped.entries()].sort(([, left], [, right]) => {
    const leftKind = left.articles[0]?.kind as CandidateVerificationRecord["kind"];
    const rightKind = right.articles[0]?.kind as CandidateVerificationRecord["kind"];
    return candidateImpactScore(rightKind, right.articles) - candidateImpactScore(leftKind, left.articles);
  });
  let enrichmentBudget = options.maxEnrichmentAttempts ?? 20;
  for (const [key, group] of orderedGroups) {
    const profile = group.resolution.entityId ? profiles.find((item) => item.entityId === group.resolution.entityId) : profiles.find((item) => item.name === group.resolution.name);
    const id = `verify-${createHash("sha256").update(key).digest("hex").slice(0, 14)}`;
    const saved = prior.get(id);
    const hasNewLead = !saved || group.articles.some((article) => !saved.evidence.some((item) => normalizeUrl(item.link) === normalizeUrl(article.link)));
    const scheduledDue = Boolean(saved?.nextReviewAt && new Date(saved.nextReviewAt).getTime() <= now.getTime());
    const shouldEnrich = Boolean(options.evidencePool?.length && options.sources?.length && enrichmentBudget > 0 && (!saved || hasNewLead || scheduledDue));
    const enrichment = shouldEnrich ? enrichCandidateEvidence({
      companyName: group.resolution.name ?? "待识别公司", entityId: group.resolution.entityId,
      kind: group.articles[0].kind as CandidateVerificationRecord["kind"], leads: group.articles,
      evidencePool: options.evidencePool!, profile, sources: options.sources!,
      previousEvidenceLinks: saved?.evidence.map((item) => item.link) ?? [], previousAttempts: saved?.enrichmentAttempts ?? [],
      now, trigger: !saved ? "首次补证" : hasNewLead ? "新证据触发" : "定时重试",
    }) : undefined;
    if (enrichment) enrichmentBudget -= 1;
    const articleEvidence = [...group.articles, ...(enrichment?.matchedEvidence ?? [])].map((article) => evidenceFor(article, profile));
    const evidence = [...new Map([...(saved?.evidence ?? []).map(normalizeStoredEvidence), ...articleEvidence].map((item) => {
      return [normalizeUrl(item.link), item];
    })).values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    const hash = evidenceHash(evidence);
    const shouldAttempt = due(saved, hash, now);
    const attempts = shouldAttempt ? (saved?.attempts ?? 0) + 1 : saved?.attempts ?? 0;
    const rejected = group.resolution.error ? [group.resolution.error] : [];
    const publicEvidence = evidence.filter((item) => item.grade !== "线索");
    // Discovery leads may trigger enrichment but never establish or conflict a
    // public fact on their own.
    const conflicts = factConflicts(publicEvidence);
    const eligible = !conflicts.length && !rejected.length && eligibleForHumanReview(publicEvidence);
    const confidenceResult = confidence(evidence, conflicts, Boolean(rejected.length));
    const result = shouldAttempt ? statusAndRetry(attempts, conflicts, eligible, rejected, now) : { status: saved!.status, nextReviewAt: saved!.nextReviewAt };
    const failureReasons = rejected.length ? rejected : conflicts.length ? conflicts : eligible ? [] : ["尚缺一条 A 级一手证据，或两个独立 B 级来源", ...(evidence.every((item) => item.grade === "线索") ? ["现有材料全部来自线索发现层，不能作为公开证据"] : [])];
    const best = [...group.articles, ...(enrichment?.matchedEvidence ?? [])].sort((a, b) => b.sourceWeight - a.sourceWeight || b.publishedAt.getTime() - a.publishedAt.getTime())[0];
    const amountVerification = fieldVerification(publicEvidence, "amount", conflicts.some((item) => item.includes("金额")));
    const roundVerification = fieldVerification(publicEvidence, "round", conflicts.some((item) => item.includes("轮次")));
    const dateVerification = fieldVerification(publicEvidence, "eventDate", false);
    const facts = {
      amount: amountVerification.status === "conflicting" ? undefined : amountVerification.value,
      round: roundVerification.status === "conflicting" ? undefined : roundVerification.value,
      eventDate: dateVerification.status === "conflicting" ? undefined : dateVerification.value,
    };
    const companyName = group.resolution.name ?? "待识别公司";
    records.push({
      id, companyName, companyEntityId: group.resolution.entityId, kind: best.kind as CandidateVerificationRecord["kind"], title: best.titleZh ?? best.title,
      status: result.status, publicStatus: confidenceResult.status, publicationState: confidenceResult.status,
      confidenceScore: confidenceResult.score, independentEvidenceCount: independentEvidence(publicEvidence).length,
      impactScore: candidateImpactScore(best.kind as CandidateVerificationRecord["kind"], group.articles),
      discoveryOrigins: [...(saved?.discoveryOrigins ?? []), ...discoveryOrigins(group.articles)]
        .filter((item, index, all) => all.findIndex((other) => normalizeUrl(other.discoveryLink) === normalizeUrl(item.discoveryLink)) === index),
      enrichmentAttempts: [...(saved?.enrichmentAttempts ?? []), ...(enrichment ? [enrichment.attempt] : [])].slice(-12),
      firstSeenAt: saved?.firstSeenAt ?? now.toISOString(), lastAttemptAt: shouldAttempt ? now.toISOString() : saved?.lastAttemptAt,
      nextReviewAt: result.nextReviewAt, attempts, evidenceHash: hash, evidence, facts, conflicts, failureReasons,
      fieldVerification: { amount: amountVerification, round: roundVerification, eventDate: dateVerification },
      reviewSeed: eligible ? {
        title: `[证据复核] ${companyName} · ${best.kind} · ${facts.eventDate ?? "日期待确认"}`,
        body: [`候选主体：${companyName}`, `事件：${best.titleZh ?? best.title}`, `金额/轮次：${facts.amount ?? "待确认"} / ${facts.round ?? "待确认"}`, "", "证据：", ...publicEvidence.map((item) => `- [${item.grade}] ${item.source} · ${item.link}`), "", "该记录仅进入人工审核队列；必须显式晋升为规范事件后，才可进入 README 或 Pages。"].join("\n"),
        labels: ["evidence-review", best.kind === "投融资" ? "funding" : "product-deployment"],
      } : undefined,
    });
  }
  return { schemaVersion: 1, generatedAt: now.toISOString(), records: records.sort((a, b) => (a.status === "可人工审核" ? -1 : 0) - (b.status === "可人工审核" ? -1 : 0) || b.impactScore - a.impactScore || b.evidence.length - a.evidence.length || a.companyName.localeCompare(b.companyName, "zh-CN")) };
}

export function formatCandidateVerificationReview(artifact: CandidateVerificationArtifact): string {
  const lines = ["# 高价值公司 / 融资候选二次核验", "", "内部审核层：线索发现源与候选记录永不直接进入公开页面；主体明确且证据充分的记录仍须显式晋升到规范事件中心。", ""];
  if (!artifact.records.length) return [...lines, "暂无高价值候选。", ""].join("\n");
  for (const record of artifact.records) lines.push(`## ${record.companyName} · ${record.kind} · ${record.status}`, "", `- 公开等级：${record.publicStatus} · 可信分 ${record.confidenceScore} · 影响分 ${record.impactScore}`, `- 尝试：${record.attempts}${record.nextReviewAt ? `；下次复核 ${record.nextReviewAt.slice(0, 10)}` : ""}`, `- 主动补证：${record.enrichmentAttempts.at(-1)?.outcome ?? "尚未执行"}${record.enrichmentAttempts.at(-1)?.failureReasons.length ? `（${record.enrichmentAttempts.at(-1)!.failureReasons.join("；")}）` : ""}`, `- 事实：${record.facts.amount ?? "金额待确认"}（${record.fieldVerification.amount.status}） · ${record.facts.round ?? "轮次待确认"}（${record.fieldVerification.round.status}） · ${record.facts.eventDate ?? "日期待确认"}（${record.fieldVerification.eventDate.status}）`, `- 证据：${record.evidence.map((item) => `[${item.grade} · ${item.source} · ${item.score}分](${item.link})`).join(" · ")}`, `- 结论：${record.failureReasons.join("；") || "证据包已达到人工审核门槛，尚未公开。"}`, "");
  return lines.join("\n");
}

export function verificationIssueSeeds(artifact: CandidateVerificationArtifact): Array<{ id: string; title: string; body: string; labels: string[] }> {
  return artifact.records.flatMap((record) => record.status === "可人工审核" && record.reviewSeed ? [{ id: record.id, ...record.reviewSeed }] : []);
}

/**
 * Shared publication gate for a future public candidate/"正在发生" layer.
 * It deliberately does not inspect the Chinese workflow status: developing
 * records may be visible with an explicit caveat before they qualify for the
 * confirmed-event store. Identity or fact conflicts always hard-block it.
 */
export function isCandidateEligibleForPublicLayer(
  record: CandidateVerificationRecord,
  options: { includeDeveloping?: boolean } = {},
): boolean {
  if (record.companyName === "待识别公司" || record.status === "已拒绝" || record.status === "证据冲突" || record.conflicts.length) return false;
  if (Object.values(record.fieldVerification).some((field) => field.status === "conflicting")) return false;
  const allowed: PublicVerificationStatus[] = options.includeDeveloping === false
    ? ["confirmed", "corroborated"]
    : ["confirmed", "corroborated", "developing"];
  return allowed.includes(record.publicationState ?? record.publicStatus);
}
