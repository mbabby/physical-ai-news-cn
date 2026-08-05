import type { Article, CandidateCompanyRegistry, CandidateSourceRegistry, DailyArchive, EventRecord, EventStore, ProjectMetrics, ResearchRecord, SourceRegistry } from "./types.js";

const DISCOVERY = /google news|hacker news|^x\s*·/i;
const zh = (value: string | undefined): value is string => Boolean(value && /[\u3400-\u9fff]/.test(value) && !/暂无|未生成|请阅读|原文摘要/.test(value));
const evidence = (event: EventRecord) => event.evidence.find((item) => (item.grade === "A" || item.grade === "B") && !DISCOVERY.test(item.source));
const publicEvent = (event: EventRecord) => Boolean(event.primaryEntity && evidence(event) && event.status !== "核验中" && event.status !== "待复核" && event.facts.some(zh));
const date = (value: string) => value.slice(0, 10);
const link = (event: EventRecord) => evidence(event)?.link ?? "#";
const fact = (event: EventRecord) => [...event.timeline.map((item) => item.summary), ...event.facts].find(zh) ?? "";

function rate(numerator: number, denominator: number): number | undefined {
  return denominator ? Number((numerator / denominator).toFixed(2)) : undefined;
}
function unique<T>(items: T[]): T[] { return [...new Set(items)]; }

export function buildProjectMetrics(
  archives: DailyArchive[], store: EventStore, registry: SourceRegistry, companyCandidates: CandidateCompanyRegistry, now = new Date(),
): ProjectMetrics {
  const windowDays = 30;
  const since = now.getTime() - windowDays * 86_400_000;
  const recent = archives.filter((item) => new Date(`${item.date}T23:59:59Z`).getTime() >= since);
  const successful = recent.filter((archive) => (archive.sourceOutcomes ?? []).some((outcome) => outcome.status === "success"));
  const events = store.events.filter(publicEvent);
  const withAB = events.filter((event) => Boolean(evidence(event)));
  const coveredCompanies = new Set(events.map((event) => event.primaryEntity)).size;
  const effectiveItems = events.filter((event) => new Date(event.lastUpdatedAt).getTime() >= since).length;
  const reviewCandidates = recent.flatMap((archive) => archive.candidates ?? []).filter((item) => item.stage !== "不适合公开资讯" && item.sourceWeight >= 7 && zh(item.summaryZh)).length + companyCandidates.companies.filter((item) => item.status === "观察中" || item.status === "已交叉核验").length;
  return {
    updatedAt: now.toISOString(), windowDays,
    digest: { expectedRuns: windowDays, observedRuns: recent.length, successfulRuns: successful.length, successRate: rate(successful.length, recent.length) },
    publicContent: { homepageEffectiveItems: effectiveItems, evidenceABRatio: rate(withAB.length, events.length), companyDossierCoverage: coveredCompanies },
    flywheel: {
      enabledSources: registry.sources.filter((item) => item.status === "已启用").length,
      observedSources: registry.sources.filter((item) => item.status === "观察").length,
      pausedSources: registry.sources.filter((item) => item.status === "已暂停").length,
      promotedSources: registry.sources.filter((item) => item.status === "已启用" && item.successfulRuns >= 5 && item.selectedArticles >= 3).length,
      reviewCandidates,
    },
    community: { stars: { status: "未配置" }, visitors: { status: "未配置" }, referrers: { status: "未配置" } },
  };
}

function eventLine(event: EventRecord): string { return `- **${event.primaryEntity}** · [${event.title}](${link(event)})：${fact(event)}`; }

/** Weekly report is shareable and only consumes public, evidence-backed facts. */
export function formatWeeklyReport(store: EventStore, research: ResearchRecord[], metrics: ProjectMetrics, week: string, now = new Date()): string {
  const since = now.getTime() - 7 * 86_400_000;
  const events = store.events.filter((event) => publicEvent(event) && new Date(event.lastUpdatedAt).getTime() >= since);
  const funding = events.filter((event) => event.type === "投融资");
  const products = events.filter((event) => event.type === "产品发布" || event.type === "部署案例" || event.type === "公司商业");
  const papers = research.filter((record) => record.lastShownAt && new Date(record.lastShownAt).getTime() >= since && zh(record.article.titleZh) && zh(record.article.summaryZh) && record.status !== "待复核" && record.status !== "已撤稿").slice(0, 6);
  const lines = [`# 物理 AI 周报 · ${week}`, "", `> 截止 ${date(now.toISOString())}。只纳入主体明确、中文事实简介完整、且具 A/B 级非线索证据的公开条目。`, "", "## 新增事件", ""];
  lines.push(...(events.length ? events.map(eventLine) : ["- 本周暂无满足公开门槛的新增产业事件。"]));
  lines.push("", "## 融资与并购", "", ...(funding.length ? funding.map(eventLine) : ["- 本周暂无满足公开门槛的融资或并购事件。"]));
  lines.push("", "## 产品与部署", "", ...(products.length ? products.map(eventLine) : ["- 本周暂无满足公开门槛的产品或部署事件。"]));
  lines.push("", "## 研究前沿", "", ...(papers.length ? papers.map((record) => `- [${record.article.titleZh}](${record.article.link})：${record.article.summaryZh}`) : ["- 本周暂无完整中文研究卡进入公开周报。"]));
  const health = metrics.flywheel;
  lines.push("", "## 信源质量变化", "", `- 已启用 ${health.enabledSources} 个；观察 ${health.observedSources} 个；暂停 ${health.pausedSources} 个；达到晋升条件 ${health.promotedSources} 个。`, "", "## 项目指标", "", `- 日报成功率：${metrics.digest.successRate === undefined ? "样本不足" : `${Math.round(metrics.digest.successRate * 100)}%`}（${metrics.digest.successfulRuns}/${metrics.digest.observedRuns} 个已归档运行）`, `- 首页有效条目：${metrics.publicContent.homepageEffectiveItems}；A/B 级证据比例：${metrics.publicContent.evidenceABRatio === undefined ? "样本不足" : `${Math.round(metrics.publicContent.evidenceABRatio * 100)}%`}；公司档案覆盖：${metrics.publicContent.companyDossierCoverage} 家。`, "", "## 待验证候选", "", `- 有 ${metrics.flywheel.reviewCandidates} 条高质量候选停留在 Review 队列；它们不会进入首页或本周结论，欢迎补充官网、投资方公告、第二独立来源或论文元数据。`, "", "---", "", "*GitHub Star、访问量与来源需要另行授权 GitHub Traffic API；未配置时不会以 0 展示。*", "");
  return lines.join("\n");
}

/** A deliberately non-public-fact queue. Humans file an issue only after reviewing the evidence. */
export function formatCommunityReviewQueue(
  archives: DailyArchive[], candidateCompanies: CandidateCompanyRegistry, candidateSources: CandidateSourceRegistry | undefined, week: string,
): string {
  const articles = archives.flatMap((archive) => archive.candidates ?? []).filter((article) => article.stage !== "不适合公开资讯" && article.sourceWeight >= 7 && zh(article.summaryZh));
  const deduped = articles.filter((article, index) => articles.findIndex((item) => item.link === article.link) === index).slice(0, 8);
  const companies = candidateCompanies.companies.filter((company) => company.status === "观察中" || company.status === "已交叉核验").slice(0, 8);
  const sources = (candidateSources?.sources ?? []).filter((source) => source.successfulRuns >= 2).slice(0, 6);
  const lines = [`# 社区 Review 队列 · ${week}`, "", "> 这里是待核验候选，不是公开事实清单。请先补齐原始证据，再通过对应 Issue 模板提交；审核通过后才可能进入公司档案、日报或常青资源。", "", "## 待补融资 / 公司主体", ""];
  lines.push(...(companies.length ? companies.map((company) => `- **${company.name}** · ${company.status} · ${company.verificationScore}/100 · 需要：${company.openQuestions.join("；")} · [提交公司或融资证据](../../issues/new/choose)`) : ["- 暂无达到社区复核阈值的公司候选。"]));
  lines.push("", "## 待补事件证据", "", ...(deduped.length ? deduped.map((article) => `- [${article.titleZh ?? article.title}](${article.link}) · ${article.stage}：${article.holdReasons.join("；")} · [提交补充证据](../../issues/new/choose)`) : ["- 暂无达到社区复核阈值的事件候选。"]));
  lines.push("", "## 待评估信源", "", ...(sources.length ? sources.map((source) => `- **${source.domain}** · 连续成功 ${source.successfulRuns} 次 · 样例：[${source.title}](${source.link}) · [提交信源建议](../../issues/new/choose)`) : ["- 暂无达到复核阈值的候选信源。"]));
  lines.push("", "## 如何贡献", "", "1. 选择 Issue 类型：公司/融资、产品/部署、论文、信源或事实纠错。", "2. 提供原始链接、主体名称、发生时间与简短中文事实说明。", "3. 线索链接本身不足以入库；融资优先公司或投资方公告，或两家独立媒体交叉确认。", "");
  return lines.join("\n");
}
