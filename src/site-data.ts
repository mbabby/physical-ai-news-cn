import type { Article, CompanyProfile, EventRecord, EventStore } from "./types.js";

export interface DashboardItem { title: string; summary: string; link: string; type: string; route: string; date: string; source: string; }
export interface DashboardData { generatedAt: string; stats: { events: number; companies: number; research: number; }; keyEvents: DashboardItem[]; capital: DashboardItem[]; industry: DashboardItem[]; research: DashboardItem[]; routes: Array<{ name: string; focus: string; companies: string[]; }>; }

function eventFact(event: EventRecord): string {
  return [...event.timeline.map((item) => item.summary), ...event.facts].find(Boolean) ?? "请阅读原始证据。";
}
function eventItem(event: EventRecord): DashboardItem {
  const evidence = event.evidence.find((item) => item.grade === "A") ?? event.evidence[0];
  return { title: event.title, summary: eventFact(event), link: evidence?.link ?? "#", type: event.type, route: event.routes[0] ?? "物理 AI", date: event.lastUpdatedAt.slice(0, 10), source: evidence?.source ?? "可追溯来源" };
}
function articleItem(article: Article): DashboardItem {
  return { title: article.titleZh ?? article.title, summary: article.summaryZh ?? article.excerpt ?? "请阅读论文原文。", link: article.link, type: "研究论文", route: article.tags[0] ?? "具身智能", date: article.publishedAt.toISOString().slice(0, 10), source: article.source };
}
function recent(events: EventRecord[]): EventRecord[] { return [...events].filter((event) => event.status !== "已归档").sort((a, b) => b.lastUpdatedAt.localeCompare(a.lastUpdatedAt)); }

export function buildDashboard(store: EventStore, companies: CompanyProfile[], research: Article[], generatedAt = new Date()): DashboardData {
  const events = recent(store.events); const items = events.map(eventItem);
  const routeFocus: Record<string, string> = {
    "数据与训练": "真实数据与训练效率", "VLA 与具身模型": "泛化与长程任务", "世界模型与空间智能": "可预测的物理环境", "本体与硬件": "可靠性、灵巧性与成本", "部署与商业化": "可验证 ROI 与规模化",
  };
  const routeNames = Object.keys(routeFocus);
  return {
    generatedAt: generatedAt.toISOString(),
    stats: { events: events.length, companies: companies.length, research: research.length },
    keyEvents: items.slice(0, 3),
    capital: items.filter((item) => item.type === "投融资").slice(0, 4),
    industry: items.filter((item) => item.type !== "投融资").slice(0, 5),
    research: research.slice(0, 5).map(articleItem),
    routes: routeNames.map((name) => ({ name, focus: routeFocus[name], companies: companies.filter((company) => company.routes.includes(name as CompanyProfile["routes"][number])).slice(0, 4).map((company) => company.name) })),
  };
}
