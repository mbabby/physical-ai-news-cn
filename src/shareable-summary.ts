import type { Article, EventRecord, EventStore } from "./types.js";

function fact(event: EventRecord): string | undefined {
  return [...event.timeline.map((item) => item.summary), ...event.facts].find((value) => /[\u3400-\u9fff]/.test(value) && !/暂无|未生成|请阅读/.test(value));
}
function evidence(event: EventRecord): string | undefined {
  // Discovery networks must never become a public citation merely because an
  // older stored event happened to carry a B-grade link.
  return event.evidence.find((item) => (item.grade === "A" || item.grade === "B") && !/google news|hacker news|^x\s*·/i.test(item.source))?.link;
}
function eventRank(event: EventRecord): number {
  const kind = { "投融资": 35, "部署案例": 32, "产品发布": 30, "公司商业": 22, "开源项目": 16, "研究与数据": 10 }[event.type];
  const grade = event.evidence.some((item) => item.grade === "A") ? 12 : 6;
  return kind + grade + new Date(event.lastUpdatedAt).getTime() / 1e14;
}
function isPublic(event: EventRecord): boolean { return event.status !== "核验中" && Boolean(event.primaryEntity) && Boolean(evidence(event)) && Boolean(fact(event)); }
function hasChinese(value: string | undefined): boolean { return /[\u3400-\u9fff]/.test(value ?? ""); }
function englishFallback(event: EventRecord): string {
  const subject = event.primaryEntity ?? "Physical AI company";
  const action = { "投融资": "reports a verified capital event", "产品发布": "announces a product update", "部署案例": "reports a deployment update", "公司商业": "reports a business update", "开源项目": "releases an open-source update", "研究与数据": "shares a research update" }[event.type];
  return `${subject} ${action}`;
}
function englishHeadline(event: EventRecord): string { return event.sourceTitle && !hasChinese(event.sourceTitle) ? event.sourceTitle : englishFallback(event); }

/** Copy-ready social summary. It deliberately consumes public facts only. */
export function formatShareableSummary(store: EventStore, research: Article[], week: string): string {
  const events = store.events.filter(isPublic).sort((a, b) => eventRank(b) - eventRank(a)).slice(0, 3);
  const funding = events.find((event) => event.type === "投融资");
  const product = events.find((event) => event.type === "产品发布" || event.type === "部署案例" || event.type === "公司商业");
  const paper = research.find((article) => article.titleZh && article.summaryZh && /[\u3400-\u9fff]/.test(article.summaryZh));
  const lines = [`# 本周物理 AI 情报摘要 · ${week}`, "", "> 可直接复制发布。内容仅来自已公开、可追溯的事件与完整中文研究卡。", "", "## 中文版", ""];
  if (events.length) lines.push(...events.map((event, index) => `${index + 1}. [${event.title}](${evidence(event)})：${fact(event)}`));
  else lines.push("本周暂无同时满足主体、中文事实简介与证据链接门槛的产业事件。");
  const capitalLine = funding ? `资本：[${funding.primaryEntity}](${evidence(funding)}) 出现可追溯资本事件。` : "资本：本周暂无满足公开门槛的资本事件。";
  const productLine = product ? `产品与部署：[${product.primaryEntity}](${evidence(product)}) 出现产品、部署或商业进展。` : "产品与部署：本周暂无满足公开门槛的产品或部署事件。";
  const researchLine = paper ? `研究：[${paper.titleZh}](${paper.link})。${paper.summaryZh}` : "研究：本周暂无完整中文研究卡。";
  lines.push("", capitalLine, productLine, researchLine, "", "完整情报：", "- [公司与资本地图](../resources/companies.md)", "- [物理 AI 竞争路线图](../resources/industry-landscape-and-tech-routes.md)", "- [里程碑论文与精读](../resources/milestone-papers.md)", "", "## English short version", "", `Physical AI Intelligence Brief · ${week}`, "");
  lines.push(...(events.length ? events.map((event) => `- [${englishHeadline(event)}](${evidence(event)})`) : ["- No public event met the repository's evidence threshold this week."]));
  lines.push("", "Source-traceable Chinese intelligence for Physical AI practitioners: companies, capital, product deployment, technical competition, and research.", "");
  return lines.join("\n");
}
