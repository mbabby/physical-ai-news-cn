import { createHash } from "node:crypto";

export type LedgerFieldStatus = "verified" | "developing" | "conflicted" | "unknown";

export interface LedgerField<T> {
  value: T | "unknown";
  status: LedgerFieldStatus;
  evidenceIds: string[];
  evidenceUrls: string[];
  observedAt: string | "unknown";
  verifiedAt: string | "unknown";
  conflictingValues?: T[];
}

export type LedgerFieldInput<T> = Omit<LedgerField<T>, "observedAt" | "verifiedAt"> & {
  observedAt?: string | "unknown";
  verifiedAt?: string | "unknown";
};

export type LedgerCorrectionReason = "new-evidence" | "conflict-detected" | "conflict-resolved" | "source-withdrawn" | "metadata-correction";

export interface LedgerCorrection {
  correctionId: string;
  ledgerType: string;
  subjectId: string;
  fieldPath: string;
  before: LedgerField<unknown>;
  after: LedgerField<unknown>;
  reason: LedgerCorrectionReason;
  evidenceIds: string[];
  correctedAt: string;
}

export interface DeriveLedgerCorrectionsInput<T> {
  ledgerType: string;
  subjectId: string;
  fieldPath: string;
  before?: LedgerFieldInput<T>;
  after: LedgerFieldInput<T>;
  previousCorrections?: readonly LedgerCorrection[];
  correctedAt: string;
}

const codeUnitCompare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

function canonicalValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => codeUnitCompare(left, right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalValue(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function absoluteUrl(value: string): boolean {
  try {
    return Boolean(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function validateLedgerField<T>(field: LedgerFieldInput<T>): void {
  if (!["verified", "developing", "conflicted", "unknown"].includes(field.status)) {
    throw new Error(`Invalid ledger field status: ${field.status}`);
  }
  if (!Array.isArray(field.evidenceIds) || !field.evidenceIds.every((id) => typeof id === "string" && id.length > 0)) {
    throw new Error("Ledger evidence IDs must be non-empty strings");
  }
  if (new Set(field.evidenceIds).size !== field.evidenceIds.length) {
    throw new Error("Ledger evidence IDs must be unique");
  }
  if (!Array.isArray(field.evidenceUrls) || !field.evidenceUrls.every((url) => typeof url === "string" && absoluteUrl(url))) {
    throw new Error("Ledger evidence URLs must be absolute URLs");
  }

  const observedAt = field.observedAt ?? "unknown";
  const verifiedAt = field.verifiedAt ?? "unknown";
  if (field.status === "unknown") {
    if (field.value !== "unknown" || field.evidenceIds.length > 0 || field.evidenceUrls.length > 0
      || observedAt !== "unknown" || verifiedAt !== "unknown" || (field.conflictingValues?.length ?? 0) > 0) {
      throw new Error("Unknown ledger fields cannot carry values, evidence, clocks, or conflicts");
    }
    return;
  }

  if (field.evidenceIds.length === 0 || field.evidenceUrls.length === 0) {
    throw new Error("Known ledger fields require evidence IDs and URLs");
  }
  if (field.status === "conflicted") {
    if (field.value !== "unknown") throw new Error("Conflicted ledger fields expose an unknown canonical value");
    const alternatives = field.conflictingValues ?? [];
    if (new Set(alternatives.map(canonicalValue)).size < 2) {
      throw new Error("Conflicted ledger fields require at least two distinct values");
    }
    return;
  }

  if (field.value === "unknown") throw new Error("Known ledger fields require a value");
  if ((field.conflictingValues?.length ?? 0) > 0) {
    throw new Error("Only conflicted ledger fields may carry conflicting values");
  }
}

export function unknownLedgerField<T>(): LedgerField<T> {
  return {
    value: "unknown",
    status: "unknown",
    evidenceIds: [],
    evidenceUrls: [],
    observedAt: "unknown",
    verifiedAt: "unknown",
  };
}

export function ledgerField<T>(input: LedgerFieldInput<T>): LedgerField<T> {
  validateLedgerField(input);
  const result: LedgerField<T> = {
    value: input.value,
    status: input.status,
    evidenceIds: [...input.evidenceIds].sort(codeUnitCompare),
    evidenceUrls: [...input.evidenceUrls].sort(codeUnitCompare),
    observedAt: input.observedAt ?? "unknown",
    verifiedAt: input.verifiedAt ?? "unknown",
  };
  if (input.status === "conflicted") {
    result.conflictingValues = [...(input.conflictingValues ?? [])]
      .sort((left, right) => codeUnitCompare(canonicalValue(left), canonicalValue(right)));
  }
  return result;
}

function materialField<T>(field: LedgerFieldInput<T>): Omit<LedgerField<T>, "verifiedAt"> {
  const { verifiedAt: _verifiedAt, ...material } = ledgerField(field);
  return material;
}

function correctionReason<T>(before: LedgerField<T>, after: LedgerField<T>): LedgerCorrectionReason {
  if (before.status !== "conflicted" && after.status === "conflicted") return "conflict-detected";
  if (before.status === "conflicted" && after.status !== "conflicted") return "conflict-resolved";
  const withdrawn = before.evidenceIds.some((id) => !after.evidenceIds.includes(id))
    || before.evidenceUrls.some((url) => !after.evidenceUrls.includes(url));
  if (withdrawn) return "source-withdrawn";
  const added = after.evidenceIds.some((id) => !before.evidenceIds.includes(id))
    || after.evidenceUrls.some((url) => !before.evidenceUrls.includes(url));
  if (before.status === "unknown" || added) return "new-evidence";
  return "metadata-correction";
}

export function deriveLedgerCorrections<T>(input: DeriveLedgerCorrectionsInput<T>): LedgerCorrection[] {
  const previous = [...(input.previousCorrections ?? [])];
  if (!input.before) return previous;

  const before = ledgerField(input.before);
  const after = ledgerField(input.after);
  const materialBefore = materialField(before);
  const materialAfter = materialField(after);
  if (canonicalValue(materialBefore) === canonicalValue(materialAfter)) return previous;

  const reason = correctionReason(before, after);
  const identity = canonicalValue({
    ledgerType: input.ledgerType,
    subjectId: input.subjectId,
    fieldPath: input.fieldPath,
    before: materialBefore,
    after: materialAfter,
    reason,
  });
  const correctionId = `ledger-correction-${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
  if (previous.some((correction) => correction.correctionId === correctionId)) return previous;

  return [...previous, {
    correctionId,
    ledgerType: input.ledgerType,
    subjectId: input.subjectId,
    fieldPath: input.fieldPath,
    before,
    after,
    reason,
    evidenceIds: [...new Set([...before.evidenceIds, ...after.evidenceIds])].sort(codeUnitCompare),
    correctedAt: input.correctedAt,
  }];
}
