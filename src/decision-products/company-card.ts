import type { CompanyClaim, CompanyClaimFields, CompanyClaimLedger } from "../company-claim-ledger.js";
import { eventMaterialChangeAt, eventOccurredAt } from "../event-time.js";
import { isDiscoveryEvidence } from "../facts-contract.js";
import type { LedgerField, LedgerFieldStatus } from "../ledger-contracts.js";
import type { CompanyProfile, EventEvidence, EventRecord, ValidationStage } from "../types.js";
import { assertNoPrivateWatchlistContent, isInternalCandidateIdentifier } from "../watchlist/public-view.js";
import type { WatchlistPublicCard, WatchlistPublicView } from "../watchlist/public-view.js";
import { stableDecisionId } from "./contracts.js";
import type { DecisionCompanyCard, DecisionEvidence } from "./contracts.js";

const DEFAULT_LIMIT = 20;
const UNKNOWN = "unknown" as const;
const CAPITAL_UNKNOWN = "证据不足（不代表未融资）";
const PRODUCT_UNKNOWN = "证据不足（不代表没有产品或部署进展）";
const CONFLICT_SUMMARY = "字段证据存在冲突";
const CAPITAL_FIELDS = ["round", "amount", "valuation", "investors"] as const;
const PRODUCT_FIELDS = ["product", "customer", "deployment", "productionStage"] as const;
const codeUnitCompare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

export interface BuildDecisionCompanyCardsInput {
  companies: CompanyProfile[];
  claimLedger: CompanyClaimLedger;
  events: EventRecord[];
  watchlist: WatchlistPublicView;
  now: Date;
  limit?: number;
}

type FactFieldKey = (typeof CAPITAL_FIELDS)[number] | (typeof PRODUCT_FIELDS)[number];
type FactView = DecisionCompanyCard["capital"];

function canonicalTimestamp(value: string | undefined): string | undefined {
  if (!value || !Number.isFinite(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

function normalizedLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(DEFAULT_LIMIT, Math.max(0, Math.floor(limit)));
}

function indexUnique<T>(values: T[], identity: (value: T) => string | undefined, label: string): Map<string, T> {
  const indexed = new Map<string, T>();
  for (const value of values) {
    const id = identity(value)?.trim();
    if (!id) throw new Error(`${label}缺少规范标识`);
    if (indexed.has(id)) throw new Error(`${label}包含重复规范标识：${id}`);
    indexed.set(id, value);
  }
  return indexed;
}

function companyIdentityMatches(company: CompanyProfile, identity: string): boolean {
  const normalized = identity.trim().toLowerCase();
  return [company.entityId, company.name, company.legalName, ...(company.aliases ?? [])]
    .some((candidate) => candidate?.trim().toLowerCase() === normalized);
}

function eventOwner(event: EventRecord, companies: CompanyProfile[]): CompanyProfile | undefined {
  if (!event.primaryEntity?.trim()) return undefined;
  const matches = companies.filter((company) => companyIdentityMatches(company, event.primaryEntity!));
  if (matches.length > 1) throw new Error(`事件 ${event.id} 主体归属不唯一`);
  return matches[0];
}

function publicStatus(status: LedgerFieldStatus): FactView["status"] {
  return status;
}

function fieldPaths(fields: CompanyClaimFields, keys: readonly FactFieldKey[], prefix: "capital" | "product"): string[] {
  return keys.filter((key) => fields[key].status === "unknown" || fields[key].status === "conflicted")
    .map((key) => `${prefix}.${key}`)
    .sort(codeUnitCompare);
}

function eventEvidenceForField(field: LedgerField<unknown>, claimEvents: EventRecord[]): DecisionEvidence[] {
  const evidenceByUrl = new Map<string, EventEvidence>();
  for (const event of claimEvents) {
    for (const evidence of event.evidence) {
      if ((evidence.grade === "A" || evidence.grade === "B") && !isDiscoveryEvidence(evidence)) evidenceByUrl.set(evidence.link, evidence);
    }
  }
  return field.evidenceUrls.map((url, index) => {
    const source = evidenceByUrl.get(url);
    if (!source) throw new Error(`账本字段证据无法解析为规范公开证据：${url}`);
    return {
      evidenceId: field.evidenceIds[index] ?? stableDecisionId("evidence", url),
      url,
      source: source.source,
      grade: source.grade as "A" | "B",
    };
  });
}

function uniqueEvidence(fields: LedgerField<unknown>[], claimEvents: EventRecord[]): DecisionEvidence[] {
  const indexed = new Map<string, DecisionEvidence>();
  for (const field of fields) {
    for (const evidence of eventEvidenceForField(field, claimEvents)) indexed.set(evidence.evidenceId, evidence);
  }
  return [...indexed.values()].sort((left, right) => codeUnitCompare(left.evidenceId, right.evidenceId));
}

function displayValues(fields: CompanyClaimFields, keys: readonly FactFieldKey[]): string[] {
  const values: string[] = [];
  for (const key of keys) {
    const field = fields[key];
    if (field.status === "conflicted" || field.value === UNKNOWN) continue;
    if (Array.isArray(field.value)) values.push(...field.value.map(String));
    else values.push(String(field.value));
  }
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function projectFact(claim: ClaimWithEvents | undefined, keys: readonly FactFieldKey[], unknownSummary: string, now: Date): FactView {
  if (!claim || claim.freshness.state !== "fresh") return { status: "unknown", summary: unknownSummary, evidence: [] };
  const expiresAt = claim.freshness.expiresAt === UNKNOWN ? undefined : canonicalTimestamp(claim.freshness.expiresAt);
  if (!expiresAt || Date.parse(expiresAt) <= now.getTime()) return { status: "unknown", summary: unknownSummary, evidence: [] };

  const fields = keys.map((key) => claim.fields[key]) as LedgerField<unknown>[];
  const conflicts = fields.filter((field) => field.status === "conflicted");
  if (conflicts.length) return { status: "conflicted", summary: CONFLICT_SUMMARY, evidence: uniqueEvidence(conflicts, claim.__events) };

  const known = fields.filter((field) => field.status === "verified" || field.status === "developing");
  const values = displayValues(claim.fields, keys);
  if (!known.length || !values.length) return { status: "unknown", summary: unknownSummary, evidence: [] };
  const status = known.some((field) => field.status === "developing") ? "developing" : "verified";
  return { status: publicStatus(status), summary: values.join(" · "), evidence: uniqueEvidence(known, claim.__events) };
}

type ClaimWithEvents = CompanyClaim & { __events: EventRecord[] };

function newestClaim(claims: ClaimWithEvents[], types: ReadonlySet<CompanyClaim["claimType"]>): ClaimWithEvents | undefined {
  return claims.filter((claim) => types.has(claim.claimType))
    .sort((left, right) => right.eventDate.localeCompare(left.eventDate) || codeUnitCompare(left.claimId, right.claimId))[0];
}

function validationStage(claim: ClaimWithEvents | undefined, fact: DecisionCompanyCard["productDeployment"]): ValidationStage {
  if (!claim || fact.status === "unknown" || fact.status === "conflicted") return "证据不足";
  const text = `${claim.claimType} ${displayValues(claim.fields, PRODUCT_FIELDS).join(" ")}`.toLowerCase();
  if (/production|commercialization|量产|规模化|商业化/.test(text)) return "规模部署 / 商业化";
  if (/pilot|deployment|客户|订单|工厂|warehouse|deploy|试点/.test(text)) return "客户试点";
  if (/实机|真实机器人|real[- ]world|on[- ]robot/.test(text)) return "实机验证";
  if (/product|发布|launch|release|演示|demo|prototype|原型/.test(text)) return "原型与演示";
  return "概念 / 研究";
}

function fallbackWatchlist(): DecisionCompanyCard["watchlist"] {
  return { track: "unknown", lifecycle: "unknown", whyNow: "证据不足", nextValidationPoints: [] };
}

function projectWatchlist(card: WatchlistPublicCard | undefined): DecisionCompanyCard["watchlist"] {
  if (!card) return fallbackWatchlist();
  return {
    track: card.track,
    lifecycle: card.lifecycle,
    whyNow: card.whyNow,
    nextValidationPoints: card.nextValidationPoints.map((point) => ({ ...point })),
  };
}

function materialUpdatedAt(company: CompanyProfile, claims: CompanyClaim[], events: EventRecord[]): string {
  const timestamps = [
    canonicalTimestamp(company.lastVerifiedAt),
    ...claims.flatMap((claim) => [
      canonicalTimestamp(claim.verifiedAt === UNKNOWN ? undefined : claim.verifiedAt),
      ...Object.values(claim.fields).map((field) => canonicalTimestamp(field.observedAt === UNKNOWN ? undefined : field.observedAt)),
      ...claim.corrections.map((correction) => canonicalTimestamp(correction.correctedAt)),
    ]),
    ...events.map((event) => canonicalTimestamp(eventMaterialChangeAt(event))),
  ].filter((value): value is string => Boolean(value));
  const newest = timestamps.sort(codeUnitCompare).at(-1);
  if (!newest) throw new Error(`公司 ${company.entityId ?? company.name} 缺少可公开的材料更新时间`);
  return newest;
}

function bindClaimsToEvents(entryClaims: CompanyClaim[], eventsById: Map<string, EventRecord>, companies: CompanyProfile[], companyId: string): ClaimWithEvents[] {
  return entryClaims.map((claim) => {
    if (claim.companyId !== companyId) throw new Error(`公司 ${companyId} 的账本归属不一致`);
    const events = claim.eventIds.map((eventId) => {
      const event = eventsById.get(eventId);
      if (!event) throw new Error(`账本事件 ${eventId} 缺少规范事件归属`);
      const owner = eventOwner(event, companies);
      if (owner?.entityId !== companyId) throw new Error(`账本事件 ${eventId} 的公司归属不一致`);
      return event;
    });
    return Object.assign({}, claim, { __events: events });
  });
}

export function buildDecisionCompanyCards(input: BuildDecisionCompanyCardsInput): DecisionCompanyCard[] {
  if (!Number.isFinite(input.now.getTime())) throw new Error("公司卡需要有效的固定时间");
  const limit = normalizedLimit(input.limit);
  if (limit === 0) return [];

  const canonicalCompanies = input.companies.filter((company) => company.entityType === undefined || company.entityType === "公司");
  if (canonicalCompanies.some((company) => company.entityId && isInternalCandidateIdentifier(company.entityId))) {
    throw new Error("公司卡公开边界包含候选公司标识");
  }
  assertNoPrivateWatchlistContent(input.watchlist);
  const companiesById = indexUnique(canonicalCompanies, (company) => company.entityId, "规范公司");
  const eventsById = indexUnique(input.events, (event) => event.id, "规范事件");
  const ledgerById = indexUnique(input.claimLedger.companies, (entry) => entry.companyId, "公司账本");
  const watchlistCards = [...input.watchlist.forwardRadar, ...input.watchlist.validatedMomentum];
  const watchlistById = indexUnique(watchlistCards, (card) => card.companyId, "公开 Watchlist");

  for (const entry of ledgerById.values()) {
    const company = companiesById.get(entry.companyId);
    if (!company || entry.companyName !== company.name) throw new Error(`公司账本 ${entry.companyId} 的主体归属不一致`);
  }
  for (const card of watchlistById.values()) {
    const company = companiesById.get(card.companyId);
    if (!company || card.companyName !== company.name) throw new Error(`公开 Watchlist ${card.companyId} 的主体归属不一致`);
  }

  return [...canonicalCompanies]
    .sort((left, right) => codeUnitCompare(left.entityId!, right.entityId!))
    .slice(0, limit)
    .map((company) => {
      const companyId = company.entityId!;
      const entryClaims = ledgerById.get(companyId)?.claims ?? [];
      const claims = bindClaimsToEvents(entryClaims, eventsById, canonicalCompanies, companyId);
      const ownedEvents = input.events.filter((event) => eventOwner(event, canonicalCompanies)?.entityId === companyId);
      const funding = newestClaim(claims, new Set(["funding"]));
      const product = newestClaim(claims, new Set(["product", "pilot", "deployment", "production", "commercialization"]));
      const capital = projectFact(funding, CAPITAL_FIELDS, CAPITAL_UNKNOWN, input.now);
      const productDeployment = projectFact(product, PRODUCT_FIELDS, PRODUCT_UNKNOWN, input.now);
      const unknownFields = [
        ...(capital.status === "unknown" ? CAPITAL_FIELDS.map((key) => `capital.${key}`) : fieldPaths(funding!.fields, CAPITAL_FIELDS, "capital")),
        ...(productDeployment.status === "unknown" ? PRODUCT_FIELDS.map((key) => `product.${key}`) : fieldPaths(product!.fields, PRODUCT_FIELDS, "product")),
      ].sort(codeUnitCompare);
      const recentChanges = ownedEvents.map((event) => ({
        eventId: event.id,
        title: event.title,
        occurredAt: canonicalTimestamp(eventOccurredAt(event))!,
        type: event.type,
      })).filter((change) => Boolean(change.occurredAt))
        .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || codeUnitCompare(left.eventId, right.eventId))
        .slice(0, 2);

      return {
        cardId: stableDecisionId("company", companyId),
        companyId,
        companyName: company.name,
        officialUrl: company.officialUrl,
        region: company.region,
        stage: company.stage ?? "公司",
        routes: [...new Set(company.routes)].sort(codeUnitCompare),
        capital,
        validationStage: validationStage(product, productDeployment),
        productDeployment,
        recentChanges,
        watchlist: projectWatchlist(watchlistById.get(companyId)),
        unknownFields,
        updatedAt: materialUpdatedAt(company, entryClaims, ownedEvents),
      } satisfies DecisionCompanyCard;
    });
}
