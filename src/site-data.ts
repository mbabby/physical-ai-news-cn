import type { Article, CompanyDossier, CompanyProfile, EventRecord, EventStore, ValidationStage } from "./types.js";
import { buildCompanyDossiers } from "./event-center.js";
import { hasChineseText, hasCompleteChineseCopy, isPlaceholderCopy } from "./publication.js";

export interface DashboardItem { title: string; summary: string; link: string; type: string; route: string; date: string; source: string; }
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
}
export interface DashboardData { generatedAt: string; stats: { events: number; companies: number; research: number; }; keyEvents: DashboardItem[]; capital: DashboardItem[]; industry: DashboardItem[]; research: DashboardItem[]; companyRadar: CompanyRadarItem[]; routes: Array<{ name: string; focus: string; companies: string[]; }>; }

function eventFact(event: EventRecord): string {
  return [...event.timeline.map((item) => item.summary), ...event.facts].find((value) => hasChineseText(value) && !isPlaceholderCopy(value)) ?? "";
}
function eventItem(event: EventRecord): DashboardItem {
  const evidence = event.evidence.find((item) => (item.grade === "A" || item.grade === "B") && !/google news|hacker news|^x\s*·/i.test(item.source));
  return { title: event.title, summary: eventFact(event), link: evidence?.link ?? "#", type: event.type, route: event.routes[0] ?? "物理 AI", date: event.lastUpdatedAt.slice(0, 10), source: evidence?.source ?? "可追溯来源" };
}
function articleItem(article: Article): DashboardItem {
  return { title: article.titleZh!, summary: article.summaryZh!, link: article.link, type: "研究论文", route: article.tags[0] ?? "具身智能", date: article.publishedAt.toISOString().slice(0, 10), source: article.source };
}
function recent(events: EventRecord[]): EventRecord[] {
  return [...events].filter((event) => event.status !== "已归档" && hasChineseText(event.title) && Boolean(event.primaryEntity) && event.evidence.some((item) => (item.grade === "A" || item.grade === "B") && !/google news|hacker news|^x\s*·/i.test(item.source)) && Boolean(eventFact(event))).sort((a, b) => b.lastUpdatedAt.localeCompare(a.lastUpdatedAt));
}

const CAPITAL_ORDER: Record<string, number> = { "已证实": 3, "有资本信号": 2, "证据不足": 1 };
const VALIDATION_ORDER: Record<ValidationStage, number> = { "规模部署 / 商业化": 6, "客户试点": 5, "实机验证": 4, "原型与演示": 3, "概念 / 研究": 2, "证据不足": 1 };

function radarItem(dossier: CompanyDossier, store: EventStore): CompanyRadarItem {
  const byId = new Map(store.events.map((event) => [event.id, event]));
  const funding = dossier.funding[0] && byId.get(dossier.funding[0].eventId);
  const progress = dossier.productsAndDeployments[0] && byId.get(dossier.productsAndDeployments[0].eventId);
  return {
    name: dossier.company.name,
    officialUrl: dossier.company.officialUrl,
    region: dossier.company.region,
    stage: dossier.company.stage ?? "公司",
    routes: dossier.company.routes,
    thesis: dossier.company.thesis,
    capitalStatus: dossier.capitalStatus,
    validationStage: dossier.validationStage,
    funding: funding ? eventItem(funding) : undefined,
    progress: progress ? eventItem(progress) : undefined,
    identitySource: dossier.identityEvidence[0]?.source ?? "公司官网",
    updatedAt: dossier.updatedAt || undefined,
  };
}

export function buildDashboard(store: EventStore, companies: CompanyProfile[], research: Article[], generatedAt = new Date()): DashboardData {
  const events = recent(store.events); const items = events.map(eventItem); const publicResearch = research.filter(hasCompleteChineseCopy);
  const routeFocus: Record<string, string> = {
    "数据与训练": "真实数据与训练效率", "VLA 与具身模型": "泛化与长程任务", "世界模型与空间智能": "可预测的物理环境", "本体与硬件": "可靠性、灵巧性与成本", "部署与商业化": "可验证 ROI 与规模化",
  };
  const routeNames = Object.keys(routeFocus);
  const companyRadar = buildCompanyDossiers(companies, store.events).map((dossier) => radarItem(dossier, store))
    .sort((a, b) => CAPITAL_ORDER[b.capitalStatus] - CAPITAL_ORDER[a.capitalStatus]
      || VALIDATION_ORDER[b.validationStage] - VALIDATION_ORDER[a.validationStage]
      || Number(Boolean(b.updatedAt)) - Number(Boolean(a.updatedAt))
      || a.name.localeCompare(b.name));
  return {
    generatedAt: generatedAt.toISOString(),
    stats: { events: events.length, companies: companies.length, research: publicResearch.length },
    keyEvents: items.slice(0, 3),
    capital: items.filter((item) => item.type === "投融资").slice(0, 4),
    industry: items.filter((item) => item.type !== "投融资").slice(0, 5),
    research: publicResearch.slice(0, 6).map(articleItem),
    companyRadar,
    routes: routeNames.map((name) => ({ name, focus: routeFocus[name], companies: companies.filter((company) => company.routes.includes(name as CompanyProfile["routes"][number])).slice(0, 4).map((company) => company.name) })),
  };
}
