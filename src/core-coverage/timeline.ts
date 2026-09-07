import { projectCanonicalCompanyClaimFields } from "../company-claim-ledger.js";
import type { CompanyClaim, CompanyClaimLedger, CompanyClaimType } from "../company-claim-ledger.js";
import type { LedgerField } from "../ledger-contracts.js";
import type { EventRecord } from "../types.js";

const UNKNOWN = "unknown" as const;
const DAY_MS = 86_400_000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1_000;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface CoverageWindows {
  backfillStart: string;
  currentStart: string;
  through: string;
}

export interface TimelineEventProjection {
  eventId: string;
  title: string;
  occurredOn: string | "unknown";
  publishedOn: string | "unknown";
}

export interface TimelineFactProjection {
  claimId: string;
  companyId: string;
  claimType: CompanyClaimType;
  statement: string;
  eventIds: string[];
  fields: Partial<Record<keyof CompanyClaim["fields"], LedgerField<unknown>>>;
  needsReview: boolean;
}

export interface CoreCoverageTimelineProjection {
  windows: CoverageWindows;
  occurred: TimelineEventProjection[];
  published: TimelineEventProjection[];
  historicalFunding: TimelineFactProjection[];
  currentFacts: TimelineFactProjection[];
}

function shanghaiDay(date: Date): string {
  if (Number.isNaN(date.valueOf())) throw new Error("时间线日期不合法");
  return new Date(date.getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

function parseDay(day: string): Date | undefined {
  const match = DATE.exec(day);
  if (!match) return undefined;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === day ? date : undefined;
}

function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function subtractCalendarMonths(day: string, months: number): string {
  const source = parseDay(day)!;
  const targetYear = source.getUTCFullYear();
  const targetMonthIndex = source.getUTCMonth() - months;
  const monthStart = new Date(Date.UTC(targetYear, targetMonthIndex, 1));
  const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0)).getUTCDate();
  return formatDay(new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), Math.min(source.getUTCDate(), monthEnd))));
}

export function coverageWindows(now: Date): CoverageWindows {
  const through = shanghaiDay(now);
  const throughDate = parseDay(through)!;
  return {
    backfillStart: subtractCalendarMonths(through, 12),
    currentStart: formatDay(new Date(throughDate.getTime() - 89 * DAY_MS)),
    through,
  };
}

export function inCoverageWindow(day: string, from: string, through: string): boolean {
  if (!parseDay(day) || !parseDay(from) || !parseDay(through) || from > through) return false;
  return day >= from && day <= through;
}

export function needsCurrentStateReview(verifiedAt: string, now: Date): boolean {
  const today = parseDay(shanghaiDay(now))!;
  const calendarDay = parseDay(verifiedAt.slice(0, 10));
  if (!calendarDay) return true;
  let verifiedDay = calendarDay;
  if (!DATE.test(verifiedAt)) {
    if (!verifiedAt.includes("T")) return true;
    const verified = new Date(verifiedAt);
    if (!Number.isFinite(verified.valueOf()) || verified > now) return true;
    verifiedDay = parseDay(shanghaiDay(verified))!;
  }
  if (verifiedDay > today) return true;
  return Math.floor((today.getTime() - verifiedDay.getTime()) / DAY_MS) > 30;
}

type LifecycleEvent = EventRecord & { evidenceState?: "candidate" | "developing" | "confirmed" | "conflicted" | "rejected" | "withdrawn" };
type LifecycleEvidence = EventRecord["evidence"][number] & { withdrawn?: boolean };

function lifecycleAllowsEvidence(event: EventRecord): boolean {
  const lifecycle = (event as LifecycleEvent).evidenceState;
  return lifecycle !== "candidate" && lifecycle !== "developing" && lifecycle !== "conflicted"
    && lifecycle !== "rejected" && lifecycle !== "withdrawn"
    && !event.openQuestions.some((question) => /冲突|矛盾|不一致|conflict/i.test(question));
}

function explicitOccurrence(event: EventRecord, now: Date): string | typeof UNKNOWN {
  if (event.dateSource !== "explicit") return UNKNOWN;
  const raw = event.occurredAt ?? event.eventDate;
  if (!raw) return UNKNOWN;
  const calendarPrefix = raw.slice(0, 10);
  if (!parseDay(calendarPrefix)) return UNKNOWN;
  if (DATE.test(raw)) return raw <= shanghaiDay(now) ? raw : UNKNOWN;
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.valueOf()) || parsed > now) return UNKNOWN;
  return shanghaiDay(parsed);
}

function publicationDay(event: EventRecord, now: Date, evidenceUrls?: ReadonlySet<string>): string | typeof UNKNOWN {
  const days = event.evidence
    .filter((evidence) => !(evidence as LifecycleEvidence).withdrawn && (!evidenceUrls || evidenceUrls.has(evidence.link)))
    .flatMap((evidence) => {
      const raw = evidence.publishedAt;
      if (!parseDay(raw.slice(0, 10))) return [];
      if (DATE.test(raw)) return raw <= shanghaiDay(now) ? [raw] : [];
      const date = new Date(raw);
      return Number.isFinite(date.valueOf()) && date <= now ? [shanghaiDay(date)] : [];
    })
    .sort();
  return days.at(-1) ?? UNKNOWN;
}

/** Date projection independent of the 90-day display window; never fills occurrence from disclosure. */
export function projectCoreCoverageEventDates(event: EventRecord, now: Date, evidenceUrls?: ReadonlySet<string>): TimelineEventProjection {
  return { eventId: event.id, title: event.title, occurredOn: explicitOccurrence(event, now), publishedOn: publicationDay(event, now, evidenceUrls) };
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function verifiedFieldsForEvent(claim: CompanyClaim, event: EventRecord, now: Date): TimelineFactProjection["fields"] {
  if (!lifecycleAllowsEvidence(event)) return {};
  const canonical = projectCanonicalCompanyClaimFields(event);
  return Object.fromEntries(Object.entries(claim.fields).flatMap(([key, saved]) => {
    const current = canonical[key as keyof CompanyClaim["fields"]] as LedgerField<unknown>;
    if (saved.status !== "verified" || saved.value === UNKNOWN || current.status !== "verified" || current.value === UNKNOWN) return [];
    if (!sameValue(saved.value, current.value)) return [];
    if (key === "eventDate" && explicitOccurrence(event, now) !== current.value) return [];
    return [[key, current]];
  })) as TimelineFactProjection["fields"];
}

function verifiedFields(claim: CompanyClaim, eventsById: ReadonlyMap<string, EventRecord>, now: Date): TimelineFactProjection["fields"] {
  const fields: TimelineFactProjection["fields"] = {};
  for (const eventId of claim.eventIds) {
    const event = eventsById.get(eventId);
    if (!event) continue;
    Object.assign(fields, verifiedFieldsForEvent(claim, event, now));
  }
  return fields;
}

function factProjection(claim: CompanyClaim, eventsById: ReadonlyMap<string, EventRecord>, now: Date): TimelineFactProjection {
  return {
    claimId: claim.claimId,
    companyId: claim.companyId,
    claimType: claim.claimType,
    statement: claim.statement,
    eventIds: [...claim.eventIds],
    fields: verifiedFields(claim, eventsById, now),
    needsReview: needsCurrentStateReview(claim.verifiedAt, now),
  };
}

function claimIsUsable(claim: CompanyClaim, eventsById: ReadonlyMap<string, EventRecord>, now: Date): boolean {
  if (claim.evidenceState !== "verified" || claim.eventIds.length === 0) return false;
  if (!claim.eventIds.every((eventId) => eventsById.has(eventId))) return false;
  return Object.keys(verifiedFields(claim, eventsById, now)).some((key) => key !== "eventDate");
}

/** Strict Core30 view: occurrence and publication clocks never substitute for one another. */
export function projectCoreCoverageTimeline(
  ledger: CompanyClaimLedger,
  events: readonly EventRecord[],
  now: Date,
): CoreCoverageTimelineProjection {
  const windows = coverageWindows(now);
  const eventsById = new Map(events.map((event) => [event.id, event]));
  const claims = ledger.companies.flatMap((company) => company.claims).filter((claim) => claimIsUsable(claim, eventsById, now));
  const eventEvidenceUrls = new Map<string, Set<string>>();
  for (const claim of claims) {
    for (const eventId of claim.eventIds) {
      const event = eventsById.get(eventId);
      if (!event) continue;
      const fields = verifiedFieldsForEvent(claim, event, now);
      const substantive = Object.entries(fields).filter(([key]) => key !== "eventDate");
      if (!substantive.length) continue;
      const urls = eventEvidenceUrls.get(eventId) ?? new Set<string>();
      substantive.forEach(([, field]) => field?.evidenceUrls.forEach((url) => urls.add(url)));
      eventEvidenceUrls.set(eventId, urls);
    }
  }
  const eventRows = [...eventEvidenceUrls].flatMap(([eventId, urls]) => {
    const event = eventsById.get(eventId);
    return event ? [projectCoreCoverageEventDates(event, now, urls)] : [];
  });
  const descending = (left: TimelineEventProjection, right: TimelineEventProjection): number =>
    right.publishedOn.localeCompare(left.publishedOn) || left.eventId.localeCompare(right.eventId);
  return {
    windows,
    occurred: eventRows.filter((item) => inCoverageWindow(item.occurredOn, windows.currentStart, windows.through))
      .sort((left, right) => right.occurredOn.localeCompare(left.occurredOn) || left.eventId.localeCompare(right.eventId)),
    published: eventRows.filter((item) => inCoverageWindow(item.publishedOn, windows.currentStart, windows.through)).sort(descending),
    historicalFunding: claims.filter((claim) => claim.claimType === "funding").map((claim) => factProjection(claim, eventsById, now)),
    currentFacts: claims.filter((claim) => claim.claimType !== "funding").map((claim) => factProjection(claim, eventsById, now)),
  };
}
