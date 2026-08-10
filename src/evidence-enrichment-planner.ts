import { createHash } from "node:crypto";
import type { CandidateVerificationArtifact, CandidateVerificationRecord, EvidenceSourceClass } from "./candidate-verification.js";
import type { Article, CompanyProfile, SourceConfig } from "./types.js";

export type EvidenceGap = "missing-subject" | "missing-official" | "missing-second-independent-source" | "amount-conflict";
export type EvidenceProbeClass = "company-official" | "regulatory" | "investor-official" | "authoritative-media" | "other";
export type EvidencePlanStatus = "scheduled" | "candidate-found" | "deferred" | "no-target" | "degraded" | "exhausted";

export interface EvidenceProbe {
  id: string;
  domain: string;
  sourceId?: string;
  sourceLabel: string;
  sourceClass: EvidenceProbeClass;
  query: string;
  addresses: EvidenceGap[];
  /** A probe is an audit instruction, not an authorization to crawl arbitrary hosts. */
  allowedBy: "company-profile" | "source-registry" | "explicit-allowlist";
}

export interface PlannedCandidateEvidence {
  articleId: string;
  link: string;
  domain: string;
  source: string;
  sourceClass: EvidenceProbeClass;
  title: string;
  publishedAt: string;
  addresses: EvidenceGap[];
  extractedAmount?: string;
  disposition: "candidate-only";
  mayPublish: false;
  mayUpgradeFactGrade: false;
}

export interface EvidenceEnrichmentPlan {
  id: string;
  recordId: string;
  companyName: string;
  eventKind: CandidateVerificationRecord["kind"];
  fingerprint: string;
  gaps: EvidenceGap[];
  priority: number;
  status: EvidencePlanStatus;
  probes: EvidenceProbe[];
  candidateEvidence: PlannedCandidateEvidence[];
  attemptCount: number;
  createdAt: string;
  lastAttemptAt?: string;
  nextAttemptAt?: string;
  errors: string[];
  auditNote: string;
}

export interface EvidenceEnrichmentArtifact {
  schemaVersion: 1;
  generatedAt: string;
  policy: {
    allowedDomains: string[];
    candidateOnly: true;
    automaticPublication: false;
    automaticGradeUpgrade: false;
  };
  budget: { maxPlansPerRun: number; attemptedPlans: number; deferredPlans: number; maxProbesPerPlan: number };
  status: "healthy" | "degraded";
  errors: string[];
  plans: EvidenceEnrichmentPlan[];
}

export interface EvidenceEnrichmentPlannerInput {
  verification: CandidateVerificationArtifact;
  companies: CompanyProfile[];
  sources: SourceConfig[];
  /** Already-fetched corpus only. The planner itself performs no network write or publication. */
  evidencePool?: Article[];
  previous?: EvidenceEnrichmentArtifact;
  /** Additional reviewed domains; values may be bare domains or HTTPS URLs. */
  allowedDomains?: string[];
}

export interface EvidenceEnrichmentPlannerOptions {
  maxPlansPerRun?: number;
  maxProbesPerPlan?: number;
  maxCandidateEvidencePerPlan?: number;
  retryDays?: number[];
}

interface AllowedSource {
  domain: string;
  sourceId?: string;
  label: string;
  sourceClass: EvidenceProbeClass;
  allowedBy: EvidenceProbe["allowedBy"];
  entityIds: string[];
}

const DEFAULT_RETRY_DAYS = [1, 3, 7, 30];
const SUBJECT_PLACEHOLDER = /^(?:待识别公司|行业公司|机器人公司|具身智能公司|公司|一家初创公司)$/i;
const AMOUNT = /(?:US\$|USD\s*|\$|人民币\s*)?\d+(?:[.,]\d+)?\s*(?:million|billion|m|bn|亿美元|亿元|万美元|万元|美元|元)/i;
const KIND_TERMS: Record<CandidateVerificationRecord["kind"], string> = {
  "投融资": "funding financing investment raises 融资 投资",
  "产品发布": "product launch release 产品 发布",
  "部署案例": "deployment customer pilot 部署 客户 试点",
};

function domain(value: string): string | undefined {
  const candidate = value.trim().toLowerCase();
  if (!candidate) return undefined;
  try {
    const parsed = new URL(candidate.includes("://") ? candidate : `https://${candidate}`);
    const host = parsed.hostname.replace(/^www\./, "");
    return host.includes(".") && !/\s/.test(host) ? host : undefined;
  } catch { return undefined; }
}
function articleDomain(article: Article): string | undefined { return domain(article.link); }
function sourceUrl(source: SourceConfig): string | undefined {
  if (source.type === "rss" || source.type === "webpage" || source.type === "sitemap") return source.url;
  if (source.type === "github-releases") return `https://github.com/${source.repo}`;
  if (source.type === "youtube") return "https://youtube.com";
  return undefined;
}
function sourceClass(source: SourceConfig): EvidenceProbeClass {
  if (source.role === "监管披露") return "regulatory";
  if (/投资方|投资机构|investor|portfolio/i.test(`${source.role ?? ""} ${source.name}`)) return "investor-official";
  if (source.role === "公司官网" || source.tier === "官方公司与实验室") return "company-official";
  if (source.tier === "权威产业媒体" || source.role === "产业媒体") return "authoritative-media";
  return "other";
}
function unique<T>(values: T[]): T[] { return [...new Set(values)]; }
function stableHash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 20); }
function addDays(now: Date, days: number): string { const next = new Date(now); next.setUTCDate(next.getUTCDate() + days); return next.toISOString(); }
function compact(value: string): string { return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ""); }
function safeTime(value: Date): number { const time = value.getTime(); return Number.isFinite(time) ? time : 0; }

function buildAllowlist(input: EvidenceEnrichmentPlannerInput): { sources: AllowedSource[]; errors: string[] } {
  const errors: string[] = [];
  const allowed: AllowedSource[] = [];
  for (const company of input.companies) {
    for (const value of [company.officialUrl, ...(company.officialDomains ?? [])]) {
      const host = domain(value);
      if (!host) { errors.push(`公司 ${company.name} 的官方域名无效：${value}`); continue; }
      allowed.push({ domain: host, label: `${company.name} 官网`, sourceClass: "company-official", allowedBy: "company-profile", entityIds: company.entityId ? [company.entityId] : [] });
    }
  }
  for (const source of input.sources) {
    if (source.status === "已暂停" || source.tier === "线索发现层") continue;
    const url = sourceUrl(source);
    if (!url) continue;
    const host = domain(url);
    if (!host) { errors.push(`信源 ${source.name} 的域名无效：${url}`); continue; }
    allowed.push({ domain: host, sourceId: source.id, label: source.name, sourceClass: sourceClass(source), allowedBy: "source-registry", entityIds: source.entityIds ?? [] });
  }
  for (const value of input.allowedDomains ?? []) {
    const host = domain(value);
    if (!host) { errors.push(`显式白名单域名无效：${value}`); continue; }
    allowed.push({ domain: host, label: host, sourceClass: "other", allowedBy: "explicit-allowlist", entityIds: [] });
  }
  const byIdentity = new Map<string, AllowedSource>();
  for (const item of allowed) byIdentity.set(`${item.domain}\n${item.sourceId ?? ""}\n${item.sourceClass}`, item);
  return { sources: [...byIdentity.values()].sort((a, b) => a.domain.localeCompare(b.domain) || a.label.localeCompare(b.label)), errors: unique(errors) };
}

function gapsFor(record: CandidateVerificationRecord): EvidenceGap[] {
  const gaps: EvidenceGap[] = [];
  if (!record.companyEntityId || SUBJECT_PLACEHOLDER.test(record.companyName)) gaps.push("missing-subject");
  const publicEvidence = record.evidence.filter((item) => item.grade === "A" || item.grade === "B");
  const hasOfficial = publicEvidence.some((item) => item.sourceClass === "company-official");
  if (!hasOfficial) gaps.push("missing-official");
  const hasA = publicEvidence.some((item) => item.grade === "A");
  const independent = new Set(publicEvidence.filter((item) => item.grade === "B").map((item) => item.independentOrigin).filter(Boolean)).size;
  if (!hasA && independent < 2) gaps.push("missing-second-independent-source");
  if (record.fieldVerification.amount.status === "conflicting" || record.conflicts.some((item) => /金额|amount/i.test(item))) gaps.push("amount-conflict");
  return gaps;
}

function desiredClasses(gaps: EvidenceGap[]): Set<EvidenceProbeClass> {
  const classes = new Set<EvidenceProbeClass>();
  for (const gap of gaps) {
    if (gap === "missing-official") classes.add("company-official");
    if (gap === "missing-second-independent-source") { classes.add("authoritative-media"); classes.add("company-official"); classes.add("regulatory"); classes.add("investor-official"); classes.add("other"); }
    if (gap === "amount-conflict") { classes.add("company-official"); classes.add("regulatory"); classes.add("investor-official"); }
    if (gap === "missing-subject") { classes.add("regulatory"); classes.add("investor-official"); classes.add("authoritative-media"); classes.add("other"); }
  }
  return classes;
}

function existingOrigins(record: CandidateVerificationRecord): Set<string> {
  return new Set(record.evidence.filter((item) => item.grade === "A" || item.grade === "B")
    .flatMap((item) => [domain(item.link), item.independentOrigin.toLowerCase()]).filter((item): item is string => Boolean(item)));
}

function probesFor(record: CandidateVerificationRecord, gaps: EvidenceGap[], allowed: AllowedSource[], limit: number): EvidenceProbe[] {
  const wanted = desiredClasses(gaps);
  const origins = existingOrigins(record);
  const profileBound = (source: AllowedSource): boolean => !record.companyEntityId || !source.entityIds.length || source.entityIds.includes(record.companyEntityId);
  return allowed.filter((source) => wanted.has(source.sourceClass) && profileBound(source))
    .filter((source) => !(gaps.includes("missing-second-independent-source") && source.sourceClass === "authoritative-media" && origins.has(source.domain)))
    .sort((a, b) => {
      const rank = (item: AllowedSource): number => item.sourceClass === "company-official" ? 0 : item.sourceClass === "regulatory" ? 1 : item.sourceClass === "investor-official" ? 2 : 3;
      return rank(a) - rank(b) || a.domain.localeCompare(b.domain) || a.label.localeCompare(b.label);
    }).slice(0, limit).map((source) => {
      const subject = SUBJECT_PLACEHOLDER.test(record.companyName) ? `\"${record.title}\"` : `\"${record.companyName}\"`;
      const query = `site:${source.domain} ${subject} ${KIND_TERMS[record.kind]}${gaps.includes("amount-conflict") ? " amount 金额" : ""}`;
      const addresses = gaps.filter((gap) => {
        if (gap === "missing-official") return source.sourceClass === "company-official";
        if (gap === "amount-conflict") return ["company-official", "regulatory", "investor-official"].includes(source.sourceClass);
        if (gap === "missing-subject") return ["regulatory", "investor-official", "authoritative-media", "other"].includes(source.sourceClass);
        return true;
      });
      return { id: `probe-${stableHash([record.id, source.domain, source.sourceId, addresses])}`, domain: source.domain, sourceId: source.sourceId, sourceLabel: source.label, sourceClass: source.sourceClass, query, addresses, allowedBy: source.allowedBy };
    });
}

function compatibleKind(article: Article, kind: CandidateVerificationRecord["kind"]): boolean {
  if (article.kind === kind) return true;
  const text = `${article.title} ${article.titleZh ?? ""}`;
  if (kind === "投融资") return /fund|financ|invest|rais|融资|投资|收购/i.test(text);
  if (kind === "产品发布") return /launch|release|unveil|发布|推出/i.test(text);
  return /deploy|customer|pilot|部署|客户|试点|交付/i.test(text);
}

function sameSubject(article: Article, record: CandidateVerificationRecord, profile: CompanyProfile | undefined): boolean {
  const text = compact(`${article.title} ${article.titleZh ?? ""} ${article.summaryZh ?? ""} ${article.excerpt}`);
  if (!SUBJECT_PLACEHOLDER.test(record.companyName)) {
    return unique([record.companyName, profile?.name ?? "", profile?.legalName ?? "", ...(profile?.aliases ?? [])])
      .map(compact).filter((name) => name.length >= 3).some((name) => text.includes(name));
  }
  // For an unknown subject, require several headline tokens; this is still
  // retained only as a candidate and can never establish identity by itself.
  const tokens = record.title.split(/[^\p{L}\p{N}]+/u).map(compact).filter((token) => token.length >= 4);
  return tokens.filter((token) => text.includes(token)).length >= Math.min(2, tokens.length);
}

function candidateEvidenceFor(record: CandidateVerificationRecord, gaps: EvidenceGap[], probes: EvidenceProbe[], pool: Article[], companies: CompanyProfile[], limit: number): PlannedCandidateEvidence[] {
  const probeForDomain = (host: string): EvidenceProbe | undefined => probes.find((probe) => host === probe.domain || host.endsWith(`.${probe.domain}`));
  const knownLinks = new Set(record.evidence.map((item) => item.link.replace(/\/$/, "")));
  const profile = companies.find((item) => item.entityId === record.companyEntityId || item.name === record.companyName);
  return pool.filter((article) => {
    const host = articleDomain(article);
    return Boolean(host && probeForDomain(host) && !knownLinks.has(article.link.replace(/\/$/, ""))
      && article.sourceTier !== "线索发现层" && compatibleKind(article, record.kind) && sameSubject(article, record, profile));
  }).sort((a, b) => b.sourceWeight - a.sourceWeight || safeTime(b.publishedAt) - safeTime(a.publishedAt) || a.link.localeCompare(b.link))
    .slice(0, limit).map((article) => {
      const host = articleDomain(article)!;
      const probe = probeForDomain(host)!;
      return {
        articleId: article.id, link: article.link, domain: probe.domain, source: article.source, sourceClass: probe.sourceClass,
        title: article.titleZh ?? article.title, publishedAt: article.publishedAt.toISOString(), addresses: probe.addresses,
        extractedAmount: `${article.title} ${article.titleZh ?? ""}`.match(AMOUNT)?.[0],
        disposition: "candidate-only", mayPublish: false, mayUpgradeFactGrade: false,
      };
    });
}

function nextRetry(now: Date, attemptCount: number, retryDays: number[]): string | undefined {
  const days = retryDays[attemptCount - 1];
  return days === undefined ? undefined : addDays(now, days);
}

function due(previous: EvidenceEnrichmentPlan | undefined, fingerprint: string, now: Date): boolean {
  if (!previous || previous.fingerprint !== fingerprint) return true;
  if (previous.status === "candidate-found" || previous.status === "exhausted") return false;
  if (!previous.nextAttemptAt) return true;
  return Date.parse(previous.nextAttemptAt) <= now.getTime();
}

/**
 * Produce bounded, allowlist-only acquisition instructions and internal
 * evidence candidates. The input verification artifact is never mutated and
 * no result from this function is publishable or grade-promoting.
 */
export function buildEvidenceEnrichmentPlan(
  input: EvidenceEnrichmentPlannerInput,
  options: EvidenceEnrichmentPlannerOptions = {},
  now = new Date(),
): EvidenceEnrichmentArtifact {
  const maxPlansPerRun = Math.max(0, Math.floor(options.maxPlansPerRun ?? 10));
  const maxProbesPerPlan = Math.max(0, Math.floor(options.maxProbesPerPlan ?? 6));
  const maxCandidates = Math.max(0, Math.floor(options.maxCandidateEvidencePerPlan ?? 5));
  const retryDays = (options.retryDays ?? DEFAULT_RETRY_DAYS).map((day) => Math.max(1, Math.floor(day))).filter(Number.isFinite);
  const allowlist = buildAllowlist(input);
  const previous = new Map((input.previous?.plans ?? []).map((plan) => [plan.recordId, plan]));
  const actionable = input.verification.records.map((record) => ({ record, gaps: gapsFor(record) })).filter((item) => item.gaps.length)
    .sort((a, b) => Number(b.gaps.includes("amount-conflict")) - Number(a.gaps.includes("amount-conflict")) || b.record.impactScore - a.record.impactScore || a.record.id.localeCompare(b.record.id));
  const plans: EvidenceEnrichmentPlan[] = [];
  let attemptedPlans = 0;
  let deferredPlans = 0;
  for (const { record, gaps } of actionable) {
    const allowedForRecord = allowlist.sources.filter((source) => !record.companyEntityId || !source.entityIds.length || source.entityIds.includes(record.companyEntityId));
    const fingerprint = stableHash([record.evidenceHash, gaps, allowedForRecord.map((source) => [source.domain, source.sourceClass, source.sourceId])]);
    const saved = previous.get(record.id);
    if (!due(saved, fingerprint, now)) { plans.push(saved!); continue; }
    if (attemptedPlans >= maxPlansPerRun) {
      deferredPlans += 1;
      if (saved && saved.fingerprint === fingerprint) plans.push(saved);
      else plans.push({
        id: `plan-${stableHash(record.id)}`, recordId: record.id, companyName: record.companyName, eventKind: record.kind, fingerprint,
        gaps, priority: record.impactScore, status: "deferred", probes: [], candidateEvidence: [], attemptCount: 0,
        createdAt: now.toISOString(), nextAttemptAt: now.toISOString(), errors: [], auditNote: "本轮预算不足；没有执行探针，也没有改变候选事实状态。",
      });
      continue;
    }
    attemptedPlans += 1;
    const probes = probesFor(record, gaps, allowedForRecord, maxProbesPerPlan);
    const candidates = candidateEvidenceFor(record, gaps, probes, input.evidencePool ?? [], input.companies, maxCandidates);
    const attemptCount = saved?.fingerprint === fingerprint ? saved.attemptCount + 1 : 1;
    const nextAttemptAt = candidates.length ? undefined : nextRetry(now, attemptCount, retryDays);
    let status: EvidencePlanStatus = candidates.length ? "candidate-found" : probes.length ? "scheduled" : "no-target";
    if (!nextAttemptAt && !candidates.length) status = "exhausted";
    const errors = probes.length ? [] : [`${record.id} 没有满足缺口类型且在白名单内的取证目标`];
    if (errors.length && status !== "exhausted") status = "degraded";
    plans.push({
      id: saved?.id ?? `plan-${stableHash(record.id)}`, recordId: record.id, companyName: record.companyName, eventKind: record.kind,
      fingerprint, gaps, priority: record.impactScore, status, probes, candidateEvidence: candidates, attemptCount,
      createdAt: saved?.createdAt ?? now.toISOString(), lastAttemptAt: now.toISOString(), nextAttemptAt, errors,
      auditNote: candidates.length
        ? "发现的材料仅进入内部候选证据层；必须重新走主体、独立性、事实冲突和人工审核门槛。"
        : "本计划只描述白名单域名内的定向取证；不会自动公开记录或提升任何事实等级。",
    });
  }
  const planErrors = plans.flatMap((plan) => plan.errors);
  const errors = unique([...allowlist.errors, ...planErrors]);
  return {
    schemaVersion: 1, generatedAt: now.toISOString(),
    policy: { allowedDomains: unique(allowlist.sources.map((source) => source.domain)).sort(), candidateOnly: true, automaticPublication: false, automaticGradeUpgrade: false },
    budget: { maxPlansPerRun, attemptedPlans, deferredPlans, maxProbesPerPlan },
    status: errors.length ? "degraded" : "healthy", errors,
    plans: plans.sort((a, b) => b.priority - a.priority || a.recordId.localeCompare(b.recordId)),
  };
}

export function evidenceGaps(record: CandidateVerificationRecord): EvidenceGap[] { return gapsFor(record); }
export type { EvidenceSourceClass };
