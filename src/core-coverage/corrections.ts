import { createHash } from "node:crypto";
import { deriveLedgerCorrections, unknownLedgerField } from "../ledger-contracts.js";
import type { LedgerField } from "../ledger-contracts.js";
import type { CoverageBrief, CoverageCorrection } from "./contracts.js";

function fieldIndex(brief: CoverageBrief | undefined): Map<string, LedgerField<unknown>> {
  return new Map((brief?.knownFacts ?? []).flatMap((fact) => Object.entries(fact.fields).map(([field, value]) => [`${fact.claimId}.fields.${field}`, value!] as const)));
}

function material(field: LedgerField<unknown>): unknown {
  return { value: field.value, status: field.status, evidenceIds: [...field.evidenceIds].sort(), evidenceUrls: [...field.evidenceUrls].sort(), conflictingValues: field.conflictingValues ?? [] };
}

/** Append-only field transitions, independent of run/verification timestamps. */
export function deriveCoverageCorrections(input: { previous: readonly CoverageBrief[]; current: readonly CoverageBrief[]; previousCorrections?: readonly CoverageCorrection[]; now: Date }): CoverageCorrection[] {
  const result = structuredClone([...(input.previousCorrections ?? [])]);
  for (const companyId of [...new Set([...input.previous, ...input.current].map((brief) => brief.companyId))].sort()) {
    const previous = input.previous.find((brief) => brief.companyId === companyId);
    // First publication establishes a baseline, not a correction.
    if (!previous) continue;
    const beforeFields = fieldIndex(previous);
    const current = input.current.find((brief) => brief.companyId === companyId);
    const afterFields = fieldIndex(current);
    for (const fieldPath of [...new Set([...beforeFields.keys(), ...afterFields.keys()])].sort()) {
      const before = beforeFields.get(fieldPath) ?? unknownLedgerField();
      const after = afterFields.get(fieldPath) ?? unknownLedgerField();
      const beforeMaterial = material(before);
      const afterMaterial = material(after);
      if (JSON.stringify(beforeMaterial) === JSON.stringify(afterMaterial)) continue;
      const changeId = `core-correction-${createHash("sha256").update(JSON.stringify({ companyId, fieldPath, before: beforeMaterial, after: afterMaterial })).digest("hex").slice(0, 24)}`;
      if (result.some((item) => item.changeId === changeId)) continue;
      const correction = deriveLedgerCorrections({ ledgerType: "core-coverage", subjectId: companyId, fieldPath, before, after, correctedAt: input.now.toISOString() })[0]!;
      const [claimId, field] = fieldPath.split(".fields.");
      const hasConflict = (brief: CoverageBrief | undefined) => brief?.reviewIssues?.some((issue) => issue.claimId === claimId && issue.reason === "conflict"
        && (issue.fieldPath === undefined || issue.fieldPath === field));
      const reason = hasConflict(current) ? "conflict-detected" : hasConflict(previous) ? "conflict-resolved" : correction.reason;
      result.push({ changeId, companyId, fieldPath, before: structuredClone(before), after: structuredClone(after), reason, evidenceIds: correction.evidenceIds, correctedAt: input.now.toISOString() });
    }
  }
  return result;
}
