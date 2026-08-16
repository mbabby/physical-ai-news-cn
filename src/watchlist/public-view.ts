import { derivePublication } from "../facts-contract.js";
import type { CompanyProfile, EventRecord, TechnicalRoute } from "../types.js";
import {
  isCanonicalTimestamp,
  isValidIsoWeek,
  type CompanyThesis,
  type CompanyThesisArtifact,
  type ThesisLifecycle,
  type WatchlistChange,
  type WatchlistPublicGroup,
  type WatchlistSnapshot,
  type WatchlistSnapshotEntry,
  type WatchlistTrack,
} from "./contracts.js";
import { isTechnicalRoute } from "./routes.js";

export interface WatchlistPublicEvidenceLink {
  eventId: string;
  title: string;
  url: string;
  source: string;
  grade: "A" | "B";
}

export interface WatchlistPublicCapital {
  status: "verified" | "evidence-insufficient";
  summary: string;
}

export interface WatchlistPublicCard {
  companyId: string;
  companyName: string;
  thesisId: string;
  thesisVersion: number;
  track: WatchlistTrack;
  group: WatchlistPublicGroup;
  lifecycle: Exclude<ThesisLifecycle, "falsified" | "expired">;
  lifecycleLabel: string;
  routes: TechnicalRoute[];
  whyNow: string;
  routeAndDependencies: string;
  nextValidationPoints: Array<{ text: string; dueAt: string }>;
  falsifiers: Array<{ text: string }>;
  evidenceLinks: WatchlistPublicEvidenceLink[];
  capital: WatchlistPublicCapital;
}

export interface WatchlistPublicChange {
  companyId: string;
  companyName: string;
  change: WatchlistChange;
}

export interface WatchlistPublicView {
  week: string;
  snapshotVersion: number;
  methodologyVersion: string;
  lastSuccessfulAt: string;
  companyIds: string[];
  forwardRadar: WatchlistPublicCard[];
  validatedMomentum: WatchlistPublicCard[];
  changes: WatchlistPublicChange[];
}

export interface BuildWatchlistPublicViewInput {
  snapshot: WatchlistSnapshot;
  thesisArtifact: CompanyThesisArtifact;
  companies: CompanyProfile[];
  events: EventRecord[];
}

type PublicThesis = CompanyThesis & { lifecycle: Exclude<ThesisLifecycle, "falsified" | "expired"> };

const LIFECYCLE_LABELS: Record<Exclude<ThesisLifecycle, "falsified" | "expired">, string> = {
  new: "新进入",
  strengthening: "持续强化",
  "awaiting-validation": "等待验证",
  downgraded: "判断降级",
};

const VIEW_KEYS = new Set(["week", "snapshotVersion", "methodologyVersion", "lastSuccessfulAt", "companyIds", "forwardRadar", "validatedMomentum", "changes"]);
const CARD_KEYS = new Set(["companyId", "companyName", "thesisId", "thesisVersion", "track", "group", "lifecycle", "lifecycleLabel", "routes", "whyNow", "routeAndDependencies", "nextValidationPoints", "falsifiers", "evidenceLinks", "capital"]);
const EVIDENCE_KEYS = new Set(["eventId", "title", "url", "source", "grade"]);
const CAPITAL_KEYS = new Set(["status", "summary"]);
const CHANGE_KEYS = new Set(["companyId", "companyName", "change"]);
const PRIVATE_PUBLIC_TEXT = /\b(?:score|rank)\b|分数|排名|内部诊断|候选(?:ID|标识)/i;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: Set<string>): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.size && actual.every((key) => keys.has(key));
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Reject private diagnostics from any value that crosses the public Watchlist boundary. */
export function assertNoPrivateWatchlistContent(value: unknown): void {
  if (typeof value === "string") {
    if (/\bcandidate-[a-f0-9]{8,}\b/i.test(value)) throw new Error("Watchlist 公开产物包含候选标识");
    if (PRIVATE_PUBLIC_TEXT.test(value)) throw new Error("Watchlist 公开产物包含私有诊断、分数或排名");
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(assertNoPrivateWatchlistContent);
    return;
  }
  if (isObject(value)) Object.values(value).forEach(assertNoPrivateWatchlistContent);
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function validPublicUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function validValidationPoint(value: unknown): boolean {
  return isObject(value) && hasExactKeys(value, new Set(["text", "dueAt"]))
    && nonEmpty(value.text) && validDate(value.dueAt);
}

function validFalsifier(value: unknown): boolean {
  return isObject(value) && hasExactKeys(value, new Set(["text"])) && nonEmpty(value.text);
}

function validEvidenceLink(value: unknown): boolean {
  return isObject(value) && hasExactKeys(value, EVIDENCE_KEYS)
    && nonEmpty(value.eventId) && nonEmpty(value.title) && validPublicUrl(value.url) && nonEmpty(value.source)
    && (value.grade === "A" || value.grade === "B");
}

function validCapital(value: unknown): boolean {
  if (!isObject(value) || !hasExactKeys(value, CAPITAL_KEYS) || !nonEmpty(value.summary)) return false;
  if (value.status === "evidence-insufficient") return value.summary === "证据不足（不代表未融资）";
  return value.status === "verified";
}

function validRoutes(value: unknown): value is TechnicalRoute[] {
  return Array.isArray(value) && value.length > 0 && value.every(isTechnicalRoute)
    && new Set(value).size === value.length
    && value.every((route, index) => index === 0 || value[index - 1]! < route);
}

function validCard(value: unknown, expectedTrack: WatchlistTrack): value is WatchlistPublicCard {
  if (!isObject(value) || !hasExactKeys(value, CARD_KEYS)) return false;
  const lifecycle = value.lifecycle;
  if (lifecycle !== "new" && lifecycle !== "strengthening" && lifecycle !== "awaiting-validation" && lifecycle !== "downgraded") return false;
  return nonEmpty(value.companyId) && nonEmpty(value.companyName) && nonEmpty(value.thesisId)
    && typeof value.thesisVersion === "number" && Number.isInteger(value.thesisVersion) && value.thesisVersion > 0
    && value.track === expectedTrack
    && (value.group === "priority-focus" || value.group === "continued-observation")
    && value.lifecycleLabel === LIFECYCLE_LABELS[lifecycle]
    && validRoutes(value.routes)
    && nonEmpty(value.whyNow) && nonEmpty(value.routeAndDependencies)
    && Array.isArray(value.nextValidationPoints) && value.nextValidationPoints.length > 0 && value.nextValidationPoints.every(validValidationPoint)
    && Array.isArray(value.falsifiers) && value.falsifiers.length > 0 && value.falsifiers.every(validFalsifier)
    && Array.isArray(value.evidenceLinks) && value.evidenceLinks.length > 0 && value.evidenceLinks.every(validEvidenceLink)
    && validCapital(value.capital);
}

function validChange(value: unknown): value is WatchlistPublicChange {
  return isObject(value) && hasExactKeys(value, CHANGE_KEYS)
    && nonEmpty(value.companyId) && nonEmpty(value.companyName)
    && (value.change === "added" || value.change === "strengthened" || value.change === "downgraded" || value.change === "exited");
}

/** Strict runtime boundary for serialized dashboard Watchlist data. */
export function validateWatchlistPublicViewShape(value: unknown): value is WatchlistPublicView {
  if (!isObject(value) || !hasExactKeys(value, VIEW_KEYS)) return false;
  if (!isValidIsoWeek(value.week)
    || typeof value.snapshotVersion !== "number" || !Number.isInteger(value.snapshotVersion) || value.snapshotVersion < 1
    || !nonEmpty(value.methodologyVersion) || !isCanonicalTimestamp(value.lastSuccessfulAt)
    || !Array.isArray(value.companyIds) || !value.companyIds.every(nonEmpty)
    || !Array.isArray(value.forwardRadar) || !value.forwardRadar.every((card) => validCard(card, "forward-radar"))
    || !Array.isArray(value.validatedMomentum) || !value.validatedMomentum.every((card) => validCard(card, "validated-momentum"))
    || !Array.isArray(value.changes) || !value.changes.every(validChange)) return false;
  const cards = [...value.forwardRadar, ...value.validatedMomentum];
  const companyIds = cards.map((card) => card.companyId);
  const thesisVersions = cards.map((card) => `${card.thesisId}\0${card.thesisVersion}`);
  const changeIds = value.changes.map((change) => change.companyId);
  return new Set(companyIds).size === companyIds.length
    && new Set(thesisVersions).size === thesisVersions.length
    && new Set(value.companyIds).size === value.companyIds.length
    && value.companyIds.length === companyIds.length
    && value.companyIds.every((companyId, index) => companyId === companyIds[index])
    && new Set(changeIds).size === changeIds.length;
}

function uniqueIndex<T>(items: T[], keyFor: (item: T) => string | undefined, duplicateMessage: string): Map<string, T> {
  const indexed = new Map<string, T>();
  for (const item of items) {
    const key = keyFor(item);
    if (!key) continue;
    if (indexed.has(key)) throw new Error(`${duplicateMessage}：${key}`);
    indexed.set(key, item);
  }
  return indexed;
}

function assertUniqueSnapshotSelections(snapshot: WatchlistSnapshot): void {
  const companyIds = new Set<string>();
  const thesisVersions = new Set<string>();
  for (const entry of [...snapshot.forwardRadar, ...snapshot.validatedMomentum]) {
    const thesisVersion = `${entry.thesisId}\0${entry.thesisVersion}`;
    if (companyIds.has(entry.companyId) || thesisVersions.has(thesisVersion)) {
      throw new Error(`Watchlist 重复快照选择：${entry.companyId}`);
    }
    companyIds.add(entry.companyId);
    thesisVersions.add(thesisVersion);
  }
}

function resolveCompany(companyId: string, companies: Map<string, CompanyProfile>): CompanyProfile {
  const company = companies.get(companyId);
  if (!company || company.entityType !== "公司") throw new Error(`Watchlist 缺少规范公司：${companyId}`);
  return company;
}

function resolveThesis(entry: WatchlistSnapshotEntry, track: WatchlistTrack, theses: Map<string, CompanyThesis>, now: number): PublicThesis {
  const thesis = theses.get(`${entry.thesisId}\0${entry.thesisVersion}`);
  if (!thesis || thesis.companyId !== entry.companyId || thesis.track !== track) {
    throw new Error(`Watchlist 缺少匹配的判断版本：${entry.thesisId}@${entry.thesisVersion}`);
  }
  if (thesis.lifecycle === "falsified" || thesis.lifecycle === "expired" || !Number.isFinite(Date.parse(thesis.expiresAt)) || Date.parse(thesis.expiresAt) <= now) {
    throw new Error(`Watchlist 判断不可公开：${thesis.thesisId}`);
  }
  return thesis as PublicThesis;
}

function evidenceId(evidence: EventRecord["evidence"][number], index: number): string {
  const item = evidence as typeof evidence & { id?: string; articleId?: string };
  return item.id?.trim() || item.articleId?.trim() || evidence.link.trim() || `evidence-${index + 1}`;
}

function evidenceLinks(thesis: CompanyThesis, company: CompanyProfile, events: Map<string, EventRecord>): { links: WatchlistPublicEvidenceLink[]; references: EventRecord[] } {
  const references = thesis.factReferenceIds.map((eventId) => events.get(eventId));
  if (references.some((event) => !event)) throw new Error(`Watchlist 缺少规范事件：${thesis.thesisId}`);
  const canonical = references as EventRecord[];
  const links: WatchlistPublicEvidenceLink[] = [];
  for (const event of canonical) {
    if (event.primaryEntity !== company.name) throw new Error(`Watchlist 规范事件主体不匹配：${event.id}`);
    const publication = derivePublication({ evidence: event.evidence });
    if (!publication.publicEligible) throw new Error(`Watchlist 缺少公开证据：${event.id}`);
    const qualifyingIds = new Set(publication.qualifyingEvidenceIds);
    const eventLinks: WatchlistPublicEvidenceLink[] = [];
    for (const [index, evidence] of event.evidence.entries()) {
      const url = evidence.link.trim();
      if (!url || !qualifyingIds.has(evidenceId(evidence, index))) continue;
      if (evidence.grade !== "A" && evidence.grade !== "B") continue;
      eventLinks.push({ eventId: event.id, title: event.title, url, source: evidence.source, grade: evidence.grade });
    }
    if (!eventLinks.length) throw new Error(`Watchlist 缺少公开证据：${event.id}`);
    links.push(...eventLinks);
  }
  return { links, references: canonical };
}

function capital(references: EventRecord[]): WatchlistPublicCapital {
  const funding = references.find((event) => event.type === "投融资" && event.funding?.entityStatus === "已确认");
  if (!funding?.funding) return { status: "evidence-insufficient", summary: "证据不足（不代表未融资）" };
  const valuation = funding.funding.valuation?.trim();
  const summary = [funding.funding.round?.trim(), funding.funding.amount?.trim(), valuation && valuation !== "未披露" ? valuation : "估值未披露"]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
  return { status: "verified", summary };
}

function resolveCard(
  entry: WatchlistSnapshotEntry,
  track: WatchlistTrack,
  companies: Map<string, CompanyProfile>,
  theses: Map<string, CompanyThesis>,
  events: Map<string, EventRecord>,
  now: number,
): WatchlistPublicCard {
  const thesis = resolveThesis(entry, track, theses, now);
  const company = resolveCompany(entry.companyId, companies);
  const resolvedEvidence = evidenceLinks(thesis, company, events);
  const routes = [...new Set(company.routes)];
  if (!routes.length || !routes.every(isTechnicalRoute)) throw new Error(`Watchlist 缺少规范技术路线：${company.entityId ?? company.name}`);
  routes.sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  return {
    companyId: entry.companyId,
    companyName: company.name,
    thesisId: thesis.thesisId,
    thesisVersion: thesis.thesisVersion,
    track,
    group: entry.group,
    lifecycle: thesis.lifecycle,
    lifecycleLabel: LIFECYCLE_LABELS[thesis.lifecycle],
    routes,
    whyNow: thesis.whyNow,
    routeAndDependencies: thesis.routeAndDependencies,
    nextValidationPoints: thesis.nextValidationPoints.map((point) => ({ ...point })),
    falsifiers: thesis.falsifiers.map((falsifier) => ({ ...falsifier })),
    evidenceLinks: resolvedEvidence.links,
    capital: capital(resolvedEvidence.references),
  };
}

function changes(snapshot: WatchlistSnapshot, companies: Map<string, CompanyProfile>): WatchlistPublicChange[] {
  return snapshot.changesSinceLastWeek.map((item) => {
    const company = resolveCompany(item.companyId, companies);
    return { companyId: item.companyId, companyName: company.name, change: item.change };
  });
}

/** Resolve the immutable snapshot through canonical company and event records for public consumption. */
export function buildWatchlistPublicView(input: BuildWatchlistPublicViewInput): WatchlistPublicView {
  const now = Date.parse(input.snapshot.generatedAt);
  if (!Number.isFinite(now)) throw new Error("Watchlist 快照缺少有效的最后成功时间");
  assertUniqueSnapshotSelections(input.snapshot);
  const companies = uniqueIndex(input.companies, (company) => company.entityId, "Watchlist 重复规范公司");
  const events = uniqueIndex(input.events, (event) => event.id, "Watchlist 重复规范事件");
  const theses = uniqueIndex(input.thesisArtifact.theses, (thesis) => `${thesis.thesisId}\0${thesis.thesisVersion}`, "Watchlist 重复判断版本");
  const forwardRadar = input.snapshot.forwardRadar.map((entry) => resolveCard(entry, "forward-radar", companies, theses, events, now));
  const validatedMomentum = input.snapshot.validatedMomentum.map((entry) => resolveCard(entry, "validated-momentum", companies, theses, events, now));
  return {
    week: input.snapshot.week,
    snapshotVersion: input.snapshot.snapshotVersion,
    methodologyVersion: input.snapshot.methodologyVersion,
    lastSuccessfulAt: input.snapshot.generatedAt,
    companyIds: [...forwardRadar, ...validatedMomentum].map((card) => card.companyId),
    forwardRadar,
    validatedMomentum,
    changes: changes(input.snapshot, companies),
  };
}
