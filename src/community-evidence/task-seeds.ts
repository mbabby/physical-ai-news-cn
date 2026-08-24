import { createHash } from "node:crypto";
import { derivePublication } from "../facts-contract.js";
import type { ResearchDecisionCard } from "../research-decision-card.js";
import type { CandidateCompany, CandidateCompanyRegistry, EventRecord, EventStore, ResearchRecord } from "../types.js";
import {
  assertEvidenceTaskSeedArtifact,
  buildEvidenceTaskId,
  type EvidenceSubject,
  type EvidenceTargetField,
  type EvidenceTaskCategory,
  type EvidenceTaskSeed,
  type EvidenceTaskSeedArtifact,
} from "./contracts.js";

export interface BuildEvidenceTaskSeedsInput {
  generatedAt: string;
  generatedWeek: string;
  companyCandidates: CandidateCompanyRegistry;
  events: EventStore;
  researchRecords: ResearchRecord[];
  researchCards: ResearchDecisionCard[];
}

export const targetPriority: Record<EvidenceTaskCategory, EvidenceTargetField[]> = {
  "company-funding": ["company.officialUrl", "funding.regulatoryFiling", "funding.amount", "funding.round", "funding.valuation", "funding.investors", "company.officialName"],
  "product-deployment": ["product.officialUrl", "deployment.customer", "deployment.scale", "deployment.location", "product.releaseDate"],
  "research-metadata": ["research.codeUrl", "research.weightsUrl", "research.datasetUrl", "research.realRobotEvidence", "research.institutions"],
};

const CHINESE_ABSENCE = /(?:未|无)(?:融资|部署|代码)|(?:暂未|尚未|仍未|迄今未|尚无|暂无|没有|不存在|缺少|缺乏|未公开|未发布|未提供|未进行|未曾)[^，。；\n]{0,12}(?:融资|部署|代码)|(?:融资|部署|代码)[^，。；\n]{0,12}(?:暂未|尚未|仍未|尚无|暂无|没有|不存在|并不存在|并未|未曾|缺少|缺乏)(?:发生|完成|存在|发布|公开|提供|落地|实现|进行)?/i;
const ENGLISH_ABSENCE = /\b(?:no|without|not|never|lack(?:s|ed|ing)?|absence|absent|unavailable|missing|(?:has|have|had|is|are|was|were|does|do|did)n['’]t)\b.{0,40}\b(?:funding|financ(?:ing|ed)?|deploy(?:ment|ed)?|code)\b|\b(?:funding|financ(?:ing|ed)?|deploy(?:ment|ed)?|code)\b.{0,40}\b(?:not|never|lack(?:s|ed|ing)?|absence|absent|unavailable|missing|(?:has|have|had|is|are|was|were|does|do|did)n['’]t)\b/i;
const TERMINAL_EVIDENCE_STATES = new Set(["rejected", "conflicted", "withdrawn"]);
const INTERNAL_REVIEW_URL = /https:\/\/[^\s"']*(?:\/|%2f|=)review(?:\/|%2f|[?#&]|$)/i;
const REPLY_TEMPLATE = "证据链接：\n证据摘录：\n来源类型：";

const fieldCopy: Record<EvidenceTargetField, {
  label: string;
  suggestedLocations: string[];
  qualifiedEvidenceZh: string[];
  disqualifiedEvidenceZh: string[];
}> = {
  "company.officialName": copy("公司官方名称", ["公司官网", "监管披露"], ["公司或监管机构公开的法定主体名称"], ["无来源的名称聚合页"]),
  "company.officialUrl": copy("公司官网", ["公司官方社交账号", "监管披露"], ["公司或监管机构链接的官方网站"], ["搜索结果页或未验证的同名网站"]),
  "funding.round": copy("融资轮次", ["公司新闻稿", "投资方公告"], ["公司或投资方明确披露的融资轮次"], ["仅引用其他媒体的聚合摘要"]),
  "funding.amount": copy("融资金额", ["公司新闻稿", "投资方公告"], ["公司、投资方或监管文件明确披露的金额"], ["没有原始链接的金额转述"]),
  "funding.valuation": copy("融资估值", ["公司新闻稿", "监管披露"], ["公司或监管文件明确披露的估值"], ["根据融资金额自行推算的估值"]),
  "funding.investors": copy("投资方", ["公司新闻稿", "投资方公告"], ["公司或投资方公告中的投资者名单"], ["未经当事方确认的名单"]),
  "funding.regulatoryFiling": copy("融资监管披露", ["公司注册地监管数据库", "监管披露"], ["可公开核验的监管备案或披露"], ["需要登录的截图或无永久链接的转述"]),
  "product.officialUrl": copy("产品官方页面", ["公司官网", "官方产品文档"], ["公司发布的产品页或技术文档"], ["经销商或聚合站页面"]),
  "product.releaseDate": copy("产品发布日期", ["公司新闻稿", "官方发布记录"], ["带明确发布日期的官方发布记录"], ["抓取日期或搜索结果日期"]),
  "deployment.customer": copy("部署客户", ["公司新闻稿", "客户公告"], ["客户或供应方明确点名的部署公告"], ["演示视频或未点名的合作线索"]),
  "deployment.location": copy("部署地点", ["公司新闻稿", "客户公告"], ["客户或供应方明确披露的部署地点"], ["根据公司总部自行推测的地点"]),
  "deployment.scale": copy("部署规模", ["公司新闻稿", "客户公告"], ["明确披露设备数量、站点数或运行范围的公告"], ["把试点或演示描述为规模化部署"]),
  "research.codeUrl": copy("代码仓库", ["论文项目页", "作者机构主页"], ["作者或机构发布的公开代码仓库"], ["论文中的未来开源承诺"]),
  "research.datasetUrl": copy("数据集地址", ["论文项目页", "数据仓库"], ["作者发布且可访问的数据集页面"], ["仅提到数据集名称的二手页面"]),
  "research.weightsUrl": copy("模型权重地址", ["论文项目页", "模型仓库"], ["作者发布且可访问的模型权重页面"], ["论文中的未来发布承诺"]),
  "research.realRobotEvidence": copy("真实机器人实验", ["论文正文", "论文项目页"], ["论文正文或补充材料中的真实机器人实验说明"], ["仿真实验或没有方法说明的演示视频"]),
  "research.institutions": copy("作者机构", ["OpenAlex", "作者机构主页"], ["论文、机构主页或学术索引中的作者机构元数据"], ["根据邮箱域名猜测的机构"]),
};

function copy(label: string, suggestedLocations: string[], qualifiedEvidenceZh: string[], disqualifiedEvidenceZh: string[]) {
  return { label, suggestedLocations: sorted(suggestedLocations), qualifiedEvidenceZh: sorted(qualifiedEvidenceZh), disqualifiedEvidenceZh: sorted(disqualifiedEvidenceZh) };
}

function sorted(values: string[]): string[] {
  return [...new Set(values)].sort(compareStrings);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizedName(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function publicCompanySubjectId(name: string, aliases: readonly string[]): string {
  const canonicalAlias = aliases.map(normalizedName).find(Boolean) ?? name;
  const identity = `name:${canonicalAlias.toLocaleLowerCase("en-US")}`;
  const digest = createHash("sha256").update(`company\n${identity}`).digest("hex").slice(0, 24);
  return `company-${digest}`;
}

function canonicalHttps(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) return undefined;
    const normalized = url.toString();
    if (INTERNAL_REVIEW_URL.test(normalized)) return undefined;
    return normalized;
  } catch {
    return undefined;
  }
}

function references(values: Array<string | undefined>): string[] {
  return sorted(values.flatMap((value) => canonicalHttps(value) ?? [])).slice(0, 3);
}

function hasUnsupportedNegative(values: readonly string[]): boolean {
  return values.some((value) => CHINESE_ABSENCE.test(value) || ENGLISH_ABSENCE.test(value));
}

function singlePriorityGap(category: EvidenceTaskCategory, gaps: ReadonlySet<EvidenceTargetField>): EvidenceTargetField | undefined {
  if (gaps.size !== 1) return undefined;
  return targetPriority[category].find((field) => gaps.has(field));
}

function questionGaps(category: "company-funding" | "product-deployment", questions: readonly string[]): Set<EvidenceTargetField> {
  const patterns: Array<[EvidenceTargetField, RegExp]> = category === "company-funding"
    ? [
      ["company.officialUrl", /官网|官方网站|official\s*(?:site|url)/i],
      ["funding.regulatoryFiling", /监管|备案|工商披露|regulatory|filing/i],
      ["funding.amount", /金额|amount/i],
      ["funding.round", /轮次|round/i],
      ["funding.valuation", /估值|valuation/i],
      ["funding.investors", /投资方|投资人|investor/i],
      ["company.officialName", /官方名称|法定名称|工商主体|公司全称|official name|legal name/i],
    ]
    : [
      ["product.officialUrl", /产品(?:官方)?(?:官网|页面)|官方产品|official\s*(?:product|url)/i],
      ["deployment.customer", /客户|customer/i],
      ["deployment.scale", /规模|数量|站点|scale/i],
      ["deployment.location", /地点|位置|工厂|location/i],
      ["product.releaseDate", /发布日期|发布时间|release date/i],
    ];
  return new Set(patterns.filter(([, pattern]) => questions.some((question) => pattern.test(question))).map(([field]) => field));
}

function materialVersion(category: EvidenceTaskCategory, subject: EvidenceSubject, targetField: EvidenceTargetField, referenceUrls: string[], material: unknown): string {
  const digest = createHash("sha256")
    .update(JSON.stringify({ category, subject: { kind: subject.kind, id: subject.id }, targetField, referenceUrls, material }))
    .digest("hex")
    .slice(0, 20);
  return `v-${digest}`;
}

function seed(category: EvidenceTaskCategory, subject: EvidenceSubject, targetField: EvidenceTargetField, referenceUrls: string[], generatedWeek: string, material: unknown): EvidenceTaskSeed {
  const copy = fieldCopy[targetField];
  const version = materialVersion(category, subject, targetField, referenceUrls, material);
  return {
    id: buildEvidenceTaskId(subject, targetField, version),
    version: 1,
    category,
    subject,
    targetField,
    contextZh: `${subject.name} 的${copy.label}仍待可追溯公开证据确认。`,
    referenceUrls,
    suggestedLocations: copy.suggestedLocations,
    qualifiedEvidenceZh: copy.qualifiedEvidenceZh,
    disqualifiedEvidenceZh: copy.disqualifiedEvidenceZh,
    replyTemplateZh: REPLY_TEMPLATE,
    estimatedMinutes: 2,
    generatedWeek,
    materialVersion: version,
    supersedesTaskId: null,
  };
}

function companySeed(candidate: CandidateCompany, generatedWeek: string): EvidenceTaskSeed | undefined {
  const lifecycle = (candidate as CandidateCompany & { evidenceState?: string }).evidenceState;
  const hasWithdrawnEvidence = candidate.evidence.some((item) => Boolean((item as typeof item & { withdrawn?: boolean }).withdrawn));
  if ((candidate.status !== "观察中" && candidate.status !== "已交叉核验") || TERMINAL_EVIDENCE_STATES.has(lifecycle ?? "") || hasWithdrawnEvidence) return undefined;
  const subjectName = normalizedName(candidate.name);
  if (!subjectName || hasUnsupportedNegative(candidate.openQuestions)) return undefined;
  const officialUrl = canonicalHttps(candidate.officialUrl);
  const publicReferences = references([
    officialUrl,
    ...candidate.evidence.map((item) => item.link),
  ]);
  if (!publicReferences.length) return undefined;
  const gaps = questionGaps("company-funding", candidate.openQuestions);
  if (!officialUrl) gaps.add("company.officialUrl");
  const targetField = singlePriorityGap("company-funding", gaps);
  if (!targetField) return undefined;
  const subject: EvidenceSubject = { kind: "company", id: publicCompanySubjectId(subjectName, candidate.aliases), name: subjectName, url: officialUrl ?? publicReferences[0]! };
  return seed("company-funding", subject, targetField, publicReferences, generatedWeek, { openQuestions: sorted(candidate.openQuestions) });
}

function eventSeed(event: EventRecord, generatedWeek: string): EvidenceTaskSeed | undefined {
  const lifecycle = (event as EventRecord & { evidenceState?: string }).evidenceState;
  const activeEvidence = event.evidence.filter((item) => !(item as typeof item & { withdrawn?: boolean }).withdrawn);
  const subjectName = normalizedName(event.title);
  const publication = derivePublication({ evidence: event.evidence, evidenceState: lifecycle as "rejected" | "conflicted" | "withdrawn" | undefined });
  if (!event.productDeployment || !event.id.trim() || !subjectName || !event.primaryEntity?.trim()
    || (event.status !== "已确证" && event.status !== "持续跟踪") || !publication.publicEligible
    || TERMINAL_EVIDENCE_STATES.has(lifecycle ?? "") || activeEvidence.length !== event.evidence.length) return undefined;
  if (hasUnsupportedNegative([...event.facts, ...event.openQuestions])) return undefined;
  const publicReferences = references(activeEvidence.filter((item) => item.grade === "A" || item.grade === "B").map((item) => item.link));
  if (!publicReferences.length) return undefined;
  const gaps = questionGaps("product-deployment", event.openQuestions);
  if (!event.productDeployment.customers.length) gaps.add("deployment.customer");
  if (!event.occurredAt && !event.eventDate) gaps.add("product.releaseDate");
  const targetField = singlePriorityGap("product-deployment", gaps);
  if (!targetField) return undefined;
  const subject: EvidenceSubject = { kind: "event", id: event.id.trim(), name: subjectName, url: publicReferences[0]! };
  return seed("product-deployment", subject, targetField, publicReferences, generatedWeek, {
    openQuestions: sorted(event.openQuestions),
    productDeployment: {
      product: event.productDeployment.product,
      customers: sorted(event.productDeployment.customers),
      deployment: event.productDeployment.deployment,
    },
  });
}

function unknown(value: { value: unknown }): boolean {
  return value.value === "unknown";
}

function researchSeed(record: ResearchRecord, card: ResearchDecisionCard, generatedWeek: string): EvidenceTaskSeed | undefined {
  const subjectName = normalizedName(record.article.titleZh ?? record.article.title);
  if (record.status === "已撤稿" || record.status === "待复核" || card.openAlex.retraction.value === true) return undefined;
  if (card.identity.paperId.value !== record.id || !record.id.trim() || !subjectName || hasUnsupportedNegative([record.article.title, record.article.excerpt])) return undefined;
  const publicReferences = references([
    record.article.link,
    ...Object.values(card.fieldEvidence).flat(),
  ]);
  if (!publicReferences.length) return undefined;
  const gaps = new Set<EvidenceTargetField>();
  if (unknown(card.artifacts.code)) gaps.add("research.codeUrl");
  if (unknown(card.artifacts.weights)) gaps.add("research.weightsUrl");
  if (unknown(card.artifacts.data)) gaps.add("research.datasetUrl");
  if (unknown(card.realRobotTrials)) gaps.add("research.realRobotEvidence");
  if (unknown(card.lab)) gaps.add("research.institutions");
  const targetField = singlePriorityGap("research-metadata", gaps);
  if (!targetField) return undefined;
  const articleUrl = canonicalHttps(record.article.link);
  if (!articleUrl) return undefined;
  const subject: EvidenceSubject = { kind: "research", id: record.id.trim(), name: subjectName, url: articleUrl };
  return seed("research-metadata", subject, targetField, publicReferences, generatedWeek, { factHash: record.factHash });
}

/** Build a deterministic public artifact containing only safe one-field gaps. */
export function buildEvidenceTaskSeeds(input: BuildEvidenceTaskSeedsInput): EvidenceTaskSeedArtifact {
  const cards = new Map(input.researchCards.flatMap((card) => card.identity.paperId.value === "unknown" ? [] : [[card.identity.paperId.value, card] as const]));
  const seeds = [
    ...input.companyCandidates.companies.flatMap((candidate) => companySeed(candidate, input.generatedWeek) ?? []),
    ...input.events.events.flatMap((event) => eventSeed(event, input.generatedWeek) ?? []),
    ...input.researchRecords.flatMap((record) => {
      const card = cards.get(record.id);
      return card ? researchSeed(record, card, input.generatedWeek) ?? [] : [];
    }),
  ].sort((left, right) => compareStrings(left.category, right.category)
    || compareStrings(left.subject.name, right.subject.name)
    || compareStrings(left.targetField, right.targetField)
    || compareStrings(left.id, right.id));
  const artifact: EvidenceTaskSeedArtifact = { schemaVersion: 1, generatedAt: input.generatedAt, generatedWeek: input.generatedWeek, seeds };
  assertEvidenceTaskSeedArtifact(artifact);
  return artifact;
}
