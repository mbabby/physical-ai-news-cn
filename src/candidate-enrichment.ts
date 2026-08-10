import { normalizeUrl } from "./filter.js";
import type { Article, ArticleKind, CompanyProfile, SourceConfig } from "./types.js";

export type EnrichmentTargetKind = "公司官网" | "已启用官方源" | "权威产业媒体" | "原始媒体";
export type EnrichmentOutcome = "发现新证据" | "未发现新证据" | "无可用补证目标";

export interface CandidateEnrichmentTarget {
  kind: EnrichmentTargetKind;
  label: string;
  value: string;
  query: string;
}

export interface CandidateEnrichmentAttempt {
  attemptedAt: string;
  trigger: "首次补证" | "定时重试" | "新证据触发";
  priority: number;
  targets: CandidateEnrichmentTarget[];
  scannedArticles: number;
  newEvidenceLinks: string[];
  outcome: EnrichmentOutcome;
  failureReasons: string[];
}

export interface DiscoveryOrigin {
  discoveryLink: string;
  discoverySource: string;
  publisher?: string;
  publisherUrl?: string;
  landingLink?: string;
}

export interface CandidateEnrichmentRequest {
  companyName: string;
  entityId?: string;
  kind: Extract<ArticleKind, "投融资" | "产品发布" | "部署案例">;
  leads: Article[];
  evidencePool: Article[];
  profile?: CompanyProfile;
  sources: SourceConfig[];
  previousEvidenceLinks: string[];
  previousAttempts: CandidateEnrichmentAttempt[];
  now: Date;
  trigger: CandidateEnrichmentAttempt["trigger"];
}

export interface CandidateEnrichmentResult {
  matchedEvidence: Article[];
  discoveryOrigins: DiscoveryOrigin[];
  attempt: CandidateEnrichmentAttempt;
}

const DISCOVERY = /google news|news\.google\.com|hacker news|\bhn\b|^x\s*[·:]|twitter/i;
const KIND_TERMS: Record<CandidateEnrichmentRequest["kind"], string> = {
  "投融资": "funding financing investment raises 融资 投资",
  "产品发布": "product launch release 产品 发布",
  "部署案例": "deployment customer pilot 部署 客户 试点",
};

function host(link: string): string {
  try { return new URL(link).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
}
function compact(value: string): string { return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ""); }
function unique<T>(values: T[]): T[] { return [...new Set(values)]; }
function publisher(title: string): string | undefined {
  return title.match(/\s[-–—|]\s([^|–—]{2,80})$/)?.[1]?.trim();
}
function aliases(companyName: string, profile?: CompanyProfile): string[] {
  return unique([companyName, profile?.name ?? "", profile?.legalName ?? "", ...(profile?.aliases ?? [])])
    .map(compact).filter((value) => value.length >= 3);
}
function containsEntity(article: Article, names: string[]): boolean {
  // Body/abstract mentions are not subject identity. Restrict evidence joins
  // to headlines so unrelated papers cannot be attached to company events.
  const text = compact(`${article.title} ${article.titleZh ?? ""}`);
  return names.some((name) => text.includes(name));
}
function nearbyEvent(article: Article, leads: Article[]): boolean {
  const time = article.eventDate?.getTime() ?? article.publishedAt.getTime();
  return leads.some((lead) => {
    const leadTime = lead.eventDate?.getTime() ?? lead.publishedAt.getTime();
    return Math.abs(time - leadTime) <= 45 * 24 * 60 * 60 * 1000;
  });
}
function compatibleKind(article: Article, kind: CandidateEnrichmentRequest["kind"]): boolean {
  const text = `${article.title} ${article.titleZh ?? ""}`;
  // Classification alone is insufficient: a noisy upstream kind must not
  // turn an unrelated research paper into financing/product evidence.
  return kind === "投融资" ? /fund|financ|invest|rais|融资|投资|收购/i.test(text)
    : kind === "产品发布" ? /launch|release|unveil|发布|推出/i.test(text)
      : /deploy|customer|pilot|部署|客户|试点|交付/i.test(text);
}
function isEvidenceSource(article: Article): boolean {
  return article.sourceTier === "官方公司与实验室" || article.sourceTier === "权威产业媒体" || article.sourceTier === "开源发布";
}

export function candidateImpactScore(kind: CandidateEnrichmentRequest["kind"], leads: Article[]): number {
  const text = leads.map((article) => `${article.title} ${article.titleZh ?? ""}`).join(" ");
  let score = kind === "投融资" ? 70 : kind === "部署案例" ? 58 : 52;
  if (/billion|亿美元|十亿|亿元|series\s+[b-f]|[b-f]轮|并购|acqui/i.test(text)) score += 18;
  if (/million|千万|pre[-\s]?a|series\s+a|a轮|量产|规模部署/i.test(text)) score += 10;
  score += Math.min(10, Math.max(0, ...leads.map((article) => article.sourceWeight - 5)));
  return Math.min(100, score);
}

export function discoveryOrigins(leads: Article[]): DiscoveryOrigin[] {
  return leads.filter((article) => article.sourceTier === "线索发现层" || DISCOVERY.test(`${article.source} ${article.link}`)).map((article) => {
    const isAggregator = /news\.google\.com/i.test(article.link);
    return {
      discoveryLink: article.discoveryOrigin?.aggregatorLink ?? article.link,
      discoverySource: article.source,
      publisher: article.discoveryOrigin?.publisher ?? publisher(article.title),
      publisherUrl: article.discoveryOrigin?.publisherUrl,
      landingLink: isAggregator ? undefined : article.link,
    };
  }).filter((item, index, all) => all.findIndex((other) => normalizeUrl(other.discoveryLink) === normalizeUrl(item.discoveryLink)) === index);
}

export function buildEnrichmentTargets(companyName: string, entityId: string | undefined, kind: CandidateEnrichmentRequest["kind"], leads: Article[], profile: CompanyProfile | undefined, sources: SourceConfig[]): CandidateEnrichmentTarget[] {
  const query = `\"${companyName}\" ${KIND_TERMS[kind]}`;
  const targets: CandidateEnrichmentTarget[] = [];
  if (profile?.officialUrl) targets.push({ kind: "公司官网", label: `${profile.name} 官网`, value: profile.officialUrl, query });
  for (const source of sources.filter((item) => item.status !== "已暂停" && item.tier !== "线索发现层")) {
    const isBound = Boolean(entityId && source.entityIds?.includes(entityId));
    if (isBound) targets.push({ kind: "已启用官方源", label: source.name, value: source.type === "github-releases" ? `https://github.com/${source.repo}/releases` : "url" in source ? source.url : source.name, query });
    else if (source.tier === "权威产业媒体") targets.push({ kind: "权威产业媒体", label: source.name, value: "url" in source ? source.url : source.name, query });
  }
  for (const origin of discoveryOrigins(leads)) {
    if (origin.publisher) targets.push({ kind: "原始媒体", label: origin.publisher, value: origin.landingLink ?? origin.publisherUrl ?? origin.discoveryLink, query });
  }
  return targets.filter((target, index, all) => all.findIndex((other) => `${other.kind}:${other.label}:${other.value}` === `${target.kind}:${target.label}:${target.value}`) === index);
}

/**
 * Offline, deterministic enrichment pass. Production collection already scans
 * configured sources; this function actively re-queries that rolling corpus
 * using entity, event kind and time proximity. It also emits auditable query
 * targets for future HTTP/search adapters without making an uncontrolled
 * network request itself.
 */
export function enrichCandidateEvidence(request: CandidateEnrichmentRequest): CandidateEnrichmentResult {
  const names = aliases(request.companyName, request.profile);
  const targets = buildEnrichmentTargets(request.companyName, request.entityId, request.kind, request.leads, request.profile, request.sources);
  const existing = new Set([...request.previousEvidenceLinks, ...request.leads.map((article) => article.link)].map(normalizeUrl));
  const matchedEvidence = request.evidencePool.filter((article) =>
    !existing.has(normalizeUrl(article.link))
    && isEvidenceSource(article)
    && containsEntity(article, names)
    && compatibleKind(article, request.kind)
    && nearbyEvent(article, request.leads)
  ).filter((article, index, all) => all.findIndex((other) => normalizeUrl(other.link) === normalizeUrl(article.link)) === index);
  const failures: string[] = [];
  if (!targets.length) failures.push("没有已启用官网、绑定官方源、权威媒体或可识别原始媒体可供补证");
  if (targets.length && !matchedEvidence.length) failures.push("本轮已扫描补证目标，但未发现同主体、同事件且时间相近的新证据");
  const outcome: EnrichmentOutcome = !targets.length ? "无可用补证目标" : matchedEvidence.length ? "发现新证据" : "未发现新证据";
  return {
    matchedEvidence,
    discoveryOrigins: discoveryOrigins(request.leads),
    attempt: {
      attemptedAt: request.now.toISOString(), trigger: request.trigger,
      priority: candidateImpactScore(request.kind, request.leads), targets,
      scannedArticles: request.evidencePool.length,
      newEvidenceLinks: matchedEvidence.map((article) => article.link), outcome, failureReasons: failures,
    },
  };
}
