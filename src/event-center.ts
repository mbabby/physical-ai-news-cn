import { createHash } from "node:crypto";
import { normalizeUrl } from "./filter.js";
import type { Article, CompanyProfile, EventEvidence, EventRecord, EventStatus, EventStore, TechnicalRoute } from "./types.js";

const COMPANY_ALIASES: Record<string, string[]> = {
  "Tesla": ["tesla", "optimus"], "宇树科技": ["unitree"], "Google DeepMind": ["google deepmind", "gemini robotics", "google robotics"],
  "Figure": ["figure", "helix"], "Physical Intelligence": ["physical intelligence", "openpi", "pi0"], "World Labs": ["world labs", "marble"],
};

function id(value: string): string { return `evt-${createHash("sha256").update(value).digest("hex").slice(0, 12)}`; }
function text(article: Article): string { return `${article.title} ${article.titleZh ?? ""} ${article.excerpt} ${article.summaryZh ?? ""}`.toLowerCase(); }
function routeFor(article: Article): TechnicalRoute[] {
  const value = text(article); const routes = new Set<TechnicalRoute>();
  if (/world model|world labs|spatial|cosmos|marble/.test(value)) routes.add("世界模型与空间智能");
  if (/vla|vision-language-action|gemini robotics|openpi|pi0|policy/.test(value)) routes.add("VLA 与具身模型");
  if (/humanoid|unitree|optimus|actuator|robot hardware/.test(value)) routes.add("本体与硬件");
  if (/deploy|deployment|customer|factory|commercial|funding|investment|融资|部署|客户|工厂|订单/.test(value)) routes.add("部署与商业化");
  if (/dataset|data|lerobot|training|teleoperation|数据集|训练/.test(value)) routes.add("数据与训练");
  return [...routes].length ? [...routes] : ["部署与商业化"];
}
function entitiesFor(article: Article): string[] { const value = text(article); return Object.entries(COMPANY_ALIASES).filter(([, aliases]) => aliases.some((alias) => value.includes(alias))).map(([name]) => name); }
function grade(article: Article): EventEvidence["grade"] { return article.sourceWeight >= 9 ? "A" : article.sourceWeight >= 6 ? "B" : article.source.startsWith("X ·") ? "C" : "D"; }
function statusFor(article: Article): EventStatus { return grade(article) === "A" ? "已确证" : grade(article) === "B" ? "持续跟踪" : "核验中"; }
function similar(a: EventRecord, article: Article): boolean {
  if (a.evidence.some((item) => normalizeUrl(item.link) === normalizeUrl(article.link))) return true;
  const eventWords = new Set(a.title.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  const articleWords = new Set((article.titleZh ?? article.title).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  const shared = [...eventWords].filter((word) => articleWords.has(word)).length;
  return shared >= 3 && a.entities.some((entity) => entitiesFor(article).includes(entity));
}

export function upsertEvents(store: EventStore | undefined, articles: Article[], now = new Date()): EventStore {
  const events = [...(store?.events ?? [])];
  for (const article of articles.filter((item) => item.sourceWeight >= 6 && ["投融资", "产品发布", "公司商业", "部署案例", "开源项目"].includes(item.kind ?? ""))) {
    const evidence: EventEvidence = { link: article.link, source: article.source, grade: grade(article), publishedAt: article.publishedAt.toISOString(), supports: article.titleZh ?? article.title };
    const update = { date: now.toISOString(), summary: article.summaryZh ?? article.titleZh ?? article.title, evidenceLinks: [article.link] };
    const existing = events.find((event) => similar(event, article));
    if (existing) {
      if (!existing.evidence.some((item) => normalizeUrl(item.link) === normalizeUrl(article.link))) existing.evidence.push(evidence);
      if (!existing.timeline.some((item) => item.evidenceLinks.includes(article.link))) existing.timeline.unshift(update);
      existing.lastUpdatedAt = now.toISOString();
      if (grade(article) <= "B") { existing.lastVerifiedAt = now.toISOString(); existing.status = grade(article) === "A" ? "已确证" : existing.status; }
      continue;
    }
    const title = article.titleZh ?? article.title;
    events.push({ id: id(article.link), title, type: article.kind ?? "公司商业", entities: entitiesFor(article), routes: routeFor(article), status: statusFor(article), firstSeenAt: now.toISOString(), lastUpdatedAt: now.toISOString(), lastVerifiedAt: now.toISOString(), facts: [article.summaryZh ?? title], openQuestions: [article.kind === "部署案例" ? "公开信息是否能证明持续、规模化运行？" : "后续是否有一手技术细节、客户或复现证据？"], evidence: [evidence], timeline: [update] });
  }
  return { updatedAt: now.toISOString(), events: events.sort((a, b) => b.lastUpdatedAt.localeCompare(a.lastUpdatedAt)) };
}

export function formatRecentEvents(events: EventRecord[]): string {
  const cutoff = Date.now() - 30 * 24 * 3_600_000;
  const active = events.filter((event) => event.status !== "已归档" && new Date(event.lastUpdatedAt).getTime() >= cutoff).slice(0, 8);
  if (!active.length) return "> 暂无已确证事件；系统仍在持续核验候选信号。";
  const lines = ["> 展示近 30 天仍在演进的高可信事件；新证据会追加到同一事件，而非重复造新闻。", ""];
  for (const event of active) {
    const latest = event.timeline[0]; const evidence = event.evidence[0];
    lines.push(`### ${event.title}`, "", `**${event.status}** · ${event.type} · ${event.routes.join(" / ")}`, "", latest?.summary ?? event.facts[0], "", `- **最近更新：** ${event.lastUpdatedAt.slice(0, 10)}`, `- **证据：** [${evidence.source}](${evidence.link}) · ${evidence.grade} 级`, `- **待验证：** ${event.openQuestions[0]}`, "");
  }
  return lines.join("\n");
}

export function formatCompanyRadar(companies: CompanyProfile[], events: EventRecord[]): string {
  const lines = ["> 覆盖平台公司、成长公司与创业公司；融资、产品和部署均须有对应事件证据才会显示为“已确证”。", "", "| 公司 | 地域 / 阶段 | 技术位置 | 最近可核验进展 |", "| --- | --- | --- | --- |"];
  for (const company of companies) {
    const latest = events.find((event) => event.entities.includes(company.name));
    const progress = latest ? `${latest.title}（${latest.status}）` : "等待可核验事件";
    lines.push(`| [${company.name}](${company.officialUrl}) | ${company.region} / ${company.stage ?? "观察"} | ${company.routes.join("、")} | ${progress} |`);
  }
  lines.push("", "各公司“核心押注、融资与部署证据、待验证问题”会在事件中心累计后进入独立档案页。");
  return lines.join("\n");
}

export function formatIndustryMap(events: EventRecord[]): string {
  const routes: TechnicalRoute[] = ["数据与训练", "VLA 与具身模型", "世界模型与空间智能", "本体与硬件", "部署与商业化"];
  const lines = ["# 产业地图与技术路线", "", "从数据、智能、本体到部署，查看公司、事件与研究如何指向同一套物理 AI 瓶颈。", ""];
  for (const route of routes) {
    const related = events.filter((event) => event.routes.includes(route)).slice(0, 4);
    lines.push(`## ${route}`, "");
    if (!related.length) lines.push("正在积累可核验事件。");
    for (const event of related) lines.push(`- [${event.title}](../events/index.json) · ${event.status} · 更新 ${event.lastUpdatedAt.slice(0, 10)}`);
    lines.push("");
  }
  lines.push("## 证据规则", "", "- A 级：官方发布、论文原文、GitHub Release、产品页等一手证据。", "- B 级：可追溯的可靠行业报道，用于补充部署或投融资。", "- C 级：本人公开观点，不作为产品、融资或能力事实。", "- D 级：仅作候选线索，不进入本页。", "");
  return lines.join("\n");
}
