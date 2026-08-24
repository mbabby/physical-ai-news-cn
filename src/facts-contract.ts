/**
 * Machine-executable public facts contract.
 *
 * This module is intentionally independent from the event store and candidate
 * verifier.  Both layers may pass their current or legacy records here before
 * something is rendered publicly.  A missing value is represented as
 * `"unknown"`; no crawler clock or inferred publication date is manufactured.
 */

export const UNKNOWN = "unknown" as const;
export type Unknown = typeof UNKNOWN;
export type KnownOrUnknown = string | Unknown;

export const PUBLIC_EVENT_KINDS = [
  "funding", "acquisition", "product-release", "demonstration", "pilot",
  "deployment", "mass-production", "commercialisation", "research-author-report",
  "independent-replication",
] as const;
export type PublicEventKind = (typeof PUBLIC_EVENT_KINDS)[number];
export type PublicEventKindOrUnknown = PublicEventKind | Unknown;

export const EVIDENCE_STATES = [
  "candidate", "developing", "corroborated", "confirmed", "rejected", "conflicted", "withdrawn",
] as const;
export type EvidenceState = (typeof EVIDENCE_STATES)[number];
/** `线索` is accepted from the legacy candidate verifier and never qualifies. */
export type EvidenceGrade = "A" | "B" | "C" | "D" | "线索";

export interface PublicFactEvidence {
  /** Stable evidence id when one is available; the link is used as fallback. */
  id?: string;
  /** Legacy candidate-verification identifier. */
  articleId?: string;
  link?: string;
  source?: string;
  grade?: EvidenceGrade;
  /** Discovery records can be retained for audit, but cannot be public proof. */
  discovery?: boolean;
  sourceClass?: string;
  /** Optional policy values accepted from the existing source registry. */
  publicationPolicy?: "可作为一手证据" | "可作为独立报道" | "仅作线索发现";
  /** Publisher, domain, wire origin, or other provenance chosen by the verifier. */
  independentOrigin?: string;
  publishedAt?: string;
  withdrawn?: boolean;
}

export interface PublicFactTimesInput {
  eventDate?: string;
  publishedAt?: string;
  firstSeenAt?: string;
  verifiedAt?: string;
  materiallyChangedAt?: string;
  /** Legacy aliases are read only; the returned contract always uses the names above. */
  occurredAt?: string;
  lastEvidenceAt?: string;
  lastVerifiedAt?: string;
  lastMaterialChangeAt?: string;
  lastUpdatedAt?: string;
}

export interface PublicFactTimes {
  eventDate: KnownOrUnknown;
  publishedAt: KnownOrUnknown;
  firstSeenAt: KnownOrUnknown;
  verifiedAt: KnownOrUnknown;
  materiallyChangedAt: KnownOrUnknown;
}

export interface PublicFactsInput extends PublicFactTimesInput {
  /** `type` accepts legacy ArticleKind values; `kind` is preferred for new records. */
  kind?: PublicEventKind | string;
  type?: string;
  evidence?: PublicFactEvidence[];
  /** A lifecycle decision from a reviewer overrides normal evidence progression. */
  evidenceState?: EvidenceState;
  /** Whether this exact record is intended for a public surface. */
  public?: boolean;
  /** Evidence selected for public rendering. Omit to let the contract select qualifying proof. */
  publicEvidenceIds?: string[];
}

export interface PublicationDerivation {
  evidenceState: EvidenceState;
  publicEligible: boolean;
  qualifyingEvidenceIds: string[];
  excludedDiscoveryEvidenceIds: string[];
  independentBOrigins: string[];
  reasons: string[];
}

export interface PublicFactsDerivation extends PublicationDerivation {
  kind: PublicEventKindOrUnknown;
  times: PublicFactTimes;
}

export type FactsContractIssueCode =
  | "unknown-event-kind"
  | "invalid-time"
  | "verification-before-first-seen"
  | "material-change-before-first-seen"
  | "invalid-evidence-state"
  | "insufficient-proof"
  | "single-b-cannot-confirm"
  | "b-sources-not-independent"
  | "discovery-evidence-public"
  | "public-record-not-eligible";

export interface FactsContractIssue {
  code: FactsContractIssueCode;
  message: string;
}

export interface FactsContractValidation extends PublicFactsDerivation {
  valid: boolean;
  issues: FactsContractIssue[];
}

export class FactsContractError extends Error {
  constructor(readonly issues: FactsContractIssue[]) {
    super(`公开事实契约未通过：\n- ${issues.map((issue) => issue.message).join("\n- ")}`);
    this.name = "FactsContractError";
  }
}

const EVENT_KIND_ALIASES: Record<string, PublicEventKind> = {
  funding: "funding", "投融资": "funding", "融资": "funding",
  acquisition: "acquisition", "并购": "acquisition", "收购": "acquisition",
  "product-release": "product-release", "产品发布": "product-release", "开源项目": "product-release",
  demonstration: "demonstration", "演示": "demonstration",
  pilot: "pilot", "试点": "pilot",
  deployment: "deployment", "部署": "deployment", "部署案例": "deployment",
  "mass-production": "mass-production", "量产": "mass-production",
  commercialisation: "commercialisation", commercialization: "commercialisation", "商业化": "commercialisation", "公司商业": "commercialisation",
  "research-author-report": "research-author-report", "研究作者报告": "research-author-report", "研究与数据": "research-author-report",
  "independent-replication": "independent-replication", "独立复现": "independent-replication",
};

const DISCOVERY_SOURCE = /google news|hacker news|\bhn\b|(?:^|\s)x\s*[··]|twitter|news\.google\.com|news\.ycombinator\.com|(?:^|[/:.\s])x\.com(?:[/:?\s]|$)/i;

function knownTimestamp(value: string | undefined): KnownOrUnknown {
  return value && Number.isFinite(Date.parse(value)) ? value : UNKNOWN;
}

function knownEventDate(value: string | undefined): KnownOrUnknown {
  if (!value) return UNKNOWN;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`))) return value;
  return Number.isFinite(Date.parse(value)) ? value : UNKNOWN;
}

function evidenceId(evidence: PublicFactEvidence, index: number): string {
  return evidence.id?.trim() || evidence.articleId?.trim() || evidence.link?.trim() || `evidence-${index + 1}`;
}

function originFor(evidence: PublicFactEvidence, index: number): string {
  if (evidence.independentOrigin?.trim()) return evidence.independentOrigin.trim().toLowerCase();
  try { return new URL(evidence.link ?? "").hostname.replace(/^www\./, "").toLowerCase(); } catch { /* fall through */ }
  return evidence.source?.trim().toLowerCase() || `unattributed-${index + 1}`;
}

export function isDiscoveryEvidence(evidence: PublicFactEvidence): boolean {
  return evidence.discovery === true
    || evidence.sourceClass === "discovery"
    || evidence.publicationPolicy === "仅作线索发现"
    || DISCOVERY_SOURCE.test(`${evidence.source ?? ""} ${evidence.link ?? ""}`);
}

function stateIsValid(state: string | undefined): state is EvidenceState {
  return Boolean(state && (EVIDENCE_STATES as readonly string[]).includes(state));
}

/** Normalize legacy and current labels without guessing an unfamiliar kind. */
export function normalizeEventKind(value: string | undefined): PublicEventKindOrUnknown {
  if (!value) return UNKNOWN;
  return EVENT_KIND_ALIASES[value.trim().toLowerCase()] ?? UNKNOWN;
}

/**
 * Normalize time fields.  Legacy aliases preserve their documented meanings;
 * missing or malformed values remain `unknown` rather than falling back to now.
 */
export function deriveFactTimes(input: PublicFactTimesInput): PublicFactTimes {
  return {
    eventDate: knownEventDate(input.eventDate ?? input.occurredAt),
    publishedAt: knownTimestamp(input.publishedAt ?? input.lastEvidenceAt),
    firstSeenAt: knownTimestamp(input.firstSeenAt),
    verifiedAt: knownTimestamp(input.verifiedAt ?? input.lastVerifiedAt),
    materiallyChangedAt: knownTimestamp(input.materiallyChangedAt ?? input.lastMaterialChangeAt ?? input.lastUpdatedAt),
  };
}

/**
 * Derive the maximum evidence state that the evidence can support.  A single
 * B source is deliberately only developing.  Two B sources confirm a fact
 * only if their independent origins differ.  Discovery evidence is excluded
 * before every count and is never selected as public proof.
 */
export function derivePublication(input: Pick<PublicFactsInput, "evidence" | "evidenceState">): PublicationDerivation {
  const evidence = input.evidence ?? [];
  const excludedDiscoveryEvidenceIds = evidence.flatMap((item, index) => isDiscoveryEvidence(item) ? [evidenceId(item, index)] : []);
  const direct = evidence.map((item, index) => ({ item, index })).filter(({ item }) => !isDiscoveryEvidence(item) && !item.withdrawn);
  const qualifying = direct.filter(({ item }) => item.grade === "A" || item.grade === "B");
  const bOrigins = [...new Set(direct.filter(({ item }) => item.grade === "B").map(({ item, index }) => originFor(item, index)))];
  const directOrigins = new Set(direct.map(({ item, index }) => originFor(item, index)));
  const hasA = qualifying.some(({ item }) => item.grade === "A");
  const bIndependent = bOrigins.length >= 2;
  const lifecycle = input.evidenceState;
  const reasons: string[] = [];
  let evidenceState: EvidenceState;

  if (lifecycle === "rejected" || lifecycle === "conflicted" || lifecycle === "withdrawn") {
    evidenceState = lifecycle;
    reasons.push(`人工生命周期状态为 ${lifecycle}`);
  } else if (evidence.some((item) => item.withdrawn)) {
    evidenceState = "withdrawn";
    reasons.push("至少一项证据已撤回");
  } else if (hasA) {
    evidenceState = "confirmed";
    reasons.push("存在可公开的一手 A 级证据");
  } else if (bIndependent) {
    evidenceState = "confirmed";
    reasons.push("存在两项独立来源的 B 级证据");
  } else if (qualifying.some(({ item }) => item.grade === "B") && directOrigins.size >= 2) {
    evidenceState = "corroborated";
    reasons.push("一项 B 级证据获得独立的非 A/B 级补充，但尚未达到确认门槛");
  } else if (direct.length > 0) {
    evidenceState = "developing";
    reasons.push(qualifying.length ? "仅有一项独立 B 级证据" : "仅有待发展的直接证据");
  } else {
    evidenceState = "candidate";
    reasons.push(evidence.length ? "仅有线索发现层证据" : "尚无直接证据");
  }

  return {
    evidenceState,
    publicEligible: evidenceState === "confirmed",
    qualifyingEvidenceIds: qualifying.map(({ item, index }) => evidenceId(item, index)),
    excludedDiscoveryEvidenceIds,
    independentBOrigins: bOrigins,
    reasons,
  };
}

export function derivePublicFacts(input: PublicFactsInput): PublicFactsDerivation {
  return { kind: normalizeEventKind(input.kind ?? input.type), times: deriveFactTimes(input), ...derivePublication(input) };
}

/** Validate a record at the public boundary. This does not mutate the input. */
export function validateFacts(input: PublicFactsInput): FactsContractValidation {
  const derived = derivePublicFacts(input);
  const issues: FactsContractIssue[] = [];
  if (derived.kind === UNKNOWN) issues.push({ code: "unknown-event-kind", message: "事件类型未知；不能把未映射的旧标签公开为确定语义。" });
  for (const [name, value] of Object.entries(derived.times)) {
    const supplied = input[name as keyof PublicFactTimesInput]
      ?? (name === "eventDate" ? input.occurredAt : name === "publishedAt" ? input.lastEvidenceAt : name === "verifiedAt" ? input.lastVerifiedAt : name === "materiallyChangedAt" ? input.lastMaterialChangeAt ?? input.lastUpdatedAt : undefined);
    if (supplied !== undefined && value === UNKNOWN) issues.push({ code: "invalid-time", message: `${name} 不是有效时间，缺失值应明确保持 unknown。` });
  }
  const firstSeen = derived.times.firstSeenAt;
  const verified = derived.times.verifiedAt;
  const changed = derived.times.materiallyChangedAt;
  if (firstSeen !== UNKNOWN && verified !== UNKNOWN && Date.parse(verified) < Date.parse(firstSeen)) issues.push({ code: "verification-before-first-seen", message: "verifiedAt 早于 firstSeenAt。" });
  if (firstSeen !== UNKNOWN && changed !== UNKNOWN && Date.parse(changed) < Date.parse(firstSeen)) issues.push({ code: "material-change-before-first-seen", message: "materiallyChangedAt 早于 firstSeenAt。" });
  if (input.evidenceState !== undefined && !stateIsValid(input.evidenceState)) issues.push({ code: "invalid-evidence-state", message: `未知证据状态：${input.evidenceState}` });

  const evidence = input.evidence ?? [];
  const directB = evidence.filter((item) => !isDiscoveryEvidence(item) && !item.withdrawn && item.grade === "B");
  const directBOrigins = derived.independentBOrigins;
  if (input.evidenceState === "confirmed" && derived.evidenceState !== "confirmed") {
    issues.push({ code: "insufficient-proof", message: "记录声明为 confirmed，但没有达到公开确认门槛。" });
    if (directB.length === 1) issues.push({ code: "single-b-cannot-confirm", message: "单一 B 级来源不能成为 confirmed。" });
    if (directB.length >= 2 && directBOrigins.length < 2) issues.push({ code: "b-sources-not-independent", message: "两项 B 级证据必须来自独立来源。" });
  }

  const publicIds = input.publicEvidenceIds;
  if (publicIds) {
    const discoveryIds = new Set(derived.excludedDiscoveryEvidenceIds);
    if (publicIds.some((id) => discoveryIds.has(id))) issues.push({ code: "discovery-evidence-public", message: "线索发现层来源不能作为公开证据。" });
  }
  if (input.public === true && !derived.publicEligible) issues.push({ code: "public-record-not-eligible", message: "公开记录必须有 A 级证据或两项独立 B 级证据。" });
  if (input.public === true && evidence.length > 0 && derived.qualifyingEvidenceIds.length === 0) issues.push({ code: "discovery-evidence-public", message: "发现源只能保留在候选层，不能单独支撑公开记录。" });

  return { valid: issues.length === 0, issues, ...derived };
}

/** Throwing convenience wrapper for pipeline gates and release validation. */
export function assertFacts(input: PublicFactsInput): PublicFactsDerivation {
  const result = validateFacts(input);
  if (!result.valid) throw new FactsContractError(result.issues);
  const { valid: _valid, issues: _issues, ...derived } = result;
  return derived;
}
