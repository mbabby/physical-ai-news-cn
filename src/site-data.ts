import type { Article, CompanyDossier, CompanyProfile, EventRecord, EventStore, TechnicalRoute, ValidationStage } from "./types.js";
import { buildCompanyDossiers } from "./event-center.js";
import { eventMaterialChangeAt } from "./event-time.js";
import { hasChineseText, hasCompleteChineseResearchCopy, isPlaceholderCopy } from "./publication.js";
import { isCandidateEligibleForPublicLayer } from "./candidate-verification.js";
import type { CandidateVerificationRecord } from "./candidate-verification.js";
import { derivePublication } from "./facts-contract.js";
import type { CompanyClaimLedger } from "./company-claim-ledger.js";
import type { ResearchDecisionCard } from "./research-decision-card.js";
import { researchIndustryCompanyId } from "./research-industry-relations.js";
import type { ResearchIndustryRelationEdge } from "./research-industry-relations.js";

export interface DashboardItem {
  title: string;
  summary: string;
  link: string;
  type: string;
  route: string;
  /** The event occurrence / announcement date, never the ingestion timestamp. */
  date: string;
  source: string;
  isThisWeek?: boolean;
  lastVerifiedAt?: string;
  lastMaterialChangeAt?: string;
}
export interface DashboardSignal extends DashboardItem {
  entity: string;
  evidenceGrade: "A" | "B" | "学术";
  verificationStatus: "官方确认" | "多方证实" | "正在发生";
  evidenceCount: number;
  missingEvidence?: string;
  verifiedAt?: string;
  whyItMatters: string;
  score: number;
}
export interface CompanyRadarItem {
  name: string;
  officialUrl: string;
  region: string;
  stage: string;
  routes: string[];
  thesis: string;
  capitalStatus: string;
  validationStage: ValidationStage;
  funding?: DashboardItem;
  progress?: DashboardItem;
  identitySource: string;
  updatedAt?: string;
  momentumScore: number;
  momentumLabel: "高动量" | "持续推进" | "长期跟踪";
  recentSignals: number;
  claimCompleteness?: number;
  staleClaims?: number;
}
export interface ResearchIndustryLink {
  paper: DashboardItem;
  route: string;
  companies: string[];
  connection: string;
  relations?: Array<{ company: string; type: string; state: "verified" | "developing"; evidenceLinks: string[]; }>;
}
export interface DashboardResearchItem extends DashboardItem { decisionCard?: ResearchDecisionCard; }
export interface DashboardData {
  generatedAt: string;
  periodLabel: string;
  stats: { events: number; companies: number; research: number; sources: number; };
  /** Confirmed by official evidence or at least two independent B-grade sources. */
  confirmedSignals: DashboardSignal[];
  /** Timely, single-source B-grade facts. These remain explicitly provisional. */
  developingSignals: DashboardSignal[];
  /** Backward-compatible alias for confirmedSignals. */
  topSignals: DashboardSignal[];
  keyEvents: DashboardItem[];
  capital: DashboardItem[];
  industry: DashboardItem[];
  research: DashboardResearchItem[];
  researchGraph: ResearchIndustryLink[];
  companyRadar: CompanyRadarItem[];
  routes: Array<{ name: string; focus: string; companies: string[]; }>;
}

export interface DashboardContext {
  activeSources?: number;
  periodLabel?: string;
  /** Internal verification records are filtered again before any public copy is emitted. */
  candidateVerificationRecords?: CandidateVerificationRecord[];
  companyClaimLedger?: CompanyClaimLedger;
  researchDecisionCards?: ResearchDecisionCard[];
  researchIndustryEdges?: ResearchIndustryRelationEdge[];
}

function eventFact(event: EventRecord): string {
  return [...event.timeline.map((item) => item.summary), ...event.facts].find((value) => hasChineseText(value) && !isPlaceholderCopy(value)) ?? "";
}
const DISCOVERY_SOURCE_PATTERN = /google news|hacker news|^x\s*·/i;
const DAY_MS = 86_400_000;

function publicEvidence(event: EventRecord) {
  return event.evidence
    .filter((item) => (item.grade === "A" || item.grade === "B") && !DISCOVERY_SOURCE_PATTERN.test(item.source))
    .sort((a, b) => (a.grade === "A" ? 0 : 1) - (b.grade === "A" ? 0 : 1))[0];
}

function publicEvidenceSet(event: EventRecord) {
  const seen = new Set<string>();
  return event.evidence.filter((item) => {
    if ((item.grade !== "A" && item.grade !== "B") || DISCOVERY_SOURCE_PATTERN.test(item.source)) return false;
    let identity = item.source.trim().toLowerCase();
    try { identity = new URL(item.link).hostname.replace(/^www\./, ""); } catch { /* source name remains the stable fallback */ }
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

const CONFLICT_PATTERN = /冲突|矛盾|主体待识别|主体不明|归属不明|金额待核验|轮次待核验/i;

function hasPublicationConflict(event: EventRecord): boolean {
  if (event.status === "待复核" || !event.primaryEntity) return true;
  if (event.type === "投融资" && event.funding?.entityStatus !== "已确认") return true;
  return event.openQuestions.some((question) => CONFLICT_PATTERN.test(question));
}

function verificationState(event: EventRecord): "官方确认" | "多方证实" | "正在发生" | undefined {
  if (hasPublicationConflict(event)) return undefined;
  const publication = derivePublication({ evidence: event.evidence.map((item) => ({
    id: item.link,
    link: item.link,
    source: item.source,
    grade: item.grade,
    discovery: DISCOVERY_SOURCE_PATTERN.test(item.source),
    independentOrigin: (() => { try { return new URL(item.link).hostname.replace(/^www\./, ""); } catch { return item.source; } })(),
  })) });
  if (publication.evidenceState === "confirmed") {
    return event.evidence.some((item) => item.grade === "A" && !DISCOVERY_SOURCE_PATTERN.test(item.source)) ? "官方确认" : "多方证实";
  }
  if (publication.evidenceState === "developing" || publication.evidenceState === "corroborated") return "正在发生";
  return undefined;
}

function validIsoDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

/**
 * Resolve when the fact happened, rather than when our pipeline happened to
 * ingest or re-check it. Historic records fall back to the earliest public
 * A/B evidence publication date, so another verification run cannot make an
 * old event look new.
 */
export function publicEventDate(event: EventRecord): string | undefined {
  const explicit = validIsoDate(event.occurredAt) ?? validIsoDate(event.eventDate);
  if (explicit) return explicit;
  return event.evidence
    .filter((item) => (item.grade === "A" || item.grade === "B") && !DISCOVERY_SOURCE_PATTERN.test(item.source))
    .map((item) => validIsoDate(item.publishedAt))
    .filter((item): item is string => Boolean(item))
    .sort()[0];
}

function ageInDays(value: string, now: Date): number | undefined {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return undefined;
  const age = (now.getTime() - timestamp) / DAY_MS;
  return age >= 0 ? age : undefined;
}

function isPublicEvent(event: EventRecord): boolean {
  return event.status !== "已归档"
    && hasChineseText(event.title)
    && Boolean(event.primaryEntity)
    && Boolean(verificationState(event))
    && Boolean(eventFact(event));
}

function eventItem(event: EventRecord, now?: Date): DashboardItem {
  const evidence = publicEvidence(event);
  const eventDate = publicEventDate(event);
  const materialDate = validIsoDate(eventMaterialChangeAt(event));
  return {
    title: event.title,
    summary: eventFact(event),
    link: evidence?.link ?? "#",
    type: event.type,
    route: event.routes[0] ?? "物理 AI",
    date: eventDate?.slice(0, 10) ?? "日期待核验",
    source: evidence?.source ?? "可追溯来源",
    isThisWeek: now && eventDate ? (ageInDays(eventDate, now) ?? Number.POSITIVE_INFINITY) <= 7 : undefined,
    lastVerifiedAt: validIsoDate(event.lastVerifiedAt),
    lastMaterialChangeAt: materialDate,
  };
}

const KIND_IMPACT: Record<string, number> = { "投融资": 30, "部署案例": 28, "产品发布": 26, "公司商业": 18, "开源项目": 15, "研究与数据": 10 };
const IMPACT_PATTERN = /融资|并购|估值|量产|订单|客户|部署|发布|开源|基准|真实机器人|million|billion|funding|valuation|deploy|customer|production/i;

function signalScore(event: EventRecord, now: Date): number {
  const evidence = event.evidence.filter((item) => (item.grade === "A" || item.grade === "B") && !DISCOVERY_SOURCE_PATTERN.test(item.source));
  const grade = evidence.some((item) => item.grade === "A") ? 20 : 12;
  const sources = new Set(evidence.map((item) => item.source)).size;
  const ageDays = ageInDays(publicEventDate(event) ?? "", now) ?? 30;
  const freshness = Math.max(0, 18 - ageDays * 0.6);
  const impact = IMPACT_PATTERN.test(`${event.title} ${eventFact(event)}`) ? 10 : 0;
  return Math.round((KIND_IMPACT[event.type] ?? 10) + grade + Math.min(12, sources * 4) + freshness + impact);
}

function eventWhy(event: EventRecord): string {
  const evidence = event.evidence.some((item) => item.grade === "A" && !DISCOVERY_SOURCE_PATTERN.test(item.source)) ? "一手证据" : "独立可信来源";
  const value = {
    "投融资": "资本正在为相关技术路线提供资源与估值信号",
    "部署案例": "技术已进入客户、试点或真实场景验证",
    "产品发布": "产品能力或工程边界出现可核验推进",
    "公司商业": "公司商业化、合作或组织进程发生变化",
    "开源项目": "开发者获得了可复用的模型、代码或工具",
    "研究与数据": "研究结果可能改变模型、数据或评测路径",
  }[event.type];
  return `${value}；当前由${evidence}支持。`;
}

function signalItem(event: EventRecord, now: Date): DashboardSignal {
  const item = eventItem(event, now);
  const evidence = publicEvidenceSet(event);
  const grade = evidence.some((item) => item.grade === "A") ? "A" : "B";
  const verificationStatus = verificationState(event)!;
  const missingEvidence = verificationStatus === "正在发生"
    ? event.openQuestions.find((question) => !CONFLICT_PATTERN.test(question)) ?? "缺少官方公告或第二个独立可信来源"
    : undefined;
  return {
    ...item,
    entity: event.primaryEntity!,
    evidenceGrade: grade,
    verificationStatus,
    evidenceCount: evidence.length,
    missingEvidence,
    verifiedAt: validIsoDate(event.lastVerifiedAt) ?? validIsoDate(event.lastEvidenceAt),
    whyItMatters: eventWhy(event),
    score: signalScore(event, now),
  };
}

const GENERIC_COMPANY = /^(?:待识别公司|行业公司|机器人公司|具身智能公司|人形机器人公司|公司)$/i;

function candidateSignal(record: CandidateVerificationRecord, now: Date): DashboardSignal | undefined {
  if (!isCandidateEligibleForPublicLayer(record)) return undefined;
  if (!record.companyName || GENERIC_COMPANY.test(record.companyName) || !hasChineseText(record.title)) return undefined;
  const evidence = record.evidence.filter((item) => (item.grade === "A" || item.grade === "B") && item.sourceClass !== "discovery");
  if (!evidence.length) return undefined;
  const strongest = [...evidence].sort((a, b) => b.score - a.score || b.publishedAt.localeCompare(a.publishedAt))[0];
  const newest = [...evidence].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))[0];
  const eventDate = record.facts.eventDate ?? newest.publishedAt.slice(0, 10);
  const age = ageInDays(eventDate, now);
  const verificationStatus = record.publicStatus === "confirmed" ? "官方确认"
    : record.publicStatus === "corroborated" ? "多方证实" : "正在发生";
  if (age === undefined || age > (verificationStatus === "正在发生" ? 7 : 30)) return undefined;
  const factParts = record.kind === "投融资"
    ? [record.facts.amount, record.facts.round].filter(Boolean)
    : [];
  const evidenceCopy = verificationStatus === "官方确认" ? "已有一手来源确认"
    : verificationStatus === "多方证实" ? "已有多个独立可信来源相互印证"
      : "已有单一可信媒体报道，尚待官方或第二来源确认";
  const summary = record.kind === "投融资"
    ? `${record.companyName} 的融资进展${evidenceCopy}${factParts.length ? `；已核验字段：${factParts.join("、")}` : ""}。`
    : `${record.companyName} 的${record.kind === "产品发布" ? "产品发布" : "部署进展"}${evidenceCopy}。`;
  const typeImpact = KIND_IMPACT[record.kind] ?? 15;
  return {
    title: record.title,
    summary,
    link: strongest.link,
    type: record.kind,
    route: "物理 AI",
    date: eventDate,
    source: strongest.source,
    isThisWeek: age <= 7,
    verifiedAt: record.lastAttemptAt,
    entity: record.companyName,
    evidenceGrade: evidence.some((item) => item.grade === "A") ? "A" : "B",
    verificationStatus,
    evidenceCount: new Set(evidence.map((item) => item.independentOrigin || item.source)).size,
    missingEvidence: verificationStatus === "正在发生"
      ? record.failureReasons.find((reason) => !CONFLICT_PATTERN.test(reason)) ?? "缺少官方公告或第二个独立可信来源"
      : undefined,
    whyItMatters: record.kind === "投融资" ? "资本线索可能改变公司资源与交付节奏。" : "产品或部署线索可能反映工程化进展。",
    score: Math.round(typeImpact + Math.min(30, record.confidenceScore) + Math.max(0, 12 - age)),
  };
}
function articleItem(article: Article): DashboardItem {
  return { title: article.titleZh!, summary: article.summaryZh!, link: article.link, type: "研究论文", route: article.tags[0] ?? "具身智能", date: article.publishedAt.toISOString().slice(0, 10), source: article.source };
}
function recent(events: EventRecord[], now: Date, windowDays = 30): EventRecord[] {
  return [...events]
    .filter((event) => isPublicEvent(event) && (ageInDays(publicEventDate(event) ?? "", now) ?? Number.POSITIVE_INFINITY) <= windowDays)
    .sort((a, b) => (publicEventDate(b) ?? "").localeCompare(publicEventDate(a) ?? "") || a.id.localeCompare(b.id));
}

const CAPITAL_ORDER: Record<string, number> = { "已证实": 3, "有资本信号": 2, "证据不足": 1 };
const VALIDATION_ORDER: Record<ValidationStage, number> = { "规模部署 / 商业化": 6, "客户试点": 5, "实机验证": 4, "原型与演示": 3, "概念 / 研究": 2, "证据不足": 1 };

function radarItem(dossier: CompanyDossier, store: EventStore, now: Date): CompanyRadarItem {
  const byId = new Map(store.events.map((event) => [event.id, event]));
  const fundingEvent = dossier.funding[0] && byId.get(dossier.funding[0].eventId);
  const progressEvent = dossier.productsAndDeployments[0] && byId.get(dossier.productsAndDeployments[0].eventId);
  const funding = fundingEvent && isPublicEvent(fundingEvent) ? fundingEvent : undefined;
  const progress = progressEvent && isPublicEvent(progressEvent) ? progressEvent : undefined;
  const companyEvents = dossier.eventIds.flatMap((id) => byId.get(id) ? [byId.get(id)!] : []);
  const recentSignals = companyEvents.filter((event) => isPublicEvent(event) && (ageInDays(publicEventDate(event) ?? "", now) ?? Number.POSITIVE_INFINITY) <= 30).length;
  const momentumScore = Math.min(100, recentSignals * 12 + CAPITAL_ORDER[dossier.capitalStatus] * 8 + VALIDATION_ORDER[dossier.validationStage] * 7);
  return {
    name: dossier.company.name,
    officialUrl: dossier.company.officialUrl,
    region: dossier.company.region,
    stage: dossier.company.stage ?? "公司",
    routes: dossier.company.routes,
    thesis: dossier.company.thesis,
    capitalStatus: dossier.capitalStatus,
    validationStage: dossier.validationStage,
    funding: funding ? eventItem(funding, now) : undefined,
    progress: progress ? eventItem(progress, now) : undefined,
    identitySource: dossier.identityEvidence[0]?.source ?? "公司官网",
    updatedAt: dossier.updatedAt || undefined,
    momentumScore,
    momentumLabel: momentumScore >= 70 ? "高动量" : momentumScore >= 42 ? "持续推进" : "长期跟踪",
    recentSignals,
  };
}

function researchRoute(article: Article): TechnicalRoute {
  const text = `${article.title} ${article.titleZh} ${article.summaryZh} ${article.tags.join(" ")}`.toLowerCase();
  if (/world model|世界模型|spatial|空间/.test(text)) return "世界模型与空间智能";
  if (/vla|vision.language.action|具身模型|策略/.test(text)) return "VLA 与具身模型";
  if (/dataset|数据集|training|训练|demonstration/.test(text)) return "数据与训练";
  if (/hardware|humanoid|人形|本体|dexterous|灵巧/.test(text)) return "本体与硬件";
  return "部署与商业化";
}

export function buildDashboard(store: EventStore, companies: CompanyProfile[], research: Article[], generatedAt = new Date(), context: DashboardContext = {}): DashboardData {
  const events = recent(store.events, generatedAt); const items = events.map((event) => eventItem(event, generatedAt)); const publicResearch = research.filter(hasCompleteChineseResearchCopy);
  const routeFocus: Record<string, string> = {
    "数据与训练": "真实数据与训练效率", "VLA 与具身模型": "泛化与长程任务", "世界模型与空间智能": "可预测的物理环境", "本体与硬件": "可靠性、灵巧性与成本", "部署与商业化": "可验证 ROI 与规模化",
  };
  const routeNames = Object.keys(routeFocus);
  const ledgerByName = new Map((context.companyClaimLedger?.companies ?? []).map((entry) => [entry.companyName, entry]));
  const selectedCompanies = context.companyClaimLedger
    ? companies.filter((company) => ledgerByName.has(company.name))
    : companies;
  const companyRadar = buildCompanyDossiers(selectedCompanies, store.events).map((dossier) => {
    const item = radarItem(dossier, store, generatedAt);
    const ledger = ledgerByName.get(dossier.company.name);
    return ledger ? { ...item, claimCompleteness: ledger.metrics.fieldCompletenessRate, staleClaims: ledger.metrics.staleClaimCount } : item;
  })
    .sort((a, b) => b.momentumScore - a.momentumScore
      || CAPITAL_ORDER[b.capitalStatus] - CAPITAL_ORDER[a.capitalStatus]
      || VALIDATION_ORDER[b.validationStage] - VALIDATION_ORDER[a.validationStage]
      || Number(Boolean(b.updatedAt)) - Number(Boolean(a.updatedAt))
      || a.name.localeCompare(b.name));
  const companyRank = new Map(companyRadar.map((company, index) => [company.name, index]));
  const rankedSignals = events.map((event) => signalItem(event, generatedAt))
    .sort((a, b) => b.score - a.score || b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
  const confirmedSignals = rankedSignals.filter((item) => item.verificationStatus !== "正在发生").slice(0, 10);
  const candidateSignals = (context.candidateVerificationRecords ?? []).flatMap((record) => {
    const item = candidateSignal(record, generatedAt); return item ? [item] : [];
  });
  const confirmedCandidateSignals = candidateSignals.filter((item) => item.verificationStatus !== "正在发生");
  const developingSignals = [...rankedSignals.filter((item) => item.verificationStatus === "正在发生" && item.isThisWeek), ...candidateSignals.filter((item) => item.verificationStatus === "正在发生")]
    .filter((item, index, all) => all.findIndex((candidate) => candidate.link === item.link || (candidate.entity === item.entity && candidate.type === item.type && candidate.title === item.title)) === index)
    .sort((a, b) => b.score - a.score || b.date.localeCompare(a.date)).slice(0, 5);
  const confirmedItems = events.filter((event) => verificationState(event) !== "正在发生").map((event) => eventItem(event, generatedAt));
  return {
    generatedAt: generatedAt.toISOString(),
    periodLabel: context.periodLabel ?? "近 30 天滚动窗口",
    stats: { events: events.length, companies: companies.length, research: publicResearch.length, sources: context.activeSources ?? 0 },
    confirmedSignals: [...confirmedSignals, ...confirmedCandidateSignals]
      .filter((item, index, all) => all.findIndex((candidate) => candidate.link === item.link || (candidate.entity === item.entity && candidate.type === item.type && candidate.title === item.title)) === index)
      .sort((a, b) => b.score - a.score || b.date.localeCompare(a.date)).slice(0, 10),
    developingSignals,
    topSignals: [...confirmedSignals, ...confirmedCandidateSignals]
      .filter((item, index, all) => all.findIndex((candidate) => candidate.link === item.link || (candidate.entity === item.entity && candidate.type === item.type && candidate.title === item.title)) === index)
      .sort((a, b) => b.score - a.score || b.date.localeCompare(a.date)).slice(0, 10),
    keyEvents: confirmedItems.slice(0, 3),
    capital: confirmedItems.filter((item) => item.type === "投融资").slice(0, 4),
    industry: confirmedItems.filter((item) => item.type !== "投融资").slice(0, 5),
    research: publicResearch.slice(0, 6).map((article) => ({
      ...articleItem(article),
      decisionCard: (context.researchDecisionCards ?? []).find((card) => card.identity.paperId.value === article.id),
    })),
    researchGraph: publicResearch.slice(0, 6).map((article) => {
      const route = researchRoute(article);
      const relations = (context.researchIndustryEdges ?? [])
        .filter((edge) => edge.paperId === article.id && edge.relationType !== "route_adjacency" && (edge.relationState === "verified" || edge.relationState === "developing"))
        .flatMap((edge) => {
          const company = companies.find((item) => researchIndustryCompanyId(item) === edge.companyId);
          return company ? [{ company: company.name, type: edge.relationType, state: edge.relationState as "verified" | "developing", evidenceLinks: edge.evidenceUrls }] : [];
        });
      const verifiedCompanies = [...new Set(relations.filter((relation) => relation.state === "verified").map((relation) => relation.company))]
        .sort((a, b) => (companyRank.get(a) ?? Number.MAX_SAFE_INTEGER) - (companyRank.get(b) ?? Number.MAX_SAFE_INTEGER));
      const developingCount = relations.filter((relation) => relation.state === "developing").length;
      const connection = verifiedCompanies.length
        ? `已核验 ${verifiedCompanies.length} 条公司关系；每条关系均附显式采用、合作、机构或复现证据。`
        : developingCount
          ? `存在 ${developingCount} 条待补证关系；当前没有可确认为采用或合作的公司关联。`
          : `当前暂无已证实产业关联；同属技术路线不视为公司采用或背书。`;
      return { paper: articleItem(article), route, companies: verifiedCompanies, connection, relations };
    }),
    companyRadar,
    routes: routeNames.map((name) => ({ name, focus: routeFocus[name], companies: companies.filter((company) => company.routes.includes(name as CompanyProfile["routes"][number])).slice(0, 4).map((company) => company.name) })),
  };
}
