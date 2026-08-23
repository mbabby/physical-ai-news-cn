import { createHash } from "node:crypto";
import { eventOccurredAt } from "./event-time.js";
import { derivePublication } from "./facts-contract.js";
import type { PublicFactEvidence } from "./facts-contract.js";
import { deriveLedgerCorrections, ledgerField, unknownLedgerField } from "./ledger-contracts.js";
import type { LedgerCorrection, LedgerField } from "./ledger-contracts.js";
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

export interface CompanyClaimFields {
  eventDate: LedgerField<string>;
  round: LedgerField<string>;
  amount: LedgerField<string>;
  valuation: LedgerField<string>;
  investors: LedgerField<string[]>;
  product: LedgerField<string>;
  customer: LedgerField<string[]>;
  deployment: LedgerField<string>;
  productionStage: LedgerField<string>;
}

export interface CompanyClaim {
  claimId: string;
  companyId: string;
  claimType: CompanyClaimType;
  /** Source-derived event headline, never a model-written synopsis. */
  statement: string;
  value: ClaimValue;
  /** Stable IDs derived from an event ID plus its canonical evidence order. */
  evidenceIds: string[];
  evidenceUrls: string[];
  evidenceState: ClaimEvidenceState;
  eventIds: string[];
  fields: CompanyClaimFields;
  corrections: LedgerCorrection[];
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
  previous?: CompanyClaimLedger;
}

const MAX_COMPANIES = 15;
const UNKNOWN = "unknown" as const;
const codeUnitCompare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

function companyId(company: CompanyProfile): string {
  if (company.entityId) return company.entityId;
  // Tests and migration callers may have legacy profiles without entityId.
  // Hashing the authoritative profile identity avoids inventing a catalog ID.
  return `company-${createHash("sha256").update(`${company.name}\n${company.officialUrl}`).digest("hex").slice(0, 12)}`;
}

function publicEvidence(event: EventRecord): EventEvidence[] {
  const evidence = event.evidence.map((item, index) => ({ ...item, id: `${event.id}:source:${index + 1}` })) as Array<EventEvidence & PublicFactEvidence & { id: string }>;
  const qualifying = new Set(derivePublication({ evidence }).qualifyingEvidenceIds);
  return evidence.filter((item) => qualifying.has(item.id))
    .sort((a, b) => codeUnitCompare(a.link, b.link) || codeUnitCompare(a.source, b.source));
}

type EventWithEvidenceState = EventRecord & { evidenceState?: "candidate" | "developing" | "confirmed" | "conflicted" | "rejected" | "withdrawn" };

function claimIdFor(companyIdentifier: string, eventIdentity: string): string {
  return `company-claim-${createHash("sha256").update(`${companyIdentifier}\n${eventIdentity}`).digest("hex").slice(0, 16)}`;
}

function evidenceBindings(event: EventRecord, evidence: EventEvidence[], universe = evidence) {
  return {
    evidenceIds: evidence.map((item) => `${event.id}:evidence:${universe.findIndex((candidate) => candidate.link === item.link && candidate.source === item.source) + 1}`),
    evidenceUrls: evidence.map((item) => item.link),
  };
}

function fieldStatus(evidence: EventEvidence[]): "verified" | "developing" | "unknown" {
  if (!evidence.length) return "unknown";
  if (evidence.some((item) => item.grade === "A")) return "verified";
  const independentBOrigins = derivePublication({ evidence: evidence.filter((item) => item.grade === "B") as PublicFactEvidence[] }).independentBOrigins;
  return independentBOrigins.length >= 2 ? "verified" : "developing";
}

type CompanyClaimFieldKey = keyof CompanyClaimFields;

const FIELD_SUPPORT_PATTERNS: Record<CompanyClaimFieldKey, RegExp> = {
  eventDate: /事件日期|发生日期|event\s*date|occurred/i,
  round: /轮次|round|seed|series/i,
  amount: /金额|融资额|amount|raised/i,
  valuation: /估值|valuation/i,
  investors: /投资方|投资人|investor/i,
  product: /产品|product/i,
  customer: /客户|customer/i,
  deployment: /部署|deployment/i,
  productionStage: /试点|量产|商业化|production|pilot|commerciali[sz]/i,
};

function normalizedSupport(value: string): string {
  return value.normalize("NFKC").toLowerCase()
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedFieldValue(value: string, field: CompanyClaimFieldKey): string {
  const normalized = normalizedSupport(value);
  return field === "round" ? normalized.replace(/\b(pre|post)\s+(?=[\p{L}\p{N}])/gu, "$1-") : normalized;
}

const TOKEN_CONTINUATION = /[\p{L}\p{N}\p{M}_./-]/u;

function containsExactValue(support: string, value: string): boolean {
  if (!value) return false;
  let start = support.indexOf(value);
  while (start >= 0) {
    const before = Array.from(support.slice(0, start)).at(-1);
    const after = Array.from(support.slice(start + value.length))[0];
    const first = Array.from(value)[0];
    const last = Array.from(value).at(-1);
    const leftSafe = !first || !TOKEN_CONTINUATION.test(first) || !before || !TOKEN_CONTINUATION.test(before);
    const rightSafe = !last || !TOKEN_CONTINUATION.test(last) || !after || !TOKEN_CONTINUATION.test(after);
    if (leftSafe && rightSafe) return true;
    start = support.indexOf(value, start + value.length);
  }
  return false;
}

function evidenceSupportsValue<T>(evidence: EventEvidence, field: CompanyClaimFieldKey, value: T): boolean {
  const support = normalizedFieldValue(evidence.supports, field);
  const values = (Array.isArray(value) ? value : [value]).map((item) => normalizedFieldValue(String(item), field));
  return FIELD_SUPPORT_PATTERNS[field].test(evidence.supports) && values.length > 0 && values.every((item) => containsExactValue(support, item));
}

function evidenceForValue<T>(evidence: EventEvidence[], field: CompanyClaimFieldKey, value: T): EventEvidence[] {
  return evidence.filter((item) => evidenceSupportsValue(item, field, value));
}

function conflictValues(event: EventRecord, field: Exclude<CompanyClaimFieldKey, "eventDate">): string[] {
  const patterns: Record<typeof field, RegExp> = {
    round: /轮次|round/i, amount: /金额|amount/i, valuation: /估值|valuation/i, investors: /投资方|investor/i,
    product: /产品|product/i, customer: /客户|customer/i, deployment: /部署|deployment/i, productionStage: /量产|生产阶段|production/i,
  };
  return [...new Set(event.openQuestions.filter((question) => patterns[field].test(question)).flatMap((question) => {
    const detail = question.split(/[：:]/, 2)[1];
    return detail ? detail.split(/\s*(?:\/|\bvs\.?\b|与)\s*/i).map((value) => value.trim()).filter(Boolean) : [];
  }))].sort(codeUnitCompare);
}

function projectedField<T>(
  event: EventRecord,
  evidence: EventEvidence[],
  value: T | undefined,
  field: CompanyClaimFieldKey,
): LedgerField<T> {
  if (field !== "eventDate") {
    const conflicts = conflictValues(event, field);
    const supportedConflicts = conflicts.filter((alternative) => evidence.some((item) => evidenceSupportsValue(item, field, alternative)));
    const conflictEvidence = evidence.filter((item) => supportedConflicts.some((alternative) => evidenceSupportsValue(item, field, alternative)));
    if (supportedConflicts.length >= 2 && conflictEvidence.length > 0) {
      return ledgerField({
        value: "unknown", status: "conflicted", ...evidenceBindings(event, conflictEvidence, evidence),
        conflictingValues: supportedConflicts as T[],
      });
    }
  }
  const missing = value === undefined || value === null || (Array.isArray(value) && value.length === 0);
  if (missing) return unknownLedgerField<T>();
  const supportingEvidence = evidenceForValue(evidence, field, value);
  const status = fieldStatus(supportingEvidence);
  if (status === "unknown") return unknownLedgerField<T>();
  const observedAt = event.lastEvidenceAt || eventOccurredAt(event) || UNKNOWN;
  return ledgerField({
    value,
    status,
    ...evidenceBindings(event, supportingEvidence, evidence),
    observedAt,
    verifiedAt: status === "verified" ? event.lastVerifiedAt || UNKNOWN : UNKNOWN,
  });
}

function fieldsFor(event: EventRecord, claimType: CompanyClaimType, evidence: EventEvidence[]): CompanyClaimFields {
  const funding = event.funding;
  const deployment = event.productDeployment;
  const productionStage = ["pilot", "production", "commercialization"].includes(claimType) ? claimType : undefined;
  return {
    eventDate: projectedField(event, evidence, eventOccurredAt(event).slice(0, 10), "eventDate"),
    round: projectedField(event, evidence, funding?.round, "round"),
    amount: projectedField(event, evidence, funding?.amount, "amount"),
    valuation: projectedField(event, evidence, funding?.valuation, "valuation"),
    investors: projectedField(event, evidence, funding?.investors.length ? [...funding.investors].sort(codeUnitCompare) : undefined, "investors"),
    product: projectedField(event, evidence, deployment?.product, "product"),
    customer: projectedField(event, evidence, deployment?.customers.length ? [...deployment.customers].sort(codeUnitCompare) : undefined, "customer"),
    deployment: projectedField(event, evidence, deployment?.deployment, "deployment"),
    productionStage: projectedField(event, evidence, productionStage, "productionStage"),
  };
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
  const lifecycle = (event as EventWithEvidenceState).evidenceState;
  if (["candidate", "developing", "conflicted", "rejected", "withdrawn"].includes(lifecycle ?? "")) return false;
  if (event.openQuestions.some((question) => /冲突|矛盾|不一致|conflict/i.test(question))) return false;
  const evidence = publicEvidence(event);
  const type = claimTypeFor(event);
  return compatibilityValue(type, fieldsFor(event, type, evidence)) !== UNKNOWN;
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

function compatibilityValue(claimType: CompanyClaimType, fields: CompanyClaimFields): ClaimValue {
  if (claimType === "funding") {
    const fundingFields = [fields.round, fields.amount, fields.valuation, fields.investors];
    if (fundingFields.some((field) => field.status === "conflicted")) return UNKNOWN;
    const values = fundingFields.slice(0, 3)
      .filter((field) => field.status === "verified" && field.value !== UNKNOWN)
      .map((field) => field.value as string);
    return values.length ? values.join(" · ") : UNKNOWN;
  }
  const deploymentFields = [fields.product, fields.customer, fields.deployment, fields.productionStage];
  if (deploymentFields.some((field) => field.status === "conflicted")) return UNKNOWN;
  for (const field of [fields.product, fields.deployment, fields.productionStage]) {
    if (field.status === "verified" && field.value !== UNKNOWN) return field.value;
  }
  return UNKNOWN;
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
  const fields = fieldsFor(event, claimType, evidence);
  const value = compatibilityValue(claimType, fields);
  const evidenceIds = [...new Set(Object.values(fields).flatMap((field) => field.evidenceIds))].sort(codeUnitCompare);
  const evidenceUrls = [...new Set(Object.values(fields).flatMap((field) => field.evidenceUrls))].sort(codeUnitCompare);
  return {
    claimId: claimIdFor(companyId(company), `event:${event.id}`),
    companyId: companyId(company), claimType, statement: event.title,
    value,
    evidenceIds, evidenceUrls,
    evidenceState: value === UNKNOWN ? "evidence_insufficient" : "verified",
    eventIds: [event.id], fields, corrections: [],
    eventDate: eventOccurredAt(event).slice(0, 10),
    verifiedAt,
    freshness: freshness(claimType, verifiedAt === UNKNOWN ? undefined : verifiedAt, now),
    unresolvedQuestions: questionsFor(event, value),
  };
}

function unknownFundingClaim(company: CompanyProfile, now: Date): CompanyClaim {
  const claimType: CompanyClaimType = "funding";
  const identifier = companyId(company);
  return {
    claimId: claimIdFor(identifier, "unknown:funding"),
    companyId: identifier, claimType,
    statement: "当前事件视图未收录可归属的公开融资证据。",
    value: UNKNOWN, evidenceIds: [], evidenceUrls: [], evidenceState: "evidence_insufficient",
    eventIds: [],
    fields: {
      eventDate: unknownLedgerField(), round: unknownLedgerField(), amount: unknownLedgerField(), valuation: unknownLedgerField(),
      investors: unknownLedgerField(), product: unknownLedgerField(), customer: unknownLedgerField(), deployment: unknownLedgerField(), productionStage: unknownLedgerField(),
    },
    corrections: [],
    eventDate: UNKNOWN, verifiedAt: UNKNOWN, freshness: freshness(claimType, undefined, now),
    unresolvedQuestions: ["需要补充主体明确且可追溯的融资、并购或战略资本公开证据。"],
  };
}

const COMPANY_CLAIM_FIELD_PATHS = [
  "eventDate", "round", "amount", "valuation", "investors", "product", "customer", "deployment", "productionStage",
] as const satisfies readonly (keyof CompanyClaimFields)[];

function correctionsFor(previous: CompanyClaim | undefined, current: CompanyClaim, correctedAt: string): LedgerCorrection[] {
  if (!previous || !previous.fields || !Array.isArray(previous.corrections)) return [];
  let corrections = [...previous.corrections];
  for (const fieldPath of COMPANY_CLAIM_FIELD_PATHS) {
    corrections = deriveLedgerCorrections<unknown>({
      ledgerType: "company-claim",
      subjectId: current.claimId,
      fieldPath: `fields.${fieldPath}`,
      before: previous.fields[fieldPath] as LedgerField<unknown>,
      after: current.fields[fieldPath] as LedgerField<unknown>,
      previousCorrections: corrections,
      correctedAt,
    });
  }
  return corrections;
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
  const previousClaims = new Map((options.previous?.companies ?? []).flatMap((entry) => entry.claims)
    .filter((claim) => typeof claim.claimId === "string")
    .map((claim) => [claim.claimId, claim]));
  const entries = selected.map(({ company, attributed, eligible, score }) => {
    const claims = attributed.filter((event) => {
      const lifecycle = (event as EventWithEvidenceState).evidenceState;
      if (["candidate", "rejected", "withdrawn"].includes(lifecycle ?? "")) return false;
      if (event.type === "投融资" && event.funding?.entityStatus === "待识别") return false;
      return publicEvidence(event).length > 0;
    }).map((event) => claimFromEvent(company, event, now));
    // Absence is represented as an explicit unknown/evidence_insufficient
    // claim, never as a conclusion that the company did not raise funding.
    if (!claims.some((claim) => claim.claimType === "funding")) claims.push(unknownFundingClaim(company, now));
    claims.forEach((claim) => { claim.corrections = correctionsFor(previousClaims.get(claim.claimId), claim, now.toISOString()); });
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
