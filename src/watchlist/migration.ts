import { createHash } from "node:crypto";
import type { ThesisSeed } from "./seeds.js";

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
