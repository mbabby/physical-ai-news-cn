import { createHash } from "node:crypto";
import { HttpRequestError } from "../runtime/http.js";
import type { ExplainerModel, ExplainerReason, ExplainerRunReport, ExplainerSource, ProgressExplainerCard, ProgressExplainersArtifact } from "./contracts.js";
import { requestDraft, reviewDraft } from "./draft.js";
import { reviewApproved, validateDraft, validateProgressExplainersArtifact } from "./validate.js";
import { explainerReasonLabels } from "./contracts.js";
import type { RuntimeStatus } from "../types.js";

export function reportExplainerStatus(result: { artifact: ProgressExplainersArtifact; report: ExplainerRunReport }): RuntimeStatus {
  const { artifact, report: run } = result;
  const failed = run.failed + run.timedOut;
  const rejected = run.structureRejected + run.evidenceRejected + run.semanticRejected;
  const detail = `${!artifact.cards.length && (failed || rejected) ? "核心解读不可用；" : ""}状态：${artifact.status}；公开 ${artifact.cards.length} 张；保留 ${run.retained} 张；移除 ${run.removed} 张；校验拒绝 ${rejected} 张；超时 ${run.timedOut} 次${artifact.reason ? `；原因：${explainerReasonLabels[artifact.reason]}` : ""}。`;
  return { component: "ProgressExplainers", status: ["constrained", "unavailable"].includes(artifact.status) || failed || rejected ? "部分降级" : "成功", attempted: run.requestsSucceeded + failed, succeeded: run.requestsSucceeded, failed, detail };
}

export function warnExplainerStatus(status: RuntimeStatus | undefined, warn: (message: string) => void = console.warn): void {
  if (status?.component === "ProgressExplainers" && status.status !== "成功") {
    const safeDetail = status.detail.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
    warn(`::warning title=ProgressExplainers::${safeDetail}`);
  }
}

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
  if (input.previous) validateProgressExplainersArtifact(input.previous);
  const current = new Map(input.sources.map((source) => [source.canonicalId, source]));
  const previous = new Map((input.previous?.cards ?? []).map((card) => [card.canonicalId, card]));
  const retainable = [...current.values()].filter((source) => previous.get(source.canonicalId)?.sourceRevision === source.revision);
  const recentCandidates = [...current.values()].filter((source) => !previous.has(source.canonicalId) || previous.get(source.canonicalId)?.sourceRevision !== source.revision).filter((source) => inLookback(source, input.now));
  const selected = recentCandidates.sort((left, right) => selectionTime(right) - selectionTime(left) || left.canonicalId.localeCompare(right.canonicalId)).slice(0, MAX_CARDS);
  // Keep current valid cards available until replacements actually pass review.
  const retainedCards = retainable.map((source) => ({ ...previous.get(source.canonicalId)!, checkedAt, historical: !inLookback(source, input.now) }));
  const reviewedCards: ProgressExplainerCard[] = [];
  let circuitOpen = false;
  let reason: ExplainerReason | undefined;

  for (const source of selected) {
    if (circuitOpen) break;
    if (!input.model) {
      run.failed += 1;
      reason = "model-not-configured";
      break;
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
      reviewedCards.push({ ...stable, revision: revisionFor(stable), checkedAt });
    } catch (error) {
      if (timeout(error)) run.timedOut += 1;
      else run.failed += 1;
      const transport = error instanceof HttpRequestError ? error : error instanceof Error && error.cause instanceof HttpRequestError ? error.cause : undefined;
      reason = transport?.kind === "timeout" ? "timeout" : transport?.kind === "auth" ? "auth" : transport?.kind === "payment_required" ? "quota" : "provider";
      // The adapter already retries each transport request once. Do not
      // multiply that retry loop here; allow one other candidate to recover.
      circuitOpen = !transport?.retryable || run.failed + run.timedOut >= 2;
    }
  }

  const cards = [...retainedCards, ...reviewedCards].sort((left, right) => selectionTime(current.get(right.canonicalId)!) - selectionTime(current.get(left.canonicalId)!) || left.canonicalId.localeCompare(right.canonicalId)).slice(0, MAX_CARDS);
  run.retained = cards.filter((card) => previous.get(card.canonicalId)?.sourceRevision === card.sourceRevision).length;
  const publishedIds = new Set(cards.map((card) => card.canonicalId));
  run.removed = (input.previous?.cards ?? []).filter((card) => !publishedIds.has(card.canonicalId)).length;
  const created = cards.some((card) => previous.get(card.canonicalId)?.revision !== card.revision);
  const changed = created || run.removed > 0;
  let status: ProgressExplainersArtifact["status"];
  if (changed && cards.length) status = "updated";
  else if (!cards.length && (!input.sources.length || run.failed || run.timedOut)) status = "unavailable";
  else if (input.upstreamConstrained || run.failed || run.timedOut) status = "constrained";
  else status = "no-new-content";
  reason ??= run.structureRejected + run.evidenceRejected + run.semanticRejected > 0 ? "validation" : input.upstreamConstrained ? "upstream" : !cards.length && !selected.length ? "no-recent-sources" : undefined;
  const artifact: ProgressExplainersArtifact = { schemaVersion: 1, generatedAt: checkedAt, lastContentUpdatedAt: changed ? checkedAt : input.previous?.lastContentUpdatedAt ?? null, checkedAt, status, ...(reason ? { reason } : {}), cards };
  validateProgressExplainersArtifact(artifact);
  return { artifact, report: run };
}
