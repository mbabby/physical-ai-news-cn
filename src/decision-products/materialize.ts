import { createHash } from "node:crypto";
import { join } from "node:path";
import type { BenchmarkResultLedger } from "../benchmark-result-ledger.js";
import type { CompanyClaimLedger } from "../company-claim-ledger.js";
import { eventOccurredAt } from "../event-time.js";
import { derivePublication, isDiscoveryEvidence, type EvidenceState } from "../facts-contract.js";
import type { FileTransaction } from "../runtime/storage.js";
import { ambiguousOpenAlexWorkIds, canonicalOpenAlexWorkId, type ResearchDecisionCard } from "../research-decision-card.js";
import type { CompanyProfile, EventRecord, ResearchRecord } from "../types.js";
import type { WatchlistPublicView } from "../watchlist/public-view.js";
import { buildDecisionCompanyCards } from "./company-card.js";
import { validateDecisionProductArtifact, type DecisionProductArtifact } from "./contracts.js";
import { replaceDecisionProductReadme } from "./markdown.js";
import { buildReproducibilityPassports } from "./repro-passport.js";
import { buildSubscriptionCatalog, stageDecisionFeeds } from "./subscriptions.js";
import { buildDecisionTopSignals } from "./top-signals.js";

const DEFAULT_REPOSITORY_URL = "https://github.com/mbabby/physical-ai-news-cn";
const DEFAULT_PAGES_URL = "https://mbabby.github.io/physical-ai-news-cn";
const DAY_MS = 86_400_000;
const MAX_OPENALEX_AGE_DAYS = 30;
const COMPANY_LIMIT = 20;
const PASSPORT_LIMIT = 6;
const timestamp = (value: unknown): boolean => typeof value === "string" && value !== "unknown" && Number.isFinite(Date.parse(value));
const codeUnitCompare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

type EventWithLifecycle = EventRecord & { evidenceState?: EvidenceState };
type EvidenceWithLifecycle = EventRecord["evidence"][number] & { withdrawn?: boolean };

function publicEvent(event: EventWithLifecycle): boolean {
  const evidence = event.evidence.filter((item) => !isDiscoveryEvidence(item) && !(item as EvidenceWithLifecycle).withdrawn);
  const publication = derivePublication({ evidence, evidenceState: event.evidenceState });
  return publication.publicEligible && !(["rejected", "conflicted", "withdrawn"] as EvidenceState[]).includes(publication.evidenceState);
}

function companyMatches(company: CompanyProfile, identity: string | undefined): boolean {
  if (!identity) return false;
  const normalized = identity.trim().toLowerCase();
  return [company.entityId, company.name, company.legalName, ...(company.aliases ?? [])]
    .some((candidate) => candidate?.trim().toLowerCase() === normalized);
}

function ownedBy(event: EventRecord, company: CompanyProfile): boolean {
  return companyMatches(company, event.primaryEntity)
    && event.entities.some((identity) => companyMatches(company, identity));
}

function companyCardInputs(input: BuildDecisionProductInput): { companies: CompanyProfile[]; claimLedger: CompanyClaimLedger; events: EventRecord[] } {
  const events = input.events.filter(publicEvent);
  const aliases = new Map<string, string>();
  for (const company of input.companies) for (const name of [company.entityId, company.name, company.legalName, ...(company.aliases ?? [])]) {
    if (name) aliases.set(name.trim().toLowerCase(), company.entityId!);
  }
  const eventCompanyIds = new Set(events.flatMap((event) => {
    const companyId = event.primaryEntity && aliases.get(event.primaryEntity.trim().toLowerCase());
    return companyId && [event.lastMaterialChangeAt, event.lastUpdatedAt, event.occurredAt, event.eventDate].some(timestamp) ? [companyId] : [];
  }));
  const publicEventIds = new Set(events.map((event) => event.id));
  const publicLedgerCompanies = input.companyClaimLedger.companies.map((entry) => ({
    ...entry,
    claims: entry.claims.filter((claim) => claim.eventIds.every((eventId) => publicEventIds.has(eventId))),
  }));
  const ledgerCompanyIds = new Set(publicLedgerCompanies.flatMap((entry) => entry.claims.some((claim) =>
    timestamp(claim.verifiedAt)
      || Object.values(claim.fields).some((field) => timestamp(field.observedAt))
      || claim.corrections.some((correction) => timestamp(correction.correctedAt))) ? [entry.companyId] : []));
  const eligibleIds = new Set(input.companies.flatMap((company) => company.entityId && (timestamp(company.lastVerifiedAt) || eventCompanyIds.has(company.entityId) || ledgerCompanyIds.has(company.entityId)) ? [company.entityId] : []));
  return {
    companies: input.companies.filter((company) => company.entityId && eligibleIds.has(company.entityId)),
    claimLedger: { ...input.companyClaimLedger, companies: publicLedgerCompanies.filter((entry) => eligibleIds.has(entry.companyId)) },
    events,
  };
}

function currentWatchlistCard(input: BuildDecisionProductInput, companyId: string): DecisionProductArtifact["companyCards"][number]["watchlist"] {
  const card = [...input.watchlist.forwardRadar, ...input.watchlist.validatedMomentum].find((item) => item.companyId === companyId);
  return card ? {
    track: card.track,
    lifecycle: card.lifecycle,
    whyNow: card.whyNow,
    nextValidationPoints: card.nextValidationPoints.map((point) => ({ ...point })),
  } : { track: "unknown", lifecycle: "unknown", whyNow: "证据不足", nextValidationPoints: [] };
}

function currentCompanyEvidence(input: BuildDecisionProductInput, company: CompanyProfile): Map<string, EventRecord["evidence"][number]> {
  const evidence = new Map<string, EventRecord["evidence"][number]>();
  for (const event of input.events.filter((item) => publicEvent(item) && ownedBy(item, company))) {
    for (const item of event.evidence) if (!isDiscoveryEvidence(item) && !(item as EvidenceWithLifecycle).withdrawn) evidence.set(item.link, item);
  }
  return evidence;
}

function retainedFactSupported(
  fact: DecisionProductArtifact["companyCards"][number]["capital"],
  keys: readonly string[],
  input: BuildDecisionProductInput,
  company: CompanyProfile,
  updatedAt: string,
): boolean {
  if (fact.status === "unknown") return fact.evidence.length === 0;
  if (fact.status === "conflicted") return false;
  const entry = input.companyClaimLedger.companies.find((item) => item.companyId === company.entityId);
  if (!entry) return false;
  if (entry.claims.some((claim) => claim.corrections.some((correction) => timestamp(correction.correctedAt) && correction.correctedAt > updatedAt))) return false;
  const allowedUrls = new Set(entry.claims.flatMap((claim) => Object.entries(claim.fields)
    .filter(([key, field]) => keys.includes(key) && (field.status === "verified" || field.status === "developing"))
    .flatMap(([, field]) => field.evidenceUrls)));
  const eventEvidence = currentCompanyEvidence(input, company);
  return fact.evidence.every((evidence) => {
    const current = eventEvidence.get(evidence.url);
    return allowedUrls.has(evidence.url) && current?.source === evidence.source && current.grade === evidence.grade;
  });
}

function retainedCompanyCardValid(card: DecisionProductArtifact["companyCards"][number], input: BuildDecisionProductInput): boolean {
  const company = input.companies.find((item) => item.entityId === card.companyId);
  if (!company || company.entityType !== "公司" || Date.parse(card.updatedAt) > input.generatedAt.getTime()) return false;
  if (company.name !== card.companyName || company.officialUrl !== card.officialUrl || company.region !== card.region
    || (company.stage ?? "公司") !== card.stage
    || JSON.stringify([...new Set(company.routes)].sort(codeUnitCompare)) !== JSON.stringify(card.routes)) return false;
  if (JSON.stringify(currentWatchlistCard(input, card.companyId)) !== JSON.stringify(card.watchlist)) return false;
  if (!retainedFactSupported(card.capital, ["round", "amount", "valuation", "investors"], input, company, card.updatedAt)
    || !retainedFactSupported(card.productDeployment, ["product", "customer", "deployment", "productionStage"], input, company, card.updatedAt)) return false;
  return card.recentChanges.every((change) => {
    const event = input.events.find((item) => item.id === change.eventId);
    const occurredAt = event && eventOccurredAt(event);
    return Boolean(event && publicEvent(event) && ownedBy(event, company)
      && event.title === change.title && event.type === change.type
      && occurredAt && new Date(occurredAt).toISOString() === change.occurredAt
      && (!event.lastMaterialChangeAt || event.lastMaterialChangeAt <= card.updatedAt));
  });
}

function knownLedgerValue(field: { value: unknown; status: string; evidenceUrls: string[] }, value: unknown, evidenceUrls: string[]): boolean {
  return field.status === "verified" && field.value !== "unknown" && JSON.stringify(field.value) === JSON.stringify(value)
    && evidenceUrls.every((url) => field.evidenceUrls.includes(url));
}

function retainedPassportValid(passport: DecisionProductArtifact["researchPassports"][number], input: BuildDecisionProductInput, ambiguousWorkIds: ReadonlySet<string>): boolean {
  const record = input.researchRecords.find((item) => item.id === passport.paperId);
  const scholar = record?.article.scholar;
  const workId = canonicalOpenAlexWorkId(scholar?.workId);
  if (!record || record.status === "已撤稿" || record.status === "待复核" || record.article.link !== passport.sourceUrl
    || !scholar || scholar.isRetracted !== false || !workId || ambiguousWorkIds.has(workId)) return false;
  const checkedAt = Date.parse(scholar.checkedAt);
  const authorityCheckedAt = passport.authority.checkedAt === "unknown" ? NaN : Date.parse(passport.authority.checkedAt);
  if (!Number.isFinite(checkedAt) || checkedAt > input.generatedAt.getTime()
    || input.generatedAt.getTime() - checkedAt > MAX_OPENALEX_AGE_DAYS * DAY_MS
    || !Number.isFinite(authorityCheckedAt) || authorityCheckedAt > checkedAt) return false;
  const currentCard = input.researchDecisionCards.find((card) => card.identity.paperId.value === passport.paperId);
  if (currentCard && (!currentCard.eligibleForTopResearch || currentCard.gates.length > 0
    || canonicalOpenAlexWorkId(currentCard.identity.openAlexWorkId.value === "unknown" ? undefined : currentCard.identity.openAlexWorkId.value) !== workId
    || currentCard.openAlex.retraction.value !== false || currentCard.openAlex.freshness.value !== "fresh")) return false;

  const benchmarkFields = ["name", "metric", "result", "baseline", "delta"] as const;
  const ledgerKeys = { name: "benchmark", metric: "metric", result: "result", baseline: "baseline", delta: "delta" } as const;
  const knownBenchmark = benchmarkFields.filter((key) => passport.benchmark[key] !== "unknown");
  if (knownBenchmark.length) {
    const supported = input.benchmarkResultLedger.entries.some((entry) => entry.paperId === passport.paperId
      && entry.decisionCardPaperId === passport.paperId && entry.sourceUrl === passport.sourceUrl && entry.gateCodes.length === 0
      && knownBenchmark.every((key) => knownLedgerValue(entry.fields[ledgerKeys[key]], passport.benchmark[key], passport.benchmark.evidenceUrls)));
    if (!supported) return false;
  }
  if (passport.realRobotTrials !== "unknown" && !input.benchmarkResultLedger.entries.some((entry) => entry.paperId === passport.paperId
    && entry.gateCodes.length === 0 && knownLedgerValue(entry.fields.realRobotTrials, passport.realRobotTrials, entry.fields.realRobotTrials.evidenceUrls))) return false;
  for (const key of ["code", "data", "weights"] as const) {
    const asset = passport.assets[key];
    if (asset === "unknown") continue;
    const ledgerSupported = input.benchmarkResultLedger.entries.some((entry) => entry.paperId === passport.paperId
      && entry.gateCodes.length === 0 && knownLedgerValue(entry.fields[key], asset, entry.fields[key].evidenceUrls));
    const cardSupported = currentCard?.artifacts[key].value === asset && currentCard.artifacts[key].evidenceUrls.length > 0;
    if (!ledgerSupported && !cardSupported) return false;
  }
  return true;
}

function mergeSparse<T>(current: T[], previous: T[], identity: (item: T) => string, valid: (item: T) => boolean, limit: number): T[] {
  const merged = current.slice(0, limit);
  const seen = new Set(merged.map(identity));
  for (const item of previous) {
    if (merged.length >= limit) break;
    const id = identity(item);
    if (!seen.has(id) && valid(item)) { merged.push(item); seen.add(id); }
  }
  return merged;
}

export interface BuildDecisionProductInput {
  generatedAt: Date;
  events: EventRecord[];
  companies: CompanyProfile[];
  companyClaimLedger: CompanyClaimLedger;
  researchRecords: ResearchRecord[];
  researchDecisionCards: ResearchDecisionCard[];
  benchmarkResultLedger: BenchmarkResultLedger;
  watchlist: WatchlistPublicView;
  /** Strict last-known-good public artifact; retained items are revalidated against every current canonical source. */
  previousArtifact?: DecisionProductArtifact;
}

export interface DecisionProductRetentionReceipt {
  schemaVersion: 1;
  generatedAt: string;
  previousArtifactSha256: string | null;
  retainedCompanyIds: string[];
  retainedPaperIds: string[];
}

export function validateDecisionProductRetentionReceipt(value: unknown): asserts value is DecisionProductRetentionReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Decision Product 保留凭据必须为对象");
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== 5 || keys[0] !== "generatedAt" || keys[1] !== "previousArtifactSha256" || keys[2] !== "retainedCompanyIds"
    || keys[3] !== "retainedPaperIds" || keys[4] !== "schemaVersion" || record.schemaVersion !== 1
    || typeof record.generatedAt !== "string" || !Number.isFinite(Date.parse(record.generatedAt)) || new Date(record.generatedAt).toISOString() !== record.generatedAt) {
    throw new Error("Decision Product 保留凭据结构无效");
  }
  const identifiers = (items: unknown): items is string[] => Array.isArray(items) && items.every((item) => typeof item === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item)) && new Set(items).size === items.length;
  if (!identifiers(record.retainedCompanyIds) || !identifiers(record.retainedPaperIds)) throw new Error("Decision Product 保留凭据 identity 无效");
  if (record.previousArtifactSha256 !== null && (typeof record.previousArtifactSha256 !== "string" || !/^[a-f0-9]{64}$/.test(record.previousArtifactSha256))) {
    throw new Error("Decision Product 保留凭据摘要无效");
  }
  if ((record.retainedCompanyIds.length > 0 || record.retainedPaperIds.length > 0) !== (record.previousArtifactSha256 !== null)) throw new Error("Decision Product 保留凭据摘要与 identity 不一致");
}

const stableArtifactBytes = (artifact: DecisionProductArtifact): string => `${JSON.stringify(artifact, null, 2)}\n`;
export const decisionProductArtifactSha256 = (artifact: DecisionProductArtifact): string => createHash("sha256").update(stableArtifactBytes(artifact)).digest("hex");

export function buildDecisionProductRetentionReceipt(input: {
  currentArtifact: DecisionProductArtifact;
  artifact: DecisionProductArtifact;
  previousArtifact?: DecisionProductArtifact;
}): DecisionProductRetentionReceipt {
  validateDecisionProductArtifact(input.currentArtifact);
  validateDecisionProductArtifact(input.artifact);
  if (input.previousArtifact) validateDecisionProductArtifact(input.previousArtifact);
  if (input.currentArtifact.generatedAt !== input.artifact.generatedAt) throw new Error("Decision Product 当前工件与发布工件时钟不一致");
  const currentCompanyIds = new Set(input.currentArtifact.companyCards.map((card) => card.companyId));
  const currentPaperIds = new Set(input.currentArtifact.researchPassports.map((passport) => passport.paperId));
  const retainedCompanyIds = input.artifact.companyCards.filter((card) => !currentCompanyIds.has(card.companyId)).map((card) => card.companyId);
  const retainedPaperIds = input.artifact.researchPassports.filter((passport) => !currentPaperIds.has(passport.paperId)).map((passport) => passport.paperId);
  const retained = retainedCompanyIds.length > 0 || retainedPaperIds.length > 0;
  if (retained && !input.previousArtifact) throw new Error("Decision Product 发布工件包含无保留来源的条目");
  if (retained && (!retainedCompanyIds.every((id) => input.previousArtifact!.companyCards.some((card) => card.companyId === id))
    || !retainedPaperIds.every((id) => input.previousArtifact!.researchPassports.some((passport) => passport.paperId === id)))) {
    throw new Error("Decision Product 发布工件的保留 identity 不属于上一版公开工件");
  }
  const receipt = {
    schemaVersion: 1,
    generatedAt: input.artifact.generatedAt,
    previousArtifactSha256: retained ? decisionProductArtifactSha256(input.previousArtifact!) : null,
    retainedCompanyIds,
    retainedPaperIds,
  } satisfies DecisionProductRetentionReceipt;
  validateDecisionProductRetentionReceipt(receipt);
  return receipt;
}

export function buildDecisionProductArtifact(input: BuildDecisionProductInput): DecisionProductArtifact {
  if (!Number.isFinite(input.generatedAt.getTime())) throw new Error("Decision Product requires a valid fixed clock");
  const generatedAt = input.generatedAt.toISOString();
  if (input.companyClaimLedger.generatedAt !== generatedAt || input.benchmarkResultLedger.generatedAt !== generatedAt) {
    throw new Error("Decision Product 输入账本与生成时钟不一致");
  }
  if (input.previousArtifact) {
    validateDecisionProductArtifact(input.previousArtifact);
    if (Date.parse(input.previousArtifact.generatedAt) > input.generatedAt.getTime()) throw new Error("Decision Product 历史工件不能晚于当前生成时钟");
  }
  const companyInputs = companyCardInputs(input);
  const currentCompanyCards = buildDecisionCompanyCards({
    companies: companyInputs.companies,
    claimLedger: companyInputs.claimLedger,
    events: companyInputs.events,
    watchlist: input.watchlist,
    now: input.generatedAt,
  });
  const currentPassports = buildReproducibilityPassports({
    records: input.researchRecords,
    cards: input.researchDecisionCards,
    benchmarkLedger: input.benchmarkResultLedger,
  });
  const currentAmbiguousWorkIds = ambiguousOpenAlexWorkIds(input.researchRecords);
  const base: DecisionProductArtifact = {
    schemaVersion: 1,
    generatedAt,
    periodStart: new Date(input.generatedAt.getTime() - 6 * DAY_MS).toISOString().slice(0, 10),
    topSignals: buildDecisionTopSignals(input.events, input.companies, input.generatedAt),
    companyCards: input.previousArtifact
      ? mergeSparse(currentCompanyCards, input.previousArtifact.companyCards, (card) => card.companyId, (card) => retainedCompanyCardValid(card, input), COMPANY_LIMIT)
      : currentCompanyCards,
    researchPassports: input.previousArtifact
      ? mergeSparse(currentPassports, input.previousArtifact.researchPassports, (passport) => passport.paperId, (passport) => retainedPassportValid(passport, input, currentAmbiguousWorkIds), PASSPORT_LIMIT)
      : currentPassports,
    subscriptions: { generatedAt, entries: [] },
  };
  validateDecisionProductArtifact(base);
  const artifact = { ...base, subscriptions: buildSubscriptionCatalog(base, { repositoryUrl: DEFAULT_REPOSITORY_URL, pagesUrl: DEFAULT_PAGES_URL }) };
  validateDecisionProductArtifact(artifact);
  return artifact;
}

export interface StageDecisionProductsInput {
  root: string;
  transaction: Pick<FileTransaction, "stage">;
  artifact: DecisionProductArtifact;
  readme: string;
  repositoryUrl: string;
  pagesUrl: string;
  watchlist: WatchlistPublicView;
  retentionReceipt: DecisionProductRetentionReceipt;
  retentionSource?: DecisionProductArtifact;
}

/** Validate all projections before placing any decision-product bytes in the shared transaction. */
export function stageDecisionProducts(input: StageDecisionProductsInput): string {
  validateDecisionProductArtifact(input.artifact);
  validateDecisionProductRetentionReceipt(input.retentionReceipt);
  if (input.retentionReceipt.generatedAt !== input.artifact.generatedAt) throw new Error("Decision Product 保留凭据与发布工件时钟不一致");
  if (input.retentionReceipt.previousArtifactSha256) {
    if (!input.retentionSource) throw new Error("Decision Product 保留凭据缺少上一版公开快照");
    validateDecisionProductArtifact(input.retentionSource);
    if (decisionProductArtifactSha256(input.retentionSource) !== input.retentionReceipt.previousArtifactSha256) throw new Error("Decision Product 上一版公开快照摘要不一致");
  } else if (input.retentionSource) throw new Error("Decision Product 未使用保留条目时不得新增历史快照");
  const readme = replaceDecisionProductReadme(input.readme, input.artifact);
  const expectedCatalog = buildSubscriptionCatalog(input.artifact, input);
  if (JSON.stringify(expectedCatalog) !== JSON.stringify(input.artifact.subscriptions)) {
    throw new Error("Decision Product 订阅目录与发布 URL 不一致");
  }
  const bytes = `${JSON.stringify(input.artifact, null, 2)}\n`;
  stageDecisionFeeds({ ...input, transaction: input.transaction });
  input.transaction.stage(join(input.root, "site", "data", "decision-products.json"), bytes);
  if (input.retentionSource) input.transaction.stage(
    join(input.root, "review", "decision-products-history", `${input.retentionReceipt.previousArtifactSha256}.json`),
    stableArtifactBytes(input.retentionSource),
  );
  input.transaction.stage(join(input.root, "review", "decision-products-retention.json"), `${JSON.stringify(input.retentionReceipt, null, 2)}\n`);
  return readme;
}
