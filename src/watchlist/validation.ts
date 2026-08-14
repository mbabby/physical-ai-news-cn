import { createHash } from "node:crypto";
import { derivePublication } from "../facts-contract.js";
import type { EvidenceState } from "../facts-contract.js";
import type { CompanyClaim, CompanyClaimLedger } from "../company-claim-ledger.js";
import type { CompanyProfile, EventRecord } from "../types.js";
import type { CompanyThesis, ThesisSensitiveBinding, ThesisSensitiveField } from "./contracts.js";
import { scheduleAtomId } from "./generator.js";
import type { CanonicalFactAtom, CompanyThesisDraft, FactAtomKind, ThesisSentenceCitation } from "./generator.js";
import type { ThesisSeed } from "./seeds.js";

const EXPIRY_MS = 60 * 24 * 60 * 60 * 1_000;
const CHINESE_PATTERN = /[\u3400-\u9fff]/;
const CONFLICT_PATTERN = /冲突|矛盾|待复核|待识别|待核验|待确认|未确认|主体不明|归属不明|撤回|撤销|withdrawn|conflict|unverified/i;
const PROHIBITED_INVESTMENT_LANGUAGE = /买入|卖出|目标价|投资建议|建议配置|推荐(?!算法|系统|模型|引擎|机制)|回报率|收益率|投资(?:收益|回报)|(?:预计|预期|预估|有望|或将|可能)(?:将)?(?:获得|实现|带来|产生|达到|取得)?(?:投资)?(?:收益|回报)|\bbuy\b|\bsell\b|target price|\breturns?\b/i;
const SENSITIVE_FIELDS = ["amount", "valuation", "customer", "revenue", "order"] as const;
const SENSITIVE_FIELD_SET = new Set<string>(SENSITIVE_FIELDS);

export type SensitiveField = ThesisSensitiveField;

export type ValidationIssueCode =
  | "unknown-company"
  | "company-mismatch"
  | "track-mismatch"
  | "missing-fact-reference"
  | "reference-outside-seed"
  | "missing-canonical-event"
  | "event-company-mismatch"
  | "single-b-momentum"
  | "conflicted-evidence"
  | "withdrawn-evidence"
  | "rejected-evidence"
  | "missing-chinese-copy"
  | "missing-validation-point"
  | "missing-falsifier"
  | "invalid-expiry"
  | "invalid-citation"
  | "uncited-sentence"
  | "citation-reference-outside-seed"
  | "unsupported-sentence-claim"
  | "unknown-sensitive-field"
  | "undeclared-sensitive-field"
  | "unverified-sensitive-field"
  | "prior-thesis-mismatch"
  | "no-material-change"
  | "prohibited-investment-language";

export interface ValidationIssue {
  code: ValidationIssueCode;
  message: string;
  path?: string;
}

export type SentenceCitation = ThesisSentenceCitation;

export interface ThesisValidationInput {
  draft: CompanyThesisDraft;
  seed: ThesisSeed;
  companies: CompanyProfile[];
  canonicalEvents: EventRecord[];
  claimLedger?: CompanyClaimLedger;
  priorThesis?: CompanyThesis;
}

export interface CitationCoverage {
  citedSentences: number;
  totalSentences: number;
  ratio: number;
}

export interface SensitiveFieldValidation {
  field: SensitiveField;
  verified: boolean;
  referenceIds: string[];
  valueDigest?: string;
}

export interface ThesisValidationResult {
  publishable: boolean;
  issues: ValidationIssue[];
  citationCoverage: CitationCoverage;
  sensitiveFields: SensitiveFieldValidation[];
  draftDigest: string;
}

type EventWithLifecycle = EventRecord & { evidenceState?: EvidenceState };
type EvidenceWithLifecycle = EventRecord["evidence"][number] & { withdrawn?: boolean };

interface DraftSentence {
  path: string;
  sentenceIndex: number;
  text: string;
}

export function thesisDraftDigest(draft: CompanyThesisDraft): string {
  const payload = {
    schemaVersion: 1,
    companyId: draft.companyId,
    track: draft.track,
    whyNow: draft.whyNow,
    routeAndDependencies: draft.routeAndDependencies,
    nextValidationPoints: draft.nextValidationPoints.map((point) => ({ text: point.text, dueAt: point.dueAt })),
    falsifiers: draft.falsifiers.map((falsifier) => ({ text: falsifier.text })),
    factReferenceIds: [...draft.factReferenceIds],
    inferenceLabels: [...draft.inferenceLabels],
    confidence: draft.confidence,
    generatedAt: draft.generatedAt,
    expiresAt: draft.expiresAt,
    modelVersion: draft.modelVersion,
    promptVersion: draft.promptVersion,
    methodologyVersion: draft.methodologyVersion,
    sentenceCitations: Array.isArray(draft.sentenceCitations)
      ? draft.sentenceCitations.map((citation) => ({
        path: citation.path,
        sentenceIndex: citation.sentenceIndex,
        text: citation.text,
        claimKind: citation.claimKind,
        referenceIds: [...citation.referenceIds],
        factAtomIds: [...citation.factAtomIds],
        sensitiveFields: [...citation.sensitiveFields],
      }))
      : null,
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function issue(code: ValidationIssueCode, message: string, path?: string): ValidationIssue {
  return path ? { code, message, path } : { code, message };
}

function validTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return false;
  const normalized = new Date(milliseconds).toISOString();
  return normalized === value || normalized === value.replace("Z", ".000Z");
}

function sentences(value: string): string[] {
  return value.match(/[^。！？!?]+[。！？!?]?/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [];
}

function draftSentences(draft: CompanyThesisDraft): DraftSentence[] {
  const fields: Array<{ path: string; text: string }> = [
    { path: "whyNow", text: draft.whyNow },
    { path: "routeAndDependencies", text: draft.routeAndDependencies },
    ...draft.nextValidationPoints.map((point, index) => ({ path: `nextValidationPoints.${index}`, text: point.text })),
    ...draft.falsifiers.map((falsifier, index) => ({ path: `falsifiers.${index}`, text: falsifier.text })),
  ];
  return fields.flatMap(({ path, text }) => sentences(text).map((sentence, sentenceIndex) => ({ path, sentenceIndex, text: sentence })));
}

function evidenceState(event: EventWithLifecycle): EvidenceState {
  return derivePublication({ evidence: event.evidence, evidenceState: event.evidenceState }).evidenceState;
}

function conflictIssues(event: EventWithLifecycle): ValidationIssue[] {
  const state = evidenceState(event);
  const issues: ValidationIssue[] = [];
  if (state === "conflicted") issues.push(issue("conflicted-evidence", `规范事件 ${event.id} 的证据存在冲突。`, event.id));
  if (state === "withdrawn") issues.push(issue("withdrawn-evidence", `规范事件 ${event.id} 的证据已撤回。`, event.id));
  if (state === "rejected") issues.push(issue("rejected-evidence", `规范事件 ${event.id} 的证据已拒绝。`, event.id));
  if (event.evidence.some((evidence) => (evidence as EvidenceWithLifecycle).withdrawn)
    && !issues.some((item) => item.code === "withdrawn-evidence")) {
    issues.push(issue("withdrawn-evidence", `规范事件 ${event.id} 包含已撤回证据。`, event.id));
  }
  if ([...event.openQuestions, event.title].some((value) => CONFLICT_PATTERN.test(value))
    && !issues.some((item) => item.code === "conflicted-evidence")) {
    issues.push(issue("conflicted-evidence", `规范事件 ${event.id} 包含未解决冲突。`, event.id));
  }
  if ((event.status === "待复核" || event.funding?.entityStatus === "待识别")
    && !issues.some((item) => item.code === "conflicted-evidence")) {
    issues.push(issue("conflicted-evidence", `规范事件 ${event.id} 尚未完成主体或事实复核。`, event.id));
  }
  return issues;
}

function hasMomentumProof(events: EventRecord[]): boolean {
  return derivePublication({ evidence: events.flatMap((event) => event.evidence) }).evidenceState === "confirmed";
}

function claimSupportsField(claim: CompanyClaim, field: SensitiveField): boolean {
  if (field === "amount" || field === "valuation") return claim.claimType === "funding";
  if (field === "customer") return ["pilot", "deployment", "commercialization"].includes(claim.claimType);
  return claim.claimType === "commercialization";
}

function eventContainsField(event: EventRecord, field: SensitiveField): boolean {
  if (field === "amount") return Boolean(event.funding?.amount);
  if (field === "valuation") return Boolean(event.funding?.valuation);
  if (field === "customer") return Boolean(event.productDeployment?.customers.length);
  const eventText = `${event.title} ${event.facts.join(" ")} ${event.productDeployment?.deployment ?? ""}`;
  return field === "revenue" ? /收入|营收|revenue/i.test(eventText) : /订单|order/i.test(eventText);
}

function claimEventIds(claim: CompanyClaim): string[] {
  return [...new Set(claim.evidenceIds.map((id) => id.replace(/:evidence:\d+$/, "")))];
}

function claimHasConflict(claim: CompanyClaim): boolean {
  return claim.unresolvedQuestions.some((question) => CONFLICT_PATTERN.test(question));
}

function detectedSensitiveFields(text: string, events: EventRecord[] = []): SensitiveField[] {
  const fields: SensitiveField[] = [];
  const canonicalAmounts = events.flatMap((event) => event.funding?.amount ? [event.funding.amount] : []);
  const canonicalValuations = events.flatMap((event) => event.funding?.valuation ? [event.funding.valuation] : []);
  const canonicalCustomers = events.flatMap((event) => event.productDeployment?.customers ?? []);
  if (/融资金额|funding amount|(?:融资|募资|融得|完成)[^。！？!?]{0,30}(?:元|美元|欧元|人民币)|(?:元|美元|欧元|人民币)[^。！？!?]{0,15}(?:融资|募资)/i.test(text)
    || canonicalAmounts.some((value) => text.includes(value))) fields.push("amount");
  if (/估值|valuation/i.test(text) || canonicalValuations.some((value) => text.includes(value))) fields.push("valuation");
  if (/客户\s*(?:包括|包含|为|是|：|:)|customer\s+(?:includes?|is|was|named)/i.test(text)
    || canonicalCustomers.some((customer) => text.includes(customer))) fields.push("customer");
  if (/收入|营收|revenue/i.test(text)) fields.push("revenue");
  if (/订单|\border(?:s|ed)?\b/i.test(text)) fields.push("order");
  return fields;
}

function canonicalEventText(event: EventRecord): string {
  const publication = derivePublication({ evidence: event.evidence });
  const qualifyingEvidenceIds = new Set(publication.qualifyingEvidenceIds);
  return [
    event.title,
    ...event.facts,
    event.occurredAt,
    event.eventDate,
    ...event.routes,
    event.funding?.round,
    event.funding?.amount,
    event.funding?.valuation,
    event.productDeployment?.product,
    ...(event.productDeployment?.customers ?? []),
    event.productDeployment?.deployment,
    ...event.evidence.filter((evidence) => qualifyingEvidenceIds.has(evidence.link)).map((evidence) => evidence.supports),
  ].filter((value): value is string => Boolean(value)).join(" ");
}

function materialTokens(text: string, prospectiveSchedule: boolean): string[] {
  const latinNames = text.match(/\b[A-Z][A-Za-z0-9-]*(?:\s+[A-Z][A-Za-z0-9-]*)*\b/g) ?? [];
  const chineseRelationshipNames = [
    ...text.matchAll(/向\s*([\u3400-\u9fff]{2,16})(?=\s*(?:交付|部署|销售|提供|试点))/g),
    ...text.matchAll(/(?:^|[：，。；\s])([\u3400-\u9fff]{2,16})(?=\s*(?:采用|订购|购买))/g),
    ...text.matchAll(/与\s*([\u3400-\u9fff]{2,16})(?=\s*(?:达成|建立|签署|开展|推进)?\s*(?:合作|伙伴|协议))/g),
  ].map((match) => match[1]!);
  return [...new Set([...latinNames, ...chineseRelationshipNames]
    .map((token) => token.trim()).filter((token) => token !== "AI"))];
}

function normalizedMaterial(value: string): string {
  return value.replace(/[\s,，]/g, "").toLowerCase();
}

function factAtomId(referenceId: string, kind: FactAtomKind, value: string): string {
  const digest = createHash("sha256").update(`${kind}\n${value}`).digest("hex").slice(0, 12);
  return `${referenceId}:atom:${kind}:${digest}`;
}

function actionValues(text: string): string[] {
  const actions: string[] = [];
  if (/融资|募资|funding/i.test(text)) actions.push("funding");
  if (/部署|试点|工厂|deployment|pilot|factory/i.test(text)) actions.push("deployment");
  if (/收购|并购|acquisition|acquire[sd]?/i.test(text)) actions.push("acquisition");
  if (/合作|伙伴|partner(?:ship)?|collaborat/i.test(text)) actions.push("partnership");
  if (/正式发布|推出|首发|\brelease[sd]?\b|\blaunch(?:ed)?\b/i.test(text)) actions.push("product-release");
  if (/论文|研究报告|研究论文|benchmark|\bresearch\b|\bpaper\b/i.test(text)) actions.push("research");
  if (/开源|open[- ]source/i.test(text)) actions.push("open-source");
  if (/量产|规模化生产|mass production/i.test(text)) actions.push("production");
  return [...new Set(actions)];
}

function chineseActionTargets(text: string): string[] {
  const matches = [
    ...text.matchAll(/(?:收购|并购)\s*([\u3400-\u9fff]{2,20})(?=[，。；、]|$)/g),
    ...text.matchAll(/(?:正式发布|推出|首发)\s*([\u3400-\u9fff]{2,20})(?=[，。；、]|$)/g),
    ...text.matchAll(/(?:发表|发布)\s*([\u3400-\u9fff]{2,20})(?=\s*(?:论文|报告))/g),
    ...text.matchAll(/开源\s*([\u3400-\u9fff]{2,20})(?=[，。；、]|$)/g),
  ].map((match) => match[1]!);
  return [...new Set(matches)];
}

export function buildCanonicalFactAtoms(events: EventRecord[]): CanonicalFactAtom[] {
  const atoms = new Map<string, CanonicalFactAtom>();
  const add = (referenceId: string, kind: FactAtomKind, value: string | undefined): void => {
    const clean = value?.trim();
    if (!clean) return;
    const id = factAtomId(referenceId, kind, clean);
    atoms.set(id, { id, referenceId, kind, value: clean });
  };
  for (const event of events) {
    add(event.id, "company", event.primaryEntity);
    event.entities.forEach((name) => add(event.id, "official-name", name));
    (event.mentionedEntities ?? []).forEach((name) => add(event.id, "official-name", name));
    event.routes.forEach((route) => add(event.id, "route", route));
    add(event.id, "product", event.productDeployment?.product);
    add(event.id, "funding-amount", event.funding?.amount);
    add(event.id, "valuation", event.funding?.valuation);
    event.productDeployment?.customers.forEach((customer) => add(event.id, "customer", customer));
    add(event.id, "date", event.eventDate ?? event.occurredAt);

    const claimText = `${event.title} ${qualifyingClaimText(event)}`;
    const typeAction = {
      "投融资": "funding", "产品发布": "product-release", "公司商业": undefined,
      "部署案例": "deployment", "开源项目": "open-source", "研究与数据": "research",
    }[event.type];
    add(event.id, "action", typeAction);
    if (event.funding) add(event.id, "action", "funding");
    if (event.productDeployment) add(event.id, "action", "deployment");
    actionValues(claimText).forEach((action) => add(event.id, "action", action));
    chineseActionTargets(claimText).forEach((target) => add(event.id, "official-name", target));
    const quantities = claimText.match(/\d[\d,]*(?:\.\d+)?(?:\s*(?:万|亿|千|百)?\s*(?:美元|欧元|人民币|元|台|套|家|个|%|％|年|月|日|天))?/g) ?? [];
    quantities.forEach((quantity) => add(event.id, "quantity", quantity));
  }
  return [...atoms.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function qualifyingClaimText(event: EventRecord): string {
  const publication = derivePublication({ evidence: event.evidence });
  const qualifyingEvidenceIds = new Set(publication.qualifyingEvidenceIds);
  return [
    ...event.facts,
    ...event.evidence.filter((evidence) => qualifyingEvidenceIds.has(evidence.link)).map((evidence) => evidence.supports),
  ].join(" ");
}

function scheduleBindingValid(text: string, path: string, draft: CompanyThesisDraft, atomIds: ReadonlySet<string>): boolean | undefined {
  if (!path.startsWith("nextValidationPoints.")) return undefined;
  const pointIndex = Number(path.split(".")[1]);
  const point = draft.nextValidationPoints[pointIndex];
  if (!point) return false;
  const generatedDay = Date.parse(`${draft.generatedAt.slice(0, 10)}T00:00:00.000Z`);
  const dueDay = Date.parse(`${point.dueAt}T00:00:00.000Z`);
  if (!Number.isFinite(generatedDay) || !Number.isFinite(dueDay)) return false;
  const horizonDays = (dueDay - generatedDay) / 86_400_000;
  if (!Number.isInteger(horizonDays) || horizonDays < 30 || horizonDays > 90) return false;
  const relativeDays = text.match(/(?:未来|后续|接下来)\s*(30|60|90)\s*天/);
  const isoDate = text.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  const chineseDate = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  const hasScheduleLanguage = Boolean(relativeDays || isoDate || chineseDate);
  if (!hasScheduleLanguage) return undefined;
  if (/已于|此前|曾经|已经|截至|过去|连续运行/.test(text)) return false;
  if (!/(?:未来|后续|接下来|之前|前核验|内核验)/.test(text)) return false;
  if (!atomIds.has(scheduleAtomId(path, point.dueAt))) return false;
  if (relativeDays) {
    if (horizonDays !== Number(relativeDays[1])) return false;
  }
  if (isoDate && isoDate !== point.dueAt) return false;
  if (chineseDate) {
    const normalized = `${chineseDate[1]}-${chineseDate[2]!.padStart(2, "0")}-${chineseDate[3]!.padStart(2, "0")}`;
    if (normalized !== point.dueAt) return false;
  }
  return true;
}

function typedNumericClaimsSupported(text: string, boundAtoms: CanonicalFactAtom[], scheduleBinding: boolean | undefined): boolean {
  const dateClaims = [
    ...(text.match(/\d{4}-\d{2}-\d{2}/g) ?? []),
    ...[...text.matchAll(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/g)]
      .map((match) => `${match[1]}-${match[2]!.padStart(2, "0")}-${match[3]!.padStart(2, "0")}`),
  ];
  if (scheduleBinding !== true && dateClaims.some((date) => !boundAtoms.some((atom) => atom.kind === "date" && atom.value.slice(0, 10) === date))) return false;

  const currencyPattern = /\d[\d,]*(?:\.\d+)?\s*(?:万|亿|千|百)?\s*(?:美元|欧元|人民币|元)/g;
  const currencyClaims = [...text.matchAll(currencyPattern)];
  const fieldLabels = [...text.matchAll(/融资金额|融资额|融资|募资|funding amount|funding|估值|valuation/gi)]
    .map((match) => ({ index: match.index ?? 0, end: (match.index ?? 0) + match[0].length, kind: /估值|valuation/i.test(match[0]) ? "valuation" as const : "funding-amount" as const }));
  for (const match of currencyClaims) {
    const value = match[0];
    const index = match.index ?? 0;
    const preceding = fieldLabels.filter((label) => label.end <= index && index - label.end <= 24).sort((left, right) => right.end - left.end)[0];
    const following = fieldLabels.filter((label) => label.index >= index + value.length && label.index - (index + value.length) <= 12)
      .sort((left, right) => left.index - right.index)[0];
    const kind: FactAtomKind = preceding?.kind ?? following?.kind ?? "quantity";
    if (!boundAtoms.some((atom) => atom.kind === kind && normalizedMaterial(atom.value) === normalizedMaterial(value))) return false;
  }

  let remaining = text
    .replace(/\d{4}-\d{2}-\d{2}/g, "")
    .replace(/\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日/g, "")
    .replace(currencyPattern, "");
  if (scheduleBinding === true) remaining = remaining.replace(/(?:未来|后续|接下来)\s*(?:30|60|90)\s*天/g, "");
  const quantities = remaining.match(/\b\d[\d,]*(?:\.\d+)?\b(?:\s*(?:台|套|家|个|%|％|天))?/g) ?? [];
  return quantities.every((value) => boundAtoms.some((atom) => atom.kind === "quantity"
    && normalizedMaterial(atom.value) === normalizedMaterial(value)));
}

function sentenceClaimsSupported(
  text: string,
  events: EventRecord[],
  path: string,
  draft: CompanyThesisDraft,
  boundAtoms: CanonicalFactAtom[],
  atomIds: ReadonlySet<string>,
): boolean {
  const evidenceText = events.map(canonicalEventText).join(" ");
  const sensitiveFields = detectedSensitiveFields(text, events);
  const scheduleBinding = scheduleBindingValid(text, path, draft, atomIds);
  if (scheduleBinding === false) return false;
  const atomValues = boundAtoms.map((atom) => normalizedMaterial(atom.value));
  if (materialTokens(text, scheduleBinding === true).some((token) => {
    const normalized = normalizedMaterial(token);
    if (/^\d/.test(normalized)) {
      return !boundAtoms.some((atom) => ["date", "quantity", "funding-amount", "valuation"].includes(atom.kind)
        && materialTokens(atom.value, false).some((candidate) => normalizedMaterial(candidate) === normalized));
    }
    return !atomValues.some((value) => value.includes(normalized) || normalized.includes(value));
  })) return false;
  if (!typedNumericClaimsSupported(text, boundAtoms, scheduleBinding)) return false;
  if (actionValues(text).some((action) => !boundAtoms.some((atom) => atom.kind === "action" && atom.value === action))) return false;
  if (chineseActionTargets(text).some((target) => !boundAtoms.some((atom) => ["official-name", "product", "customer"].includes(atom.kind)
    && normalizedMaterial(atom.value).includes(normalizedMaterial(target))))) return false;
  if (sensitiveFields.includes("amount") && !events.some((event) => event.funding?.amount && text.includes(event.funding.amount))) return false;
  if (sensitiveFields.includes("valuation") && !events.some((event) => event.funding?.valuation && text.includes(event.funding.valuation))) return false;
  if (sensitiveFields.includes("customer") && !events.some((event) => event.productDeployment?.customers.some((customer) => text.includes(customer)))) return false;
  if (!evidenceText.trim()) return false;
  return true;
}

function sensitiveEventValues(event: EventRecord, field: SensitiveField): string[] {
  if (field === "amount") return event.funding?.amount ? [event.funding.amount] : [];
  if (field === "valuation") return event.funding?.valuation ? [event.funding.valuation] : [];
  if (field === "customer") return event.productDeployment?.customers ?? [];
  if (!eventContainsField(event, field)) return [];
  return [canonicalEventText(event)];
}

function deriveSensitiveBinding(
  field: SensitiveField,
  referenceIds: string[],
  companyId: string,
  ledger: CompanyClaimLedger | undefined,
  canonicalEventsById: ReadonlyMap<string, EventRecord>,
): ThesisSensitiveBinding | undefined {
  const claims = ledger?.companies.find((entry) => entry.companyId === companyId)?.claims ?? [];
  const referenceSet = new Set(referenceIds);
  const verifiedClaims = claims.flatMap((claim) => {
    const mappedEvents = claimEventIds(claim);
    const verified = claim.evidenceState === "verified"
      && claim.value !== "unknown"
      && claim.freshness.state === "fresh"
      && !claimHasConflict(claim)
      && claimSupportsField(claim, field)
      && mappedEvents.length > 0
      && mappedEvents.every((eventId) => canonicalEventsById.has(eventId))
      && mappedEvents.some((eventId) => {
        const event = canonicalEventsById.get(eventId);
        return referenceSet.has(eventId) && Boolean(event && eventContainsField(event, field));
      });
    return verified ? [{ claim, referenceIds: mappedEvents.filter((eventId) => referenceSet.has(eventId)).sort() }] : [];
  });
  if (!verifiedClaims.length) return undefined;
  const normalizedReferenceIds = [...new Set(referenceIds)].sort();
  if (normalizedReferenceIds.some((referenceId) => !canonicalEventsById.has(referenceId))) return undefined;
  const eventValues = normalizedReferenceIds.map((referenceId) => ({
    referenceId,
    values: [...new Set(sensitiveEventValues(canonicalEventsById.get(referenceId)!, field).map(normalizedMaterial))].sort(),
  }));
  const claimValues = verifiedClaims.map(({ claim, referenceIds: claimReferences }) => ({
    referenceIds: claimReferences,
    value: normalizedMaterial(claim.value),
  })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const valueDigest = createHash("sha256").update(JSON.stringify({
    schemaVersion: 1,
    field,
    references: eventValues,
    claims: claimValues,
  })).digest("hex");
  return { field, referenceIds: normalizedReferenceIds, valueDigest };
}

export function deriveVerifiedSensitiveBinding(input: {
  field: SensitiveField;
  referenceIds: string[];
  companyId: string;
  claimLedger?: CompanyClaimLedger;
  canonicalEvents: EventRecord[];
}): ThesisSensitiveBinding | undefined {
  return deriveSensitiveBinding(
    input.field,
    input.referenceIds,
    input.companyId,
    input.claimLedger,
    new Map(input.canonicalEvents.map((event) => [event.id, event])),
  );
}

function validateCitationCoverage(
  input: ThesisValidationInput,
  canonicalEventsById: ReadonlyMap<string, EventRecord>,
): { coverage: CitationCoverage; issues: ValidationIssue[]; sensitiveFields: SensitiveFieldValidation[] } {
  const expectedSentences = draftSentences(input.draft);
  const seedReferences = new Set(input.seed.factReferenceIds);
  const draftReferences = new Set(input.draft.factReferenceIds);
  const sentenceCitations = input.draft.sentenceCitations ?? [];
  const factAtomsById = new Map(buildCanonicalFactAtoms([...canonicalEventsById.values()]).map((atom) => [atom.id, atom]));
  const issues: ValidationIssue[] = [];
  const usedCitations = new Set<SentenceCitation>();
  let citedSentences = 0;

  for (const sentence of expectedSentences) {
    const matches = sentenceCitations.filter((citation) => citation.path === sentence.path
      && citation.sentenceIndex === sentence.sentenceIndex
      && citation.text === sentence.text);
    const valid = matches.length === 1 && matches[0]!.referenceIds.length > 0
      && new Set(matches[0]!.referenceIds).size === matches[0]!.referenceIds.length
      && matches[0]!.referenceIds.every((referenceId) => seedReferences.has(referenceId)
        && draftReferences.has(referenceId)
        && canonicalEventsById.has(referenceId));
    if (!valid) {
      issues.push(issue("uncited-sentence", `句子缺少唯一且有效的规范事实引用：${sentence.text}`, sentence.path));
      continue;
    }
    usedCitations.add(matches[0]!);
    const citedEvents = matches[0]!.referenceIds.flatMap((referenceId) => {
      const event = canonicalEventsById.get(referenceId);
      return event ? [event] : [];
    });
    const pointIndex = sentence.path.startsWith("nextValidationPoints.") ? Number(sentence.path.split(".")[1]) : undefined;
    const allowedScheduleAtom = pointIndex === undefined ? undefined
      : scheduleAtomId(sentence.path, input.draft.nextValidationPoints[pointIndex]?.dueAt ?? "");
    const atomIds = new Set(matches[0]!.factAtomIds);
    const boundAtoms = matches[0]!.factAtomIds.flatMap((atomId) => {
      const atom = factAtomsById.get(atomId);
      return atom ? [atom] : [];
    });
    const invalidAtom = matches[0]!.factAtomIds.some((atomId) => {
      if (atomId === allowedScheduleAtom) return false;
      const atom = factAtomsById.get(atomId);
      return !atom || !matches[0]!.referenceIds.includes(atom.referenceId);
    });
    if (invalidAtom || !sentenceClaimsSupported(sentence.text, citedEvents, sentence.path, input.draft, boundAtoms, atomIds)) {
      issues.push(issue("unsupported-sentence-claim", `句子的具体名称、数值或事实类别未被所引规范事件支持：${sentence.text}`, sentence.path));
    }
    citedSentences += 1;
  }

  for (const citation of sentenceCitations) {
    const expectedClaimKind = citation.path.startsWith("nextValidationPoints.")
      ? "validation-point" : citation.path.startsWith("falsifiers.") ? "falsifier" : "analysis";
    if (!citation.referenceIds.length || !citation.factAtomIds?.length
      || citation.claimKind !== expectedClaimKind
      || !Number.isInteger(citation.sentenceIndex) || citation.sentenceIndex < 0 || !citation.text.trim()) {
      issues.push(issue("invalid-citation", "句子引用必须包含有效位置、原文和至少一个引用。", citation.path));
    }
    if (citation.referenceIds.some((referenceId) => !seedReferences.has(referenceId)
      || !draftReferences.has(referenceId)
      || !canonicalEventsById.has(referenceId))) {
      issues.push(issue("citation-reference-outside-seed", "句子引用只能指向草稿和种子共同允许的规范事件。", citation.path));
    }
    if (!usedCitations.has(citation)
      && !expectedSentences.some((sentence) => sentence.path === citation.path
        && sentence.sentenceIndex === citation.sentenceIndex
        && sentence.text === citation.text)) {
      issues.push(issue("invalid-citation", "句子引用的路径、序号或原文与草稿不一致。", citation.path));
    }
  }

  const sensitiveUses = new Map<string, { field: SensitiveField; references: Set<string> }>();
  for (const citation of sentenceCitations) {
    const citedEvents = citation.referenceIds.flatMap((referenceId) => {
      const event = canonicalEventsById.get(referenceId);
      return event ? [event] : [];
    });
    const declaredFields = citation.sensitiveFields ?? [];
    const detectedFields = detectedSensitiveFields(citation.text, citedEvents);
    for (const detected of detectedFields) {
      if (!declaredFields.includes(detected)) {
        issues.push(issue("undeclared-sensitive-field", `句子使用敏感字段 ${detected}，但引用映射未声明。`, citation.path));
      }
    }
    for (const rawField of [...new Set([...declaredFields, ...detectedFields])]) {
      if (!SENSITIVE_FIELD_SET.has(rawField)) {
        issues.push(issue("unknown-sensitive-field", `不允许的敏感字段：${String(rawField)}`, citation.path));
        continue;
      }
      const field = rawField as SensitiveField;
      const existing = sensitiveUses.get(field) ?? { field, references: new Set<string>() };
      citation.referenceIds.forEach((referenceId) => existing.references.add(referenceId));
      sensitiveUses.set(field, existing);
    }
  }
  const sensitiveFields = [...sensitiveUses.values()]
    .sort((left, right) => SENSITIVE_FIELDS.indexOf(left.field) - SENSITIVE_FIELDS.indexOf(right.field))
    .map(({ field, references }) => {
      const referenceIds = [...references].sort();
      const binding = deriveSensitiveBinding(field, referenceIds, input.seed.companyId, input.claimLedger, canonicalEventsById);
      const verified = Boolean(binding);
      if (!verified) issues.push(issue("unverified-sensitive-field", `敏感字段 ${field} 缺少映射到规范事件的已核验新鲜声明。`));
      return binding ? { field, verified, referenceIds, valueDigest: binding.valueDigest } : { field, verified, referenceIds };
    });
  const totalSentences = expectedSentences.length;
  return {
    coverage: { citedSentences, totalSentences, ratio: totalSentences ? citedSentences / totalSentences : 0 },
    issues,
    sensitiveFields,
  };
}

export function validateTrackEvidence(seed: ThesisSeed): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!seed.factReferenceIds.length) issues.push(issue("missing-fact-reference", "观察名单种子缺少规范事实引用。", "seed.factReferenceIds"));
  if (seed.track === "validated-momentum" && seed.evidenceGrade === "B") {
    issues.push(issue("single-b-momentum", "验证动量轨道至少需要 A 或两个独立 B 来源。", "seed.evidenceGrade"));
  }
  const declaredSensitiveFields = [...seed.verifiedSensitiveFields, ...seed.unknownSensitiveFields];
  for (const field of declaredSensitiveFields) {
    if (!SENSITIVE_FIELD_SET.has(field)) issues.push(issue("unknown-sensitive-field", `不允许的敏感字段：${field}`, "seed"));
  }
  return issues;
}

export function validateThesisDraft(input: ThesisValidationInput): ThesisValidationResult {
  const issues = validateTrackEvidence(input.seed);
  const canonicalCompany = input.companies.find((candidate) => candidate.entityId === input.seed.companyId && candidate.entityType === "公司");
  if (!canonicalCompany) issues.push(issue("unknown-company", `未知的规范公司 ID：${input.seed.companyId}`, "seed.companyId"));
  else if (canonicalCompany.name !== input.seed.companyName) {
    issues.push(issue("company-mismatch", "种子公司名称与规范公司实体不一致。", "seed.companyName"));
  }
  if (input.draft.companyId !== input.seed.companyId) issues.push(issue("company-mismatch", "草稿公司 ID 与种子不一致。", "draft.companyId"));
  if (input.draft.track !== input.seed.track) issues.push(issue("track-mismatch", "草稿轨道与种子不一致。", "draft.track"));

  if (!input.draft.factReferenceIds.length) issues.push(issue("missing-fact-reference", "草稿缺少规范事实引用。", "draft.factReferenceIds"));
  const seedReferenceIds = new Set(input.seed.factReferenceIds);
  for (const referenceId of input.draft.factReferenceIds) {
    if (!seedReferenceIds.has(referenceId)) issues.push(issue("reference-outside-seed", `引用 ${referenceId} 不在种子允许范围内。`, "draft.factReferenceIds"));
  }
  const eventById = new Map(input.canonicalEvents.map((event) => [event.id, event]));
  const selectedEvents = input.seed.factReferenceIds.flatMap((referenceId) => {
    const selected = eventById.get(referenceId);
    if (!selected) {
      issues.push(issue("missing-canonical-event", `种子引用 ${referenceId} 未映射到规范事件。`, "seed.factReferenceIds"));
      return [];
    }
    if (selected.primaryEntity !== input.seed.companyName) {
      issues.push(issue("event-company-mismatch", `规范事件 ${referenceId} 未归属于种子公司。`, "seed.factReferenceIds"));
    }
    return [selected];
  });
  selectedEvents.forEach((selected) => issues.push(...conflictIssues(selected as EventWithLifecycle)));
  if (input.seed.track === "validated-momentum" && !hasMomentumProof(selectedEvents)
    && !issues.some((item) => item.code === "single-b-momentum")) {
    issues.push(issue("single-b-momentum", "规范事件未达到验证动量所需的 A 或两个独立 B 来源。", "canonicalEvents"));
  }

  const chineseFields: Array<{ path: string; text: string }> = [
    { path: "draft.whyNow", text: input.draft.whyNow },
    { path: "draft.routeAndDependencies", text: input.draft.routeAndDependencies },
    ...input.draft.nextValidationPoints.map((point, index) => ({ path: `draft.nextValidationPoints.${index}`, text: point.text })),
    ...input.draft.falsifiers.map((falsifier, index) => ({ path: `draft.falsifiers.${index}`, text: falsifier.text })),
  ];
  for (const field of chineseFields) {
    if (!field.text.trim() || !CHINESE_PATTERN.test(field.text)) issues.push(issue("missing-chinese-copy", "公司判断卡的全部文案必须包含中文。", field.path));
  }
  if (!input.draft.nextValidationPoints.length) issues.push(issue("missing-validation-point", "草稿至少需要一个下一验证点。", "draft.nextValidationPoints"));
  if (!input.draft.falsifiers.length) issues.push(issue("missing-falsifier", "草稿至少需要一个反证条件。", "draft.falsifiers"));

  const generatedAt = Date.parse(input.draft.generatedAt);
  const expiresAt = Date.parse(input.draft.expiresAt);
  if (!validTimestamp(input.draft.generatedAt)
    || !validTimestamp(input.draft.expiresAt)
    || expiresAt - generatedAt !== EXPIRY_MS) {
    issues.push(issue("invalid-expiry", "草稿有效期必须恰好为生成时间后 60 天。", "draft.expiresAt"));
  }

  const prose = chineseFields.map((field) => field.text).join("\n");
  if (PROHIBITED_INVESTMENT_LANGUAGE.test(prose)) {
    issues.push(issue("prohibited-investment-language", "草稿包含投资推荐或回报预测措辞。"));
  }

  const ledgerClaims = input.claimLedger?.companies.find((entry) => entry.companyId === input.seed.companyId)?.claims ?? [];
  if (ledgerClaims.some(claimHasConflict)) issues.push(issue("conflicted-evidence", "公司声明台账包含未解决冲突。", "claimLedger"));

  if (input.priorThesis) {
    if (input.priorThesis.companyId !== input.seed.companyId) {
      issues.push(issue("prior-thesis-mismatch", "前序判断卡属于不同公司。", "priorThesis.companyId"));
    } else if (input.priorThesis.track === "validated-momentum" && input.seed.track === "forward-radar") {
      issues.push(issue("prior-thesis-mismatch", "前序判断卡轨道与当前种子不一致。", "priorThesis.track"));
    } else {
      const priorGeneratedAt = Date.parse(input.priorThesis.generatedAt);
      const hasNewerMaterialChange = Number.isFinite(priorGeneratedAt) && selectedEvents.some((selected) => {
        const changedAt = Date.parse(selected.lastMaterialChangeAt ?? selected.lastUpdatedAt);
        return Number.isFinite(changedAt) && changedAt > priorGeneratedAt;
      });
      if (!hasNewerMaterialChange) issues.push(issue("no-material-change", "相较前序判断卡没有更新的规范事实实质变化。", "priorThesis"));
    }
  }

  const citations = validateCitationCoverage(input, new Map(selectedEvents.map((selected) => [selected.id, selected])));
  issues.push(...citations.issues);
  return {
    publishable: issues.length === 0 && citations.coverage.ratio === 1,
    issues,
    citationCoverage: citations.coverage,
    sensitiveFields: citations.sensitiveFields,
    draftDigest: thesisDraftDigest(input.draft),
  };
}
