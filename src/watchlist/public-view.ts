import { derivePublication } from "../facts-contract.js";
import type { CompanyProfile, EventRecord } from "../types.js";
import type {
  CompanyThesis,
  CompanyThesisArtifact,
  ThesisLifecycle,
  WatchlistChange,
  WatchlistPublicGroup,
  WatchlistSnapshot,
  WatchlistSnapshotEntry,
  WatchlistTrack,
} from "./contracts.js";

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
  return {
    companyId: entry.companyId,
    companyName: company.name,
    thesisId: thesis.thesisId,
    thesisVersion: thesis.thesisVersion,
    track,
    group: entry.group,
    lifecycle: thesis.lifecycle,
    lifecycleLabel: LIFECYCLE_LABELS[thesis.lifecycle],
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
