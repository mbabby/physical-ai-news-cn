import { createHash } from "node:crypto";
import { normalizeUrl } from "./filter.js";
import type { Article, ArticleKind, CompanyProfile, EventEvidence, EventRecord, EventStatus, EventStore, TechnicalRoute } from "./types.js";

// Alias matching is deliberately title-only for event ownership. An article may
// mention a competitor or customer, but that must never overwrite its profile.
const COMPANY_ALIASES: Record<string, string[]> = {
  Tesla: ["tesla", "optimus"], NVIDIA: ["nvidia"], "Google DeepMind": ["google deepmind", "gemini robotics", "google robotics"], Meta: ["meta ai", "meta robotics"],
  Figure: ["figure ai", "figure robot", "figure 02", "figure 03", "helix"], "Physical Intelligence": ["physical intelligence"], "World Labs": ["world labs"],
  "1X": ["1x technologies", "1x humanoid"], Apptronik: ["apptronik", "apollo humanoid"], "Agility Robotics": ["agility robotics", "digit robot"], "Sanctuary AI": ["sanctuary ai"], Skild: ["skild ai"], Dexterity: ["dexterity ai"], "Boston Dynamics": ["boston dynamics"],
  "宇树科技": ["unitree", "宇树"], "优必选": ["ubtech", "优必选"], "智元机器人": ["智元机器人", "agibot"], "银河通用": ["galbot", "银河通用"], "众擎机器人": ["engineai", "众擎"], "傅利叶智能": ["fourier intelligence", "傅利叶"], "逐际动力": ["limx dynamics", "逐际"], "松延动力": ["noetix", "松延"], "魔法原子": ["magiclab", "魔法原子"], "乐聚机器人": ["leju robot", "乐聚"], "NEURA Robotics": ["neura robotics"], ANYbotics: ["anybotics"],
};
const FUNDING_WORDS = ["funding", "funded", "raises", "raised", "series a", "series b", "series c", "seed round", "venture round", "valuation", "acquisition", "融资", "投资", "收购", "估值"];

function id(value: string): string { return `evt-${createHash("sha256").update(value).digest("hex").slice(0, 12)}`; }
function text(article: Article): string { return `${article.title} ${article.titleZh ?? ""} ${article.excerpt} ${article.summaryZh ?? ""}`.toLowerCase(); }
function titleText(article: Pick<Article, "title" | "titleZh">): string { return `${article.title} ${article.titleZh ?? ""}`.toLowerCase(); }
function aliasesIn(value: string): string[] { return Object.entries(COMPANY_ALIASES).filter(([, aliases]) => aliases.some((alias) => value.includes(alias))).map(([name]) => name); }
function primaryEntityFor(article: Article): string | undefined {
  const value = titleText(article);
  const matches = Object.entries(COMPANY_ALIASES).flatMap(([name, aliases]) => aliases.filter((alias) => value.includes(alias)).map((alias) => ({ name, index: value.indexOf(alias) })));
  return matches.sort((a, b) => a.index - b.index)[0]?.name;
}
function routeFor(article: Article): TechnicalRoute[] {
  const value = text(article); const routes = new Set<TechnicalRoute>();
  if (/world model|world labs|spatial|cosmos|marble/.test(value)) routes.add("世界模型与空间智能");
  if (/vla|vision-language-action|gemini robotics|openpi|pi0|policy/.test(value)) routes.add("VLA 与具身模型");
  if (/humanoid|unitree|optimus|actuator|robot hardware/.test(value)) routes.add("本体与硬件");
  if (/deploy|deployment|customer|factory|commercial|funding|investment|融资|部署|客户|工厂|订单/.test(value)) routes.add("部署与商业化");
  if (/dataset|data|lerobot|training|teleoperation|数据集|训练/.test(value)) routes.add("数据与训练");
  return [...routes].length ? [...routes] : ["部署与商业化"];
}
function grade(article: Article): EventEvidence["grade"] { return article.sourceWeight >= 9 ? "A" : article.sourceWeight >= 6 ? "B" : article.source.startsWith("X ·") ? "C" : "D"; }
function statusFor(article: Article): EventStatus { return grade(article) === "A" ? "已确证" : grade(article) === "B" ? "持续跟踪" : "核验中"; }
function isFundingTitle(value: string): boolean { return FUNDING_WORDS.some((word) => value.toLowerCase().includes(word)); }
function meaningful(value: string | undefined): boolean { return Boolean(value?.trim()) && !/暂无原文摘要|请阅读原文|自动摘要失败|未配置模型|未配置摘要服务|暂未生成中文摘要/.test(value ?? ""); }
function hasChinese(value: string): boolean { return /[\u3400-\u9fff]/.test(value); }
function cleanTitle(value: string): string { return value.replace(/\s*[-—|｜]\s*(?:Business Wire|Ventureburn|AI Insider|The Robot Report|Arctic Today|TechCrunch|IEEE Spectrum).*$/i, "").trim(); }
function fundingSubject(event: EventRecord): string | undefined {
  const title = event.title.replace(/\s+-\s+[^-]+$/, "").trim();
  const english = title.match(/^(.{2,50}?)\s+(?:raises?|raised|completes?|secured|lands?)\b/i)?.[1];
  const chinese = title.match(/^(.{2,30}?)(?:完成|获得|获|宣布).{0,24}?(?:融资|投资|收购|估值)/)?.[1];
  return (english ?? chinese)?.replace(/^(physical ai data platform|humanoid robot company)\s+/i, "").trim();
}
function primaryForEvent(event: EventRecord): string | undefined {
  if (event.primaryEntity) return event.primaryEntity;
  const title = event.title.toLowerCase();
  return aliasesIn(title)[0];
}
function normalizeExisting(events: EventRecord[]): EventRecord[] {
  return events.map((event) => {
    const primaryEntity = primaryForEvent(event);
    const mentioned = [...new Set([...(event.mentionedEntities ?? []), ...event.entities].filter((entity) => entity !== primaryEntity))];
    // Earlier versions classified any article containing the word investment as
    // a funding story. Repair those stored records during the next daily run.
    const type: ArticleKind = event.type === "投融资" && !isFundingTitle(event.title) ? "公司商业" : event.type;
    return { ...event, type, entities: primaryEntity ? [primaryEntity] : [], primaryEntity, mentionedEntities: mentioned };
  });
}
function mergeRepeatedFunding(events: EventRecord[]): EventRecord[] {
  const kept: EventRecord[] = [];
  for (const event of events) {
    const subject = event.type === "投融资" ? fundingSubject(event)?.toLowerCase() : undefined;
    const existing = subject ? kept.find((candidate) => {
      if (candidate.type !== "投融资") return false;
      const candidateSubject = fundingSubject(candidate)?.toLowerCase();
      return Boolean(candidateSubject && (candidateSubject === subject || candidateSubject.includes(subject) || subject.includes(candidateSubject)));
    }) : undefined;
    if (!existing) { kept.push(event); continue; }
    if (hasChinese(event.title) && !hasChinese(existing.title)) existing.title = event.title;
    const eventFactValue = eventFact(event);
    if (eventFactValue && hasChinese(eventFactValue) && !hasChinese(eventFact(existing) ?? "")) existing.facts.unshift(eventFactValue);
    for (const evidence of event.evidence) if (!existing.evidence.some((item) => normalizeUrl(item.link) === normalizeUrl(evidence.link))) existing.evidence.push(evidence);
    for (const update of event.timeline) if (!existing.timeline.some((item) => item.evidenceLinks.some((link) => update.evidenceLinks.includes(link)))) existing.timeline.push(update);
    existing.timeline.sort((a, b) => b.date.localeCompare(a.date));
    if (event.lastUpdatedAt > existing.lastUpdatedAt) existing.lastUpdatedAt = event.lastUpdatedAt;
  }
  return kept;
}
function similar(a: EventRecord, article: Article): boolean {
  if (a.evidence.some((item) => normalizeUrl(item.link) === normalizeUrl(article.link))) return true;
  const eventWords = new Set(a.title.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  const articleWords = new Set((article.titleZh ?? article.title).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  const shared = [...eventWords].filter((word) => articleWords.has(word)).length;
  const primary = primaryEntityFor(article);
  return shared >= 3 && Boolean(primary && primaryForEvent(a) === primary);
}

export function upsertEvents(store: EventStore | undefined, articles: Article[], now = new Date()): EventStore {
  const events = normalizeExisting([...(store?.events ?? [])]);
  for (const article of articles.filter((item) => item.sourceWeight >= 6 && ["投融资", "产品发布", "公司商业", "部署案例", "开源项目"].includes(item.kind ?? ""))) {
    const evidence: EventEvidence = { link: article.link, source: article.source, grade: grade(article), publishedAt: article.publishedAt.toISOString(), supports: article.titleZh ?? article.title };
    const summary = meaningful(article.summaryZh) ? article.summaryZh! : article.titleZh ?? article.title;
    const update = { date: now.toISOString(), summary, evidenceLinks: [article.link] };
    const existing = events.find((event) => similar(event, article));
    if (existing) {
      if (!existing.evidence.some((item) => normalizeUrl(item.link) === normalizeUrl(article.link))) existing.evidence.push(evidence);
      if (!existing.timeline.some((item) => item.evidenceLinks.includes(article.link))) existing.timeline.unshift(update);
      existing.lastUpdatedAt = now.toISOString();
      // The model may refine a previously stored fallback title on a later run.
      if (article.titleZh && hasChinese(article.titleZh)) existing.title = article.titleZh;
      if (grade(article) <= "B") { existing.lastVerifiedAt = now.toISOString(); existing.status = grade(article) === "A" ? "已确证" : existing.status; }
      continue;
    }
    const primaryEntity = primaryEntityFor(article);
    const mentionedEntities = aliasesIn(text(article)).filter((name) => name !== primaryEntity);
    const title = article.titleZh ?? article.title;
    events.push({ id: id(article.link), title, type: article.kind ?? "公司商业", entities: primaryEntity ? [primaryEntity] : [], primaryEntity, mentionedEntities, routes: routeFor(article), status: statusFor(article), firstSeenAt: now.toISOString(), lastUpdatedAt: now.toISOString(), lastVerifiedAt: now.toISOString(), facts: [summary], openQuestions: [article.kind === "部署案例" ? "公开信息是否能证明持续、规模化运行？" : "后续是否有一手技术细节、客户或复现证据？"], evidence: [evidence], timeline: [update] });
  }
  return { updatedAt: now.toISOString(), events: mergeRepeatedFunding(events).sort((a, b) => b.lastUpdatedAt.localeCompare(a.lastUpdatedAt)) };
}

function eventFact(event: EventRecord): string | undefined {
  const candidates = [...event.timeline.map((item) => item.summary), ...event.facts].filter(meaningful);
  return candidates.find(hasChinese) ?? candidates[0];
}
function fundingAmount(value: string): string | undefined {
  const match = value.match(/\$\s*(\d+(?:\.\d+)?)\s*(m|b|million|billion)\b/i);
  if (!match) return undefined;
  const millions = Number(match[1]) * (/b|billion/i.test(match[2]) ? 1000 : 1);
  if (millions >= 100) return `${Number((millions / 100).toFixed(2))}亿美元`;
  return `${Number((millions * 100).toFixed(2))}万美元`;
}
function headlineFor(event: EventRecord, omitCompany = false): string {
  const title = cleanTitle(event.title);
  if (hasChinese(title)) return omitCompany && event.primaryEntity ? title.replace(new RegExp(`^${event.primaryEntity}[：:，,\s]*`, "i"), "") : title;
  if (event.type === "投融资") return `${omitCompany ? "" : `${fundingSubject(event) ?? "行业公司"}`}${omitCompany ? "" : " "}完成${fundingAmount(title) ?? "新一轮"}融资`;
  return `${event.routes[0]}相关进展`;
}
function summaryFor(event: EventRecord): string { const fact = eventFact(event); return fact && hasChinese(fact) ? fact : "已纳入可追溯信源，中文事实简介将在更新后补齐。"; }
function eventTags(event: EventRecord): string { return [`<kbd>${event.type}</kbd>`, ...event.routes.slice(0, 2).map((route) => `<kbd>${route}</kbd>`), `<sub>${event.lastUpdatedAt.slice(5, 10)}</sub>`].join(" "); }
function articleTitle(article: Article): string { return cleanTitle(article.titleZh || article.title); }
function articleSummary(article: Article): string {
  if (meaningful(article.summaryZh) && hasChinese(article.summaryZh!)) return article.summaryZh!;
  const excerpt = article.excerpt.replace(/\s+/g, " ").trim();
  return excerpt ? `中文简介暂未生成；原文摘要：${excerpt.slice(0, 220)}${excerpt.length > 220 ? "…" : ""}` : "原文未提供摘要，请阅读论文。";
}
const RESEARCH_AUTHORITY: Array<{ label: string; points: number; patterns: RegExp }> = [
  { label: "Google DeepMind", points: 14, patterns: /google deepmind|demis hassabis|danijar hafner|karol hausman|ted xiao/i },
  { label: "Physical Intelligence", points: 14, patterns: /physical intelligence|sergey levine|chelsea finn/i },
  { label: "NVIDIA Research", points: 12, patterns: /nvidia research|jim fan/i },
  { label: "Meta AI", points: 12, patterns: /meta ai|yann lecun|kaiming he/i },
  { label: "Stanford", points: 10, patterns: /stanford|fei-?fei li|dieter fox|jeannette bohg|shuran song/i },
  { label: "UC Berkeley", points: 10, patterns: /uc berkeley|berkeley|pieter abbeel|sergey levine|chelsea finn/i },
  { label: "MIT", points: 9, patterns: /mit csail|massachusetts institute of technology|russ tedrake|pulkit agrawal/i },
  { label: "CMU", points: 9, patterns: /carnegie mellon|cmu robotics/i },
  { label: "Princeton / World Labs", points: 10, patterns: /world labs|fei-?fei li|jiajun wu/i },
  { label: "ETH Zurich", points: 8, patterns: /eth zurich|marco hutter/i },
  { label: "上海人工智能实验室", points: 8, patterns: /shanghai ai lab|上海人工智能实验室/i },
  { label: "清华大学", points: 8, patterns: /tsinghua|清华大学/i },
];
function researchAuthority(article: Article): { score: number; labels: string[] } {
  const value = `${article.authors?.join(" ") ?? ""} ${article.title} ${article.excerpt}`;
  const matches = RESEARCH_AUTHORITY.filter((item) => item.patterns.test(value));
  return { score: Math.min(22, matches.reduce((total, item) => total + item.points, 0)), labels: matches.map((item) => item.label).slice(0, 2) };
}
function displayable(event: EventRecord): boolean {
  const fact = eventFact(event);
  // A headline alone is a useful lead for the capital tracker but not enough
  // context for the public industry feed.
  return event.status !== "已归档" && event.evidence.some((item) => item.grade === "A" || item.grade === "B") && Boolean(fact) && fact !== event.title;
}
function ageInDays(value: string): number { return Math.max(0, (Date.now() - new Date(value).getTime()) / 86_400_000); }
function freshnessScore(value: string): number {
  const days = ageInDays(value);
  if (days <= 1) return 20;
  if (days <= 3) return 16;
  if (days <= 7) return 12;
  if (days <= 14) return 7;
  return 3;
}
function authorityScore(event: EventRecord): number {
  const grades = event.evidence.map((item) => item.grade);
  if (grades.includes("A")) return 30;
  if (grades.filter((grade) => grade === "B").length >= 2) return 25;
  return grades.includes("B") ? 18 : 0;
}
function impactScore(event: EventRecord): number {
  const base: Record<ArticleKind, number> = { "投融资": 28, "部署案例": 36, "产品发布": 34, "公司商业": 24, "开源项目": 18, "研究与数据": 12 };
  const value = `${event.title} ${eventFact(event) ?? ""}`.toLowerCase();
  let score = base[event.type] + (primaryForEvent(event) ? 4 : 0);
  if (/量产|客户|订单|工厂|真实世界|规模化|deploy|factory|customer|production/.test(value)) score += 6;
  if (/发布|推出|首个|首次|launch|release|unveil|announc/.test(value)) score += 3;
  if (event.type === "投融资") {
    const amount = fundingAmount(event.title);
    if (amount?.includes("亿美元")) score += 6;
    else if (amount) score += 3;
  }
  return Math.min(score, 40);
}
function corroborationScore(event: EventRecord): number { return Math.min(10, Math.max(0, event.evidence.length - 1) * 4 + (event.status === "已确证" ? 2 : 0)); }
/** Homepage order: impact 40, authority 30, freshness 20, corroboration 10. */
function eventPriority(event: EventRecord): number { return impactScore(event) + authorityScore(event) + freshnessScore(event.lastUpdatedAt) + corroborationScore(event); }
function isSpecificFunding(event: EventRecord): boolean {
  if (event.type !== "投融资") return true;
  const subject = event.primaryEntity ?? fundingSubject(event);
  return Boolean(subject && !/^(行业公司|机器人公司|农业机器人公司|公司)$/i.test(subject) && !/融资净买入|融资余额|股票|股价|证券|跨界.*机器人/i.test(event.title));
}
function homepageEligible(event: EventRecord): boolean { return displayable(event) && isSpecificFunding(event); }
function dedupeByCompany(events: EventRecord[], limit: number): EventRecord[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    const key = primaryForEvent(event) ?? event.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}

export function formatRecentEvents(events: EventRecord[]): string {
  const cutoff = Date.now() - 30 * 24 * 3_600_000;
  const active = events.filter((event) => new Date(event.lastUpdatedAt).getTime() >= cutoff && homepageEligible(event));
  if (!active.length) return "近期没有满足首页发布门槛的产业事件。";
  const updatedAt = [...active].sort((a, b) => b.lastUpdatedAt.localeCompare(a.lastUpdatedAt))[0].lastUpdatedAt.slice(0, 10);
  const key = dedupeByCompany([...active].sort((a, b) => eventPriority(b) - eventPriority(a) || b.lastUpdatedAt.localeCompare(a.lastUpdatedAt)), 3);
  const keyIds = new Set(key.map((event) => event.id));
  // This lane is a changelog, not another "most important" list. Use the
  // exact update timestamp so that today's confirmed additions are never
  // hidden behind yesterday's stronger stories in the same freshness bucket.
  const latest = dedupeByCompany(active.filter((event) => !keyIds.has(event.id)).sort((a, b) => b.lastUpdatedAt.localeCompare(a.lastUpdatedAt) || eventPriority(b) - eventPriority(a)), 6);
  const format = (event: EventRecord): string => {
    const evidence = event.evidence.find((item) => item.grade === "A") ?? event.evidence[0];
    return `- [${headlineFor(event)}](${evidence.link}) ${eventTags(event)}<br>${summaryFor(event)}`;
  };
  const lines: string[] = [`> 更新至 ${updatedAt} · 关键进展按影响力排序，最新动态按更新时间排序。`, ""];
  if (key.length) lines.push("### 本期关键进展", "", ...key.map(format), "");
  if (latest.length) lines.push("### 最新动态", "", ...latest.map(format), "");
  return lines.join("\n");
}

function researchPriority(article: Article): number {
  const value = `${article.title} ${article.titleZh ?? ""} ${article.excerpt} ${article.summaryZh ?? ""}`.toLowerCase();
  // Research is not a chronological arXiv dump. Prioritize work that can
  // change a practitioner's technical decision, while keeping the criteria
  // deterministic and inspectable.
  let relevance = /vla|vision-language-action|world model|spatial|humanoid|manipulation|具身|人形机器人|机器人学习/.test(value) ? 30 : 12;
  if (/long[- ]horizon|长程|泛化|generalization|dexterous|灵巧/.test(value)) relevance = Math.min(30, relevance + 4);
  const realWorld = /真实机器人|real[- ]world|physical robot|on[- ]robot|部署|hardware|unitree|franka|benchmark|基准|sota|state.of.the.art/.test(value) ? 20 : 5;
  const reproducibility = /github|code|开源|dataset|数据集|benchmark|基准|release/.test(value) ? 18 : 4;
  const institutionalAuthority = researchAuthority(article).score;
  const sourceAuthority = Math.min(10, Math.round(article.sourceWeight));
  const days = Math.max(0, (Date.now() - article.publishedAt.getTime()) / 86_400_000);
  const freshness = days <= 1 ? 15 : days <= 3 ? 12 : days <= 7 ? 8 : 3;
  return relevance + realWorld + reproducibility + institutionalAuthority + sourceAuthority + freshness;
}
export function isPublishableResearch(article: Article): boolean {
  return Boolean(article.titleZh && article.summaryZh && hasChinese(article.titleZh) && hasChinese(article.summaryZh) && !/暂未生成|未配置摘要服务/.test(article.summaryZh));
}
export function formatResearchUpdates(articles: Article[], fallbackDate?: string): string {
  const publishable = articles.filter(isPublishableResearch);
  if (!publishable.length) return "> 本轮论文已抓取，正在完成中文解读与事实校验；仅在标题和摘要均完成后展示。";
  const ordering = "> 排序：物理 AI 相关性 → 真实机器人/基准证据 → 作者与实验室权威性 → 代码与数据可复现性 → 来源可信度 → 发布时间。";
  const notice = fallbackDate ? `> arXiv 暂未刷新，以下为最近一次成功抓取（${fallbackDate}）的论文。\n\n${ordering}\n\n` : `${ordering}\n\n`;
  return notice + [...publishable].sort((a, b) => researchPriority(b) - researchPriority(a) || b.publishedAt.getTime() - a.publishedAt.getTime()).slice(0, 6).map((article) => {
    const authority = researchAuthority(article);
    const byline = authority.labels.length ? `<br><sub>重点关注：${authority.labels.join(" · ")}</sub>` : "";
    return `- [${articleTitle(article)}](${article.link})<br>${articleSummary(article)}${byline}`;
  }).join("\n\n");
}

function companyLink(company: CompanyProfile): string { return `[${company.name}](${company.officialUrl})`; }

export function formatCompanyRadar(companies: CompanyProfile[], events: EventRecord[]): string {
  const recent = events.filter(homepageEligible).sort((a, b) => eventPriority(b) - eventPriority(a) || b.lastUpdatedAt.localeCompare(a.lastUpdatedAt));
  const funding = dedupeByCompany(events.filter((event) => event.type === "投融资" && homepageEligible(event)).sort((a, b) => eventPriority(b) - eventPriority(a) || b.lastUpdatedAt.localeCompare(a.lastUpdatedAt)), 5);
  const companyEvents = dedupeByCompany(recent.filter((event) => primaryForEvent(event)), 8);
  const lines: string[] = [];
  if (funding.length) {
    lines.push("### 融资与并购", "");
    for (const event of funding) { const evidence = event.evidence.find((item) => item.grade === "A") ?? event.evidence[0]; lines.push(`- **${event.primaryEntity ?? fundingSubject(event) ?? "行业公司"}** · [${headlineFor(event, true)}](${evidence.link}) · ${event.lastUpdatedAt.slice(0, 10)}`); }
    lines.push("");
  }
  if (companyEvents.length) {
    lines.push("### 公司最新进展", "");
    for (const event of companyEvents) {
      const evidence = event.evidence.find((item) => item.grade === "A") ?? event.evidence[0];
      lines.push(`- **${event.primaryEntity}** · [${headlineFor(event, true)}](${evidence.link})：${summaryFor(event)}`);
    }
    lines.push("");
  }
  const routes: TechnicalRoute[] = ["VLA 与具身模型", "世界模型与空间智能", "本体与硬件", "数据与训练", "部署与商业化"];
  lines.push("### 技术路线地图", "", "| 路线 | 代表公司 |", "| --- | --- |");
  for (const route of routes) lines.push(`| ${route} | ${companies.filter((company) => company.routes.includes(route)).slice(0, 8).map(companyLink).join(" · ")} |`);
  return lines.join("\n");
}

const ROUTE_MAP: Array<{ route: TechnicalRoute; focus: string; approaches: string }> = [
  { route: "数据与训练", focus: "高质量真实数据与训练效率", approaches: "遥操作、数据引擎、合成数据、强化学习" },
  { route: "VLA 与具身模型", focus: "泛化、长程任务与行动推理", approaches: "VLA、策略模型、测试时扩展、多机器人协作" },
  { route: "世界模型与空间智能", focus: "可预测、可生成的物理环境表征", approaches: "世界模型、空间表征、物理仿真、生成式环境" },
  { route: "本体与硬件", focus: "灵巧性、可靠性与成本", approaches: "执行器、触觉、灵巧手、整机设计" },
  { route: "部署与商业化", focus: "可持续运行与可验证 ROI", approaches: "场景闭环、客户验证、工厂/仓储部署、量产" },
];

function routeEvidence(events: EventRecord[], company: CompanyProfile, route: TechnicalRoute): EventRecord[] {
  return events.filter((event) => event.primaryEntity === company.name && event.routes.includes(route) && event.evidence.some((item) => item.grade === "A" || item.grade === "B"));
}
function evidenceLink(event: EventRecord): string { return (event.evidence.find((item) => item.grade === "A") ?? event.evidence[0])?.link ?? "#"; }
function compactEvent(event: EventRecord): string { return `[${headlineFor(event, true)}](${evidenceLink(event)})`; }
function capitalLabel(events: EventRecord[]): string {
  const capital = events.filter((event) => event.type === "投融资");
  return capital.length ? compactEvent(capital[0]) : "尚无可归属的公开融资/并购披露";
}
function tractionLabel(events: EventRecord[], company: CompanyProfile): string {
  const traction = events.find((event) => event.type === "部署案例" || event.type === "产品发布" || event.type === "公司商业");
  return traction ? compactEvent(traction) : company.thesis;
}
function routeEventScore(event: EventRecord): number {
  const evidence = authorityScore(event) / 30;
  const freshness = freshnessScore(event.lastUpdatedAt) / 20;
  return 0.7 + evidence * 0.2 + freshness * 0.1;
}
function routeMomentum(events: EventRecord[], companies: CompanyProfile[], route: TechnicalRoute): { capital: number; traction: number; open: number; companyBreadth: number; score: number } {
  const routeCompanies = companies.filter((company) => company.routes.includes(route));
  const linked = routeCompanies.flatMap((company) => routeEvidence(events, company, route));
  const capital = linked.filter((event) => event.type === "投融资").length;
  const traction = linked.filter((event) => event.type === "产品发布" || event.type === "部署案例" || event.type === "公司商业").length;
  const open = linked.filter((event) => event.type === "开源项目" || /开源|github|代码|数据集|dataset/i.test(`${event.title} ${eventFact(event) ?? ""}`)).length;
  // Four capped components: public capital (40), product/deployment proof
  // (30), breadth of company participation (20), and reusable/open assets
  // (10). Evidence quality and freshness act as a small multiplier, instead
  // of allowing a burst of low-quality mentions to dominate the map.
  const capitalScore = Math.min(40, linked.filter((event) => event.type === "投融资").reduce((total, event) => total + 18 * routeEventScore(event), 0));
  const tractionScore = Math.min(30, linked.filter((event) => event.type === "部署案例" || event.type === "产品发布" || event.type === "公司商业").reduce((total, event) => total + (event.type === "部署案例" ? 13 : 10) * routeEventScore(event), 0));
  const breadthScore = Math.min(20, routeCompanies.length * 3);
  const opennessScore = Math.min(10, linked.filter((event) => event.type === "开源项目" || /开源|github|代码|数据集|dataset/i.test(`${event.title} ${eventFact(event) ?? ""}`)).reduce((total, event) => total + 5 * routeEventScore(event), 0));
  return { capital, traction, open, companyBreadth: routeCompanies.length, score: capitalScore + tractionScore + breadthScore + opennessScore };
}

function companyRoutePriority(events: EventRecord[]): number {
  const capital = events.filter((event) => event.type === "投融资").reduce((total, event) => total + 40 * routeEventScore(event), 0);
  const traction = events.filter((event) => event.type === "部署案例" || event.type === "产品发布" || event.type === "公司商业").reduce((total, event) => total + (event.type === "部署案例" ? 30 : 22) * routeEventScore(event), 0);
  const openness = events.filter((event) => event.type === "开源项目").reduce((total, event) => total + 10 * routeEventScore(event), 0);
  return capital + traction + openness;
}

export function formatIndustryMap(events: EventRecord[], companies: CompanyProfile[] = []): string {
  const momentum = ROUTE_MAP.map((meta) => ({ ...meta, ...routeMomentum(events, companies, meta.route) })).sort((a, b) => b.score - a.score || b.capital - a.capital || b.traction - a.traction || a.route.localeCompare(b.route));
  const lines = [
    "# 公司 × 技术路线 × 资本图谱",
    "",
    "> 这里回答的不是“技术是什么”，而是“哪些公司押注哪条路线、资本支持是否已公开披露、是否已有产品或部署证据”。只统计可归属到公司的 A/B 级证据；没有公开信息不会用推测补齐。",
    "",
    "## 路线热度",
    "",
    "| 路线 | 覆盖公司 | 已披露资本事件 | 产品/部署事件 | 开放/数据事件 |", "| --- | ---: | ---: | ---: | ---: |",
    ...momentum.map((item) => `| ${item.route} | ${item.companyBreadth} | ${item.capital} | ${item.traction} | ${item.open} |`),
    "",
  ];
  for (const [index, meta] of momentum.entries()) {
    const routeCompanies = companies.filter((company) => company.routes.includes(meta.route)).sort((a, b) => companyRoutePriority(routeEvidence(events, b, meta.route)) - companyRoutePriority(routeEvidence(events, a, meta.route)) || a.name.localeCompare(b.name));
    lines.push(`## ${String(index + 1).padStart(2, "0")} · ${meta.route}`, "", `**技术命题**：${meta.focus}  `, `**主流押注**：${meta.approaches}  `, "", "| 公司 | 技术押注 | 资本支持（已披露） | 产品 / 落地信号 |", "| --- | --- | --- | --- |");
    for (const company of routeCompanies) {
      const linked = routeEvidence(events, company, meta.route);
      lines.push(`| [${company.name}](${company.officialUrl})<br><sub>${company.region} · ${company.stage ?? "公司"}</sub> | ${company.thesis} | ${capitalLabel(linked)} | ${tractionLabel(linked, company)} |`);
    }
    lines.push("");
  }
  lines.push("## 排序与口径", "", "- 路线排序：资本支持 40% → 产品/部署验证 30% → 参与公司广度 20% → 开源、代码或数据资产 10%；证据等级和新近程度只作小幅加权。", "- 公司排序：先看已披露资本支持，再看部署/产品验证，随后看开源项目；同分按公司名稳定排序。", "- 资本支持：仅计融资、并购或其他可明确归属到公司的公开资本事件；不把股票交易或传闻当作融资。", "- 产品/落地：仅计公司主体明确的产品发布、部署案例或商业进展。", "- 资本事件为 0 不代表未融资，只表示当前信源尚无可核验、且可归属到该路线的公开披露。", "");
  return lines.join("\n");
}
