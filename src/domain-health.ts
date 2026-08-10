import type { CandidateVerificationArtifact } from "./candidate-verification.js";
import type {
  Article, ArticleKind, CompanyProfile, EventRecord, RunHistory, RuntimeStatus,
} from "./types.js";

/** The seven independently degradable parts of the daily product. */
export type HealthDomain = "industry" | "funding" | "product-deployment" | "research" | "llm" | "openalex" | "release";
export type ContentHealthDomain = Extract<HealthDomain, "industry" | "funding" | "product-deployment" | "research">;
export type HealthMatrixDimension = "company" | "region" | "route" | "event-type" | "source-tier";
export type DomainHealthStatus = "healthy" | "degraded" | "critical" | "no-data";

/**
 * A normalized input row. `expected` is deliberately explicit: the report
 * never invents a requirement that every company must fundraise every day.
 */
export interface DomainHealthObservation {
  id: string;
  domain: HealthDomain;
  observed?: number;
  evidenceReady?: number;
  failures?: number;
  company?: string;
  region?: string;
  routes?: string[];
  eventType?: string;
  sourceTier?: string;
  gaps?: string[];
}

export interface DomainHealthExpectation {
  domain: HealthDomain;
  expected: number;
  dimension?: HealthMatrixDimension;
  key?: string;
}

export interface DomainHealthMetric {
  expected: number;
  observed: number;
  evidenceReady: number;
  failureCount: number;
  coverageRate?: number;
  evidenceReadyRate?: number;
  status: DomainHealthStatus;
  gaps: string[];
}

export interface DomainHealthMatrixRow {
  dimension: HealthMatrixDimension;
  key: string;
  domains: Partial<Record<ContentHealthDomain, DomainHealthMetric>>;
  total: DomainHealthMetric;
}

export interface DomainHealthInput {
  /** Prefer normalized observations at integration boundaries. */
  observations?: DomainHealthObservation[];
  articles?: Article[];
  events?: EventRecord[];
  candidateVerification?: CandidateVerificationArtifact;
  companies?: CompanyProfile[];
  runtimeStatuses?: RuntimeStatus[];
  runHistory?: RunHistory;
  expectations?: DomainHealthExpectation[];
}

export interface DomainHealthReport {
  schemaVersion: 1;
  generatedAt: string;
  domains: Record<HealthDomain, DomainHealthMetric>;
  matrix: DomainHealthMatrixRow[];
  summary: { status: DomainHealthStatus; criticalDomains: HealthDomain[]; degradedDomains: HealthDomain[]; coverageGapCount: number };
}

const DOMAINS: HealthDomain[] = ["industry", "funding", "product-deployment", "research", "llm", "openalex", "release"];
const CONTENT_DOMAINS: ContentHealthDomain[] = ["industry", "funding", "product-deployment", "research"];
const DIMENSIONS: HealthMatrixDimension[] = ["company", "region", "route", "event-type", "source-tier"];

type MutableMetric = { expected: number; observed: number; evidenceReady: number; failureCount: number; gaps: Set<string> };
type MetricDelta = Partial<Omit<MutableMetric, "gaps">> & { gaps?: Iterable<string> };

function empty(): MutableMetric { return { expected: 0, observed: 0, evidenceReady: 0, failureCount: 0, gaps: new Set() }; }
function rounded(value: number): number { return Number(value.toFixed(4)); }
function nonNegative(value: number | undefined): number { return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0; }
function add(target: MutableMetric, values: MetricDelta): void {
  target.expected += nonNegative(values.expected);
  target.observed += nonNegative(values.observed);
  target.evidenceReady += nonNegative(values.evidenceReady);
  target.failureCount += nonNegative(values.failureCount);
  for (const gap of values.gaps ?? []) if (gap.trim()) target.gaps.add(gap.trim());
}

function finalize(value: MutableMetric): DomainHealthMetric {
  const observed = value.observed;
  const missing = Math.max(0, value.expected - observed);
  const awaitingEvidence = Math.max(0, observed - value.evidenceReady);
  const gaps = [...value.gaps];
  if (missing) gaps.push(`缺少 ${missing} 个预期观测`);
  if (awaitingEvidence) gaps.push(`${awaitingEvidence} 个观测尚未达到证据门槛`);
  if (value.failureCount) gaps.push(`${value.failureCount} 个采集或服务失败`);
  const coverageRate = value.expected ? rounded(Math.min(1, observed / value.expected)) : undefined;
  const evidenceReadyRate = observed ? rounded(Math.min(1, value.evidenceReady / observed)) : undefined;
  let status: DomainHealthStatus = "healthy";
  if (!value.expected && !observed && !value.failureCount) status = "no-data";
  else if ((coverageRate !== undefined && coverageRate < 0.5) || (value.failureCount > 0 && !observed)) status = "critical";
  else if (missing > 0 || awaitingEvidence > 0 || value.failureCount > 0) status = "degraded";
  return { expected: value.expected, observed, evidenceReady: value.evidenceReady, failureCount: value.failureCount, coverageRate, evidenceReadyRate, status, gaps: [...new Set(gaps)].sort() };
}

function contentDomain(kind: ArticleKind | undefined): ContentHealthDomain {
  if (kind === "投融资") return "funding";
  if (kind === "产品发布" || kind === "部署案例" || kind === "公司商业" || kind === "开源项目") return "product-deployment";
  if (kind === "研究与数据") return "research";
  return "industry";
}
function contentDomains(kind: ArticleKind | undefined): ContentHealthDomain[] {
  const specific = contentDomain(kind);
  if (specific === "research" || specific === "industry") return [specific];
  // Industry is the umbrella ingestion/publication lane; financing and
  // product/deployment remain separately degradable subdomains.
  return ["industry", specific];
}

function articleCompany(article: Article, companies: CompanyProfile[]): CompanyProfile | undefined {
  const text = `${article.title} ${article.titleZh ?? ""} ${article.summaryZh ?? ""}`.toLowerCase();
  const matches = companies.filter((company) => [company.name, company.legalName ?? "", ...(company.aliases ?? [])]
    .filter((name) => name.trim().length >= 3).some((name) => text.includes(name.toLowerCase())));
  return matches.length === 1 ? matches[0] : undefined;
}

function observationsFromArticles(articles: Article[], companies: CompanyProfile[]): DomainHealthObservation[] {
  return articles.flatMap((article) => {
    const company = articleCompany(article, companies);
    // A single media article is an observation, not a verified fact. Only a
    // first-party/release item can be evidence-ready without event-level
    // independent-source accounting.
    const credible = article.sourceTier === "官方公司与实验室" || article.sourceTier === "开源发布";
    return contentDomains(article.kind).map((domain) => ({
      id: `article:${article.id}:${domain}`, domain, observed: 1, evidenceReady: credible ? 1 : 0,
      company: company?.name, region: company?.region, routes: company?.routes, eventType: article.kind ?? "未分类",
      sourceTier: article.sourceTier ?? "未分层", gaps: credible ? [] : ["仅有线索或未分层来源"],
    }));
  });
}

function observationsFromEvents(events: EventRecord[], companies: CompanyProfile[]): DomainHealthObservation[] {
  return events.flatMap((event) => {
    const company = companies.find((item) => item.name === event.primaryEntity);
    const hasA = event.evidence.some((item) => item.grade === "A");
    const independentB = new Set(event.evidence.filter((item) => item.grade === "B").map((item) => {
        try { return new URL(item.link).hostname.replace(/^www\./, ""); } catch { return item.source; }
      })).size;
    const requiresFirstParty = event.type === "产品发布" || event.type === "研究与数据" || event.type === "开源项目";
    const ready = hasA || (!requiresFirstParty && independentB >= 2);
    return contentDomains(event.type).map((domain) => ({
      id: `event:${event.id}:${domain}`, domain, observed: 1, evidenceReady: ready ? 1 : 0,
      company: event.primaryEntity, region: company?.region, routes: event.routes.length ? event.routes : company?.routes,
      eventType: event.type, gaps: ready ? [] : ["事件缺少 A 级或两个独立 B 级证据"],
    }));
  });
}

function observationsFromCandidates(artifact: CandidateVerificationArtifact, companies: CompanyProfile[]): DomainHealthObservation[] {
  return artifact.records.flatMap((record) => {
    const company = companies.find((item) => item.entityId === record.companyEntityId || item.name === record.companyName);
    const ready = record.publicationState === "confirmed" || record.publicationState === "corroborated";
    const sourceTier = record.evidence.some((item) => item.grade === "A") ? "官方公司与实验室"
      : record.evidence.some((item) => item.grade === "B") ? "权威产业媒体" : "线索发现层";
    return contentDomains(record.kind).map((domain) => ({
      id: `candidate:${record.id}:${domain}`, domain, observed: 1, evidenceReady: ready ? 1 : 0,
      company: record.companyName, region: company?.region, routes: company?.routes, eventType: record.kind, sourceTier,
      gaps: [...record.failureReasons, ...record.conflicts],
    }));
  });
}

function serviceObservations(runtime: RuntimeStatus[]): DomainHealthObservation[] {
  return runtime.filter((status) => status.component === "LLM" || status.component === "OpenAlex").map((status) => ({
    id: `service:${status.component}`, domain: status.component === "LLM" ? "llm" : "openalex",
    observed: status.succeeded, evidenceReady: status.succeeded, failures: status.failed,
    gaps: status.status === "成功" ? [] : [status.detail],
  }));
}

function releaseObservation(history: RunHistory | undefined): DomainHealthObservation[] {
  const latest = [...(history?.runs ?? [])].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt))[0];
  if (!latest) return [];
  const publicItems = latest.quality.publicIndustryItems + latest.quality.publicResearchItems;
  const published = latest.status !== "failed" && latest.outputs > 0;
  return [{
    id: `release:${latest.runId}`, domain: "release", observed: published ? 1 : 0, evidenceReady: published && publicItems > 0 ? 1 : 0,
    failures: latest.status === "success" ? 0 : 1, gaps: latest.status === "success" ? [] : [`最近发布状态为 ${latest.status}`],
  }];
}

function dimensionValues(observation: DomainHealthObservation, dimension: HealthMatrixDimension): string[] {
  if (dimension === "company") return observation.company ? [observation.company] : [];
  if (dimension === "region") return observation.region ? [observation.region] : [];
  if (dimension === "route") return observation.routes ?? [];
  if (dimension === "event-type") return observation.eventType ? [observation.eventType] : [];
  return observation.sourceTier ? [observation.sourceTier] : [];
}

/** Build a deterministic health report without changing any public artifact. */
export function buildDomainHealth(input: DomainHealthInput, now = new Date()): DomainHealthReport {
  const derived = input.observations ?? [
    ...observationsFromArticles(input.articles ?? [], input.companies ?? []),
    ...observationsFromEvents(input.events ?? [], input.companies ?? []),
    ...(input.candidateVerification ? observationsFromCandidates(input.candidateVerification, input.companies ?? []) : []),
  ];
  const observations = [...derived, ...serviceObservations(input.runtimeStatuses ?? []), ...releaseObservation(input.runHistory)];
  const metrics = new Map<HealthDomain, MutableMetric>(DOMAINS.map((domain) => [domain, empty()]));
  const cells = new Map<string, MutableMetric>();

  for (const expectation of input.expectations ?? []) {
    if (expectation.dimension && expectation.key && CONTENT_DOMAINS.includes(expectation.domain as ContentHealthDomain)) {
      const id = `${expectation.dimension}\n${expectation.key}\n${expectation.domain}`;
      const cell = cells.get(id) ?? empty(); add(cell, { expected: expectation.expected }); cells.set(id, cell);
    } else add(metrics.get(expectation.domain)!, { expected: expectation.expected });
  }
  for (const observation of observations) {
    const values = { observed: observation.observed ?? 1, evidenceReady: observation.evidenceReady ?? 0, failureCount: observation.failures ?? 0, gaps: observation.gaps ?? [] };
    add(metrics.get(observation.domain)!, values);
    if (!CONTENT_DOMAINS.includes(observation.domain as ContentHealthDomain)) continue;
    for (const dimension of DIMENSIONS) for (const key of dimensionValues(observation, dimension)) {
      const id = `${dimension}\n${key}\n${observation.domain}`;
      const cell = cells.get(id) ?? empty(); add(cell, values); cells.set(id, cell);
    }
  }

  // Expectations contribute to both the addressed cell and its domain total.
  for (const expectation of input.expectations ?? []) if (expectation.dimension && expectation.key) {
    add(metrics.get(expectation.domain)!, { expected: expectation.expected });
  }
  const rows = new Map<string, { dimension: HealthMatrixDimension; key: string; domains: Partial<Record<ContentHealthDomain, DomainHealthMetric>> }>();
  for (const [id, value] of cells) {
    const [dimension, key, domain] = id.split("\n") as [HealthMatrixDimension, string, ContentHealthDomain];
    const rowId = `${dimension}\n${key}`;
    const row = rows.get(rowId) ?? { dimension, key, domains: {} };
    row.domains[domain] = finalize(value); rows.set(rowId, row);
  }
  const matrix = [...rows.values()].map((row): DomainHealthMatrixRow => {
    const total = empty();
    for (const metric of Object.values(row.domains)) if (metric) add(total, { ...metric, gaps: metric.gaps });
    return { ...row, total: finalize(total) };
  }).sort((a, b) => DIMENSIONS.indexOf(a.dimension) - DIMENSIONS.indexOf(b.dimension) || a.key.localeCompare(b.key, "zh-CN"));
  const domains = Object.fromEntries(DOMAINS.map((domain) => [domain, finalize(metrics.get(domain)!)])) as Record<HealthDomain, DomainHealthMetric>;
  const criticalDomains = DOMAINS.filter((domain) => domains[domain].status === "critical");
  const degradedDomains = DOMAINS.filter((domain) => domains[domain].status === "degraded");
  const status: DomainHealthStatus = criticalDomains.length ? "critical" : degradedDomains.length ? "degraded" : DOMAINS.every((domain) => domains[domain].status === "no-data") ? "no-data" : "healthy";
  return {
    schemaVersion: 1, generatedAt: now.toISOString(), domains, matrix,
    summary: { status, criticalDomains, degradedDomains, coverageGapCount: matrix.filter((row) => row.total.gaps.length > 0).length },
  };
}

/** Stable axis labels are useful to downstream JSON/schema validators. */
export const DOMAIN_HEALTH_DIMENSIONS = DIMENSIONS;
export const DOMAIN_HEALTH_DOMAINS = DOMAINS;
