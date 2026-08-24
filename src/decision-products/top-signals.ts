import { derivePublication } from "../facts-contract.js";
import type { EvidenceState } from "../facts-contract.js";
import { hasChineseText, isPlaceholderCopy } from "../publication.js";
import type { ArticleKind, CompanyProfile, EventEvidence, EventRecord } from "../types.js";
import { stableDecisionId, validateTopSignalSource } from "./contracts.js";
import type { DecisionEvidence, DecisionTopSignal } from "./contracts.js";

const DAY_MS = 86_400_000;
const DEFAULT_LIMIT = 10;
const KIND_LIMIT = 3;
const DISCOVERY = /google news|hacker news|news\.google\.com|news\.ycombinator\.com|\bhn\b|(?:^|\s)x\s*[··:]|twitter|x\.com/i;
const CONFLICT = /冲突|矛盾|主体待识别|主体不明|归属不明|金额待核验|轮次待核验|撤回|撤销|withdrawn|conflict/i;
const COMPLETE_CHINESE_SENTENCE = /[\u3400-\u9fff].*[。！？!?]$/u;
const TERMINAL_STATES = new Set<EvidenceState>(["rejected", "conflicted", "withdrawn"]);

const IMPACT_ORDER: Record<ArticleKind, number> = {
  "投融资": 5,
  "产品发布": 4,
  "部署案例": 4,
  "公司商业": 3,
  "开源项目": 2,
  "研究与数据": 1,
};

type EventWithLifecycle = EventRecord & { evidenceState?: EvidenceState };
type EvidenceWithLifecycle = EventEvidence & { withdrawn?: boolean };

function canonicalTimestamp(value: string | undefined): string | undefined {
  if (!value || !Number.isFinite(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

function evidenceOrigin(evidence: EventEvidence): string {
  try { return new URL(evidence.link).hostname.replace(/^www\./, "").toLowerCase(); }
  catch { return evidence.source.trim().toLowerCase(); }
}

function qualifyingEvidence(event: EventWithLifecycle): EventEvidence[] | undefined {
  const nonDiscovery = event.evidence.filter((item) => !DISCOVERY.test(`${item.source} ${item.link}`));
  const publication = derivePublication({ evidence: nonDiscovery, evidenceState: event.evidenceState });
  if (!publication.publicEligible || TERMINAL_STATES.has(publication.evidenceState)) return undefined;
  const qualifyingIds = new Set(publication.qualifyingEvidenceIds);
  const direct = nonDiscovery.filter((item) => qualifyingIds.has(item.link)
    && !(item as EvidenceWithLifecycle).withdrawn)
    .sort(compareEvidence);
  const hasA = direct.some((item) => item.grade === "A");
  if (hasA) {
    const origins = new Set<string>();
    return direct.filter((item) => {
      const origin = evidenceOrigin(item);
      if (origins.has(origin)) return false;
      origins.add(origin);
      return true;
    });
  }

  const sources = new Set<string>();
  const origins = new Set<string>();
  const independent = direct.filter((item) => {
    if (item.grade !== "B") return false;
    const source = item.source.trim().toLowerCase();
    const origin = evidenceOrigin(item);
    if (!source || sources.has(source) || origins.has(origin)) return false;
    sources.add(source);
    origins.add(origin);
    return true;
  });
  return independent.length >= 2 ? independent : undefined;
}

function compareEvidence(left: EventEvidence, right: EventEvidence): number {
  return (left.grade === "A" ? 0 : 1) - (right.grade === "A" ? 0 : 1)
    || evidenceOrigin(left).localeCompare(evidenceOrigin(right))
    || left.link.localeCompare(right.link)
    || left.source.localeCompare(right.source);
}

function resolveCompany(primaryEntity: string | undefined, companies: CompanyProfile[]): CompanyProfile | undefined {
  if (!primaryEntity?.trim()) return undefined;
  const identity = primaryEntity.trim().toLowerCase();
  const matches = companies.filter((company) => company.entityId?.trim() && [
    company.entityId,
    company.name,
    company.legalName,
    ...(company.aliases ?? []),
  ].some((candidate) => candidate?.trim().toLowerCase() === identity));
  return matches.length === 1 ? matches[0] : undefined;
}

function factualCopy(event: EventRecord): [string, string] | undefined {
  const candidates = [...event.facts, ...event.timeline.map((item) => item.summary)]
    .map((value) => value.trim())
    .filter((value) => COMPLETE_CHINESE_SENTENCE.test(value)
      && (value.match(/[。！？!?]/gu)?.length ?? 0) === 1
      && !isPlaceholderCopy(value));
  const facts = [...new Set(candidates)];
  return facts.length >= 2 ? [facts[0]!, facts[1]!] : undefined;
}

function materialChangeDate(event: EventRecord): string | undefined {
  return canonicalTimestamp(event.lastMaterialChangeAt ?? event.lastUpdatedAt);
}

function changedThisWeek(event: EventRecord, now: Date): boolean {
  const changedAt = materialChangeDate(event);
  if (!changedAt) return false;
  const age = now.getTime() - Date.parse(changedAt);
  return age >= 0 && age <= 7 * DAY_MS;
}

function occurredAt(event: EventRecord, evidence: EventEvidence[]): string | undefined {
  const explicit = canonicalTimestamp(event.occurredAt) ?? canonicalTimestamp(event.eventDate);
  if (explicit) return explicit;
  return evidence.map((item) => canonicalTimestamp(item.publishedAt))
    .filter((item): item is string => Boolean(item))
    .sort()[0];
}

function impact(kind: ArticleKind): DecisionTopSignal["impact"] {
  switch (kind) {
    case "投融资": return ["company", "capital"];
    case "产品发布":
    case "部署案例": return ["company", "product-deployment"];
    case "公司商业":
    case "开源项目": return ["company"];
    case "研究与数据": return ["research"];
  }
}

function impactReason(kind: ArticleKind): string {
  switch (kind) {
    case "投融资": return "资本事件";
    case "产品发布": return "产品发布事件";
    case "部署案例": return "部署验证事件";
    case "公司商业": return "商业进展事件";
    case "开源项目": return "开源进展事件";
    case "研究与数据": return "研究进展事件";
  }
}

function whyItMatters(kind: ArticleKind): string {
  switch (kind) {
    case "投融资": return "AI 研究判断：该事件为相关公司与技术路线带来新的资本信号。";
    case "产品发布": return "AI 研究判断：该事件提供了产品能力与工程进展的公开验证。";
    case "部署案例": return "AI 研究判断：该事件提供了真实场景部署进展的公开验证。";
    case "公司商业": return "AI 研究判断：该事件反映了公司商业化进程的公开变化。";
    case "开源项目": return "AI 研究判断：该事件增加了可公开复用的技术资产。";
    case "研究与数据": return "AI 研究判断：该事件可能影响后续研究与评测路径。";
  }
}

function rankReasons(signal: Pick<DecisionTopSignal, "changedThisWeek" | "evidenceState" | "kind">): string[] {
  return [
    signal.changedThisWeek ? "本周发生实质变化" : "已有规范事件持续有效",
    signal.evidenceState === "official" ? "官方一手证据" : "独立多源证据",
    impactReason(signal.kind),
  ];
}

function publicEvidence(event: EventRecord, evidence: EventEvidence[]): DecisionEvidence[] {
  return evidence.map((item) => ({
    evidenceId: stableDecisionId("evidence", `${event.id}\n${item.link}`),
    url: item.link,
    source: item.source,
    grade: item.grade as "A" | "B",
  }));
}

function materialize(event: EventWithLifecycle, companies: CompanyProfile[], now: Date): DecisionTopSignal | undefined {
  if (event.status === "核验中" || event.status === "待复核" || event.status === "已归档") return undefined;
  if (event.openQuestions.some((question) => CONFLICT.test(question))) return undefined;
  if (event.type === "投融资" && event.funding?.entityStatus !== "已确认") return undefined;
  const company = resolveCompany(event.primaryEntity, companies);
  const factsZh = factualCopy(event);
  const evidence = qualifyingEvidence(event);
  if (!company?.entityId || !factsZh || !evidence) return undefined;
  if (!hasChineseText(event.title) || isPlaceholderCopy(event.title)) return undefined;
  const occurrence = occurredAt(event, evidence);
  const verification = canonicalTimestamp(event.lastVerifiedAt);
  if (!occurrence || !verification) return undefined;

  const evidenceState = evidence.some((item) => item.grade === "A") ? "official" : "multi-source";
  const base = {
    changedThisWeek: changedThisWeek(event, now),
    evidenceState,
    kind: event.type,
  } as const;
  const signal: DecisionTopSignal = {
    signalId: stableDecisionId("signal", event.id),
    eventId: event.id,
    entityId: company.entityId,
    entityName: company.name,
    titleZh: event.title.trim(),
    factsZh,
    kind: event.type,
    routes: [...new Set(event.routes)],
    occurredAt: occurrence,
    verifiedAt: verification,
    changedThisWeek: base.changedThisWeek,
    evidenceState: base.evidenceState,
    evidence: publicEvidence(event, evidence),
    impact: impact(event.type),
    whyItMatters: whyItMatters(event.type),
    rankReasons: rankReasons(base),
  };
  validateTopSignalSource(signal);
  return signal;
}

function compareSignals(left: DecisionTopSignal, right: DecisionTopSignal): number {
  return Number(right.changedThisWeek) - Number(left.changedThisWeek)
    || Number(right.evidenceState === "official") - Number(left.evidenceState === "official")
    || IMPACT_ORDER[right.kind] - IMPACT_ORDER[left.kind]
    || right.evidence.length - left.evidence.length
    || right.occurredAt.localeCompare(left.occurredAt)
    || left.eventId.localeCompare(right.eventId);
}

export function buildDecisionTopSignals(
  events: EventRecord[],
  companies: CompanyProfile[],
  now: Date,
  limit = DEFAULT_LIMIT,
): DecisionTopSignal[] {
  if (!Number.isFinite(now.getTime())) throw new Error("Top Signals requires a valid fixed clock");
  const normalizedLimit = Number.isFinite(limit) ? limit : DEFAULT_LIMIT;
  const cappedLimit = Math.min(DEFAULT_LIMIT, Math.max(0, Math.floor(normalizedLimit)));
  if (cappedLimit === 0) return [];

  const ordered = events
    .map((event) => materialize(event as EventWithLifecycle, companies, now))
    .filter((signal): signal is DecisionTopSignal => Boolean(signal))
    .sort(compareSignals);
  const selected: DecisionTopSignal[] = [];
  const eventIds = new Set<string>();
  const kindCounts = new Map<ArticleKind, number>();
  for (const signal of ordered) {
    if (eventIds.has(signal.eventId) || (kindCounts.get(signal.kind) ?? 0) >= KIND_LIMIT) continue;
    selected.push(signal);
    eventIds.add(signal.eventId);
    kindCounts.set(signal.kind, (kindCounts.get(signal.kind) ?? 0) + 1);
    if (selected.length === cappedLimit) break;
  }
  return selected;
}
