import { createHash } from "node:crypto";
import { HttpRequestError } from "../runtime/http.js";
import type { ExplainerModel, ExplainerRunReport, ExplainerSource, ProgressExplainerCard, ProgressExplainersArtifact } from "./contracts.js";
import { requestDraft, reviewDraft } from "./draft.js";
import { reviewApproved, validateDraft, validateProgressExplainersArtifact } from "./validate.js";

const DAY_MS = 86_400_000;
const MAX_CARDS = 3;
const digest = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const cardId = (canonicalId: string): string => {
  const slug = canonicalId.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  return `explainer-${slug}-${digest(canonicalId).slice(0, 8)}`;
};
const report = (): ExplainerRunReport => ({ requestsSucceeded: 0, structureRejected: 0, evidenceRejected: 0, semanticRejected: 0, timedOut: 0, failed: 0, retained: 0, removed: 0 });

function selectionTime(source: ExplainerSource): number {
  for (const value of [source.materiallyChangedAt, source.eventDate, source.publishedAt]) {
    if (value !== "unknown" && Number.isFinite(Date.parse(value))) return Date.parse(value);
  }
  return Number.NEGATIVE_INFINITY;
}

function inLookback(source: ExplainerSource, now: Date): boolean {
  const value = source.eventDate !== "unknown" ? source.eventDate : source.publishedAt;
  if (value === "unknown") return false;
  const age = now.getTime() - Date.parse(value);
  return age >= 0 && age <= 30 * DAY_MS;
}

function revisionFor(card: Omit<ProgressExplainerCard, "revision" | "checkedAt">): string {
  return digest(card);
}

function timeout(error: unknown): boolean {
  if (error instanceof HttpRequestError) return error.kind === "timeout";
  if (error instanceof Error && error.cause instanceof HttpRequestError) return error.cause.kind === "timeout";
  return false;
}

export async function buildProgressExplainers(input: { sources: ExplainerSource[]; now: Date; previous?: ProgressExplainersArtifact; model?: ExplainerModel; upstreamConstrained?: boolean }): Promise<{ artifact: ProgressExplainersArtifact; report: ExplainerRunReport }> {
  const run = report();
  const checkedAt = input.now.toISOString();
  const current = new Map(input.sources.map((source) => [source.canonicalId, source]));
  const previous = new Map((input.previous?.cards ?? []).map((card) => [card.canonicalId, card]));
  const selected = [...current.values()].sort((left, right) => selectionTime(right) - selectionTime(left) || left.canonicalId.localeCompare(right.canonicalId)).slice(0, MAX_CARDS);
  const cards: ProgressExplainerCard[] = [];
  let circuitOpen = false;

  for (const source of selected) {
    const old = previous.get(source.canonicalId);
    if (old?.sourceRevision === source.revision) {
      cards.push({ ...old, checkedAt, historical: !inLookback(source, input.now) });
      run.retained += 1;
      continue;
    }
    if (!inLookback(source, input.now) || !input.model || circuitOpen) {
      if (inLookback(source, input.now)) run.failed += 1;
      continue;
    }
    try {
      const raw = await requestDraft(input.model, source);
      run.requestsSucceeded += 1;
      const validated = validateDraft(raw, source);
      if (!validated.ok) {
        run[validated.kind === "structure" ? "structureRejected" : "evidenceRejected"] += 1;
        continue;
      }
      const review = await reviewDraft(input.model, source, validated.draft);
      run.requestsSucceeded += 1;
      if (!reviewApproved(review, validated.draft)) {
        run.semanticRejected += 1;
        continue;
      }
      const stable = { ...validated.draft, id: cardId(source.canonicalId), canonicalId: source.canonicalId, sourceRevision: source.revision, kind: source.kind, evidence: source.evidence, eventDate: source.eventDate, publishedAt: source.publishedAt, materiallyChangedAt: source.materiallyChangedAt, historical: false };
      cards.push({ ...stable, revision: revisionFor(stable), checkedAt });
    } catch (error) {
      if (timeout(error)) run.timedOut += 1;
      else run.failed += 1;
      circuitOpen = true;
    }
  }

  const publishedIds = new Set(cards.map((card) => card.canonicalId));
  run.removed = (input.previous?.cards ?? []).filter((card) => !publishedIds.has(card.canonicalId)).length;
  const created = cards.some((card) => previous.get(card.canonicalId)?.revision !== card.revision);
  const changed = created || run.removed > 0;
  let status: ProgressExplainersArtifact["status"];
  if (changed && cards.length) status = "updated";
  else if (!cards.length && (!input.sources.length || run.failed || run.timedOut)) status = "unavailable";
  else if (input.upstreamConstrained || run.failed || run.timedOut) status = "constrained";
  else status = "no-new-content";
  const artifact: ProgressExplainersArtifact = { schemaVersion: 1, generatedAt: checkedAt, lastContentUpdatedAt: changed ? checkedAt : input.previous?.lastContentUpdatedAt ?? null, checkedAt, status, cards };
  validateProgressExplainersArtifact(artifact);
  return { artifact, report: run };
}
