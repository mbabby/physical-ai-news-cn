import type { Article, CompanyDossier, CompanyProfile, EventRecord, EventStore, TechnicalRoute, ValidationStage } from "./types.js";
import { buildCompanyDossiers } from "./event-center.js";
import { eventMaterialChangeAt } from "./event-time.js";
import { hasChineseText, hasCompleteChineseResearchCopy, isPlaceholderCopy } from "./publication.js";

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
}
export interface ResearchIndustryLink {
  paper: DashboardItem;
  route: string;
  companies: string[];
  connection: string;
}
export interface DashboardData {
  generatedAt: string;
  periodLabel: string;
  stats: { events: number; companies: number; research: number; sources: number; };
  topSignals: DashboardSignal[];
  keyEvents: DashboardItem[];
  capital: DashboardItem[];
  industry: DashboardItem[];
  research: DashboardItem[];
  researchGraph: ResearchIndustryLink[];
  companyRadar: CompanyRadarItem[];
  routes: Array<{ name: string; focus: string; companies: string[]; }>;
}

export interface DashboardContext { activeSources?: number; periodLabel?: string; }

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
    && Boolean(publicEvidence(event))
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
  const grade = event.evidence.some((evidence) => evidence.grade === "A" && !DISCOVERY_SOURCE_PATTERN.test(evidence.source)) ? "A" : "B";
  return { ...item, entity: event.primaryEntity!, evidenceGrade: grade, whyItMatters: eventWhy(event), score: signalScore(event, now) };
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
  const companyRadar = buildCompanyDossiers(companies, store.events).map((dossier) => radarItem(dossier, store, generatedAt))
    .sort((a, b) => b.momentumScore - a.momentumScore
      || CAPITAL_ORDER[b.capitalStatus] - CAPITAL_ORDER[a.capitalStatus]
      || VALIDATION_ORDER[b.validationStage] - VALIDATION_ORDER[a.validationStage]
      || Number(Boolean(b.updatedAt)) - Number(Boolean(a.updatedAt))
      || a.name.localeCompare(b.name));
  const companyRank = new Map(companyRadar.map((company, index) => [company.name, index]));
  return {
    generatedAt: generatedAt.toISOString(),
    periodLabel: context.periodLabel ?? "近 30 天滚动窗口",
    stats: { events: events.length, companies: companies.length, research: publicResearch.length, sources: context.activeSources ?? 0 },
    topSignals: events.map((event) => signalItem(event, generatedAt)).sort((a, b) => b.score - a.score || b.date.localeCompare(a.date) || a.title.localeCompare(b.title)).slice(0, 10),
    keyEvents: items.slice(0, 3),
    capital: items.filter((item) => item.type === "投融资").slice(0, 4),
    industry: items.filter((item) => item.type !== "投融资").slice(0, 5),
    research: publicResearch.slice(0, 6).map(articleItem),
    researchGraph: publicResearch.slice(0, 6).map((article) => {
      const route = researchRoute(article);
      const linkedCompanies = companies.filter((company) => company.routes.includes(route))
        .sort((a, b) => (companyRank.get(a.name) ?? Number.MAX_SAFE_INTEGER) - (companyRank.get(b.name) ?? Number.MAX_SAFE_INTEGER))
        .slice(0, 4).map((company) => company.name);
      const connection = linkedCompanies.length
        ? `该研究对应「${route}」路线；当前可关联观察 ${linkedCompanies.join("、")} 的路线进展，产品与部署仍以独立事件证据为准。`
        : `该研究对应「${route}」路线；当前尚无可核验的公司关联，保留为研究侧信号。`;
      return { paper: articleItem(article), route, companies: linkedCompanies, connection };
    }),
    companyRadar,
    routes: routeNames.map((name) => ({ name, focus: routeFocus[name], companies: companies.filter((company) => company.routes.includes(name as CompanyProfile["routes"][number])).slice(0, 4).map((company) => company.name) })),
  };
}
