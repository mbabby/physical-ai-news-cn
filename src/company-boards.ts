import { createHash } from "node:crypto";
import { derivePublication } from "./facts-contract.js";
import type { EvidenceState } from "./facts-contract.js";
import type { CompanyClaim, CompanyClaimLedger } from "./company-claim-ledger.js";
import type { CompanyProfile, EventEvidence, EventRecord, TechnicalRoute } from "./types.js";

const DAY_MS = 86_400_000;
const DEFAULT_LIMIT = 5;
const DEFAULT_MINIMUM_SAMPLE = 3;
const MOMENTUM_WINDOW_DAYS = 30;
const FUNDING_TTL_DAYS = 180;
const TERMINAL_STATES = new Set<EvidenceState>(["rejected", "conflicted", "withdrawn"]);
const CONFLICT_PATTERN = /冲突|矛盾|主体待识别|主体不明|归属不明|金额待核验|轮次待核验|撤回|撤销|withdrawn|conflict/i;
const DISCOVERY_PATTERN = /google news|hacker news|news\.google\.com|^x\s*[··]|twitter/i;

export type CompanyBoardKind = "momentum" | "strategic";
export type CompanyBoardMode = "ranked" | "watchlist";
export type BoardEvidenceState = "confirmed" | "corroborated" | "evidence_insufficient";

export interface CompanyBoardScoreComponent {
  key: string;
  label: string;
  points: number;
  maxPoints: number;
  basis: string;
  evidenceDates: string[];
  unknown: boolean;
}

export interface CompanyBoardEventReference {
  eventId: string;
  title: string;
  eventDate: string;
  evidenceState: "confirmed" | "corroborated";
  evidenceGrade: "A" | "B+B";
  evidenceCount: number;
  evidenceUrls: string[];
}

export interface CompanyBoardCapitalEvidence {
  state: "verified" | "evidence_insufficient";
  value: string | "unknown";
  eventDate: string | "unknown";
  evidenceDates: string[];
  note: string;
}

export interface CompanyBoardEntry {
  /** Null is mandatory in watchlist mode: an observation list is not a ranking. */
  rank: number | null;
  companyId: string;
  companyName: string;
  officialUrl: string;
  routes: TechnicalRoute[];
  score: number;
  scoreBreakdown: CompanyBoardScoreComponent[];
  evidenceDates: string[];
  unknowns: string[];
  capital: CompanyBoardCapitalEvidence;
  qualifyingEvents: CompanyBoardEventReference[];
}

export interface CompanyBoard {
  kind: CompanyBoardKind;
  title: string;
  mode: CompanyBoardMode;
  sampleSize: number;
  minimumSampleSize: number;
  reason: string;
  entries: CompanyBoardEntry[];
}

export interface CompanyBoards {
  generatedAt: string;
  policy: {
    limit: number;
    minimumSampleSize: number;
    momentumWindowDays: number;
    momentumProof: string;
    strategicProof: string;
  };
  momentum: CompanyBoard;
  strategic: CompanyBoard;
}

export interface CompanyBoardOptions {
  now?: Date;
  limit?: number;
  minimumSampleSize?: number;
  claimLedger?: CompanyClaimLedger;
}

type EventWithLifecycle = EventRecord & { evidenceState?: EvidenceState };
type EvidenceWithLifecycle = EventEvidence & { withdrawn?: boolean };

function stableCompanyId(company: CompanyProfile): string {
  return company.entityId ?? `company-${createHash("sha256").update(`${company.name}\n${company.officialUrl}`).digest("hex").slice(0, 12)}`;
}

function validDate(value: string | undefined): string | undefined {
  if (!value || !Number.isFinite(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

function eventDate(event: EventRecord): string | undefined {
  const explicit = validDate(event.occurredAt) ?? validDate(event.eventDate);
  if (explicit) return explicit;
  return event.evidence.map((item) => validDate(item.publishedAt)).filter((item): item is string => Boolean(item)).sort()[0];
}

function daysOld(value: string, now: Date): number | undefined {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  const age = (now.getTime() - timestamp) / DAY_MS;
  return age >= 0 ? age : undefined;
}

function evidenceOrigin(evidence: EventEvidence): string {
  try { return new URL(evidence.link).hostname.replace(/^www\./, "").toLowerCase(); }
  catch { return evidence.source.trim().toLowerCase(); }
}

function qualifyingEvidence(event: EventRecord): EventEvidence[] {
  return event.evidence.filter((item) => (item.grade === "A" || item.grade === "B")
    && !(item as EvidenceWithLifecycle).withdrawn
    && !DISCOVERY_PATTERN.test(`${item.source} ${item.link}`));
}

function proofGrade(event: EventRecord): "A" | "B+B" | undefined {
  const evidence = qualifyingEvidence(event);
  if (evidence.some((item) => item.grade === "A")) return "A";
  return new Set(evidence.filter((item) => item.grade === "B").map(evidenceOrigin)).size >= 2 ? "B+B" : undefined;
}

function lifecycleState(event: EventWithLifecycle): "confirmed" | "corroborated" | undefined {
  if (event.status === "已归档" || event.status === "待复核" || event.openQuestions.some((item) => CONFLICT_PATTERN.test(item))) return undefined;
  if (event.type === "投融资" && event.funding?.entityStatus !== "已确认") return undefined;
  if (event.evidenceState && TERMINAL_STATES.has(event.evidenceState)) return undefined;
  const publication = derivePublication({ evidence: event.evidence, evidenceState: event.evidenceState });
  if (TERMINAL_STATES.has(publication.evidenceState)) return undefined;
  if (!proofGrade(event)) return undefined;
  if (event.evidenceState === "confirmed" || event.evidenceState === "corroborated") return event.evidenceState;
  if (event.status === "已确证") return "confirmed";
  if (event.status === "持续跟踪") return "corroborated";
  return undefined;
}

function recentQualifiedEvent(event: EventRecord, now: Date): CompanyBoardEventReference | undefined {
  const occurred = eventDate(event);
  const age = occurred ? daysOld(occurred, now) : undefined;
  const state = lifecycleState(event as EventWithLifecycle);
  const grade = proofGrade(event);
  if (!occurred || age === undefined || age > MOMENTUM_WINDOW_DAYS || !state || !grade || !event.primaryEntity) return undefined;
  const evidence = qualifyingEvidence(event).sort((a, b) => a.link.localeCompare(b.link));
  return {
    eventId: event.id,
    title: event.title,
    eventDate: occurred.slice(0, 10),
    evidenceState: state,
    evidenceGrade: grade,
    evidenceCount: grade === "A" ? evidence.length : new Set(evidence.filter((item) => item.grade === "B").map(evidenceOrigin)).size,
    evidenceUrls: evidence.map((item) => item.link),
  };
}

function latestFreshFundingClaim(companyName: string, events: EventRecord[], ledger: CompanyClaimLedger | undefined): CompanyClaim | undefined {
  return ledger?.companies.find((item) => item.companyName === companyName)?.claims
    .filter((claim) => claim.claimType === "funding" && claim.evidenceState === "verified" && claim.freshness.state === "fresh")
    .filter((claim) => {
      const eventId = claim.evidenceIds[0]?.replace(/:evidence:\d+$/, "");
      const event = events.find((item) => item.id === eventId || (item.primaryEntity === companyName && item.title === claim.statement));
      return Boolean(event && lifecycleState(event as EventWithLifecycle) && proofGrade(event));
    })
    .sort((a, b) => b.eventDate.localeCompare(a.eventDate))[0];
}

function fallbackFunding(companyName: string, events: EventRecord[], now: Date): CompanyBoardCapitalEvidence {
  const funding = events.filter((event) => event.primaryEntity === companyName && event.type === "投融资" && lifecycleState(event as EventWithLifecycle) && proofGrade(event))
    .filter((event) => {
      const verified = validDate(event.lastVerifiedAt ?? event.lastEvidenceAt);
      return verified && (daysOld(verified, now) ?? Number.POSITIVE_INFINITY) <= FUNDING_TTL_DAYS;
    })
    .sort((a, b) => (eventDate(b) ?? "").localeCompare(eventDate(a) ?? ""))[0];
  if (!funding) return insufficientCapital();
  const values = [funding.funding?.round, funding.funding?.amount, funding.funding?.valuation].filter((value): value is string => Boolean(value));
  return {
    state: "verified",
    value: values.length ? values.join(" · ") : "unknown",
    eventDate: eventDate(funding)?.slice(0, 10) ?? "unknown",
    evidenceDates: qualifyingEvidence(funding).map((item) => validDate(item.publishedAt)?.slice(0, 10)).filter((item): item is string => Boolean(item)).sort(),
    note: values.length ? "融资字段来自仍在有效期内的公开证据。" : "融资事件已核验，但轮次、金额或估值未披露。",
  };
}

function insufficientCapital(): CompanyBoardCapitalEvidence {
  return { state: "evidence_insufficient", value: "unknown", eventDate: "unknown", evidenceDates: [], note: "当前有效证据不足；不代表该公司未融资。" };
}

function capitalEvidence(companyName: string, events: EventRecord[], now: Date, ledger?: CompanyClaimLedger): CompanyBoardCapitalEvidence {
  const claim = latestFreshFundingClaim(companyName, events, ledger);
  if (!claim) return ledger ? insufficientCapital() : fallbackFunding(companyName, events, now);
  return {
    state: "verified", value: claim.value, eventDate: claim.eventDate,
    evidenceDates: claim.verifiedAt === "unknown" ? [] : [claim.verifiedAt.slice(0, 10)],
    note: claim.value === "unknown" ? "融资事件已核验，但轮次、金额或估值仍为未知。" : "融资字段来自仍在有效期内的公开证据。",
  };
}

function momentumBreakdown(events: CompanyBoardEventReference[], now: Date): CompanyBoardScoreComponent[] {
  const impactValues = events.map((item) => {
    const matched = item.title;
    if (/融资|并购|部署|量产|订单|客户|commercial|deploy|funding|production/i.test(matched)) return 25;
    if (/发布|开源|release|launch/i.test(matched)) return 20;
    return 15;
  });
  const impact = Math.min(35, (Math.max(0, ...impactValues)) + Math.min(10, Math.max(0, events.length - 1) * 5));
  const newest = events.map((item) => item.eventDate).sort().at(-1)!;
  const newestAge = daysOld(newest, now) ?? MOMENTUM_WINDOW_DAYS;
  const recency = Math.round(Math.max(0, 30 * (1 - newestAge / MOMENTUM_WINDOW_DAYS)));
  const evidence = Math.min(25, Math.max(0, ...events.map((item) => item.evidenceGrade === "A" ? 22 : 18)) + Math.min(3, Math.max(0, events.length - 1)));
  const distinctKinds = new Set(events.map((item) => {
    const title = item.title.toLowerCase();
    if (/融资|funding|并购/.test(title)) return "capital";
    if (/部署|客户|deploy|订单/.test(title)) return "deployment";
    if (/发布|release|launch/.test(title)) return "product";
    return "other";
  })).size;
  const breadth = Math.min(10, distinctKinds * 4);
  const evidenceDates = [...new Set(events.map((item) => item.eventDate))].sort();
  return [
    { key: "material-events", label: "重大进展", points: impact, maxPoints: 35, basis: `${events.length} 个合格事件；按事件影响取最高值并计有限多事件加分`, evidenceDates, unknown: false },
    { key: "recency", label: "事件新近度", points: recency, maxPoints: 30, basis: `最新真实事件日期 ${newest}`, evidenceDates: [newest], unknown: false },
    { key: "proof", label: "证据强度", points: evidence, maxPoints: 25, basis: "仅 A 级一手证据或两个独立 B 级来源计分", evidenceDates, unknown: false },
    { key: "event-breadth", label: "进展类型覆盖", points: breadth, maxPoints: 10, basis: `${distinctKinds} 类公开进展`, evidenceDates, unknown: false },
  ];
}

function strategicBreakdown(company: CompanyProfile): CompanyBoardScoreComponent[] {
  const importanceByStage: Record<string, number> = { "平台公司": 40, "成长公司": 30, "创业公司": 22 };
  const importance = importanceByStage[company.stage ?? ""] ?? 12;
  const routePoints = Math.min(30, new Set(company.routes).size * 10);
  const fields = [company.entityId, company.entityType, company.name, company.region, company.stage, company.thesis, company.officialUrl, company.routes.length ? company.routes : undefined, company.sourceIds?.length ? company.sourceIds : undefined, company.profileEvidence?.length ? company.profileEvidence : undefined];
  const knownFields = fields.filter(Boolean).length;
  const completeness = Math.round(30 * knownFields / fields.length);
  const checked = [...(company.profileEvidence ?? []).map((item) => validDate(item.checkedAt)?.slice(0, 10)).filter((item): item is string => Boolean(item)), ...(validDate(company.lastVerifiedAt) ? [validDate(company.lastVerifiedAt)!.slice(0, 10)] : [])].sort();
  return [
    { key: "controlled-importance", label: "受控公司重要性", points: importance, maxPoints: 40, basis: `仅按受控公司阶段字段：${company.stage ?? "阶段未知"}`, evidenceDates: checked, unknown: !company.stage },
    { key: "route-coverage", label: "路线覆盖", points: routePoints, maxPoints: 30, basis: `${new Set(company.routes).size} 条受控技术路线`, evidenceDates: checked, unknown: company.routes.length === 0 },
    { key: "dossier-completeness", label: "档案完整度", points: completeness, maxPoints: 30, basis: `${knownFields}/${fields.length} 个受控档案字段已填充`, evidenceDates: checked, unknown: knownFields < fields.length },
  ];
}

function finalizeBoard(kind: CompanyBoardKind, entries: CompanyBoardEntry[], limit: number, minimumSampleSize: number): CompanyBoard {
  const mode: CompanyBoardMode = entries.length >= minimumSampleSize ? "ranked" : "watchlist";
  const ordered = mode === "ranked"
    ? [...entries].sort((a, b) => b.score - a.score || (b.evidenceDates.at(-1) ?? "").localeCompare(a.evidenceDates.at(-1) ?? "") || a.companyId.localeCompare(b.companyId))
    : [...entries].sort((a, b) => a.companyId.localeCompare(b.companyId));
  const visible = ordered.slice(0, limit).map((entry, index) => ({ ...entry, rank: mode === "ranked" ? index + 1 : null }));
  return {
    kind,
    title: kind === "momentum" ? "公司近期动量榜" : "公司战略观察榜",
    mode,
    sampleSize: entries.length,
    minimumSampleSize,
    reason: mode === "ranked" ? `共 ${entries.length} 家达到样本门槛，展示 Top ${Math.min(limit, entries.length)}。` : `仅 ${entries.length} 家达到门槛，少于 ${minimumSampleSize} 家；取消名次并降级为无序观察清单。`,
    entries: visible,
  };
}

/**
 * Build two deliberately independent company views. Momentum consumes only
 * recent verified events. Strategic observation consumes only controlled
 * profile fields; it cannot inherit momentum points or funding assumptions.
 */
export function buildCompanyBoards(companies: CompanyProfile[], events: EventRecord[], options: CompanyBoardOptions = {}): CompanyBoards {
  const now = options.now ?? new Date();
  const limit = Math.max(0, Math.floor(options.limit ?? DEFAULT_LIMIT));
  const minimumSampleSize = Math.max(1, Math.floor(options.minimumSampleSize ?? DEFAULT_MINIMUM_SAMPLE));
  const controlledCompanies = companies.filter((company) => company.entityType === undefined || company.entityType === "公司");
  const companyByName = new Map(controlledCompanies.map((company) => [company.name, company]));
  const grouped = new Map<string, CompanyBoardEventReference[]>();
  for (const event of events) {
    const reference = recentQualifiedEvent(event, now);
    if (!reference || !event.primaryEntity || !companyByName.has(event.primaryEntity)) continue;
    grouped.set(event.primaryEntity, [...(grouped.get(event.primaryEntity) ?? []), reference]);
  }
  const momentumEntries = [...grouped.entries()].map(([name, references]) => {
    const company = companyByName.get(name)!;
    const qualifyingEvents = [...references].sort((a, b) => b.eventDate.localeCompare(a.eventDate) || a.eventId.localeCompare(b.eventId));
    const scoreBreakdown = momentumBreakdown(qualifyingEvents, now);
    const evidenceDates = [...new Set(qualifyingEvents.map((item) => item.eventDate))].sort();
    return {
      rank: null, companyId: stableCompanyId(company), companyName: company.name, officialUrl: company.officialUrl,
      routes: [...new Set(company.routes)].sort(), score: scoreBreakdown.reduce((total, item) => total + item.points, 0), scoreBreakdown, evidenceDates,
      unknowns: [], capital: capitalEvidence(company.name, events, now, options.claimLedger), qualifyingEvents,
    } satisfies CompanyBoardEntry;
  });
  const strategicEntries = controlledCompanies.map((company) => {
    const scoreBreakdown = strategicBreakdown(company);
    const evidenceDates = [...new Set(scoreBreakdown.flatMap((item) => item.evidenceDates))].sort();
    const unknowns = scoreBreakdown.filter((item) => item.unknown).map((item) => item.label);
    const capital = capitalEvidence(company.name, events, now, options.claimLedger);
    if (capital.state === "evidence_insufficient") unknowns.push("融资证据");
    return {
      rank: null, companyId: stableCompanyId(company), companyName: company.name, officialUrl: company.officialUrl,
      routes: [...new Set(company.routes)].sort(), score: scoreBreakdown.reduce((total, item) => total + item.points, 0), scoreBreakdown, evidenceDates,
      unknowns, capital, qualifyingEvents: [],
    } satisfies CompanyBoardEntry;
  });
  return {
    generatedAt: now.toISOString(),
    policy: {
      limit, minimumSampleSize, momentumWindowDays: MOMENTUM_WINDOW_DAYS,
      momentumProof: "真实 eventDate 在近 30 天；生命周期为 confirmed/corroborated；且存在 A 级证据或两个独立 B 级来源。",
      strategicProof: "仅按受控公司重要性、技术路线覆盖和档案完整度评分；不读取近期事件分。",
    },
    momentum: finalizeBoard("momentum", momentumEntries, limit, minimumSampleSize),
    strategic: finalizeBoard("strategic", strategicEntries, limit, minimumSampleSize),
  };
}
