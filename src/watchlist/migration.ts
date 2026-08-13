import { createHash } from "node:crypto";
import type { TechnicalRoute } from "../types.js";
import type { ThesisSeed } from "./seeds.js";

const TECHNICAL_ROUTES = new Set<TechnicalRoute>(["数据与训练", "VLA 与具身模型", "世界模型与空间智能", "本体与硬件", "部署与商业化"]);
const SENSITIVE_FIELDS = new Set(["amount", "valuation", "customer", "revenue", "order"]);
const INTERNAL_REFERENCE_PATTERN = /candidate|verification|review/i;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export interface ThesisDraft {
  seed: ThesisSeed;
  inputHash: string;
  draftVersion: number;
  draftStatus: "needs-generation";
  createdAt: string;
  updatedAt: string;
}

export interface ThesisDraftArtifact {
  schemaVersion: 1;
  generatedAt: string;
  drafts: ThesisDraft[];
}

export interface ThesisSeedArtifact {
  schemaVersion: 1;
  generatedAt: string;
  seeds: ThesisSeed[];
}

export interface ThesisSeedMigrationOptions {
  generatedAt: string;
  methodologyVersion: string;
}

function canonicalSeed(seed: ThesisSeed): ThesisSeed {
  return {
    companyId: seed.companyId,
    companyName: seed.companyName,
    track: seed.track,
    routes: seed.routes,
    factReferenceIds: seed.factReferenceIds,
    evidenceGrade: seed.evidenceGrade,
    verifiedSensitiveFields: seed.verifiedSensitiveFields,
    unknownSensitiveFields: seed.unknownSensitiveFields,
    evidenceSummary: seed.evidenceSummary,
  };
}

function seedHash(seed: ThesisSeed): string {
  return createHash("sha256").update(JSON.stringify(canonicalSeed(seed))).digest("hex");
}

function compareSeeds(left: ThesisSeed, right: ThesisSeed): number {
  return left.track.localeCompare(right.track) || left.companyId.localeCompare(right.companyId);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && ISO_TIMESTAMP_PATTERN.test(value) && new Date(value).toISOString() === value;
}

function uniqueStrings(value: unknown, options: { nonEmpty?: boolean } = {}): value is string[] {
  return Array.isArray(value)
    && (!options.nonEmpty || value.length > 0)
    && value.every(nonEmptyString)
    && new Set(value).size === value.length;
}

function validateSeed(value: unknown): value is ThesisSeed {
  if (!isObject(value)) return false;
  if (!nonEmptyString(value.companyId) || !nonEmptyString(value.companyName)) return false;
  if (value.track !== "forward-radar" && value.track !== "validated-momentum") return false;
  if (!uniqueStrings(value.routes) || !value.routes.every((route) => TECHNICAL_ROUTES.has(route as TechnicalRoute))) return false;
  if (!uniqueStrings(value.factReferenceIds, { nonEmpty: true }) || value.factReferenceIds.some((id) => INTERNAL_REFERENCE_PATTERN.test(id))) return false;
  if (value.evidenceGrade !== "A" && value.evidenceGrade !== "B+B" && value.evidenceGrade !== "B") return false;
  if (value.track === "validated-momentum" && value.evidenceGrade === "B") return false;
  if (!uniqueStrings(value.verifiedSensitiveFields) || !value.verifiedSensitiveFields.every((field) => SENSITIVE_FIELDS.has(field))) return false;
  if (!uniqueStrings(value.unknownSensitiveFields) || !value.unknownSensitiveFields.every((field) => SENSITIVE_FIELDS.has(field))) return false;
  const unknownSensitiveFields = value.unknownSensitiveFields;
  if (value.verifiedSensitiveFields.some((field) => unknownSensitiveFields.includes(field))) return false;
  return uniqueStrings(value.evidenceSummary, { nonEmpty: true });
}

export function validateThesisDraftArtifact(value: unknown): value is ThesisDraftArtifact {
  if (!isObject(value) || value.schemaVersion !== 1 || !validTimestamp(value.generatedAt) || !Array.isArray(value.drafts)) return false;
  const companyIds = new Set<string>();
  for (const draft of value.drafts) {
    if (!isObject(draft) || !validateSeed(draft.seed)) return false;
    if (companyIds.has(draft.seed.companyId)) return false;
    companyIds.add(draft.seed.companyId);
    if (draft.inputHash !== seedHash(draft.seed)) return false;
    if (typeof draft.draftVersion !== "number" || !Number.isInteger(draft.draftVersion) || draft.draftVersion < 1) return false;
    if (draft.draftStatus !== "needs-generation" || !validTimestamp(draft.createdAt) || !validTimestamp(draft.updatedAt)) return false;
  }
  return true;
}

export function buildThesisSeedArtifact(drafts: ThesisDraftArtifact, seeds: ThesisSeed[]): ThesisSeedArtifact {
  return { schemaVersion: 1, generatedAt: drafts.generatedAt, seeds: [...seeds].sort(compareSeeds).map(canonicalSeed) };
}

export function migrateThesisSeeds(
  previous: ThesisDraftArtifact | undefined,
  seeds: ThesisSeed[],
  _options: ThesisSeedMigrationOptions,
): ThesisDraftArtifact {
  const existingByCompanyId = new Map(previous?.drafts.map((draft) => [draft.seed.companyId, draft]));
  const drafts = [...seeds]
    .sort(compareSeeds)
    .map((seed) => {
      const existing = existingByCompanyId.get(seed.companyId);
      const inputHash = seedHash(seed);
      if (existing && existing.inputHash === inputHash) return existing;
      return {
        seed: canonicalSeed(seed), inputHash, draftVersion: (existing?.draftVersion ?? 0) + 1,
        draftStatus: "needs-generation" as const,
        createdAt: existing?.createdAt ?? _options.generatedAt,
        updatedAt: _options.generatedAt,
      };
    });

  if (previous
    && drafts.length === previous.drafts.length
    && drafts.every((draft, index) => draft === previous.drafts[index])) return previous;

  return { schemaVersion: 1, generatedAt: _options.generatedAt, drafts };
}
