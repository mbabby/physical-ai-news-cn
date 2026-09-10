import { join } from "node:path";
import type { FileTransaction } from "../runtime/storage.js";
import type { ExplainerSource, ProgressExplainersArtifact } from "./contracts.js";
import { replaceProgressExplainersReadme } from "./markdown.js";
import { validateDraft, validateExplainerDependencies, validateProgressExplainersArtifact } from "./validate.js";

export function validateProgressExplainersPublication(input: { artifact: unknown; readme: string; sources: ExplainerSource[]; expectedGeneratedAt?: string }): void {
  validateProgressExplainersArtifact(input.artifact);
  const artifact = input.artifact;
  validateExplainerDependencies(artifact, input.sources);
  if (artifact.checkedAt !== artifact.generatedAt || (input.expectedGeneratedAt && artifact.generatedAt !== input.expectedGeneratedAt) || (artifact.lastContentUpdatedAt && artifact.lastContentUpdatedAt > artifact.checkedAt)) throw new Error("explainer publication time mismatch");
  for (const card of artifact.cards) {
    const source = input.sources.find((item) => item.canonicalId === card.canonicalId)!;
    const { id, revision, canonicalId, sourceRevision, kind, evidence, eventDate, publishedAt, materiallyChangedAt, checkedAt, historical, ...draft } = card;
    if (!validateDraft(draft, source).ok || kind !== source.kind || JSON.stringify(evidence) !== JSON.stringify(source.evidence) || eventDate !== source.eventDate || publishedAt !== source.publishedAt || materiallyChangedAt !== source.materiallyChangedAt || checkedAt !== artifact.checkedAt) throw new Error("explainer publication source mismatch");
  }
  if (replaceProgressExplainersReadme(input.readme, artifact) !== input.readme) throw new Error("explainer README projection mismatch");
}

export function stageProgressExplainers(input: { root: string; transaction: FileTransaction; artifact: ProgressExplainersArtifact; readme: string; sources: ExplainerSource[] }): string {
  const readme = replaceProgressExplainersReadme(input.readme, input.artifact);
  validateProgressExplainersPublication({ ...input, readme });
  input.transaction.stage(join(input.root, "site/data/progress-explainers.json"), `${JSON.stringify(input.artifact, null, 2)}\n`);
  input.transaction.stage(join(input.root, "README.md"), readme);
  return readme;
}
