import { createHash } from "node:crypto";
import type { ArticleKind, EvidenceGrade, TechnicalRoute, ValidationStage } from "../types.js";

export type DecisionEvidenceGrade = Extract<EvidenceGrade, "A" | "B"> | "学术";

export interface DecisionEvidence {
  evidenceId: string;
  url: string;
  source: string;
  grade: DecisionEvidenceGrade;
}

export interface DecisionTopSignal {
  signalId: string;
  eventId: string;
  entityId: string;
  entityName: string;
  titleZh: string;
  factsZh: [string, string];
  kind: ArticleKind;
  routes: TechnicalRoute[];
  occurredAt: string;
  verifiedAt: string;
  changedThisWeek: boolean;
  evidenceState: "official" | "multi-source";
  evidence: DecisionEvidence[];
  impact: Array<"company" | "capital" | "product-deployment" | "research">;
  whyItMatters: string;
  rankReasons: string[];
}

export interface DecisionCompanyCard {
  cardId: string;
  companyId: string;
  companyName: string;
  officialUrl: string;
  region: string;
  stage: string;
  routes: TechnicalRoute[];
  capital: { status: "verified" | "developing" | "unknown" | "conflicted"; summary: string; evidence: DecisionEvidence[] };
  validationStage: ValidationStage;
  productDeployment: { status: "verified" | "developing" | "unknown" | "conflicted"; summary: string; evidence: DecisionEvidence[] };
  recentChanges: Array<{ eventId: string; title: string; occurredAt: string; type: ArticleKind }>;
  watchlist: {
    track: "forward-radar" | "validated-momentum" | "unknown";
    lifecycle: string;
    whyNow: string;
    nextValidationPoints: Array<{ text: string; dueAt: string }>;
  };
  unknownFields: string[];
  updatedAt: string;
}

export interface ReproducibilityPassport {
  passportId: string;
  paperId: string;
  titleZh: string;
  factsZh: [string, string];
  sourceUrl: string;
  task: string[] | "unknown";
  embodiment: string[] | "unknown";
  methods: string[] | "unknown";
  benchmark: {
    name: string | "unknown";
    metric: string | "unknown";
    result: string | "unknown";
    baseline: string | "unknown";
    delta: string | "unknown";
    evidenceUrls: string[];
  };
  realRobotTrials: number | "unknown";
  assets: { code: string | "unknown"; data: string | "unknown"; weights: string | "unknown" };
  reproducibilityCost: { level: "low" | "medium" | "high" | "unknown"; rationale: string | "unknown" };
  authority: { authors: string[]; labs: string[]; citedByCount: number | "unknown"; checkedAt: string | "unknown" };
  limitations: string[] | "unknown";
  gaps: string[];
  whyWorthAttention: string;
  rankReasons: string[];
}

export interface SubscriptionCatalog {
  generatedAt: string;
  entries: Array<{
    subscriptionId: string;
    label: string;
    description: string;
    cadence: "daily" | "weekly";
    format: "github" | "rss" | "share-link";
    url: string;
    route: TechnicalRoute | "all" | "watchlist";
  }>;
}

export interface DecisionProductArtifact {
  schemaVersion: 1;
  generatedAt: string;
  periodStart: string;
  topSignals: DecisionTopSignal[];
  companyCards: DecisionCompanyCard[];
  researchPassports: ReproducibilityPassport[];
  subscriptions: SubscriptionCatalog;
}

const ARTICLE_KINDS = new Set<ArticleKind>(["投融资", "产品发布", "公司商业", "部署案例", "开源项目", "研究与数据"]);
const TECHNICAL_ROUTES = new Set<TechnicalRoute>(["数据与训练", "VLA 与具身模型", "世界模型与空间智能", "本体与硬件", "部署与商业化"]);
const VALIDATION_STAGES = new Set<ValidationStage>(["证据不足", "概念 / 研究", "原型与演示", "实机验证", "客户试点", "规模部署 / 商业化"]);
const EVIDENCE_GRADES = new Set<DecisionEvidenceGrade>(["A", "B", "学术"]);
const IMPACTS = new Set(["company", "capital", "product-deployment", "research"]);
const PRIVATE_KEYS = new Set(["rawModelOutput", "internalScore", "rankScore"]);
const EXPLICIT_PRIVATE_TEXT = /(?:internal|selection|momentum|rank)[ _-]?(?:score|rank)\b|内部诊断/i;
const NARRATIVE_PRIVATE_TEXT = /\b(?:score|rank)\b|分数|排名|内部诊断/i;
const CANDIDATE_ID = /\bcandidate[-_.:/]+[a-z0-9][a-z0-9_.:/-]*/i;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const ARTIFACT_KEYS = ["schemaVersion", "generatedAt", "periodStart", "topSignals", "companyCards", "researchPassports", "subscriptions"] as const;
const SIGNAL_KEYS = ["signalId", "eventId", "entityId", "entityName", "titleZh", "factsZh", "kind", "routes", "occurredAt", "verifiedAt", "changedThisWeek", "evidenceState", "evidence", "impact", "whyItMatters", "rankReasons"] as const;
const EVIDENCE_KEYS = ["evidenceId", "url", "source", "grade"] as const;
const COMPANY_KEYS = ["cardId", "companyId", "companyName", "officialUrl", "region", "stage", "routes", "capital", "validationStage", "productDeployment", "recentChanges", "watchlist", "unknownFields", "updatedAt"] as const;
const FACT_STATUS_KEYS = ["status", "summary", "evidence"] as const;
const CHANGE_KEYS = ["eventId", "title", "occurredAt", "type"] as const;
const WATCHLIST_KEYS = ["track", "lifecycle", "whyNow", "nextValidationPoints"] as const;
const VALIDATION_POINT_KEYS = ["text", "dueAt"] as const;
const PASSPORT_KEYS = ["passportId", "paperId", "titleZh", "factsZh", "sourceUrl", "task", "embodiment", "methods", "benchmark", "realRobotTrials", "assets", "reproducibilityCost", "authority", "limitations", "gaps", "whyWorthAttention", "rankReasons"] as const;
const BENCHMARK_KEYS = ["name", "metric", "result", "baseline", "delta", "evidenceUrls"] as const;
const ASSET_KEYS = ["code", "data", "weights"] as const;
const COST_KEYS = ["level", "rationale"] as const;
const AUTHORITY_KEYS = ["authors", "labs", "citedByCount", "checkedAt"] as const;
const CATALOG_KEYS = ["generatedAt", "entries"] as const;
const SUBSCRIPTION_KEYS = ["subscriptionId", "label", "description", "cadence", "format", "url", "route"] as const;

export function stableDecisionId(namespace: string, canonicalIdentity: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(namespace) || !canonicalIdentity.trim() || canonicalIdentity !== canonicalIdentity.trim()) {
    throw new Error("Decision identity components must be canonical");
  }
  const digest = createHash("sha256").update(`${namespace}\n${canonicalIdentity}`).digest("hex").slice(0, 20);
  return `decision-${namespace}-${digest}`;
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid decision product artifact: ${message}`);
}

function exactKeys(value: unknown, keys: readonly string[], path: string): asserts value is Record<string, unknown> {
  ensure(object(value), `${path} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  ensure(actual.length === expected.length && actual.every((key, index) => key === expected[index]), `${path} has undeclared or missing keys`);
}

function scanPrivateBoundary(value: unknown, path = "artifact"): void {
  if (typeof value === "string") {
    ensure(!CANDIDATE_ID.test(value), `${path} contains a candidate identifier`);
    ensure(!EXPLICIT_PRIVATE_TEXT.test(value), `${path} contains private score diagnostics`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanPrivateBoundary(item, `${path}[${index}]`));
    return;
  }
  if (!object(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    ensure(!PRIVATE_KEYS.has(key), `${path}.${key} is private`);
    scanPrivateBoundary(nested, `${path}.${key}`);
  }
}

function scanNarrativeBoundary(value: unknown, path: string): void {
  if (typeof value === "string") {
    ensure(!NARRATIVE_PRIVATE_TEXT.test(value), `${path} contains private score or rank diagnostics`);
    return;
  }
  if (Array.isArray(value)) value.forEach((item, index) => scanNarrativeBoundary(item, `${path}[${index}]`));
  else if (object(value)) Object.entries(value).forEach(([key, nested]) => scanNarrativeBoundary(nested, `${path}.${key}`));
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function canonicalIdentifier(value: unknown): value is string {
  return nonEmpty(value) && value === value.trim();
}

function uniqueStrings(value: unknown, allowEmpty = true): value is string[] {
  return Array.isArray(value) && (allowEmpty || value.length > 0) && value.every(nonEmpty) && new Set(value).size === value.length;
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !TIMESTAMP.test(value)) return false;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return false;
  const normalized = new Date(milliseconds).toISOString();
  return normalized === value || normalized === value.replace("Z", ".000Z");
}

function canonicalDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const milliseconds = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString().slice(0, 10) === value;
}

function absoluteUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function urlOrigin(value: string): string {
  return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
}

function exactPair(value: unknown): value is [string, string] {
  return Array.isArray(value) && value.length === 2 && value.every(nonEmpty);
}

function singleChineseSentence(value: string): boolean {
  return /[\u3400-\u9fff]/u.test(value)
    && /[。！？!?]$/u.test(value)
    && (value.match(/[。！？!?]/gu)?.length ?? 0) === 1;
}

export function hasCompleteChinesePassportCopy(title: unknown, facts: unknown): facts is [string, string] {
  return typeof title === "string"
    && nonEmpty(title)
    && /[\u3400-\u9fff]/u.test(title)
    && Array.isArray(facts)
    && facts.length === 2
    && facts.every((fact) => typeof fact === "string" && singleChineseSentence(fact));
}

function uniqueBy(values: unknown[], key: (value: Record<string, unknown>) => unknown, path: string): void {
  const identities = values.map((value) => object(value) ? key(value) : undefined);
  ensure(identities.every((identity) => nonEmpty(identity) && identity === identity.trim())
    && new Set(identities).size === identities.length,
  `${path} contains duplicate or invalid identities`);
}

function validateEvidence(value: unknown, path: string): asserts value is DecisionEvidence {
  exactKeys(value, EVIDENCE_KEYS, path);
  ensure(nonEmpty(value.evidenceId), `${path}.evidenceId must be non-empty`);
  ensure(absoluteUrl(value.url), `${path}.url must be absolute HTTP(S)`);
  ensure(nonEmpty(value.source), `${path}.source must be non-empty`);
  ensure(EVIDENCE_GRADES.has(value.grade as DecisionEvidenceGrade), `${path}.grade is not public`);
}

function validateEvidenceList(value: unknown, path: string, allowEmpty: boolean): asserts value is DecisionEvidence[] {
  ensure(Array.isArray(value) && (allowEmpty || value.length > 0), `${path} must be ${allowEmpty ? "an" : "a non-empty"} array`);
  value.forEach((item, index) => validateEvidence(item, `${path}[${index}]`));
  uniqueBy(value, (item) => item.evidenceId, path);
}

function validateTopSignal(value: unknown, path: string): asserts value is DecisionTopSignal {
  exactKeys(value, SIGNAL_KEYS, path);
  const { signalId, eventId } = value;
  ensure(canonicalIdentifier(signalId) && canonicalIdentifier(eventId), `${path} signal identity must be canonical`);
  ensure(canonicalIdentifier(value.entityId), `${path}.entityId must be canonical`);
  ensure(signalId === stableDecisionId("signal", eventId), `${path}.signalId is not bound to eventId`);
  for (const key of ["entityName", "titleZh", "whyItMatters"] as const) ensure(nonEmpty(value[key]), `${path}.${key} must be non-empty`);
  ensure(exactPair(value.factsZh), `${path}.factsZh must contain exactly two facts`);
  ensure(value.factsZh.every(singleChineseSentence), `${path}.factsZh must contain exactly two Chinese sentences`);
  ensure(ARTICLE_KINDS.has(value.kind as ArticleKind), `${path}.kind is invalid`);
  ensure(uniqueStrings(value.routes, false) && value.routes.every((route) => TECHNICAL_ROUTES.has(route as TechnicalRoute)), `${path}.routes are invalid`);
  ensure(canonicalTimestamp(value.occurredAt) && canonicalTimestamp(value.verifiedAt), `${path} timestamps are noncanonical`);
  ensure(typeof value.changedThisWeek === "boolean", `${path}.changedThisWeek must be boolean`);
  ensure(value.evidenceState === "official" || value.evidenceState === "multi-source", `${path}.evidenceState is invalid`);
  validateEvidenceList(value.evidence, `${path}.evidence`, false);
  if (value.evidenceState === "official") {
    ensure(value.evidence.some((item) => item.grade === "A" || item.grade === "学术"), `${path} official evidence requires A or academic evidence`);
  } else {
    ensure(value.evidence.length >= 2
      && value.evidence.every((item) => item.grade === "B")
      && new Set(value.evidence.map((item) => item.source.trim().toLowerCase())).size >= 2
      && new Set(value.evidence.map((item) => urlOrigin(item.url))).size >= 2,
    `${path} multi-source evidence requires independent B+B`);
  }
  ensure(uniqueStrings(value.impact, false) && value.impact.every((impact) => IMPACTS.has(impact)), `${path}.impact is invalid`);
  ensure(uniqueStrings(value.rankReasons, false), `${path}.rankReasons must be non-empty and unique`);
  scanNarrativeBoundary([value.whyItMatters, value.rankReasons], path);
}

export function validateTopSignalSource(value: unknown): asserts value is DecisionTopSignal {
  scanPrivateBoundary(value, "topSignal");
  validateTopSignal(value, "topSignal");
}

function validateFactStatus(value: unknown, path: string, unknownSummary: string): void {
  exactKeys(value, FACT_STATUS_KEYS, path);
  ensure(["verified", "developing", "unknown", "conflicted"].includes(String(value.status)), `${path}.status is invalid`);
  ensure(nonEmpty(value.summary), `${path}.summary must be non-empty`);
  scanNarrativeBoundary(value.summary, `${path}.summary`);
  validateEvidenceList(value.evidence, `${path}.evidence`, true);
  const evidence = value.evidence as DecisionEvidence[];
  ensure(value.status === "unknown" ? evidence.length === 0 : evidence.length > 0, `${path} status and evidence disagree`);
  if (value.status === "unknown") ensure(value.summary === unknownSummary, `${path} unknown summary must remain non-negative and canonical`);
  if (value.status === "verified") {
    const highConfidence = evidence.some((item) => item.grade === "A" || item.grade === "学术")
      || (evidence.filter((item) => item.grade === "B").length >= 2
        && new Set(evidence.filter((item) => item.grade === "B").map((item) => urlOrigin(item.url))).size >= 2);
    ensure(highConfidence, `${path} verified status requires A, academic, or independent B+B evidence`);
  }
}

function validateCompanyCard(value: unknown, path: string): asserts value is DecisionCompanyCard {
  exactKeys(value, COMPANY_KEYS, path);
  const { cardId, companyId } = value;
  ensure(canonicalIdentifier(cardId) && canonicalIdentifier(companyId), `${path} company identity must be canonical`);
  ensure(cardId === stableDecisionId("company", companyId), `${path}.cardId is not bound to companyId`);
  for (const key of ["companyName", "region", "stage"] as const) ensure(nonEmpty(value[key]), `${path}.${key} must be non-empty`);
  ensure(absoluteUrl(value.officialUrl), `${path}.officialUrl must be absolute HTTP(S)`);
  ensure(uniqueStrings(value.routes, false) && value.routes.every((route) => TECHNICAL_ROUTES.has(route as TechnicalRoute)), `${path}.routes are invalid`);
  validateFactStatus(value.capital, `${path}.capital`, "证据不足（不代表未融资）");
  ensure(VALIDATION_STAGES.has(value.validationStage as ValidationStage), `${path}.validationStage is invalid`);
  validateFactStatus(value.productDeployment, `${path}.productDeployment`, "证据不足（不代表没有产品或部署进展）");
  ensure(Array.isArray(value.recentChanges), `${path}.recentChanges must be an array`);
  value.recentChanges.forEach((change, index) => {
    exactKeys(change, CHANGE_KEYS, `${path}.recentChanges[${index}]`);
    ensure(nonEmpty(change.eventId) && nonEmpty(change.title), `${path}.recentChanges[${index}] strings must be non-empty`);
    ensure(canonicalTimestamp(change.occurredAt), `${path}.recentChanges[${index}].occurredAt is noncanonical`);
    ensure(ARTICLE_KINDS.has(change.type as ArticleKind), `${path}.recentChanges[${index}].type is invalid`);
  });
  uniqueBy(value.recentChanges, (change) => change.eventId, `${path}.recentChanges`);
  ensure(value.recentChanges.length <= 2, `${path}.recentChanges must contain at most two items`);
  const recentChanges = value.recentChanges as unknown as DecisionCompanyCard["recentChanges"];
  ensure(recentChanges.every((change, index) => {
    if (index === 0) return true;
    const previous = recentChanges[index - 1]!;
    const previousTime = Date.parse(previous.occurredAt);
    const currentTime = Date.parse(change.occurredAt);
    return previousTime > currentTime || (previousTime === currentTime && previous.eventId < change.eventId);
  }), `${path}.recentChanges must use descending occurrence time and stable event ID order`);
  exactKeys(value.watchlist, WATCHLIST_KEYS, `${path}.watchlist`);
  ensure(["forward-radar", "validated-momentum", "unknown"].includes(String(value.watchlist.track)), `${path}.watchlist.track is invalid`);
  ensure(nonEmpty(value.watchlist.lifecycle) && nonEmpty(value.watchlist.whyNow), `${path}.watchlist strings must be non-empty`);
  scanNarrativeBoundary(value.watchlist, `${path}.watchlist`);
  ensure(Array.isArray(value.watchlist.nextValidationPoints), `${path}.watchlist.nextValidationPoints must be an array`);
  value.watchlist.nextValidationPoints.forEach((point, index) => {
    exactKeys(point, VALIDATION_POINT_KEYS, `${path}.watchlist.nextValidationPoints[${index}]`);
    ensure(nonEmpty(point.text) && canonicalDate(point.dueAt), `${path}.watchlist.nextValidationPoints[${index}] is invalid`);
  });
  ensure(uniqueStrings(value.unknownFields), `${path}.unknownFields must be unique strings`);
  ensure(canonicalTimestamp(value.updatedAt), `${path}.updatedAt is noncanonical`);
}

export function validateDecisionCompanyCard(value: unknown): asserts value is DecisionCompanyCard {
  scanPrivateBoundary(value, "companyCard");
  validateCompanyCard(value, "companyCard");
}

function unknownOrStrings(value: unknown): boolean {
  return value === "unknown" || uniqueStrings(value, false);
}

function validatePassport(value: unknown, path: string): asserts value is ReproducibilityPassport {
  exactKeys(value, PASSPORT_KEYS, path);
  const { passportId, paperId } = value;
  ensure(canonicalIdentifier(passportId) && canonicalIdentifier(paperId), `${path} research identity must be canonical`);
  ensure(passportId === stableDecisionId("research", paperId), `${path}.passportId is not bound to paperId`);
  for (const key of ["titleZh", "whyWorthAttention"] as const) ensure(nonEmpty(value[key]), `${path}.${key} must be non-empty`);
  ensure(hasCompleteChinesePassportCopy(value.titleZh, value.factsZh), `${path} must contain a Chinese title and exactly two complete Chinese facts`);
  ensure(absoluteUrl(value.sourceUrl), `${path}.sourceUrl must be absolute HTTP(S)`);
  ensure(unknownOrStrings(value.task) && unknownOrStrings(value.embodiment) && unknownOrStrings(value.methods), `${path} task, embodiment, or methods are invalid`);
  exactKeys(value.benchmark, BENCHMARK_KEYS, `${path}.benchmark`);
  const benchmarkFields = [value.benchmark.name, value.benchmark.metric, value.benchmark.result, value.benchmark.baseline, value.benchmark.delta];
  ensure(benchmarkFields.every((field) => field === "unknown" || nonEmpty(field)), `${path}.benchmark fields are invalid`);
  ensure(Array.isArray(value.benchmark.evidenceUrls) && value.benchmark.evidenceUrls.every(absoluteUrl) && new Set(value.benchmark.evidenceUrls).size === value.benchmark.evidenceUrls.length, `${path}.benchmark.evidenceUrls are invalid`);
  const hasKnownBenchmark = benchmarkFields.some((field) => field !== "unknown");
  ensure(hasKnownBenchmark ? value.benchmark.evidenceUrls.length > 0 : value.benchmark.evidenceUrls.length === 0, `${path}.benchmark evidence does not match known fields`);
  ensure(value.realRobotTrials === "unknown" || (Number.isInteger(value.realRobotTrials) && (value.realRobotTrials as number) >= 0), `${path}.realRobotTrials is invalid`);
  exactKeys(value.assets, ASSET_KEYS, `${path}.assets`);
  ensure([value.assets.code, value.assets.data, value.assets.weights].every((asset) => asset === "unknown" || absoluteUrl(asset)), `${path}.assets contain invalid URLs`);
  exactKeys(value.reproducibilityCost, COST_KEYS, `${path}.reproducibilityCost`);
  ensure(["low", "medium", "high", "unknown"].includes(String(value.reproducibilityCost.level)), `${path}.reproducibilityCost.level is invalid`);
  ensure(value.reproducibilityCost.level === "unknown" ? value.reproducibilityCost.rationale === "unknown" : nonEmpty(value.reproducibilityCost.rationale) && value.reproducibilityCost.rationale !== "unknown", `${path}.reproducibilityCost is inconsistent`);
  exactKeys(value.authority, AUTHORITY_KEYS, `${path}.authority`);
  ensure(uniqueStrings(value.authority.authors) && uniqueStrings(value.authority.labs), `${path}.authority names are invalid`);
  ensure(value.authority.citedByCount === "unknown" || (Number.isInteger(value.authority.citedByCount) && (value.authority.citedByCount as number) >= 0), `${path}.authority.citedByCount is invalid`);
  ensure(value.authority.checkedAt === "unknown" || canonicalTimestamp(value.authority.checkedAt), `${path}.authority.checkedAt is invalid`);
  ensure(value.limitations === "unknown" || uniqueStrings(value.limitations, false), `${path}.limitations is invalid`);
  ensure(uniqueStrings(value.gaps), `${path}.gaps must be unique strings`);
  ensure(uniqueStrings(value.rankReasons, false), `${path}.rankReasons must be non-empty and unique`);
  scanNarrativeBoundary([value.whyWorthAttention, value.rankReasons], path);
}

function validateCatalog(value: unknown, path: string): asserts value is SubscriptionCatalog {
  exactKeys(value, CATALOG_KEYS, path);
  ensure(canonicalTimestamp(value.generatedAt), `${path}.generatedAt is noncanonical`);
  ensure(Array.isArray(value.entries), `${path}.entries must be an array`);
  value.entries.forEach((entry, index) => {
    const entryPath = `${path}.entries[${index}]`;
    exactKeys(entry, SUBSCRIPTION_KEYS, entryPath);
    ensure(canonicalIdentifier(entry.subscriptionId), `${entryPath}.subscriptionId must be canonical`);
    for (const key of ["label", "description"] as const) ensure(nonEmpty(entry[key]), `${entryPath}.${key} must be non-empty`);
    ensure(entry.cadence === "daily" || entry.cadence === "weekly", `${entryPath}.cadence is invalid`);
    ensure(entry.format === "github" || entry.format === "rss" || entry.format === "share-link", `${entryPath}.format is invalid`);
    ensure(absoluteUrl(entry.url), `${entryPath}.url must be absolute HTTP(S)`);
    ensure(entry.route === "all" || entry.route === "watchlist" || TECHNICAL_ROUTES.has(entry.route as TechnicalRoute), `${entryPath}.route is invalid`);
  });
  uniqueBy(value.entries, (entry) => entry.subscriptionId, `${path}.entries`);
}

export function validateDecisionProductArtifact(value: unknown): asserts value is DecisionProductArtifact {
  scanPrivateBoundary(value);
  exactKeys(value, ARTIFACT_KEYS, "artifact");
  ensure(value.schemaVersion === 1, "schemaVersion must be 1");
  ensure(canonicalTimestamp(value.generatedAt), "generatedAt is noncanonical");
  ensure(canonicalDate(value.periodStart), "periodStart is noncanonical");
  ensure(Array.isArray(value.topSignals) && Array.isArray(value.companyCards) && Array.isArray(value.researchPassports), "product collections must be arrays");
  value.topSignals.forEach((signal, index) => validateTopSignal(signal, `artifact.topSignals[${index}]`));
  value.companyCards.forEach((card, index) => validateCompanyCard(card, `artifact.companyCards[${index}]`));
  value.researchPassports.forEach((passport, index) => validatePassport(passport, `artifact.researchPassports[${index}]`));
  uniqueBy(value.topSignals, (signal) => signal.signalId, "artifact.topSignals.signalId");
  uniqueBy(value.topSignals, (signal) => signal.eventId, "artifact.topSignals.eventId");
  uniqueBy(value.companyCards, (card) => card.cardId, "artifact.companyCards.cardId");
  uniqueBy(value.companyCards, (card) => card.companyId, "artifact.companyCards.companyId");
  uniqueBy(value.researchPassports, (passport) => passport.passportId, "artifact.researchPassports.passportId");
  uniqueBy(value.researchPassports, (passport) => passport.paperId, "artifact.researchPassports.paperId");
  validateCatalog(value.subscriptions, "artifact.subscriptions");
}
