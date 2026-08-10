import { reviewSlo } from "./review-cases.js";
import type { ReviewCase, ReviewCasePriority, ReviewCaseType } from "./review-cases.js";

export interface ReviewOwner {
  ownerId: string;
  /** Maximum concurrently open/in-progress assignments. Zero disables assignment. */
  maxActiveCases: number;
  caseTypes?: readonly ReviewCaseType[];
  priorities?: readonly ReviewCasePriority[];
  active?: boolean;
}

export type ReviewAssignmentStatus = "assigned" | "unassigned" | "completed";
export type ReviewAssignmentReason = "matched-owner" | "no-eligible-owner" | "capacity-exhausted" | "case-completed";
export type ReviewAssignmentAuditAction = "assigned" | "reassigned" | "degraded" | "refreshed" | "completed";

export interface ReviewAssignmentAuditEntry {
  at: string;
  action: ReviewAssignmentAuditAction;
  fromOwner: string | null;
  toOwner: string | null;
  detail: string;
}

export interface ReviewAssignment {
  caseId: string;
  owner: string | null;
  status: ReviewAssignmentStatus;
  reason: ReviewAssignmentReason;
  priority: ReviewCasePriority;
  dueAt: string;
  nextAction: string;
  slo: {
    firstResponseHours: number;
    breached: boolean;
  };
  assignedAt: string | null;
  updatedAt: string;
  /** Safe degradation is false: an unowned case must remain private. */
  autoDecisionAllowed: false;
  auditTrail: ReviewAssignmentAuditEntry[];
}

export interface ReviewAssignmentMetrics {
  total: number;
  assigned: number;
  unassigned: number;
  completed: number;
  overdueWithoutResponse: number;
  ownerLoad: Record<string, { active: number; capacity: number }>;
}

export interface ReviewAssignmentArtifact {
  schemaVersion: 1;
  generatedAt: string;
  assignments: ReviewAssignment[];
  metrics: ReviewAssignmentMetrics;
}

const PRIORITY_ORDER: Record<ReviewCasePriority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

function required(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} must not be empty`);
  return trimmed;
}

function asIso(value: string | Date): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid review-assignment timestamp: ${value}`);
  return date.toISOString();
}

function active(reviewCase: ReviewCase): boolean { return reviewCase.state === "open" || reviewCase.state === "in_progress"; }
function cloneAssignment(value: ReviewAssignment): ReviewAssignment { return { ...value, slo: { ...value.slo }, auditTrail: value.auditTrail.map((entry) => ({ ...entry })) }; }
function supports(owner: ReviewOwner, reviewCase: ReviewCase): boolean {
  return owner.active !== false && owner.maxActiveCases > 0
    && (!owner.caseTypes || owner.caseTypes.includes(reviewCase.type))
    && (!owner.priorities || owner.priorities.includes(reviewCase.priority));
}
function fallbackNextAction(reviewCase: ReviewCase, reason?: ReviewAssignmentReason): string {
  if (reviewCase.nextAction?.trim()) return reviewCase.nextAction.trim();
  if (reason === "no-eligible-owner") return `配置可处理 ${reviewCase.type}/${reviewCase.priority} 的 Review owner；配置前保持私有`;
  if (reason === "capacity-exhausted") return "等待 Review owner 容量释放；期间保持私有";
  return "明确下一项核验动作后再开始审核";
}
function normalizedOwners(owners: readonly ReviewOwner[]): ReviewOwner[] {
  const result = owners.map((owner) => ({
    ...owner,
    ownerId: required(owner.ownerId, "Review ownerId"),
    maxActiveCases: Number.isFinite(owner.maxActiveCases) ? Math.max(0, Math.floor(owner.maxActiveCases)) : 0,
    caseTypes: owner.caseTypes ? [...new Set(owner.caseTypes)].sort() : undefined,
    priorities: owner.priorities ? [...new Set(owner.priorities)].sort((a, b) => PRIORITY_ORDER[a] - PRIORITY_ORDER[b]) : undefined,
  })).sort((left, right) => left.ownerId.localeCompare(right.ownerId));
  if (new Set(result.map((owner) => owner.ownerId)).size !== result.length) throw new Error("Duplicate Review ownerId configuration");
  return result;
}

function refreshAssignment(previous: ReviewAssignment, reviewCase: ReviewCase, now: Date): ReviewAssignment {
  const refreshed = cloneAssignment(previous);
  refreshed.priority = reviewCase.priority;
  refreshed.dueAt = asIso(reviewCase.dueAt);
  refreshed.nextAction = fallbackNextAction(reviewCase, refreshed.reason);
  refreshed.slo = {
    firstResponseHours: reviewSlo(reviewCase.priority).firstResponseHours,
    breached: !reviewCase.firstActionAt && new Date(reviewCase.dueAt).getTime() < now.getTime(),
  };
  refreshed.updatedAt = asIso(now);
  refreshed.auditTrail.push({ at: refreshed.updatedAt, action: "refreshed", fromOwner: refreshed.owner, toOwner: refreshed.owner, detail: "Priority, SLO, dueAt or nextAction changed" });
  return refreshed;
}

function sameMetadata(assignment: ReviewAssignment, reviewCase: ReviewCase, now: Date): boolean {
  return assignment.priority === reviewCase.priority && assignment.dueAt === asIso(reviewCase.dueAt)
    && assignment.nextAction === fallbackNextAction(reviewCase, assignment.reason)
    && assignment.slo.firstResponseHours === reviewSlo(reviewCase.priority).firstResponseHours
    && assignment.slo.breached === (!reviewCase.firstActionAt && new Date(reviewCase.dueAt).getTime() < now.getTime());
}

function assignmentFor(
  reviewCase: ReviewCase,
  owner: string | null,
  reason: ReviewAssignmentReason,
  now: Date,
  previous?: ReviewAssignment,
): ReviewAssignment {
  const nowIso = asIso(now);
  const status: ReviewAssignmentStatus = reason === "case-completed" ? "completed" : owner ? "assigned" : "unassigned";
  const nextAction = status === "completed" ? "无需后续动作；评审 case 已关闭" : fallbackNextAction(reviewCase, reason);
  const dueAt = asIso(reviewCase.dueAt);
  const breached = !reviewCase.firstActionAt && new Date(dueAt).getTime() < now.getTime();
  const action: ReviewAssignmentAuditAction = status === "completed" ? "completed" : owner ? (previous?.owner ? "reassigned" : "assigned") : "degraded";
  const detail = reason === "matched-owner" ? `Assigned within owner capacity for ${reviewCase.type}/${reviewCase.priority}`
    : reason === "no-eligible-owner" ? "No configured owner matches this case; case remains private and undecided"
      : reason === "capacity-exhausted" ? "All matching owners are at capacity; case remains private and undecided"
        : "Review case reached a terminal state";
  return {
    caseId: reviewCase.caseId, owner, status, reason, priority: reviewCase.priority, dueAt, nextAction,
    slo: { firstResponseHours: reviewSlo(reviewCase.priority).firstResponseHours, breached },
    assignedAt: owner ? nowIso : null, updatedAt: nowIso, autoDecisionAllowed: false,
    auditTrail: [...(previous?.auditTrail ?? []), { at: nowIso, action, fromOwner: previous?.owner ?? null, toOwner: owner, detail }],
  };
}

/**
 * Deterministic, sticky auto-assignment. Existing valid owners retain their
 * work; new cases choose the lowest utilization and then stable owner ID.
 */
export function assignReviewCases(
  cases: readonly ReviewCase[],
  owners: readonly ReviewOwner[],
  existing: readonly ReviewAssignment[] = [],
  now = new Date(),
): ReviewAssignment[] {
  const configured = normalizedOwners(owners);
  const ownerById = new Map(configured.map((owner) => [owner.ownerId, owner]));
  const caseById = new Map(cases.map((reviewCase) => [reviewCase.caseId, reviewCase]));
  const byCase = new Map(existing.filter((assignment) => caseById.has(assignment.caseId)).map((assignment) => [assignment.caseId, cloneAssignment(assignment)]));
  const load = new Map(configured.map((owner) => [owner.ownerId, 0]));

  // Reserve capacity for sticky assignments before allocating new work.
  for (const reviewCase of cases) {
    const previous = byCase.get(reviewCase.caseId);
    const owner = previous?.owner ? ownerById.get(previous.owner) : undefined;
    if (active(reviewCase) && previous?.status === "assigned" && owner && supports(owner, reviewCase)) load.set(owner.ownerId, (load.get(owner.ownerId) ?? 0) + 1);
  }

  const ordered = [...cases].sort((left, right) => PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority]
    || new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime() || left.caseId.localeCompare(right.caseId));
  for (const reviewCase of ordered) {
    const previous = byCase.get(reviewCase.caseId);
    if (!active(reviewCase)) {
      if (previous?.status === "completed") continue;
      byCase.set(reviewCase.caseId, assignmentFor(reviewCase, previous?.owner ?? null, "case-completed", now, previous));
      continue;
    }
    const stickyOwner = previous?.owner ? ownerById.get(previous.owner) : undefined;
    if (previous?.status === "assigned" && stickyOwner && supports(stickyOwner, reviewCase)) {
      if (!sameMetadata(previous, reviewCase, now)) byCase.set(reviewCase.caseId, refreshAssignment(previous, reviewCase, now));
      continue;
    }

    const eligible = configured.filter((owner) => supports(owner, reviewCase));
    const available = eligible.filter((owner) => (load.get(owner.ownerId) ?? 0) < owner.maxActiveCases)
      .sort((left, right) => ((load.get(left.ownerId) ?? 0) / left.maxActiveCases) - ((load.get(right.ownerId) ?? 0) / right.maxActiveCases)
        || (load.get(left.ownerId) ?? 0) - (load.get(right.ownerId) ?? 0) || left.ownerId.localeCompare(right.ownerId));
    const selected = available[0];
    if (selected) {
      load.set(selected.ownerId, (load.get(selected.ownerId) ?? 0) + 1);
      byCase.set(reviewCase.caseId, assignmentFor(reviewCase, selected.ownerId, "matched-owner", now, previous));
    } else {
      const reason: ReviewAssignmentReason = eligible.length ? "capacity-exhausted" : "no-eligible-owner";
      if (previous?.status === "unassigned" && previous.reason === reason) {
        if (!sameMetadata(previous, reviewCase, now)) byCase.set(reviewCase.caseId, refreshAssignment(previous, reviewCase, now));
      } else {
        byCase.set(reviewCase.caseId, assignmentFor(reviewCase, null, reason, now, previous));
      }
    }
  }
  return [...byCase.values()].sort((left, right) => PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority]
    || new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime() || left.caseId.localeCompare(right.caseId));
}

export function reviewAssignmentMetrics(assignments: readonly ReviewAssignment[], owners: readonly ReviewOwner[], cases: readonly ReviewCase[]): ReviewAssignmentMetrics {
  const configured = normalizedOwners(owners);
  const activeCaseIds = new Set(cases.filter(active).map((reviewCase) => reviewCase.caseId));
  const ownerLoad = Object.fromEntries(configured.map((owner) => [owner.ownerId, {
    active: assignments.filter((assignment) => assignment.owner === owner.ownerId && assignment.status === "assigned" && activeCaseIds.has(assignment.caseId)).length,
    capacity: owner.maxActiveCases,
  }]));
  return {
    total: assignments.length, assigned: assignments.filter((item) => item.status === "assigned").length,
    unassigned: assignments.filter((item) => item.status === "unassigned").length,
    completed: assignments.filter((item) => item.status === "completed").length,
    overdueWithoutResponse: assignments.filter((item) => item.status !== "completed" && item.slo.breached).length,
    ownerLoad,
  };
}

export function buildReviewAssignmentArtifact(
  cases: readonly ReviewCase[],
  owners: readonly ReviewOwner[],
  existing: ReviewAssignmentArtifact | undefined,
  now = new Date(),
): ReviewAssignmentArtifact {
  const assignments = assignReviewCases(cases, owners, existing?.assignments ?? [], now);
  return { schemaVersion: 1, generatedAt: asIso(now), assignments, metrics: reviewAssignmentMetrics(assignments, owners, cases) };
}
