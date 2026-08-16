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

function indexById<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

function resolveCompany(companyId: string, companies: CompanyProfile[]): CompanyProfile {
  const company = companies.find((candidate) => candidate.entityId === companyId && candidate.entityType === "公司");
  if (!company) throw new Error(`Watchlist 缺少规范公司：${companyId}`);
  return company;
}

function resolveThesis(entry: WatchlistSnapshotEntry, track: WatchlistTrack, artifact: CompanyThesisArtifact, now: number): PublicThesis {
  const thesis = artifact.theses.find((candidate) => candidate.thesisId === entry.thesisId && candidate.thesisVersion === entry.thesisVersion);
  if (!thesis || thesis.companyId !== entry.companyId || thesis.track !== track) {
    throw new Error(`Watchlist 缺少匹配的判断版本：${entry.thesisId}@${entry.thesisVersion}`);
  }
  if (thesis.lifecycle === "falsified" || thesis.lifecycle === "expired" || !Number.isFinite(Date.parse(thesis.expiresAt)) || Date.parse(thesis.expiresAt) <= now) {
    throw new Error(`Watchlist 判断不可公开：${thesis.thesisId}`);
  }
  return thesis as PublicThesis;
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
    for (const evidence of event.evidence) {
      if (!qualifyingIds.has(evidence.link)) continue;
      if (evidence.grade !== "A" && evidence.grade !== "B") continue;
      links.push({ eventId: event.id, title: event.title, url: evidence.link, source: evidence.source, grade: evidence.grade });
    }
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
  input: BuildWatchlistPublicViewInput,
  events: Map<string, EventRecord>,
  now: number,
): WatchlistPublicCard {
  const thesis = resolveThesis(entry, track, input.thesisArtifact, now);
  const company = resolveCompany(entry.companyId, input.companies);
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

function changes(snapshot: WatchlistSnapshot, companies: CompanyProfile[]): WatchlistPublicChange[] {
  return snapshot.changesSinceLastWeek.map((item) => {
    const company = resolveCompany(item.companyId, companies);
    return { companyId: item.companyId, companyName: company.name, change: item.change };
  });
}

/** Resolve the immutable snapshot through canonical company and event records for public consumption. */
export function buildWatchlistPublicView(input: BuildWatchlistPublicViewInput): WatchlistPublicView {
  const now = Date.parse(input.snapshot.generatedAt);
  if (!Number.isFinite(now)) throw new Error("Watchlist 快照缺少有效的最后成功时间");
  const events = indexById(input.events);
  const forwardRadar = input.snapshot.forwardRadar.map((entry) => resolveCard(entry, "forward-radar", input, events, now));
  const validatedMomentum = input.snapshot.validatedMomentum.map((entry) => resolveCard(entry, "validated-momentum", input, events, now));
  return {
    week: input.snapshot.week,
    snapshotVersion: input.snapshot.snapshotVersion,
    methodologyVersion: input.snapshot.methodologyVersion,
    lastSuccessfulAt: input.snapshot.generatedAt,
    companyIds: [...forwardRadar, ...validatedMomentum].map((card) => card.companyId),
    forwardRadar,
    validatedMomentum,
    changes: changes(input.snapshot, input.companies),
  };
}
