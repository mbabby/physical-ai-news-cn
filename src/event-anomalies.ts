import type { DailyArchive, EventRecord, EventStore } from "./types.js";
import { publicEventDate } from "./site-data.js";

const DAY_MS = 86_400_000;
const DISCOVERY = /google news|hacker news|^x\s*·/i;
const ARXIV = /arxiv/i;

export type EventAnomalySeverity = "提示" | "警告" | "严重";

export interface EventAnomalyAlert {
  code: "event-date-concentration" | "no-new-industry-evidence" | "candidate-backlog" | "arxiv-industry-contamination";
  severity: EventAnomalySeverity;
  message: string;
  value: number;
  threshold: number;
}

export interface EventAnomalyReport {
  generatedAt: string;
  windowDays: number;
  metrics: {
    publicIndustryEvents30d: number;
    newPublicIndustryEvents7d: number;
    dominantEventDate?: string;
    dominantEventDateShare: number;
    hoursSinceLatestPublicIndustryEvent?: number;
    candidateBacklog: number;
    arxivIndustryEvents: number;
  };
  alerts: EventAnomalyAlert[];
}

function isPublicIndustryEvent(event: EventRecord): boolean {
  return event.type !== "研究与数据"
    && event.status !== "已归档"
    && Boolean(event.primaryEntity)
    && event.evidence.some((item) => (item.grade === "A" || item.grade === "B") && !DISCOVERY.test(item.source));
}

function eventTimestamp(event: EventRecord): number | undefined {
  const value = publicEventDate(event);
  if (!value) return undefined;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

/**
 * Audits recency without manufacturing activity. Empty weeks remain empty;
 * the report raises an operational signal instead of changing public facts.
 */
export function buildEventAnomalyReport(
  store: EventStore,
  archives: DailyArchive[],
  now = new Date(),
  windowDays = 30,
): EventAnomalyReport {
  const windowStart = now.getTime() - windowDays * DAY_MS;
  const weekStart = now.getTime() - 7 * DAY_MS;
  const publicEvents = store.events
    .filter(isPublicIndustryEvent)
    .map((event) => ({ event, timestamp: eventTimestamp(event) }))
    .filter((entry): entry is { event: EventRecord; timestamp: number } => entry.timestamp !== undefined)
    .filter((entry) => entry.timestamp >= windowStart && entry.timestamp <= now.getTime());
  const thisWeek = publicEvents.filter((entry) => entry.timestamp >= weekStart);
  const byDate = new Map<string, number>();
  for (const entry of publicEvents) {
    const date = new Date(entry.timestamp).toISOString().slice(0, 10);
    byDate.set(date, (byDate.get(date) ?? 0) + 1);
  }
  const dominant = [...byDate.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const dominantShare = dominant && publicEvents.length ? dominant[1] / publicEvents.length : 0;
  const latestTimestamp = publicEvents.reduce<number | undefined>((latest, entry) => latest === undefined || entry.timestamp > latest ? entry.timestamp : latest, undefined);
  const hoursSinceLatest = latestTimestamp === undefined ? undefined : (now.getTime() - latestTimestamp) / 3_600_000;
  const candidateBacklog = archives.flatMap((archive) => archive.candidates ?? [])
    .filter((candidate) => candidate.stage !== "不适合公开资讯")
    .filter((candidate, index, all) => all.findIndex((item) => item.link === candidate.link) === index).length;
  const arxivIndustryEvents = store.events.filter((event) => event.type !== "研究与数据" && event.evidence.some((item) => ARXIV.test(`${item.source} ${item.link}`))).length;

  const alerts: EventAnomalyAlert[] = [];
  if (publicEvents.length >= 4 && dominantShare >= 0.6) alerts.push({
    code: "event-date-concentration", severity: dominantShare >= 0.8 ? "严重" : "警告",
    message: `近 ${windowDays} 天公开产业事件有 ${Math.round(dominantShare * 100)}% 集中在 ${dominant?.[0]}，请检查是否误用了入库日期。`,
    value: Number(dominantShare.toFixed(2)), threshold: 0.6,
  });
  if (hoursSinceLatest === undefined || hoursSinceLatest > 72) alerts.push({
    code: "no-new-industry-evidence", severity: hoursSinceLatest === undefined || hoursSinceLatest > 168 ? "严重" : "警告",
    message: hoursSinceLatest === undefined ? "近 30 天没有带 A/B 级证据的公开产业事件。" : `已连续 ${Math.floor(hoursSinceLatest)} 小时没有新的 A/B 级公开产业证据。`,
    value: hoursSinceLatest === undefined ? -1 : Math.round(hoursSinceLatest), threshold: 72,
  });
  if (candidateBacklog >= 20) alerts.push({
    code: "candidate-backlog", severity: candidateBacklog >= 50 ? "严重" : "警告",
    message: `候选层积压 ${candidateBacklog} 条去重线索，需要扩充二次核验能力或调整低质量来源。`,
    value: candidateBacklog, threshold: 20,
  });
  if (arxivIndustryEvents > 0) alerts.push({
    code: "arxiv-industry-contamination", severity: "严重",
    message: `发现 ${arxivIndustryEvents} 条 arXiv 论文进入产业事件类型，应迁回研究池。`,
    value: arxivIndustryEvents, threshold: 0,
  });

  return {
    generatedAt: now.toISOString(), windowDays,
    metrics: {
      publicIndustryEvents30d: publicEvents.length,
      newPublicIndustryEvents7d: thisWeek.length,
      dominantEventDate: dominant?.[0],
      dominantEventDateShare: Number(dominantShare.toFixed(2)),
      hoursSinceLatestPublicIndustryEvent: hoursSinceLatest === undefined ? undefined : Math.round(hoursSinceLatest),
      candidateBacklog,
      arxivIndustryEvents,
    },
    alerts,
  };
}
