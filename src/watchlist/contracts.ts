export type WatchlistTrack = "forward-radar" | "validated-momentum";
export type WatchlistPublicGroup = "priority-focus" | "continued-observation";
export type WatchlistChange = "added" | "strengthened" | "downgraded" | "exited";

export type ThesisLifecycle = "new" | "strengthening" | "awaiting-validation" | "downgraded" | "falsified" | "expired";
export type ThesisSensitiveField = "amount" | "valuation" | "customer" | "revenue" | "order";

export interface ThesisSensitiveBinding {
  field: ThesisSensitiveField;
  referenceIds: string[];
  valueDigest: string;
}

export interface CompanyThesis {
  thesisId: string;
  companyId: string;
  track: WatchlistTrack;
  lifecycle: ThesisLifecycle;
  thesisVersion: number;
  whyNow: string;
  routeAndDependencies: string;
  nextValidationPoints: Array<{ text: string; dueAt: string }>;
  falsifiers: Array<{ text: string }>;
  factReferenceIds: string[];
  verifiedSensitiveBindings: ThesisSensitiveBinding[];
  inferenceLabels: string[];
  confidence: "high" | "medium" | "low";
  generatedAt: string;
  expiresAt: string;
  modelVersion: string;
  promptVersion: string;
  methodologyVersion: string;
}

export interface CompanyThesisArtifact {
  schemaVersion: 1;
  generatedAt: string;
  theses: CompanyThesis[];
}

export interface WatchlistSnapshot {
  week: string;
  snapshotVersion: number;
  methodologyVersion: string;
  generatedAt: string;
  forwardRadar: WatchlistSnapshotEntry[];
  validatedMomentum: WatchlistSnapshotEntry[];
  changesSinceLastWeek: Array<{ companyId: string; change: WatchlistChange }>;
  routeShareException?: { route: string; share: number; reason: string };
}

export interface WatchlistSnapshotEntry {
  companyId: string;
  thesisId: string;
  thesisVersion: number;
  group: WatchlistPublicGroup;
}

const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
export const isCanonicalTimestamp = (value: unknown): value is string => {
  if (typeof value !== "string" || !isoTimestampPattern.test(value)) return false;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return false;
  const normalized = new Date(ms).toISOString();
  return normalized === value || normalized === value.replace("Z", ".000Z");
};

function isoWeeksInYear(year: number): number {
  const decemberTwentyEighth = new Date(0);
  decemberTwentyEighth.setUTCFullYear(year, 11, 28);
  const day = decemberTwentyEighth.getUTCDay() || 7;
  return day <= 4 ? 53 : 52;
}

export function isValidIsoWeek(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-W(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const week = Number(match[2]);
  return week >= 1 && week <= isoWeeksInYear(year);
}

const validDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(ms)) return false;
  return new Date(ms).toISOString().slice(0, 10) === value;
};
const nonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const nonEmptyArray = (value: unknown): value is unknown[] => Array.isArray(value) && value.length > 0;
const unique = <T>(values: T[]): boolean => new Set(values).size === values.length;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidTrack(value: unknown): value is WatchlistTrack {
  return value === "forward-radar" || value === "validated-momentum";
}

function isValidLifecycle(value: unknown): value is ThesisLifecycle {
  return value === "new" || value === "strengthening" || value === "awaiting-validation" || value === "downgraded" || value === "falsified" || value === "expired";
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(nonEmptyString);
}

function isNextValidationPoint(value: unknown): value is { text: string; dueAt: string } {
  return isObject(value) && nonEmptyString(value.text) && validDate(value.dueAt);
}

function isFalsifier(value: unknown): value is { text: string } {
  return isObject(value) && nonEmptyString(value.text);
}

function isSensitiveBinding(value: unknown, factReferenceIds: string[]): value is ThesisSensitiveBinding {
  if (!isObject(value) || Object.keys(value).length !== 3
    || Object.keys(value).some((key) => key !== "field" && key !== "referenceIds" && key !== "valueDigest")) return false;
  const sensitiveFields = new Set(["amount", "valuation", "customer", "revenue", "order"]);
  return typeof value.field === "string" && sensitiveFields.has(value.field)
    && isNonEmptyStringArray(value.referenceIds) && unique(value.referenceIds)
    && value.referenceIds.every((referenceId) => factReferenceIds.includes(referenceId))
    && typeof value.valueDigest === "string" && /^[a-f0-9]{64}$/.test(value.valueDigest);
}

function isSnapshotEntry(value: unknown): value is WatchlistSnapshotEntry {
  if (!isObject(value)) return false;
  if (Object.keys(value).length !== 4 || Object.keys(value).some((key) => !["companyId", "thesisId", "thesisVersion", "group"].includes(key))) return false;
  return nonEmptyString(value.companyId) && nonEmptyString(value.thesisId)
    && typeof value.thesisVersion === "number" && Number.isInteger(value.thesisVersion) && value.thesisVersion > 0
    && (value.group === "priority-focus" || value.group === "continued-observation");
}

function isChange(value: unknown): value is { companyId: string; change: WatchlistChange } {
  return isObject(value) && Object.keys(value).length === 2
    && nonEmptyString(value.companyId)
    && (value.change === "added" || value.change === "strengthened" || value.change === "downgraded" || value.change === "exited");
}

function isRouteShareException(value: unknown): value is NonNullable<WatchlistSnapshot["routeShareException"]> {
  return isObject(value) && Object.keys(value).length === 3
    && nonEmptyString(value.route) && nonEmptyString(value.reason)
    && typeof value.share === "number" && Number.isFinite(value.share) && value.share > 0.4 && value.share <= 1;
}

export function validateCompanyThesisShape(value: unknown): value is CompanyThesis {
  if (!isObject(value)) return false;
  const {
    thesisId,
    companyId,
    track,
    lifecycle,
    thesisVersion,
    whyNow,
    routeAndDependencies,
    nextValidationPoints,
    falsifiers,
    factReferenceIds,
    verifiedSensitiveBindings,
    inferenceLabels,
    confidence,
    generatedAt,
    expiresAt,
    modelVersion,
    promptVersion,
    methodologyVersion,
  } = value;
  if (!nonEmptyString(thesisId) || !nonEmptyString(companyId)) return false;
  if (!isValidTrack(track) || !isValidLifecycle(lifecycle)) return false;
  if (typeof thesisVersion !== "number" || !Number.isInteger(thesisVersion) || thesisVersion < 1) return false;
  if (!nonEmptyString(whyNow) || !nonEmptyString(routeAndDependencies)) return false;
  if (!nonEmptyArray(nextValidationPoints) || !nextValidationPoints.every(isNextValidationPoint)) return false;
  if (!nonEmptyArray(falsifiers) || !falsifiers.every(isFalsifier)) return false;
  if (!isNonEmptyStringArray(factReferenceIds) || !unique(factReferenceIds)) return false;
  if (!Array.isArray(verifiedSensitiveBindings)
    || !verifiedSensitiveBindings.every((binding) => isSensitiveBinding(binding, factReferenceIds))
    || !unique(verifiedSensitiveBindings.map((binding) => binding.field))) return false;
  if (!Array.isArray(inferenceLabels) || !inferenceLabels.every(nonEmptyString)) return false;
  if (confidence !== "high" && confidence !== "medium" && confidence !== "low") return false;
  if (!isCanonicalTimestamp(generatedAt) || !isCanonicalTimestamp(expiresAt)) return false;
  if (!nonEmptyString(modelVersion) || !nonEmptyString(promptVersion) || !nonEmptyString(methodologyVersion)) return false;
  return true;
}

export function validateWatchlistSnapshotShape(value: unknown): value is WatchlistSnapshot {
  if (!isObject(value)) return false;
  if (Object.keys(value).some((key) => !["week", "snapshotVersion", "methodologyVersion", "generatedAt", "forwardRadar", "validatedMomentum", "changesSinceLastWeek", "routeShareException"].includes(key))) return false;
  const { week, snapshotVersion, methodologyVersion, generatedAt, forwardRadar, validatedMomentum, changesSinceLastWeek, routeShareException } = value;
  if (!isValidIsoWeek(week)) return false;
  if (typeof snapshotVersion !== "number" || !Number.isInteger(snapshotVersion) || snapshotVersion < 1) return false;
  if (!nonEmptyString(methodologyVersion) || !isCanonicalTimestamp(generatedAt)) return false;
  if (!Array.isArray(forwardRadar) || !Array.isArray(validatedMomentum) || !Array.isArray(changesSinceLastWeek)) return false;
  if (!forwardRadar.every(isSnapshotEntry) || !validatedMomentum.every(isSnapshotEntry) || !changesSinceLastWeek.every(isChange)) return false;
  const thesisIds = [...forwardRadar, ...validatedMomentum].map((entry) => entry.thesisId);
  const companyIds = [...forwardRadar, ...validatedMomentum].map((entry) => entry.companyId);
  if (!unique(thesisIds) || !unique(companyIds)) return false;
  if (routeShareException !== undefined && !isRouteShareException(routeShareException)) return false;
  return true;
}
