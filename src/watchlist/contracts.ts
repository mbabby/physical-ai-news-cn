export type WatchlistTrack = "forward-radar" | "validated-momentum";

export type ThesisLifecycle = "new" | "strengthening" | "awaiting-validation" | "downgraded" | "falsified" | "expired";
export type ThesisSensitiveField = "amount" | "valuation" | "customer" | "revenue" | "order";

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
  verifiedSensitiveFields: ThesisSensitiveField[];
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
  forwardRadar: Array<{ thesisId: string; thesisVersion: number }>;
  validatedMomentum: Array<{ thesisId: string; thesisVersion: number }>;
  changesSinceLastWeek: Array<{ companyId: string; change: string }>;
}

const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const validTimestamp = (value: unknown): value is string => {
  if (typeof value !== "string" || !isoTimestampPattern.test(value)) return false;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return false;
  const normalized = new Date(ms).toISOString();
  return normalized === value || normalized === value.replace("Z", ".000Z");
};
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

function isSnapshotEntry(value: unknown): value is { thesisId: string; thesisVersion: number } {
  if (!isObject(value)) return false;
  const thesisId = value.thesisId;
  const thesisVersion = value.thesisVersion;
  return nonEmptyString(thesisId) && typeof thesisVersion === "number" && Number.isInteger(thesisVersion) && thesisVersion > 0;
}

function isChange(value: unknown): value is { companyId: string; change: string } {
  return isObject(value) && nonEmptyString(value.companyId) && nonEmptyString(value.change);
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
    verifiedSensitiveFields,
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
  const sensitiveFields = new Set(["amount", "valuation", "customer", "revenue", "order"]);
  if (!Array.isArray(verifiedSensitiveFields) || !unique(verifiedSensitiveFields)
    || !verifiedSensitiveFields.every((field) => typeof field === "string" && sensitiveFields.has(field))) return false;
  if (!Array.isArray(inferenceLabels) || !inferenceLabels.every(nonEmptyString)) return false;
  if (confidence !== "high" && confidence !== "medium" && confidence !== "low") return false;
  if (!validTimestamp(generatedAt) || !validTimestamp(expiresAt)) return false;
  if (!nonEmptyString(modelVersion) || !nonEmptyString(promptVersion) || !nonEmptyString(methodologyVersion)) return false;
  return true;
}

export function validateWatchlistSnapshotShape(value: unknown): value is WatchlistSnapshot {
  if (!isObject(value)) return false;
  const { week, snapshotVersion, methodologyVersion, generatedAt, forwardRadar, validatedMomentum, changesSinceLastWeek } = value;
  if (!/^\d{4}-W\d{2}$/.test(String(week))) return false;
  if (typeof snapshotVersion !== "number" || !Number.isInteger(snapshotVersion) || snapshotVersion < 1) return false;
  if (!nonEmptyString(methodologyVersion) || !validTimestamp(generatedAt)) return false;
  if (!Array.isArray(forwardRadar) || !Array.isArray(validatedMomentum) || !Array.isArray(changesSinceLastWeek)) return false;
  if (!forwardRadar.every(isSnapshotEntry) || !validatedMomentum.every(isSnapshotEntry) || !changesSinceLastWeek.every(isChange)) return false;
  const thesisIds = [...forwardRadar, ...validatedMomentum].map((entry) => entry.thesisId);
  if (!unique(thesisIds)) return false;
  return true;
}
