import { createHash } from "node:crypto";
import { eventOccurredAt } from "./event-time.js";
import type { ArticleKind, CompanyProfile, EventEvidence, EventRecord } from "./types.js";

/**
 * A deliberately small, materialized decision view. It is derived solely from
 * the entity graph (`CompanyProfile`) and attributed public events; it does
 * not discover companies or infer facts from a company profile.
 */
export type CompanyClaimType = "funding" | "product" | "pilot" | "deployment" | "production" | "commercialization" | "research-team";
export type ClaimEvidenceState = "verified" | "evidence_insufficient";
export type ClaimFreshnessState = "fresh" | "stale" | "unknown";
export type ClaimValue = string | "unknown";

export interface CompanyClaimFreshness {
  ttlDays: number;
  state: ClaimFreshnessState;
  expiresAt: string | "unknown";
  daysSinceVerified: number | "unknown";
}

export interface CompanyClaim {
  companyId: string;
  claimType: CompanyClaimType;
  /** Source-derived event headline, never a model-written synopsis. */
  statement: string;
  value: ClaimValue;
  /** Stable IDs derived from an event ID plus its canonical evidence order. */
  evidenceIds: string[];
  evidenceUrls: string[];
  evidenceState: ClaimEvidenceState;
  eventDate: string | "unknown";
  verifiedAt: string | "unknown";
  freshness: CompanyClaimFreshness;
  unresolvedQuestions: string[];
}

export interface CompanyClaimLedgerMetrics {
  /** Populated required claim fields; `unknown` and empty evidence are incomplete. */
  populatedFields: number;
  totalFields: number;
  fieldCompletenessRate: number;
  staleClaimCount: number;
  staleEvidenceCount: number;
  eligibleEventCount: number;
  attributedEventCount: number;
  eventCoverageRate: number;
}

export interface CompanyClaimLedgerEntry {
  companyId: string;
  companyName: string;
  selectionScore: number;
  claims: CompanyClaim[];
  metrics: CompanyClaimLedgerMetrics;
}

export interface CompanyClaimLedger {
  generatedAt: string;
  limit: number;
  companies: CompanyClaimLedgerEntry[];
  metrics: CompanyClaimLedgerMetrics & {
    selectedCompanyCount: number;
    companiesWithEligibleEvents: number;
  };
}

export interface CompanyClaimLedgerOptions {
  /** First release deliberately limits the decision view to fifteen companies. */
  limit?: number;
  now?: Date;
}

const MAX_COMPANIES = 15;
const UNKNOWN = "unknown" as const;

function companyId(company: CompanyProfile): string {
  if (company.entityId) return company.entityId;
  // Tests and migration callers may have legacy profiles without entityId.
  // Hashing the authoritative profile identity avoids inventing a catalog ID.
  return `company-${createHash("sha256").update(`${company.name}\n${company.officialUrl}`).digest("hex").slice(0, 12)}`;
}

function publicEvidence(event: EventRecord): EventEvidence[] {
  return event.evidence.filter((item) => item.grade === "A" || item.grade === "B")
    .sort((a, b) => a.link.localeCompare(b.link) || a.source.localeCompare(b.source));
}

function independentEvidenceKey(evidence: EventEvidence): string {
  try { return new URL(evidence.link).hostname.replace(/^www\./, "").toLowerCase(); }
  catch { return evidence.source.trim().toLowerCase(); }
}

function linkedEvents(company: CompanyProfile, events: EventRecord[]): EventRecord[] {
  return events.filter((event) => event.primaryEntity === company.name)
    .sort((a, b) => eventOccurredAt(b).localeCompare(eventOccurredAt(a)) || a.id.localeCompare(b.id));
}

function claimTypeFor(event: EventRecord): CompanyClaimType {
  if (event.type === "投融资") return "funding";
  if (event.type === "研究与数据") return "research-team";
  const text = `${event.title} ${event.facts.join(" ")} ${event.productDeployment?.deployment ?? ""}`.toLowerCase();
  if (/量产|production|manufactur(?:e|ing)|规模化生产/.test(text)) return "production";
  if (/商业化|commerciali[sz]ation|revenue|订单/.test(text)) return "commercialization";
  if (/试点|pilot|poc\b/.test(text)) return "pilot";
  if (event.type === "部署案例" || /部署|deployment|客户|customer|工厂|factory|warehouse/.test(text)) return "deployment";
  return "product";
}

/** Apply FACTS_POLICY proof thresholds before turning an event into a claim. */
function isClaimVerified(event: EventRecord): boolean {
  const evidence = publicEvidence(event);
  if (evidence.some((item) => item.grade === "A")) return true;
  const independentB = new Set(evidence.filter((item) => item.grade === "B").map(independentEvidenceKey)).size;
  const type = claimTypeFor(event);
  // Product/research assertions require first-party publication. Capital and
  // operational claims may instead use two independent reliable reports.
  return !["product", "research-team"].includes(type) && independentB >= 2;
}

function eligibleEvents(company: CompanyProfile, events: EventRecord[]): EventRecord[] {
  return linkedEvents(company, events).filter(isClaimVerified);
}

function ttlDaysFor(type: CompanyClaimType): number {
  if (type === "funding") return 180;
  if (type === "research-team") return 365;
  if (type === "production" || type === "commercialization") return 120;
  return 90;
}

function freshness(type: CompanyClaimType, verifiedAt: string | undefined, now: Date): CompanyClaimFreshness {
  const ttlDays = ttlDaysFor(type);
  const verified = verifiedAt ? new Date(verifiedAt) : undefined;
  if (!verified || Number.isNaN(verified.getTime())) return { ttlDays, state: "unknown", expiresAt: UNKNOWN, daysSinceVerified: UNKNOWN };
  const daysSinceVerified = Math.max(0, Math.floor((now.getTime() - verified.getTime()) / 86_400_000));
  const expiresAt = new Date(verified.getTime() + ttlDays * 86_400_000).toISOString();
  return { ttlDays, state: daysSinceVerified > ttlDays ? "stale" : "fresh", expiresAt, daysSinceVerified };
}

function fundingValue(event: EventRecord): ClaimValue {
  const funding = event.funding;
  if (!funding) return UNKNOWN;
  const values = [funding.round, funding.amount, funding.valuation].filter((value): value is string => Boolean(value));
  return values.length ? values.join(" · ") : UNKNOWN;
}

function nonFundingValue(event: EventRecord): ClaimValue {
  const product = event.productDeployment;
  return product?.product ?? product?.deployment ?? UNKNOWN;
}

function questionsFor(event: EventRecord, value: ClaimValue): string[] {
  const questions = [...new Set(event.openQuestions.filter(Boolean))];
  if (value === UNKNOWN) {
    if (event.type === "投融资") questions.push("融资轮次、金额或估值尚未由当前证据完整披露。");
    else questions.push("当前事件未披露可结构化的产品、部署或商业化数值。");
  }
  return [...new Set(questions.map((question) => question.trim()).filter(Boolean))];
}

function claimFromEvent(company: CompanyProfile, event: EventRecord, now: Date): CompanyClaim {
  const claimType = claimTypeFor(event);
  const evidence = publicEvidence(event);
  const verifiedAt = event.lastVerifiedAt || event.lastEvidenceAt || UNKNOWN;
  const value = event.type === "投融资" ? fundingValue(event) : nonFundingValue(event);
  return {
    companyId: companyId(company), claimType, statement: event.title,
    value,
    evidenceIds: evidence.map((_, index) => `${event.id}:evidence:${index + 1}`),
    evidenceUrls: evidence.map((item) => item.link),
    evidenceState: "verified",
    eventDate: eventOccurredAt(event).slice(0, 10),
    verifiedAt,
    freshness: freshness(claimType, verifiedAt === UNKNOWN ? undefined : verifiedAt, now),
    unresolvedQuestions: questionsFor(event, value),
  };
}

function unknownFundingClaim(company: CompanyProfile, now: Date): CompanyClaim {
  const claimType: CompanyClaimType = "funding";
  return {
    companyId: companyId(company), claimType,
    statement: "当前事件视图未收录可归属的公开融资证据。",
    value: UNKNOWN, evidenceIds: [], evidenceUrls: [], evidenceState: "evidence_insufficient",
    eventDate: UNKNOWN, verifiedAt: UNKNOWN, freshness: freshness(claimType, undefined, now),
    unresolvedQuestions: ["需要补充主体明确且可追溯的融资、并购或战略资本公开证据。"],
  };
}

function hasValue(value: unknown): boolean {
  if (value === UNKNOWN || value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function metricsFor(claims: CompanyClaim[], attributedEvents: EventRecord[], eligible: EventRecord[]): CompanyClaimLedgerMetrics {
  const fields = claims.flatMap((claim) => [
    claim.companyId, claim.claimType, claim.statement, claim.value, claim.evidenceIds,
    claim.evidenceUrls, claim.evidenceState, claim.eventDate, claim.verifiedAt,
    claim.freshness.state === "unknown" ? UNKNOWN : claim.freshness.expiresAt,
    claim.unresolvedQuestions,
  ]);
  const populatedFields = fields.filter(hasValue).length;
  const staleClaims = claims.filter((claim) => claim.freshness.state === "stale");
  const staleEvidenceCount = staleClaims.reduce((total, claim) => total + claim.evidenceIds.length, 0);
  return {
    populatedFields, totalFields: fields.length,
    fieldCompletenessRate: fields.length ? Number((populatedFields / fields.length).toFixed(4)) : 1,
    staleClaimCount: staleClaims.length, staleEvidenceCount,
    eligibleEventCount: eligible.length, attributedEventCount: attributedEvents.length,
    eventCoverageRate: attributedEvents.length ? Number((eligible.length / attributedEvents.length).toFixed(4)) : 0,
  };
}

function selectionScore(events: EventRecord[]): number {
  return events.reduce((score, event) => {
    const evidenceWeight = publicEvidence(event).length * 5;
    const typeWeight: Record<ArticleKind, number> = {
      "投融资": 100, "部署案例": 80, "公司商业": 65, "产品发布": 50, "开源项目": 35, "研究与数据": 25,
    };
    return score + typeWeight[event.type] + evidenceWeight;
  }, 0);
}

/**
 * Select a stable Top-N of company profiles and materialize their claims.
 * The selector rewards attributable A/B evidence, then newest event date, and
 * resolves every remaining tie by stable company ID. It never uses a profile
 * description as proof of funding, deployment, or commercialization.
 */
export function buildCompanyClaimLedger(companies: CompanyProfile[], events: EventRecord[], options: CompanyClaimLedgerOptions = {}): CompanyClaimLedger {
  const now = options.now ?? new Date();
  const limit = Math.min(MAX_COMPANIES, Math.max(0, Math.floor(options.limit ?? MAX_COMPANIES)));
  const selected = [...companies].map((company) => {
    const attributed = linkedEvents(company, events);
    const eligible = eligibleEvents(company, events);
    return { company, attributed, eligible, score: selectionScore(eligible), newest: eligible[0] ? eventOccurredAt(eligible[0]) : "" };
  }).sort((a, b) => b.score - a.score || b.newest.localeCompare(a.newest) || companyId(a.company).localeCompare(companyId(b.company)))
    .slice(0, limit);
  const entries = selected.map(({ company, attributed, eligible, score }) => {
    const claims = eligible.map((event) => claimFromEvent(company, event, now));
    // Absence is represented as an explicit unknown/evidence_insufficient
    // claim, never as a conclusion that the company did not raise funding.
    if (!claims.some((claim) => claim.claimType === "funding")) claims.push(unknownFundingClaim(company, now));
    claims.sort((a, b) => a.claimType.localeCompare(b.claimType) || b.eventDate.localeCompare(a.eventDate) || a.statement.localeCompare(b.statement));
    return { companyId: companyId(company), companyName: company.name, selectionScore: score, claims, metrics: metricsFor(claims, attributed, eligible) };
  });
  const allClaims = entries.flatMap((entry) => entry.claims);
  const allAttributed = selected.flatMap((item) => item.attributed);
  const allEligible = selected.flatMap((item) => item.eligible);
  const aggregate = metricsFor(allClaims, allAttributed, allEligible);
  return {
    generatedAt: now.toISOString(), limit, companies: entries,
    metrics: {
      ...aggregate, selectedCompanyCount: entries.length,
      companiesWithEligibleEvents: entries.filter((entry) => entry.metrics.eligibleEventCount > 0).length,
    },
  };
}
