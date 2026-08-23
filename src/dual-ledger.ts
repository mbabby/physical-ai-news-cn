import { validateBenchmarkResultLedger, type BenchmarkResultLedger } from "./benchmark-result-ledger.js";
import type { CompanyClaim, CompanyClaimLedger } from "./company-claim-ledger.js";
import { deriveLedgerCorrections, ledgerField, unknownLedgerField, validateLedgerField, type LedgerCorrection, type LedgerField, type LedgerFieldStatus, type LedgerCorrectionReason } from "./ledger-contracts.js";
import type { ResearchDecisionCard } from "./research-decision-card.js";

const FIELD_STATUSES: LedgerFieldStatus[] = ["verified", "developing", "conflicted", "unknown"];
const CORRECTION_REASONS: LedgerCorrectionReason[] = ["new-evidence", "conflict-detected", "conflict-resolved", "source-withdrawn", "metadata-correction"];
const COMPANY_FIELD_PATHS = ["eventDate", "round", "amount", "valuation", "investors", "product", "customer", "deployment", "productionStage"] as const;
const BENCHMARK_FIELD_PATHS = ["benchmark", "metric", "result", "baseline", "delta", "evaluationSetting", "realRobotTrials", "code", "data", "weights"] as const;

export interface DualLedgerMetrics {
  schemaVersion: 1;
  generatedAt: string;
  entries: { companyClaims: number; benchmarkResults: number };
  fields: Record<LedgerFieldStatus, number>;
  corrections: Record<LedgerCorrectionReason, number>;
  evidenceCoverage: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function materialField(field: LedgerField<unknown>): string {
  const { verifiedAt: _verifiedAt, ...material } = field;
  return JSON.stringify(material);
}

function validateCorrection(correction: LedgerCorrection, ledgerType: string, subjectId: string): void {
  if (!correction.correctionId || correction.ledgerType !== ledgerType || correction.subjectId !== subjectId || !correction.fieldPath || !validTimestamp(correction.correctedAt)) {
    throw new Error(`Invalid ledger correction continuity for ${subjectId}`);
  }
  if (!CORRECTION_REASONS.includes(correction.reason)) throw new Error(`Invalid correction reason for ${subjectId}`);
  validateLedgerField(correction.before);
  validateLedgerField(correction.after);
  const derived = deriveLedgerCorrections({
    ledgerType,
    subjectId,
    fieldPath: correction.fieldPath,
    before: correction.before,
    after: correction.after,
    correctedAt: correction.correctedAt,
  });
  if (derived.length !== 1 || derived[0]!.correctionId !== correction.correctionId
    || derived[0]!.reason !== correction.reason
    || JSON.stringify(derived[0]!.evidenceIds) !== JSON.stringify(correction.evidenceIds)) {
    throw new Error(`Forged or non-material ledger correction for ${subjectId}`);
  }
}

function validateCorrectionHistory(input: {
  corrections: readonly LedgerCorrection[];
  ledgerType: string;
  subjectId: string;
  currentFields: ReadonlyMap<string, LedgerField<unknown>>;
}): void {
  const correctionIds = new Set<string>();
  const lastAfter = new Map<string, LedgerField<unknown>>();
  for (const correction of input.corrections) {
    validateCorrection(correction, input.ledgerType, input.subjectId);
    if (!input.currentFields.has(correction.fieldPath)) throw new Error(`Correction references an unknown field: ${correction.fieldPath}`);
    if (correctionIds.has(correction.correctionId)) throw new Error(`Duplicate correction ${correction.correctionId}`);
    correctionIds.add(correction.correctionId);
    const previous = lastAfter.get(correction.fieldPath);
    if (previous && materialField(previous) !== materialField(correction.before)) {
      throw new Error(`Broken correction transition chain for ${input.subjectId}:${correction.fieldPath}`);
    }
    lastAfter.set(correction.fieldPath, correction.after);
  }
  for (const [fieldPath, after] of lastAfter) {
    const current = input.currentFields.get(fieldPath)!;
    if (materialField(after) !== materialField(current)) throw new Error(`Correction history does not reach current field: ${input.subjectId}:${fieldPath}`);
  }
}

function companyClaims(ledger: CompanyClaimLedger): CompanyClaim[] {
  return ledger.companies.flatMap((company) => company.claims);
}

export function validateCompanyClaimLedger(ledger: CompanyClaimLedger, options: { allowLegacy?: boolean } = {}): void {
  if (!validTimestamp(ledger.generatedAt) || !Array.isArray(ledger.companies)) throw new Error("Invalid company claim ledger envelope");
  const claimIds = new Set<string>();
  for (const company of ledger.companies) {
    if (!company.companyId || !Array.isArray(company.claims)) throw new Error("Invalid company claim ledger company entry");
    for (const claim of company.claims) {
      const record = claim as unknown as Record<string, unknown>;
      const hasCurrentShape = ["claimId", "fields", "corrections", "eventIds"].some((key) => key in record);
      if (!claim.claimId || !isRecord(claim.fields) || !Array.isArray(claim.corrections) || !Array.isArray(claim.eventIds)) {
        if (hasCurrentShape) throw new Error(`Invalid current company claim shape for ${company.companyId}`);
        if (options.allowLegacy && claim.companyId && claim.claimType && Array.isArray(claim.evidenceUrls)) continue;
        throw new Error(`Invalid field-level company claim for ${company.companyId}`);
      }
      if (claim.companyId !== company.companyId || claimIds.has(claim.claimId)) throw new Error(`Invalid company claim identity: ${claim.claimId}`);
      claimIds.add(claim.claimId);
      if (JSON.stringify(Object.keys(claim.fields).sort()) !== JSON.stringify([...COMPANY_FIELD_PATHS].sort())) throw new Error(`Invalid company field set for ${claim.claimId}`);
      const currentFields = new Map<string, LedgerField<unknown>>();
      for (const fieldPath of COMPANY_FIELD_PATHS) {
        const field = claim.fields[fieldPath] as LedgerField<unknown>;
        validateLedgerField(field);
        currentFields.set(`fields.${fieldPath}`, field);
      }
      validateCorrectionHistory({ corrections: claim.corrections, ledgerType: "company-claim", subjectId: claim.claimId, currentFields });
    }
  }
}

export function isCompanyClaimLedgerArtifact(value: unknown): value is CompanyClaimLedger {
  try {
    if (!isRecord(value)) return false;
    validateCompanyClaimLedger(value as unknown as CompanyClaimLedger, { allowLegacy: true });
    return true;
  } catch {
    return false;
  }
}

export function isBenchmarkResultLedgerArtifact(value: unknown): value is BenchmarkResultLedger {
  try {
    if (!isRecord(value)) return false;
    validateBenchmarkResultLedger(value as unknown as BenchmarkResultLedger);
    return true;
  } catch {
    return false;
  }
}

export function validateDualLedgers(input: {
  company: CompanyClaimLedger;
  benchmark: BenchmarkResultLedger;
  companyIds: ReadonlySet<string>;
  paperIds: ReadonlySet<string>;
  decisionCards: readonly ResearchDecisionCard[];
  expectedGeneratedAt: string;
}): void {
  validateCompanyClaimLedger(input.company);
  validateBenchmarkResultLedger(input.benchmark);
  if (input.company.generatedAt !== input.expectedGeneratedAt || input.benchmark.generatedAt !== input.expectedGeneratedAt) {
    throw new Error("Dual ledger generatedAt values do not match the daily transaction");
  }
  for (const company of input.company.companies) if (!input.companyIds.has(company.companyId)) {
    throw new Error(`Company ledger references a non-canonical company: ${company.companyId}`);
  }
  const cardIds = new Set(input.decisionCards.map((card) => String(card.identity.paperId.value)));
  for (const entry of input.benchmark.entries) {
    if (!input.paperIds.has(entry.paperId) || !cardIds.has(entry.decisionCardPaperId) || entry.paperId !== entry.decisionCardPaperId) {
      throw new Error(`Benchmark ledger references a non-canonical paper/card: ${entry.entryId}`);
    }
    const currentFields = new Map<string, LedgerField<unknown>>(BENCHMARK_FIELD_PATHS.map((fieldPath) => [`fields.${fieldPath}`, entry.fields[fieldPath] as LedgerField<unknown>]));
    currentFields.set("arxivVersion", entry.arxivVersion === "unknown" ? unknownLedgerField<number>() : ledgerField({
      value: entry.arxivVersion,
      status: "verified",
      evidenceIds: [`${entry.paperId}:arxiv-version`],
      evidenceUrls: [entry.sourceUrl],
      observedAt: input.benchmark.generatedAt,
      verifiedAt: input.benchmark.generatedAt,
    }));
    validateCorrectionHistory({ corrections: entry.corrections, ledgerType: "benchmark-result", subjectId: entry.entryId, currentFields });
  }
}

export function buildDualLedgerMetrics(company: CompanyClaimLedger, benchmark: BenchmarkResultLedger): DualLedgerMetrics {
  const fields = [...companyClaims(company).flatMap((claim) => Object.values(claim.fields ?? {})), ...benchmark.entries.flatMap((entry) => Object.values(entry.fields))] as LedgerField<unknown>[];
  const corrections = [...companyClaims(company).flatMap((claim) => claim.corrections ?? []), ...benchmark.entries.flatMap((entry) => entry.corrections)];
  const fieldCounts = Object.fromEntries(FIELD_STATUSES.map((status) => [status, fields.filter((field) => field.status === status).length])) as Record<LedgerFieldStatus, number>;
  const correctionCounts = Object.fromEntries(CORRECTION_REASONS.map((reason) => [reason, corrections.filter((correction) => correction.reason === reason).length])) as Record<LedgerCorrectionReason, number>;
  const evidenced = fields.filter((field) => field.evidenceIds.length > 0 && field.evidenceUrls.length > 0).length;
  return {
    schemaVersion: 1,
    generatedAt: company.generatedAt,
    entries: { companyClaims: companyClaims(company).length, benchmarkResults: benchmark.entries.length },
    fields: fieldCounts,
    corrections: correctionCounts,
    evidenceCoverage: fields.length ? Number((evidenced / fields.length).toFixed(4)) : 0,
  };
}
