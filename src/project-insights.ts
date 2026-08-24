import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Article, CandidateCompanyRegistry, CandidateSourceRegistry, DailyArchive, EventRecord, EventStore, ProjectMetrics, ResearchRecord, SourceRegistry } from "./types.js";
import { publicEventDate } from "./site-data.js";
import type { FileTransaction } from "./runtime/storage.js";
import { assertNoPrivateWatchlistContent, validateWatchlistPublicViewShape, type WatchlistPublicCard, type WatchlistPublicView } from "./watchlist/public-view.js";

export interface CommunityReviewSeed {
  id: string;
  priority: "高" | "常规";
  category: "公司/融资" | "产品/部署" | "论文" | "信源";
  title: string;
  evidenceLink: string;
  missingEvidence: string;
  issueTemplate: string;
  issueTitle: string;
  issueBody: string;
}

export type WatchlistReviewIssueKind = "evidence" | "correction";

/** A public-only, deterministic input for manual GitHub Issue materialization. */
export interface WatchlistReviewIssueSeed {
  id: string;
  kind: WatchlistReviewIssueKind;
  companyId: string;
  companyName: string;
  thesisId: string;
  thesisVersion: number;
  missingEvidenceType: string;
  snapshotWeek: string;
  snapshotVersion: number;
  evidenceUrls: string[];
  reviewTarget: string;
  publicContext: string;
  issueTitle: string;
  issueBody: string;
  labels: ["evidence-review", "needs-evidence" | "correction"];
}

export interface WatchlistReviewIssueArtifact {
  schemaVersion: 1;
  week: string;
  snapshotVersion: number;
  seeds: WatchlistReviewIssueSeed[];
}

const REVIEW_ARTIFACT_KEYS = new Set(["schemaVersion", "week", "snapshotVersion", "seeds"]);
const REVIEW_SEED_KEYS = new Set([
  "id", "kind", "companyId", "companyName", "thesisId", "thesisVersion", "missingEvidenceType", "snapshotWeek", "snapshotVersion",
  "evidenceUrls", "reviewTarget", "publicContext", "issueTitle", "issueBody", "labels",
]);

function codeUnit(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, keys: Set<string>): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.size && actual.every((key) => keys.has(key));
}
function string(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function https(value: unknown): value is string {
  if (!string(value)) return false;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

function canonicalEvidenceUrls(card: WatchlistPublicCard): string[] {
  return [...new Set(card.evidenceLinks.map((item) => item.url).filter(https))].sort(codeUnit);
}

function stableSeedId(
  kind: WatchlistReviewIssueKind,
  week: string,
  snapshotVersion: number,
  companyId: string,
  thesisId: string,
  thesisVersion: number,
  missingEvidenceType: string,
): string {
  const key = [kind, week, String(snapshotVersion), companyId, thesisId, String(thesisVersion), missingEvidenceType].join("\0");
  return `watchlist-${kind}-${createHash("sha256").update(key).digest("hex").slice(0, 20)}`;
}

function seedId(kind: WatchlistReviewIssueKind, view: WatchlistPublicView, card: WatchlistPublicCard, missingEvidenceType: string): string {
  return stableSeedId(kind, view.week, view.snapshotVersion, card.companyId, card.thesisId, card.thesisVersion, missingEvidenceType);
}

function seedMarker(id: string): string { return `<!-- watchlist-review-seed:${id} -->`; }

function issueBody(seed: Pick<WatchlistReviewIssueSeed, "id" | "kind" | "companyId" | "companyName" | "thesisId" | "thesisVersion" | "snapshotWeek" | "snapshotVersion" | "evidenceUrls" | "reviewTarget" | "publicContext">): string {
  const action = seed.kind === "evidence" ? "补充证据" : "核对并纠正公开事实";
  return [
    seedMarker(seed.id),
    "",
    "这是公开 Review 输入，不会自动发布，也不会改变当前公开 Watchlist。已采纳证据仍须在后续生成中完成规范化提升后，才可能影响公开工件。",
    "",
    `- 当前快照：${seed.snapshotWeek} · v${seed.snapshotVersion}`,
    `- 规范公司：${seed.companyName}（${seed.companyId}）`,
    `- 当前判断：${seed.thesisId} v${seed.thesisVersion}`,
    `- Review 目标：${seed.reviewTarget}`,
    `- 公开上下文：${seed.publicContext}`,
    "",
    "当前已公开的规范证据：",
    ...seed.evidenceUrls.map((url) => `- ${url}`),
    "",
    `请${action}时提供原始 URL、受影响的公开事实、规范公司 ID、事件日期和简要说明。`,
  ].join("\n");
}

function createSeed(
  kind: WatchlistReviewIssueKind,
  view: WatchlistPublicView,
  card: WatchlistPublicCard,
  missingEvidenceType: string,
  reviewTarget: string,
  publicContext: string,
): WatchlistReviewIssueSeed | undefined {
  const evidenceUrls = canonicalEvidenceUrls(card);
  if (!evidenceUrls.length) return undefined;
  const id = seedId(kind, view, card, missingEvidenceType);
  const labels: WatchlistReviewIssueSeed["labels"] = kind === "evidence"
    ? ["evidence-review", "needs-evidence"]
    : ["evidence-review", "correction"];
  const seed = {
    id, kind, companyId: card.companyId, companyName: card.companyName, thesisId: card.thesisId, thesisVersion: card.thesisVersion,
    missingEvidenceType, snapshotWeek: view.week, snapshotVersion: view.snapshotVersion, evidenceUrls, reviewTarget, publicContext,
    issueTitle: kind === "evidence"
      ? `[Watchlist 补证] ${card.companyName} · ${reviewTarget}`
      : `[Watchlist 纠错] ${card.companyName} · ${reviewTarget}`,
    labels,
  } as Omit<WatchlistReviewIssueSeed, "issueBody">;
  return { ...seed, issueBody: issueBody(seed) };
}

function earliestValidationPoint(card: WatchlistPublicCard): { text: string; dueAt: string } {
  return [...card.nextValidationPoints].sort((left, right) => codeUnit(left.dueAt, right.dueAt) || codeUnit(left.text, right.text))[0]!;
}

/**
 * Build an issue artifact solely from the current public Watchlist view.
 * No candidate, score, rank, unpublished evidence, or private review state is
 * accepted as an input to this boundary.
 */
export function buildWatchlistReviewIssueSeeds(view: WatchlistPublicView): WatchlistReviewIssueArtifact {
  if (!validateWatchlistPublicViewShape(view)) throw new Error("Watchlist 公开视图结构不合法；拒绝生成 Review Issue 种子");
  assertNoPrivateWatchlistContent(view);
  const seeds: WatchlistReviewIssueSeed[] = [];
  for (const card of [...view.forwardRadar, ...view.validatedMomentum]) {
    if (card.capital.status === "evidence-insufficient") {
      const seed = createSeed("evidence", view, card, "capital-evidence", "资本信息的一手公开证据", card.capital.summary);
      if (seed) seeds.push(seed);
    } else {
      const validation = earliestValidationPoint(card);
      const seed = createSeed("evidence", view, card, "next-validation-point", `下一验证点：${validation.text}`, `当前公开验证点截至 ${validation.dueAt}`);
      if (seed) seeds.push(seed);
    }
    if (card.lifecycle === "downgraded") {
      const seed = createSeed("correction", view, card, "current-thesis-downgraded", "当前公开判断已降级", `当前公开生命周期：${card.lifecycleLabel}`);
      if (seed) seeds.push(seed);
    }
  }
  const sorted = seeds.sort((left, right) => codeUnit(left.kind, right.kind)
    || codeUnit(left.companyId, right.companyId)
    || codeUnit(left.thesisId, right.thesisId)
    || codeUnit(left.missingEvidenceType, right.missingEvidenceType));
  const ids = new Set<string>();
  for (const seed of sorted) {
    if (ids.has(seed.id)) throw new Error(`Watchlist Review Issue 种子 ID 重复：${seed.id}`);
    ids.add(seed.id);
  }
  const artifact: WatchlistReviewIssueArtifact = { schemaVersion: 1, week: view.week, snapshotVersion: view.snapshotVersion, seeds: sorted };
  if (!validateWatchlistReviewIssueArtifact(artifact)) throw new Error("Watchlist Review Issue 种子结构不合法");
  return artifact;
}

/** Strict runtime schema for the public artifact consumed by Issue automation. */
export function validateWatchlistReviewIssueArtifact(value: unknown): value is WatchlistReviewIssueArtifact {
  if (!object(value) || !exactKeys(value, REVIEW_ARTIFACT_KEYS) || value.schemaVersion !== 1
    || !string(value.week) || !/^\d{4}-W\d{2}$/.test(value.week)
    || !Number.isInteger(value.snapshotVersion) || (value.snapshotVersion as number) < 1
    || !Array.isArray(value.seeds)) return false;
  const ids = new Set<string>();
  let previous: WatchlistReviewIssueSeed | undefined;
  for (const seed of value.seeds) {
    if (!object(seed) || !exactKeys(seed, REVIEW_SEED_KEYS)
      || !string(seed.id) || (seed.kind !== "evidence" && seed.kind !== "correction")
      || !string(seed.companyId) || !string(seed.companyName) || !string(seed.thesisId)
      || !Number.isInteger(seed.thesisVersion) || (seed.thesisVersion as number) < 1
      || !string(seed.missingEvidenceType) || seed.snapshotWeek !== value.week || seed.snapshotVersion !== value.snapshotVersion
      || !Array.isArray(seed.evidenceUrls) || !seed.evidenceUrls.length || !seed.evidenceUrls.every(https)
      || !string(seed.reviewTarget) || !string(seed.publicContext) || !string(seed.issueTitle) || !string(seed.issueBody)
      || !Array.isArray(seed.labels) || seed.labels.length !== 2 || seed.labels[0] !== "evidence-review"
      || seed.labels[1] !== (seed.kind === "evidence" ? "needs-evidence" : "correction")
      || !seed.issueBody.includes(seedMarker(seed.id))
      || ids.has(seed.id)) return false;
    const typed = seed as unknown as WatchlistReviewIssueSeed;
    if (typed.id !== stableSeedId(typed.kind, typed.snapshotWeek, typed.snapshotVersion, typed.companyId, typed.thesisId, typed.thesisVersion, typed.missingEvidenceType)) return false;
    if (previous && (codeUnit(previous.kind, typed.kind) > 0
      || (previous.kind === typed.kind && (codeUnit(previous.companyId, typed.companyId) > 0
        || (previous.companyId === typed.companyId && (codeUnit(previous.thesisId, typed.thesisId) > 0
          || (previous.thesisId === typed.thesisId && codeUnit(previous.missingEvidenceType, typed.missingEvidenceType) > 0))))))) return false;
    ids.add(seed.id);
    previous = typed;
  }
  try { assertNoPrivateWatchlistContent(value); } catch { return false; }
  return true;
}

/** Stage seeds alongside the snapshot in the caller's already-open transaction. */
export function stageWatchlistReviewIssueSeeds(input: { transaction: Pick<FileTransaction, "stage">; root: string; view: WatchlistPublicView }): WatchlistReviewIssueArtifact {
  const artifact = buildWatchlistReviewIssueSeeds(input.view);
  input.transaction.stage(join(input.root, "review", "watchlist-issue-seeds.json"), `${JSON.stringify(artifact, null, 2)}\n`);
  return artifact;
}

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

export function formatHomepageStatus(metrics: ProjectMetrics, companyProfiles: number, researchPool: number): string {
  const quality = metrics.publicContent.evidenceABRatio === undefined ? "样本积累中" : `${Math.round(metrics.publicContent.evidenceABRatio * 100)}%`;
  const coverage = metrics.digest.calendarCoverageRate === undefined ? "样本积累中" : `${Math.round(metrics.digest.calendarCoverageRate * 100)}%`;
  const observedSuccess = metrics.digest.successRate === undefined ? "样本积累中" : `${Math.round(metrics.digest.successRate * 100)}%`;
  return [
    "| 最近刷新 | 可追溯产业事件 | 公司档案 | 30 天论文池 | 已启用 / 观察信源 |",
    "| --- | ---: | ---: | ---: | ---: |",
    `| ${metrics.updatedAt.slice(0, 10)} | ${metrics.publicContent.homepageEffectiveItems} | ${companyProfiles} | ${researchPool} | ${metrics.flywheel.enabledSources} / ${metrics.flywheel.observedSources} |`,
    "",
    `**运行健康**：近 30 天日历覆盖 ${metrics.digest.observedRuns}/${metrics.digest.expectedRuns}（${coverage}） · 已归档运行成功 ${metrics.digest.successfulRuns}/${metrics.digest.observedRuns}（${observedSuccess}） · A/B 级证据比例 ${quality} · [查看 Actions](https://github.com/mbabby/physical-ai-news-cn/actions) · [信源健康分](resources/source-network.md) · [候选 Review](review/cases.md)`,
  ].join("\n");
}

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
  const effectiveItems = events.filter((event) => {
    const eventDate = publicEventDate(event);
    return eventDate ? new Date(eventDate).getTime() >= since : false;
  }).length;
  const reviewCandidates = recent.flatMap((archive) => archive.candidates ?? []).filter((item) => item.stage !== "不适合公开资讯" && item.sourceWeight >= 7 && zh(item.summaryZh)).length + companyCandidates.companies.filter((item) => item.status === "观察中" || item.status === "已交叉核验").length;
  return {
    updatedAt: now.toISOString(), windowDays,
    digest: {
      expectedRuns: windowDays,
      observedRuns: recent.length,
      successfulRuns: successful.length,
      successRate: rate(successful.length, recent.length),
      calendarCoverageRate: rate(recent.length, windowDays),
      calendarSuccessRate: rate(successful.length, windowDays),
    },
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
  const events = store.events.filter((event) => {
    const eventDate = publicEventDate(event);
    return publicEvent(event) && Boolean(eventDate) && new Date(eventDate!).getTime() >= since;
  });
  const funding = events.filter((event) => event.type === "投融资");
  const products = events.filter((event) => event.type === "产品发布" || event.type === "部署案例" || event.type === "公司商业");
  const papers = research.filter((record) => record.lastShownAt && new Date(record.lastShownAt).getTime() >= since && zh(record.article.titleZh) && zh(record.article.summaryZh) && record.status !== "待复核" && record.status !== "已撤稿").slice(0, 6);
  const lines = [`# 物理 AI 周报 · ${week}`, "", `> 截止 ${date(now.toISOString())}。只纳入主体明确、中文事实简介完整、且具 A/B 级非线索证据的公开条目。`, "", "## 新增事件", ""];
  lines.push(...(events.length ? events.map(eventLine) : ["- 本周暂无满足公开门槛的新增产业事件。"]));
  lines.push("", "## 融资与并购", "", ...(funding.length ? funding.map(eventLine) : ["- 本周暂无满足公开门槛的融资或并购事件。"]));
  lines.push("", "## 产品与部署", "", ...(products.length ? products.map(eventLine) : ["- 本周暂无满足公开门槛的产品或部署事件。"]));
  lines.push("", "## 研究前沿", "", ...(papers.length ? papers.map((record) => `- [${record.article.titleZh}](${record.article.link})：${record.article.summaryZh}`) : ["- 本周暂无完整中文研究卡进入公开周报。"]));
  const health = metrics.flywheel;
  lines.push("", "## 信源质量变化", "", `- 已启用 ${health.enabledSources} 个；观察 ${health.observedSources} 个；暂停 ${health.pausedSources} 个；达到晋升条件 ${health.promotedSources} 个。`, "", "## 项目指标", "", `- 日历覆盖：${metrics.digest.observedRuns}/${metrics.digest.expectedRuns}（${metrics.digest.calendarCoverageRate === undefined ? "样本不足" : `${Math.round(metrics.digest.calendarCoverageRate * 100)}%`}）；已归档运行成功：${metrics.digest.successfulRuns}/${metrics.digest.observedRuns}（${metrics.digest.successRate === undefined ? "样本不足" : `${Math.round(metrics.digest.successRate * 100)}%`}）`, `- 首页有效条目：${metrics.publicContent.homepageEffectiveItems}；A/B 级证据比例：${metrics.publicContent.evidenceABRatio === undefined ? "样本不足" : `${Math.round(metrics.publicContent.evidenceABRatio * 100)}%`}；公司档案覆盖：${metrics.publicContent.companyDossierCoverage} 家。`, "", "## 待验证候选", "", `- 有 ${metrics.flywheel.reviewCandidates} 条高质量候选停留在 Review 队列；它们不会进入首页或本周结论，欢迎补充官网、投资方公告、第二独立来源或论文元数据。`, "", "---", "", "*GitHub Star、访问量与来源需要另行授权 GitHub Traffic API；未配置时不会以 0 展示。*", "");
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
  lines.push(...(companies.length ? companies.map((company) => `- **${company.name}** · ${company.status} · 需要：${company.openQuestions.join("；")} · [提交公司或融资证据](../../issues/new/choose)`) : ["- 暂无达到社区复核阈值的公司候选。"]));
  lines.push("", "## 待补事件证据", "", ...(deduped.length ? deduped.map((article) => `- [${article.titleZh ?? article.title}](${article.link}) · ${article.stage}：${article.holdReasons.join("；")} · [提交补充证据](../../issues/new/choose)`) : ["- 暂无达到社区复核阈值的事件候选。"]));
  lines.push("", "## 待评估信源", "", ...(sources.length ? sources.map((source) => `- **${source.domain}** · 连续成功 ${source.successfulRuns} 次 · 样例：[${source.title}](${source.link}) · [提交信源建议](../../issues/new/choose)`) : ["- 暂无达到复核阈值的候选信源。"]));
  lines.push("", "## 如何贡献", "", "1. 选择 Issue 类型：公司/融资、产品/部署、论文、信源或事实纠错。", "2. 提供原始链接、主体名称、发生时间与简短中文事实说明。", "3. 线索链接本身不足以入库；融资优先公司或投资方公告，或两家独立媒体交叉确认。", "");
  return lines.join("\n");
}

/**
 * Convert private candidates into deterministic, evidence-first Issue seeds.
 * This deliberately does not create GitHub Issues itself: the generated JSON
 * is auditable, and the optional manual workflow de-duplicates before posting.
 */
export function buildCommunityReviewSeeds(
  archives: DailyArchive[], candidateCompanies: CandidateCompanyRegistry, candidateSources: CandidateSourceRegistry | undefined,
): CommunityReviewSeed[] {
  const articleSeeds = archives.flatMap((archive) => archive.candidates ?? [])
    .filter((article) => article.stage !== "不适合公开资讯" && article.sourceWeight >= 7 && zh(article.summaryZh))
    .filter((article, index, all) => all.findIndex((item) => item.link === article.link) === index)
    .map((article): CommunityReviewSeed => {
      const companyOrFunding = article.kind === "投融资" || article.stage === "待公司主体确认";
      const category = companyOrFunding ? "公司/融资" : article.kind === "研究与数据" ? "论文" : "产品/部署";
      const issueTemplate = category === "公司/融资" ? "company-funding.yml" : category === "论文" ? "research.yml" : "product-deployment.yml";
      const title = article.titleZh ?? article.title;
      const missing = article.holdReasons.join("；") || "需要补充原始事实证据";
      return {
        id: `article-${article.id}`, priority: article.sourceWeight >= 9 ? "高" : "常规", category, title, evidenceLink: article.link, missingEvidence: missing, issueTemplate,
        issueTitle: `[复核] ${title.slice(0, 72)}`,
        issueBody: `<!-- review-seed:article-${article.id} -->\n\n候选链接：${article.link}\n\n待补证据：${missing}\n\n中文线索说明：${article.summaryZh}\n\n请补充公司/实验室主体、发生日期，以及官网、投资方公告或第二独立来源。`,
      };
    });
  const companySeeds = candidateCompanies.companies.filter((company) => company.status === "观察中" || company.status === "已交叉核验").map((company): CommunityReviewSeed => ({
    id: `company-${company.id}`, priority: company.status === "已交叉核验" ? "高" : "常规", category: "公司/融资", title: company.name,
    evidenceLink: company.evidence[0]?.link ?? company.officialUrl ?? "", missingEvidence: company.openQuestions.join("；") || "需要补充主体或融资一手证据", issueTemplate: "company-funding.yml",
    issueTitle: `[复核] ${company.name} 公司 / 融资证据`,
    issueBody: `<!-- review-seed:company-${company.id} -->\n\n候选主体：${company.name}\n\n现有证据：${company.evidence.map((item) => item.link).join("\n") || "暂无"}\n\n待补证据：${company.openQuestions.join("；") || "主体或融资一手证据"}\n\n请提供官网、投资方公告或两个独立来源。`,
  }));
  const sourceSeeds = (candidateSources?.sources ?? []).filter((source) => source.successfulRuns >= 2 && Boolean(source.feedUrl)).map((source): CommunityReviewSeed => ({
    id: `source-${source.domain}`, priority: source.successfulRuns >= 5 ? "高" : "常规", category: "信源", title: source.domain,
    evidenceLink: source.link, missingEvidence: "需要确认来源性质、RSS/Atom 稳定性与事实证据边界", issueTemplate: "source.yml",
    issueTitle: `[复核] 信源 ${source.domain}`,
    issueBody: `<!-- review-seed:source-${source.domain} -->\n\n候选信源：${source.link}\n\n已连续成功抓取：${source.successfulRuns} 次\n\n建议补充：官方 RSS/Atom/Releases 地址、物理 AI 样例，以及应作为事实源还是线索源。`,
  }));
  return [...companySeeds, ...articleSeeds, ...sourceSeeds]
    .filter((seed) => /^https?:\/\//.test(seed.evidenceLink))
    .sort((a, b) => (a.priority === b.priority ? a.category.localeCompare(b.category) || a.title.localeCompare(b.title) : a.priority === "高" ? -1 : 1))
    .slice(0, 20);
}
