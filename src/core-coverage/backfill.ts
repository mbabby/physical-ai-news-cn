import { createHash } from "node:crypto";
import type { ReviewCaseSeed } from "../review-cases.js";
import type { CoverageMember, CoverageVersion } from "./contracts.js";

export type BackfillField = "identity" | "capital" | "product" | "deployment";
export type BackfillStatus = "pending" | "checked" | "blocked";
export type BackfillReason = "none" | "missing-evidence" | "rate-limited" | "unavailable" | "ambiguous-entity";

export interface BackfillTask {
  taskId: string;
  companyId: string;
  field: BackfillField;
  status: BackfillStatus;
  reason: BackfillReason;
  evidenceUrls: string[];
  firstSeenAt: string;
  lastActionAt: string | null;
  dispositionHistory?: Array<{
    status: BackfillStatus;
    reason: BackfillReason;
    evidenceUrls: string[];
    lastActionAt: string | null;
    reopenedAt: string;
    signals: BackfillPrioritySignal[];
  }>;
}

export type BackfillPriorityKind = "public-error" | "retraction" | "new-finding" | "gap";

export interface BackfillPrioritySignal {
  taskId: string;
  kind: BackfillPriorityKind;
  signalId?: string;
}

/** A stable correction reopens checked work once; the old disposition stays auditable. */
export function reopenCheckedBackfillTasks(tasks: readonly BackfillTask[], signals: readonly BackfillPrioritySignal[], now: Date): BackfillTask[] {
  return tasks.map((task) => {
    if (task.status !== "checked") return task;
    const consumed = new Set(task.dispositionHistory?.flatMap((entry) => entry.signals.map((signal) => signal.signalId)));
    const fresh = signals.filter((signal) => signal.taskId === task.taskId && signal.signalId && !consumed.has(signal.signalId)
      && (signal.kind === "public-error" || signal.kind === "retraction"));
    if (!fresh.length) return task;
    return { ...task, status: "pending", dispositionHistory: [...(task.dispositionHistory ?? []), {
      status: task.status, reason: task.reason, evidenceUrls: [...task.evidenceUrls], lastActionAt: task.lastActionAt,
      reopenedAt: asIso(now), signals: structuredClone(fresh),
    }] };
  });
}

const FIELDS: readonly BackfillField[] = ["identity", "capital", "product", "deployment"];
const REGIONS: readonly CoverageMember["coverageRegion"][] = ["china", "north-america", "other"];
const TIERS: readonly CoverageMember["tier"][] = ["commercial", "platform", "strategic"];
const PRIORITY: Record<BackfillPriorityKind, number> = { "public-error": 0, retraction: 1, "new-finding": 2, gap: 3 };

function asIso(value: string | Date): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid backfill timestamp: ${value}`);
  return date.toISOString();
}

function normalizedUrls(urls: readonly string[]): string[] {
  return [...new Set(urls.map((url) => url.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

export function backfillTaskId(coverageVersion: string, companyId: string, field: BackfillField): string {
  const digest = createHash("sha256").update(`${coverageVersion.trim()}:${companyId.trim()}:${field}`).digest("hex").slice(0, 16);
  return `core30-backfill-${digest}`;
}

/** Build the complete checkpoint ledger. Only an explicit previous record can carry a disposition. */
export function buildBackfillTasks(coverage: CoverageVersion, previous: readonly BackfillTask[], now: Date): BackfillTask[] {
  const firstSeenAt = asIso(now);
  const previousById = new Map(previous.map((task) => [task.taskId, task]));
  return coverage.members.flatMap((member) => FIELDS.map((field): BackfillTask => {
    const taskId = backfillTaskId(coverage.version, member.companyId, field);
    const saved = previousById.get(taskId);
    if (!saved) return { taskId, companyId: member.companyId, field, status: "pending", reason: "none", evidenceUrls: [], firstSeenAt, lastActionAt: null };
    return {
      taskId,
      companyId: member.companyId,
      field,
      status: saved.status,
      reason: saved.reason,
      evidenceUrls: normalizedUrls(saved.evidenceUrls),
      firstSeenAt: asIso(saved.firstSeenAt),
      lastActionAt: saved.lastActionAt ? asIso(saved.lastActionAt) : null,
      ...(saved.dispositionHistory ? { dispositionHistory: structuredClone(saved.dispositionHistory) } : {}),
    };
  }));
}

/** Round-robin region/tier strata so an initial batch cannot be dominated by one cohort. */
export function selectInitialBackfillCompanyIds(coverage: CoverageVersion, limit = 10): string[] {
  const buckets = TIERS.flatMap((tier) => REGIONS.map((region) => coverage.members
    .filter((member) => member.tier === tier && member.coverageRegion === region)
    .map((member) => member.companyId)));
  const selected: string[] = [];
  while (selected.length < Math.max(0, limit) && buckets.some((bucket) => bucket.length)) {
    for (const bucket of buckets) {
      const companyId = bucket.shift();
      if (companyId) selected.push(companyId);
      if (selected.length >= limit) break;
    }
  }
  return selected;
}

/** Keep only unfinished work and cap the scarce active-review surface. */
export function buildActiveBackfillQueue(
  tasks: readonly BackfillTask[],
  signals: readonly BackfillPrioritySignal[] = [],
  limit = 20,
): BackfillTask[] {
  const signalByTask = new Map<string, BackfillPriorityKind>();
  for (const signal of signals) {
    const saved = signalByTask.get(signal.taskId);
    if (!saved || PRIORITY[signal.kind] < PRIORITY[saved]) signalByTask.set(signal.taskId, signal.kind);
  }
  return tasks.filter((task) => task.status === "pending" || (task.status === "blocked" && signalByTask.has(task.taskId) && signalByTask.get(task.taskId) !== "gap"))
    .sort((left, right) => PRIORITY[signalByTask.get(left.taskId) ?? "gap"] - PRIORITY[signalByTask.get(right.taskId) ?? "gap"]
      || left.firstSeenAt.localeCompare(right.firstSeenAt) || left.taskId.localeCompare(right.taskId))
    .slice(0, Math.max(0, limit));
}

/** Adapter only: ownership and capacity remain the responsibility of review-assignment. */
export function backfillTasksToReviewCaseSeeds(tasks: readonly BackfillTask[]): ReviewCaseSeed[] {
  return tasks.filter((task) => task.status !== "checked").map((task) => ({
    type: "company",
    subjectId: task.taskId,
    priority: "P2",
    createdAt: task.firstSeenAt,
    evidenceCount: task.evidenceUrls.length,
    hasConflict: task.reason === "ambiguous-entity",
    missingEvidence: [`core30:${task.companyId}:${task.field}:${task.reason}`],
    nextAction: task.status === "blocked"
      ? `解除 ${task.companyId}/${task.field} 的 ${task.reason} 阻塞后补证`
      : `核验 ${task.companyId} 的 ${task.field} 字段并记录原始证据`,
  }));
}

/** One integration path for the first mixed cohort, bounded queue and review adapter. */
export function buildBackfillReviewCaseSeeds(
  coverage: CoverageVersion,
  tasks: readonly BackfillTask[],
  signals: readonly BackfillPrioritySignal[] = [],
): ReviewCaseSeed[] {
  const unfinishedCompanies = new Set(tasks.filter((task) => task.status === "pending").map((task) => task.companyId));
  const cohort = new Set(selectInitialBackfillCompanyIds(coverage, coverage.members.length)
    .filter((companyId) => unfinishedCompanies.has(companyId)).slice(0, 10));
  const globallyUrgent = new Set(signals
    .filter((signal) => signal.kind === "public-error" || signal.kind === "retraction"
      || (signal.kind === "new-finding" && tasks.some((task) => task.taskId === signal.taskId && task.status === "blocked")))
    .map((signal) => signal.taskId));
  const active = buildActiveBackfillQueue(
    tasks.filter((task) => cohort.has(task.companyId) || globallyUrgent.has(task.taskId)),
    signals,
    20,
  );
  return backfillTasksToReviewCaseSeeds(active);
}
