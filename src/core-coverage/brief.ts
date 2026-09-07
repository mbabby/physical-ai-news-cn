import { createHash } from "node:crypto";
import { projectCanonicalCompanyClaimFields } from "../company-claim-ledger.js";
import type { CompanyClaimLedger } from "../company-claim-ledger.js";
import { canonicalCompanyId, canonicalCompanyOwner } from "../company-event-ownership.js";
import type { CompanyProfile, EventRecord } from "../types.js";
import type { AnalysisStatement, CoverageBrief, CoverageKnownFact, CoverageVersion } from "./contracts.js";
import { projectCoreCoverageEventDates, projectCoreCoverageTimeline } from "./timeline.js";

const UNKNOWN = "unknown" as const;
const FIELD_LABELS = {
  eventDate: "事件日期", round: "轮次", amount: "金额", valuation: "估值", investors: "投资方",
  product: "产品/研究产出", customer: "客户", deployment: "部署", productionStage: "验证阶段",
} as const;
type FieldKey = keyof typeof FIELD_LABELS;
const CAPITAL_FIELDS: FieldKey[] = ["round", "amount", "valuation", "investors"];
const PRODUCT_FIELDS: FieldKey[] = ["product"];
const DEPLOYMENT_FIELDS: FieldKey[] = ["deployment", "customer", "productionStage"];
const unique = (values: string[]): string[] => [...new Set(values)].sort();

export interface AnalysisTemplateInput {
  ledger: CompanyClaimLedger;
  events: readonly EventRecord[];
  now: Date;
  companies?: readonly CompanyProfile[];
}

function ledgerProfiles(ledger: CompanyClaimLedger): CompanyProfile[] {
  return ledger.companies.map((entry) => ({ entityId: entry.companyId, name: entry.companyName, officialUrl: "", region: "", routes: [], thesis: "" }));
}

/** Check ownership before the shared timeline revalidates each field's current proof. */
function boundLedger(input: AnalysisTemplateInput): CompanyClaimLedger {
  const companies = input.companies ?? ledgerProfiles(input.ledger);
  const events = new Map(input.events.map((event) => [event.id, event]));
  const duplicateEventIds = new Set(input.events.filter((event, index) => input.events.findIndex((other) => other.id === event.id) !== index).map((event) => event.id));
  const allClaims = input.ledger.companies.flatMap((entry) => entry.claims);
  const duplicateClaimIds = new Set(allClaims.filter((claim, index) => allClaims.findIndex((other) => other.claimId === claim.claimId) !== index).map((claim) => claim.claimId));
  return { ...input.ledger, companies: input.ledger.companies.map((entry) => ({ ...entry, claims: entry.claims.filter((claim) => {
    const profile = companies.find((company) => canonicalCompanyId(company) === entry.companyId);
    return profile && claim.companyId === entry.companyId && !duplicateClaimIds.has(claim.claimId)
      // Canonical company claims are one event per claim; merged event lists can launder dates/proof.
      && claim.eventIds.length === 1 && claim.eventIds.every((id) => {
        const event = events.get(id);
        return event && !duplicateEventIds.has(id) && canonicalCompanyOwner(companies, event.primaryEntity) === entry.companyId
          && (profile.entityType !== "实验室" || event.type === "研究与数据");
      });
  }) })) };
}

function validTimestamp(value: string | undefined, now: Date): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return undefined;
  const day = value.slice(0, 10);
  const calendar = new Date(`${day}T00:00:00Z`);
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00+08:00` : value);
  if (!Number.isFinite(calendar.valueOf()) || calendar.toISOString().slice(0, 10) !== day || !Number.isFinite(parsed.valueOf()) || parsed > now) return undefined;
  return parsed.toISOString();
}

function fieldText(fact: Pick<CoverageKnownFact, "fields">, keys: FieldKey[]): string {
  return keys.flatMap((key) => {
    const field = fact.fields[key];
    return field ? [`${FIELD_LABELS[key]}：${Array.isArray(field.value) ? field.value.join("、") : String(field.value)}`] : [];
  }).join("；");
}

function knownFacts(input: AnalysisTemplateInput): CoverageKnownFact[] {
  const ledger = boundLedger(input);
  const projection = projectCoreCoverageTimeline(ledger, input.events, input.now);
  const events = new Map(input.events.map((event) => [event.id, event]));
  return [...projection.historicalFunding, ...projection.currentFacts].map((fact) => {
    const evidenceIds = unique(Object.values(fact.fields).flatMap((field) => field?.evidenceIds ?? []));
    const urls = new Set(Object.values(fact.fields).flatMap((field) => field?.evidenceUrls ?? []));
    const claimEvents = fact.eventIds.flatMap((id) => events.get(id) ? [events.get(id)!] : []);
    const dates = claimEvents.map((event) => projectCoreCoverageEventDates(event, input.now, urls));
    const occurredOn = dates.map((date) => date.occurredOn).filter((date) => date !== UNKNOWN).sort().at(-1) ?? UNKNOWN;
    const publishedOn = dates.map((date) => date.publishedOn).filter((date) => date !== UNKNOWN).sort().at(-1) ?? UNKNOWN;
    const dateKind = occurredOn !== UNKNOWN ? "occurred" : publishedOn !== UNKNOWN ? "disclosed" : "unknown";
    const date = dateKind === "occurred" ? occurredOn : publishedOn;
    const materialChangeAt = claimEvents.flatMap((event) => validTimestamp(event.lastMaterialChangeAt, input.now) ?? []).sort().at(-1) ?? UNKNOWN;
    const summaryZh = `${dateKind === "occurred" ? "事件日期" : dateKind === "disclosed" ? "披露日期" : "日期待核验"}：${date}；${fieldText(fact, [...CAPITAL_FIELDS, ...PRODUCT_FIELDS, ...DEPLOYMENT_FIELDS])}`;
    return { claimId: fact.claimId, companyId: fact.companyId, claimType: fact.claimType, fields: structuredClone(fact.fields), eventIds: [...fact.eventIds], evidenceIds, summaryZh, occurredOn, publishedOn, date, dateKind, materialChangeAt, needsReview: fact.needsReview } satisfies CoverageKnownFact;
  }).sort((a, b) => a.companyId.localeCompare(b.companyId) || a.claimId.localeCompare(b.claimId));
}

function templatesFor(facts: CoverageKnownFact[]): AnalysisStatement[] {
  return facts.flatMap((fact) => {
    const template: AnalysisStatement["template"] = fact.claimType === "funding" ? "capital-resources"
      : ["deployment", "pilot", "production", "commercialization"].includes(fact.claimType) ? "deployment-validation" : "product-validation";
    const keys = template === "capital-resources" ? CAPITAL_FIELDS : template === "product-validation" ? PRODUCT_FIELDS : DEPLOYMENT_FIELDS;
    const text = fieldText(fact, keys);
    if (!text) return [];
    const content = template === "capital-resources" ? {
      textZh: `资金资源观察：已核验披露为${text}。这提供了追踪融资资源的事实依据。`,
      limitationZh: "融资披露不代表当前现金余额、收入或机器人专项预算；不同币种不直接相加，集团资本不归入本主体。",
      nextValidationZh: "核查后续融资公告、资金用途及机器人专项预算的直接披露。",
    } : template === "product-validation" ? {
      textZh: `产品与研究产出观察：已核验记录为${text}。可据此继续核查公开产出的验证条件。`,
      limitationZh: "产出记录不等于独立复现、客户部署或商业化；作者报告仍是作者报告。",
      nextValidationZh: "补充真实机器人测试条件、可复现材料和独立验证证据。",
    } : {
      textZh: `部署验证观察：已核验记录为${text}。可据此继续核查实际运行表现。`,
      limitationZh: "该记录不自动证明当前客户关系、可靠性、收入或规模化复制；历史事实不代表现状持续成立。",
      nextValidationZh: "核查部署持续时间、运行条件、客户确认与可追溯的运行指标。",
    };
    return [{ id: `core-analysis-${createHash("sha256").update(`${fact.companyId}\n${fact.claimId}\n${template}`).digest("hex").slice(0, 20)}`, template, ...content, claimIds: [fact.claimId], evidenceIds: unique(keys.flatMap((key) => fact.fields[key]?.evidenceIds ?? [])), status: "valid" as const }];
  });
}

/** Approved deterministic templates only; arbitrary prose must remain internal review input. */
export function buildApprovedAnalysisTemplates(input: AnalysisTemplateInput): AnalysisStatement[] {
  return templatesFor(knownFacts(input));
}

function validateAgainst(analyses: readonly AnalysisStatement[], templates: AnalysisStatement[]): AnalysisStatement[] {
  return analyses.map((analysis) => {
    const match = templates.some((expected) => expected.template === analysis.template
      && expected.textZh === analysis.textZh && expected.limitationZh === analysis.limitationZh && expected.nextValidationZh === analysis.nextValidationZh
      && JSON.stringify(expected.claimIds) === JSON.stringify(unique(analysis.claimIds))
      && JSON.stringify(expected.evidenceIds) === JSON.stringify(unique(analysis.evidenceIds))
      && analysis.claimIds.length === unique(analysis.claimIds).length && analysis.evidenceIds.length === unique(analysis.evidenceIds).length);
    return { ...structuredClone(analysis), status: match ? "valid" : "needs-review" };
  });
}

export function revalidateAnalyses(analyses: readonly AnalysisStatement[], ledger: CompanyClaimLedger, events: readonly EventRecord[]): AnalysisStatement[] {
  return validateAgainst(analyses, buildApprovedAnalysisTemplates({ ledger, events, now: new Date(ledger.generatedAt) }));
}

function identityEvidence(company: CompanyProfile | undefined, now: Date): CoverageBrief["identityEvidence"] {
  if (!company) return [];
  const hostname = (url: string): string | undefined => {
    try { const parsed = new URL(url); return parsed.protocol === "https:" && !parsed.username && !parsed.password ? parsed.hostname.toLowerCase().replace(/^www\./, "") : undefined; } catch { return undefined; }
  };
  const official = hostname(company.officialUrl);
  if (!official) return [];
  const domains = new Set([official, ...(company.officialDomains ?? []).flatMap((domain) => {
    const host = hostname(domain.includes("://") ? domain : `https://${domain}`);
    return host ? [host] : [];
  })]);
  return (company.profileEvidence ?? []).filter((proof) => {
    const host = hostname(proof.link);
    return host && [...domains].some((domain) => host === domain || host.endsWith(`.${domain}`))
      && validTimestamp(proof.checkedAt, now) && proof.source.trim()
      && [company.name, company.legalName, ...(company.aliases ?? [])].some((name) => name && proof.supports.normalize("NFKC").toLowerCase().includes(name.normalize("NFKC").toLowerCase()));
  }).map(({ link, source, checkedAt, supports }) => ({ link, source, checkedAt, supports }));
}

export function buildCoverageBriefs(input: AnalysisTemplateInput & { coverage: CoverageVersion; companies: readonly CompanyProfile[]; analyses: readonly AnalysisStatement[] }): CoverageBrief[] {
  const facts = knownFacts(input);
  const revalidated = validateAgainst(input.analyses, templatesFor(facts));
  return input.coverage.members.map((member) => {
    const profile = input.companies.find((company) => canonicalCompanyId(company) === member.companyId);
    const identity = identityEvidence(profile, input.now);
    const companyFacts = facts.filter((fact) => fact.companyId === member.companyId);
    const claimIds = companyFacts.map((fact) => fact.claimId);
    const analyses = revalidated.filter((analysis) => analysis.status === "valid" && analysis.claimIds.every((id) => claimIds.includes(id)));
    const materialEventIds = unique(companyFacts.flatMap((fact) => fact.eventIds));
    const reviewIssues: CoverageBrief["reviewIssues"] = (input.ledger.companies.find((entry) => entry.companyId === member.companyId)?.claims ?? [])
      .filter((claim) => claim.companyId === member.companyId).flatMap((claim): CoverageBrief["reviewIssues"] => {
        const events = input.events.filter((event) => claim.eventIds.includes(event.id)
          && canonicalCompanyOwner(input.companies, event.primaryEntity) === member.companyId);
        const conflicted = events.some((event) => (event as EventRecord & { evidenceState?: string }).evidenceState === "conflicted"
          || event.openQuestions.some((question) => /冲突|矛盾|不一致|conflict/i.test(question)));
        const withdrawn = events.some((event) => (event as EventRecord & { evidenceState?: string }).evidenceState === "withdrawn"
          || event.evidence.some((evidence) => (evidence as typeof evidence & { withdrawn?: boolean }).withdrawn));
        const fieldConflicts = unique(events.flatMap((event) => Object.entries(projectCanonicalCompanyClaimFields(event))
          .filter(([, field]) => field.status === "conflicted").map(([field]) => field))) as FieldKey[];
        return [
          ...(conflicted ? [{ claimId: claim.claimId, reason: "conflict" as const }] : fieldConflicts.map((fieldPath) => ({ claimId: claim.claimId, reason: "conflict" as const, fieldPath }))),
          ...(withdrawn ? [{ claimId: claim.claimId, reason: "withdrawn" as const }] : []),
        ];
      });
    const hasDatedAnalysis = analyses.some((analysis) => companyFacts.some((fact) => analysis.claimIds.includes(fact.claimId) && fact.date !== UNKNOWN));
    const gapsZh: string[] = [];
    if (!identity.length) gapsZh.push("缺少可追溯的官方主体身份证据。");
    if (!profile?.legalName || !identity.some((proof) => /法定|法人|legal|registered/i.test(proof.supports) && proof.supports.includes(profile.legalName!))) gapsZh.push("法定主体名称与法律归属尚缺专项证据核验。");
    gapsZh.push("经营地区与集团关系尚缺专项证据核验；覆盖地区是研究配额，不代表法律国籍或母子关系。");
    if (reviewIssues.some((issue) => issue.reason === "conflict")) gapsZh.push("部分事实存在证据冲突，关联字段与分析已暂停公开，等待复核。");
    if (reviewIssues.some((issue) => issue.reason === "withdrawn")) gapsZh.push("部分证据已撤回；未受影响的事实保留，关联字段与分析已重新核验。");
    if (!companyFacts.length) gapsZh.push("缺少满足门槛且归属于本主体的实质事件和直接字段证据。");
    if (profile?.entityType !== "实验室" && !companyFacts.some((fact) => fact.claimType === "funding")) gapsZh.push("融资证据不足，不代表未融资。");
    if (!companyFacts.some((fact) => fact.fields.product)) gapsZh.push("产品/研究产出字段证据不足。");
    if (!companyFacts.some((fact) => fact.fields.deployment)) gapsZh.push("部署字段证据不足，不代表没有部署。");
    if (!hasDatedAnalysis) gapsZh.push("缺少与有效中文分析对应的明确事件日期或已标注披露日期。");
    if (!analyses.length) gapsZh.push("缺少与当前核验事实一致的已批准中文分析。");
    if (companyFacts.some((fact) => fact.needsReview && fact.claimType !== "funding")) gapsZh.push("现状需更新核验：核验日期缺失、无效、在未来或已超过 30 个自然日；历史事实保留，不声明现状持续成立。");
    const timestamps = companyFacts.flatMap((fact) => fact.materialChangeAt === UNKNOWN ? [] : [fact.materialChangeAt]);
    return {
      companyId: member.companyId, completeness: identity.length && companyFacts.length && hasDatedAnalysis ? "complete" : "coverage-only",
      analyses, knownClaimIds: claimIds, materialEventIds, gapsZh,
      lastMaterialChangeAt: timestamps.sort().at(-1) ?? UNKNOWN,
      positioningZh: `研究覆盖定位：${member.reasonZh}`, identityEvidence: identity, reviewIssues, knownFacts: companyFacts,
      summaryZh: companyFacts.length ? companyFacts.map((fact) => fact.summaryZh).join("\n") : "当前证据不足以形成实质事件摘要。",
      nextValidationZh: unique(analyses.length ? analyses.map((analysis) => analysis.nextValidationZh) : ["补充本主体的官方身份、直接事件证据、明确日期与字段摘录，再进行分析复核。"]),
    } satisfies CoverageBrief;
  });
}
