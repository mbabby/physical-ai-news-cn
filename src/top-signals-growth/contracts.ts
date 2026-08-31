import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { validateTopSignalSource } from "../decision-products/contracts.js";
import type { DecisionTopSignal } from "../decision-products/contracts.js";

export interface GrowthExperimentConfig {
  schemaVersion: 1;
  experimentId: string;
  startDate: string;
  endDate: string;
  manualWeek: string;
  automaticWeek: string;
  baselineStars: number;
  targetStars: number;
  targetExternalAuthors: number;
  minSignals: number;
  maxSignals: number;
  maxSignalsPerEntity: number;
  maxSignalsPerKind: number;
  channels: Array<"github-release" | "readme" | "github-value-contribution">;
}

export interface GrowthScoreBreakdown {
  industryCapitalImpact: number;
  evidenceQuality: number;
  recency: number;
  informationGain: number;
  strategicRelevance: number;
  total: number;
}

export interface GrowthTopSignal extends DecisionTopSignal {
  nextValidationPoint: string;
  scoreBreakdown: GrowthScoreBreakdown;
}

export interface TopSignalsDraft {
  schemaVersion: 1;
  experimentId: string;
  week: string;
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
  signals: GrowthTopSignal[];
}

export interface TopSignalsApproval {
  schemaVersion: 1;
  experimentId: string;
  week: string;
  contentSha256: string;
  approvedBy: string;
  approvedAt: string;
}

const CONFIG_KEYS = [
  "schemaVersion", "experimentId", "startDate", "endDate", "manualWeek", "automaticWeek",
  "baselineStars", "targetStars", "targetExternalAuthors", "minSignals", "maxSignals",
  "maxSignalsPerEntity", "maxSignalsPerKind", "channels",
] as const;
const DRAFT_KEYS = ["schemaVersion", "experimentId", "week", "generatedAt", "periodStart", "periodEnd", "signals"] as const;
const APPROVAL_KEYS = ["schemaVersion", "experimentId", "week", "contentSha256", "approvedBy", "approvedAt"] as const;
const DECISION_SIGNAL_KEYS = [
  "signalId", "eventId", "entityId", "entityName", "titleZh", "factsZh", "kind", "routes",
  "occurredAt", "verifiedAt", "changedThisWeek", "evidenceState", "evidence", "impact",
  "whyItMatters", "rankReasons",
] as const;
const GROWTH_SIGNAL_KEYS = [...DECISION_SIGNAL_KEYS, "nextValidationPoint", "scoreBreakdown"] as const;
const SCORE_KEYS = ["industryCapitalImpact", "evidenceQuality", "recency", "informationGain", "strategicRelevance", "total"] as const;
const CHANNELS = new Set(["github-release", "readme", "github-value-contribution"]);

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid Top Signals growth contract: ${message}`);
}

function exactKeys(value: unknown, keys: readonly string[], path: string): asserts value is Record<string, unknown> {
  ensure(object(value), `${path} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  ensure(actual.length === expected.length && actual.every((key, index) => key === expected[index]), `${path} has undeclared or missing keys`);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function canonicalDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isoWeeksInYear(year: number): number {
  const januaryFirst = new Date(Date.UTC(year, 0, 1)).getUTCDay() || 7;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return januaryFirst === 4 || (januaryFirst === 3 && leapYear) ? 53 : 52;
}

function isoWeek(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-W(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const week = Number(match[2]);
  return week >= 1 && week <= isoWeeksInYear(year);
}

function positiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validateGrowthTopSignal(value: unknown, path: string): asserts value is GrowthTopSignal {
  exactKeys(value, GROWTH_SIGNAL_KEYS, path);
  const source = Object.fromEntries(DECISION_SIGNAL_KEYS.map((key) => [key, value[key]]));
  validateTopSignalSource(source);
  ensure(nonEmpty(value.nextValidationPoint), `${path}.nextValidationPoint must be non-empty`);
  exactKeys(value.scoreBreakdown, SCORE_KEYS, `${path}.scoreBreakdown`);
  for (const key of SCORE_KEYS) ensure(finiteNonNegative(value.scoreBreakdown[key]), `${path}.scoreBreakdown.${key} must be non-negative`);
  const score = value.scoreBreakdown as unknown as GrowthScoreBreakdown;
  ensure(score.total === score.industryCapitalImpact + score.evidenceQuality + score.recency + score.informationGain + score.strategicRelevance, `${path}.scoreBreakdown.total must equal component scores`);
}

export function validateGrowthExperimentConfig(value: unknown): asserts value is GrowthExperimentConfig {
  exactKeys(value, CONFIG_KEYS, "config");
  ensure(value.schemaVersion === 1, "config.schemaVersion must be 1");
  ensure(nonEmpty(value.experimentId), "config.experimentId must be non-empty");
  ensure(canonicalDate(value.startDate) && canonicalDate(value.endDate) && value.startDate <= value.endDate, "config dates are invalid");
  ensure(isoWeek(value.manualWeek) && isoWeek(value.automaticWeek), "config weeks are invalid");
  for (const key of ["baselineStars", "targetStars", "targetExternalAuthors", "minSignals", "maxSignals", "maxSignalsPerEntity", "maxSignalsPerKind"] as const) {
    ensure(positiveInteger(value[key]), `config.${key} must be a positive integer`);
  }
  const numeric = value as Pick<GrowthExperimentConfig, "baselineStars" | "targetStars" | "minSignals" | "maxSignals" | "maxSignalsPerEntity" | "maxSignalsPerKind">;
  ensure(numeric.baselineStars <= numeric.targetStars, "config star targets are invalid");
  ensure(numeric.minSignals <= numeric.maxSignals && numeric.maxSignalsPerEntity <= numeric.maxSignals && numeric.maxSignalsPerKind <= numeric.maxSignals, "config signal limits are invalid");
  ensure(Array.isArray(value.channels) && value.channels.length > 0 && value.channels.every((channel) => CHANNELS.has(channel)) && new Set(value.channels).size === value.channels.length, "config.channels are invalid");
}

export async function loadGrowthExperimentConfig(root: string): Promise<GrowthExperimentConfig> {
  const contents = await readFile(join(root, "experiments", "top-signals-growth.json"), "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error("Invalid Top Signals growth contract: experiment config is not valid JSON");
  }
  validateGrowthExperimentConfig(parsed);
  return parsed;
}

export function validateTopSignalsDraft(value: unknown): asserts value is TopSignalsDraft {
  exactKeys(value, DRAFT_KEYS, "draft");
  ensure(value.schemaVersion === 1, "draft.schemaVersion must be 1");
  ensure(nonEmpty(value.experimentId), "draft.experimentId must be non-empty");
  ensure(isoWeek(value.week), "draft.week is invalid");
  ensure(canonicalTimestamp(value.generatedAt), "draft.generatedAt is invalid");
  ensure(canonicalDate(value.periodStart) && canonicalDate(value.periodEnd) && value.periodStart <= value.periodEnd, "draft period is invalid");
  ensure(Array.isArray(value.signals), "draft.signals must be an array");
  value.signals.forEach((signal, index) => validateGrowthTopSignal(signal, `draft.signals[${index}]`));
  const signalIds = value.signals.map((signal) => signal.signalId);
  ensure(new Set(signalIds).size === signalIds.length, "draft signal IDs must be unique");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export function topSignalsContentSha256(draft: TopSignalsDraft): string {
  validateTopSignalsDraft(draft);
  return createHash("sha256").update(canonicalJson({
    schemaVersion: draft.schemaVersion,
    experimentId: draft.experimentId,
    week: draft.week,
    periodStart: draft.periodStart,
    periodEnd: draft.periodEnd,
    signals: draft.signals,
  })).digest("hex");
}

export function validateTopSignalsApproval(value: unknown): asserts value is TopSignalsApproval {
  exactKeys(value, APPROVAL_KEYS, "approval");
  ensure(value.schemaVersion === 1, "approval.schemaVersion must be 1");
  ensure(nonEmpty(value.experimentId), "approval.experimentId must be non-empty");
  ensure(isoWeek(value.week), "approval.week is invalid");
  ensure(typeof value.contentSha256 === "string" && /^[a-f0-9]{64}$/.test(value.contentSha256), "approval.contentSha256 is invalid");
  ensure(nonEmpty(value.approvedBy), "approval.approvedBy must be non-empty");
  ensure(canonicalTimestamp(value.approvedAt), "approval.approvedAt is invalid");
}
