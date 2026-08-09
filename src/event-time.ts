import type { Article, EventRecord } from "./types.js";

export type EventDateSource = NonNullable<EventRecord["dateSource"]>;
export type EventDateConfidence = NonNullable<EventRecord["dateConfidence"]>;

export interface EventTimeFields {
  occurredAt: string;
  eventDate: string;
  dateSource: EventDateSource;
  dateConfidence: EventDateConfidence;
  firstSeenAt: string;
  lastEvidenceAt: string;
  lastVerifiedAt: string;
  lastMaterialChangeAt: string;
  lastUpdatedAt: string;
}

const DISCOVERY = /google news|hacker news|^x\s*·/i;

function iso(value: string | Date | undefined, fallback: string): string {
  if (!value) return fallback;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : fallback;
}

function evidenceRank(grade: string): number {
  return grade === "A" ? 3 : grade === "B" ? 2 : grade === "C" ? 1 : 0;
}

/** Derive an event date once, when the event is created. Later evidence may
 * improve verification but must not silently rewrite history. */
export function eventTimeForArticle(article: Article, seenAt: Date): EventTimeFields {
  const firstSeenAt = seenAt.toISOString();
  const publishedAt = iso(article.publishedAt, firstSeenAt);
  const explicit = article.eventDate ? iso(article.eventDate, publishedAt) : undefined;
  const official = !DISCOVERY.test(article.source)
    && (article.sourceWeight >= 9 || article.sourceTier === "官方公司与实验室" || article.sourceTier === "开源发布");
  const dateSource: EventDateSource = explicit ? "explicit" : official ? "official-published" : article.sourceWeight >= 6 ? "media-published" : "inferred";
  const dateConfidence: EventDateConfidence = explicit || official ? "high" : article.sourceWeight >= 6 ? "medium" : "low";
  const occurredAt = explicit ?? publishedAt;
  return {
    occurredAt,
    eventDate: occurredAt.slice(0, 10),
    dateSource,
    dateConfidence,
    firstSeenAt,
    lastEvidenceAt: publishedAt,
    lastVerifiedAt: firstSeenAt,
    lastMaterialChangeAt: firstSeenAt,
    lastUpdatedAt: firstSeenAt,
  };
}

/** Upgrade a legacy record without pretending its ingestion timestamp was the
 * event date. A/B evidence publication dates take precedence; within the best
 * grade, the earliest report is the conservative occurrence proxy. */
export function migrateEventTime(event: EventRecord): EventRecord {
  const fallback = iso(event.firstSeenAt || event.lastUpdatedAt, new Date(0).toISOString());
  const ranked = [...(event.evidence ?? [])]
    .filter((item) => Number.isFinite(new Date(item.publishedAt).getTime()))
    .sort((a, b) => evidenceRank(b.grade) - evidenceRank(a.grade) || a.publishedAt.localeCompare(b.publishedAt));
  const bestRank = ranked.length ? evidenceRank(ranked[0].grade) : -1;
  const best = ranked.filter((item) => evidenceRank(item.grade) === bestRank).sort((a, b) => a.publishedAt.localeCompare(b.publishedAt))[0];
  const existingOccurrence = event.occurredAt ?? event.eventDate;
  const occurredAt = iso(existingOccurrence, best ? iso(best.publishedAt, fallback) : fallback);
  const lastEvidenceAt = ranked.reduce((latest, item) => {
    const value = iso(item.publishedAt, latest);
    return value > latest ? value : latest;
  }, occurredAt);
  const inferredSource: EventDateSource = best?.grade === "A" ? "official-published" : best?.grade === "B" ? "media-published" : "inferred";
  const dateSource = event.dateSource ?? (existingOccurrence ? "explicit" : inferredSource);
  const dateConfidence = event.dateConfidence ?? (dateSource === "explicit" || dateSource === "official-published" ? "high" : dateSource === "media-published" ? "medium" : "low");
  const lastMaterialChangeAt = iso(event.lastMaterialChangeAt ?? event.lastUpdatedAt, fallback);
  return {
    ...event,
    occurredAt,
    eventDate: occurredAt.slice(0, 10),
    dateSource,
    dateConfidence,
    firstSeenAt: fallback,
    lastEvidenceAt,
    lastVerifiedAt: iso(event.lastVerifiedAt, fallback),
    lastMaterialChangeAt,
    lastUpdatedAt: lastMaterialChangeAt,
  };
}

export function eventOccurredAt(event: EventRecord): string {
  return migrateEventTime(event).occurredAt!;
}

export function eventMaterialChangeAt(event: EventRecord): string {
  return migrateEventTime(event).lastMaterialChangeAt!;
}

export function newestEvidenceAt(event: EventRecord): string {
  return migrateEventTime(event).lastEvidenceAt!;
}
