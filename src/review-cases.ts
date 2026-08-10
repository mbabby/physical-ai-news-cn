import { createHash } from "node:crypto";
import type { CandidateArticle, CandidateCompany, CandidateSource, ResearchRecord } from "./types.js";

/** A review case is an internal work item. It never promotes a candidate to a public surface. */
export type ReviewCaseType = "article" | "company" | "source" | "paper";
export type ReviewCasePriority = "P0" | "P1" | "P2" | "P3";
export type ReviewCaseState = "open" | "in_progress" | "accepted" | "rejected";
export type ReviewDecision = "accepted" | "rejected" | "deferred";
export type ReviewAuditAction = "created" | "updated" | "assigned" | "started" | "probe" | "accepted" | "rejected" | "deferred";

export interface ReviewCaseAuditEntry {
  at: string;
  action: ReviewAuditAction;
  detail: string;
}

/**
 * All nullable fields are deliberately written as null instead of omitted.
 * This makes owner-less and undecided work visible to JSON consumers.
 */
export interface ReviewCase {
  caseId: string;
  type: ReviewCaseType;
  subjectId: string;
  owner: string | null;
  priority: ReviewCasePriority;
  state: ReviewCaseState;
  createdAt: string;
  firstActionAt: string | null;
  dueAt: string;
  lastActionAt: string | null;
  nextAction: string | null;
  missingEvidence: string[];
  decision: ReviewDecision | null;
  decisionReason: string | null;
  linkedIssue: string | null;
  acceptedEvidenceId: string | null;
  auditTrail: ReviewCaseAuditEntry[];
}

export interface ReviewCaseSeed {
  type: ReviewCaseType;
  /** Stable ID from the owning registry; display names and titles are never used as identity. */
  subjectId: string;
  priority?: ReviewCasePriority;
  /** 0-100 impact signal supplied by the source queue. */
  impactScore?: number;
  evidenceCount?: number;
  hasConflict?: boolean;
  owner?: string | null;
  state?: ReviewCaseState;
  createdAt?: string;
  dueAt?: string;
  nextAction?: string | null;
  missingEvidence?: string[];
  linkedIssue?: string | null;
  decision?: ReviewDecision | null;
  decisionReason?: string | null;
  acceptedEvidenceId?: string | null;
}

export interface ReviewCaseAction {
  caseId: string;
  action: Exclude<ReviewAuditAction, "created" | "updated">;
  at?: string;
  owner?: string | null;
  nextAction?: string | null;
  detail?: string;
  linkedIssue?: string | null;
  acceptedEvidenceId?: string | null;
  decisionReason?: string | null;
}

export interface ReviewSlo {
  firstResponseHours: number;
}

export interface ReviewCaseAlert {
  code: "overdue" | "unowned" | "no-next-action";
  severity: "warning" | "critical";
  caseId: string;
  message: string;
}

export interface ReviewCaseMetrics {
  /** Of the priority-ranked 20 currently due cases, how many have had a verification probe. */
  dueTop20ProbeCoverage: { eligible: number; covered: number; rate: number | undefined };
  /** Elapsed hours from case creation to the first non-creation action. */
  firstResponseP90Hours: number | undefined;
  /** Age in hours for open and in-progress cases. */
  backlogAgeHours: { cases: number; p50: number | undefined; p90: number | undefined; max: number | undefined };
  /** Cases with a response deadline that have been resolved, responded to, or have become due. */
  sloComplianceRate: { eligible: number; met: number; rate: number | undefined };
}

export interface ReviewCaseArtifact {
  schemaVersion: 1;
  generatedAt: string;
  cases: ReviewCase[];
  alerts: ReviewCaseAlert[];
  metrics: ReviewCaseMetrics;
}

export interface ReviewCaseGenerator {
  id: string;
  generate(): Iterable<ReviewCaseSeed>;
}

const PRIORITY_ORDER: Record<ReviewCasePriority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
const SLO: Record<ReviewCasePriority, ReviewSlo> = {
  P0: { firstResponseHours: 4 },
  P1: { firstResponseHours: 24 },
  P2: { firstResponseHours: 72 },
  P3: { firstResponseHours: 168 },
};

function asIso(value: string | Date): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid review-case timestamp: ${value}`);
  return date.toISOString();
}

function normalizeText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizedEvidence(items: string[] | undefined): string[] {
  return [...new Set((items ?? []).map((item) => item.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function addHours(value: string, hours: number): string {
  return new Date(new Date(value).getTime() + hours * 3_600_000).toISOString();
}

function active(item: ReviewCase): boolean { return item.state === "open" || item.state === "in_progress"; }
function timestamp(value: string): number { return new Date(value).getTime(); }
function compareCases(left: ReviewCase, right: ReviewCase): number {
  return PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority]
    || timestamp(left.dueAt) - timestamp(right.dueAt)
    || left.caseId.localeCompare(right.caseId);
}

/** Stable even when a title, alias, or source display name changes. */
export function reviewCaseId(type: ReviewCaseType, subjectId: string): string {
  const subject = subjectId.trim();
  if (!subject) throw new Error("Review case subjectId must not be empty");
  const digest = createHash("sha256").update(`${type}:${subject}`).digest("hex").slice(0, 16);
  return `review-${type}-${digest}`;
}

export function reviewSlo(priority: ReviewCasePriority): ReviewSlo { return SLO[priority]; }

/** Priority is deterministic; callers may supply an explicit escalation. */
export function calculateReviewPriority(seed: Pick<ReviewCaseSeed, "priority" | "type" | "impactScore" | "evidenceCount" | "hasConflict">): ReviewCasePriority {
  if (seed.priority) return seed.priority;
  const typeWeight: Record<ReviewCaseType, number> = { article: 25, company: 30, source: 20, paper: 15 };
  const impact = Math.max(0, Math.min(100, seed.impactScore ?? 0));
  const score = typeWeight[seed.type] + impact * 0.6 + (seed.evidenceCount === 0 ? 10 : 0) + (seed.hasConflict ? 15 : 0);
  if (score >= 85) return "P0";
  if (score >= 65) return "P1";
  if (score >= 40) return "P2";
  return "P3";
}

function newCase(seed: ReviewCaseSeed, now: string): ReviewCase {
  const createdAt = asIso(seed.createdAt ?? now);
  const priority = calculateReviewPriority(seed);
  const state = seed.state ?? (seed.decision === "accepted" ? "accepted" : seed.decision === "rejected" ? "rejected" : "open");
  const missingEvidence = normalizedEvidence(seed.missingEvidence);
  const nextAction = state === "accepted" || state === "rejected"
    ? null
    : seed.nextAction === undefined
      ? missingEvidence[0] ?? "确认主体与原始证据"
      : normalizeText(seed.nextAction);
  const dueAt = asIso(seed.dueAt ?? addHours(createdAt, reviewSlo(priority).firstResponseHours));
  return {
    caseId: reviewCaseId(seed.type, seed.subjectId), type: seed.type, subjectId: seed.subjectId.trim(), owner: normalizeText(seed.owner), priority, state, createdAt,
    firstActionAt: null, dueAt, lastActionAt: null, nextAction, missingEvidence,
    decision: seed.decision ?? (state === "accepted" ? "accepted" : state === "rejected" ? "rejected" : null),
    decisionReason: normalizeText(seed.decisionReason), linkedIssue: normalizeText(seed.linkedIssue), acceptedEvidenceId: normalizeText(seed.acceptedEvidenceId),
    auditTrail: [{ at: now, action: "created", detail: `Generated from ${seed.type}:${seed.subjectId.trim()}` }],
  };
}

function cloneCase(value: ReviewCase): ReviewCase {
  return { ...value, missingEvidence: [...value.missingEvidence], auditTrail: value.auditTrail.map((entry) => ({ ...entry })) };
}

/**
 * Deterministic upsert: a repeated seed does not create another case or audit
 * entry. Source-controlled fields refresh only when their normalized value changes.
 */
export function upsertReviewCases(existing: readonly ReviewCase[], seeds: Iterable<ReviewCaseSeed>, now = new Date()): ReviewCase[] {
  const nowIso = asIso(now);
  const byId = new Map(existing.map((item) => [item.caseId, cloneCase(item)]));
  const orderedSeeds = [...seeds].sort((a, b) => reviewCaseId(a.type, a.subjectId).localeCompare(reviewCaseId(b.type, b.subjectId)));
  for (const seed of orderedSeeds) {
    const caseId = reviewCaseId(seed.type, seed.subjectId);
    const saved = byId.get(caseId);
    if (!saved) { byId.set(caseId, newCase(seed, nowIso)); continue; }
    const priority = calculateReviewPriority(seed);
    const missingEvidence = normalizedEvidence(seed.missingEvidence);
    const linkedIssue = seed.linkedIssue === undefined ? saved.linkedIssue : normalizeText(seed.linkedIssue);
    const changes: string[] = [];
    if (PRIORITY_ORDER[priority] < PRIORITY_ORDER[saved.priority]) {
      saved.priority = priority;
      const escalatedDue = addHours(saved.createdAt, reviewSlo(priority).firstResponseHours);
      if (timestamp(escalatedDue) < timestamp(saved.dueAt)) saved.dueAt = escalatedDue;
      changes.push(`priority:${priority}`);
    }
    if (seed.missingEvidence !== undefined && JSON.stringify(missingEvidence) !== JSON.stringify(saved.missingEvidence)) { saved.missingEvidence = missingEvidence; changes.push("missingEvidence"); }
    if (seed.nextAction !== undefined && active(saved)) {
      const nextAction = normalizeText(seed.nextAction);
      if (nextAction !== saved.nextAction) { saved.nextAction = nextAction; changes.push("nextAction"); }
    }
    if (seed.linkedIssue !== undefined && linkedIssue !== saved.linkedIssue) { saved.linkedIssue = linkedIssue; changes.push("linkedIssue"); }
    if (changes.length) saved.auditTrail.push({ at: nowIso, action: "updated", detail: changes.join(",") });
  }
  return [...byId.values()].sort(compareCases);
}

/** Apply human/system actions separately from generator upserts so reruns cannot overwrite decisions. */
export function applyReviewCaseActions(cases: readonly ReviewCase[], actions: Iterable<ReviewCaseAction>, now = new Date()): ReviewCase[] {
  const byId = new Map(cases.map((item) => [item.caseId, cloneCase(item)]));
  for (const input of [...actions].sort((a, b) => a.caseId.localeCompare(b.caseId) || (a.at ?? "").localeCompare(b.at ?? "") || a.action.localeCompare(b.action))) {
    const item = byId.get(input.caseId);
    if (!item) throw new Error(`Unknown review case: ${input.caseId}`);
    const at = asIso(input.at ?? now);
    const detail = normalizeText(input.detail) ?? input.action;
    if (input.owner !== undefined) item.owner = normalizeText(input.owner);
    if (input.nextAction !== undefined) item.nextAction = normalizeText(input.nextAction);
    if (input.linkedIssue !== undefined) item.linkedIssue = normalizeText(input.linkedIssue);
    if (input.action === "started") item.state = "in_progress";
    if (input.action === "accepted") {
      item.state = "accepted"; item.decision = "accepted"; item.decisionReason = normalizeText(input.decisionReason) ?? item.decisionReason;
      item.acceptedEvidenceId = normalizeText(input.acceptedEvidenceId) ?? item.acceptedEvidenceId; item.nextAction = null;
    }
    if (input.action === "rejected") {
      item.state = "rejected"; item.decision = "rejected"; item.decisionReason = normalizeText(input.decisionReason) ?? item.decisionReason; item.nextAction = null;
    }
    if (input.action === "deferred") { item.state = "open"; item.decision = "deferred"; item.decisionReason = normalizeText(input.decisionReason) ?? item.decisionReason; }
    if (!item.firstActionAt) item.firstActionAt = at;
    item.lastActionAt = at;
    item.auditTrail.push({ at, action: input.action, detail });
  }
  return [...byId.values()].sort(compareCases);
}

function percentile(values: number[], p: number): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] * 100) / 100;
}

function hasDueProbe(item: ReviewCase): boolean {
  const created = timestamp(item.createdAt);
  return item.auditTrail.some((entry) => entry.action === "probe" && timestamp(entry.at) >= created);
}

export function reviewCaseMetrics(cases: readonly ReviewCase[], now = new Date()): ReviewCaseMetrics {
  const nowTime = now.getTime();
  const dueTop20 = cases.filter((item) => active(item) && timestamp(item.dueAt) <= nowTime).sort(compareCases).slice(0, 20);
  const covered = dueTop20.filter(hasDueProbe).length;
  const responses = cases.flatMap((item) => item.firstActionAt ? [(timestamp(item.firstActionAt) - timestamp(item.createdAt)) / 3_600_000] : []);
  const backlog = cases.filter(active).map((item) => Math.max(0, (nowTime - timestamp(item.createdAt)) / 3_600_000));
  const sloCases = cases.filter((item) => Boolean(item.firstActionAt) || timestamp(item.dueAt) <= nowTime || !active(item));
  const met = sloCases.filter((item) => item.firstActionAt !== null && timestamp(item.firstActionAt) <= timestamp(item.dueAt)).length;
  return {
    dueTop20ProbeCoverage: { eligible: dueTop20.length, covered, rate: dueTop20.length ? Number((covered / dueTop20.length).toFixed(2)) : undefined },
    firstResponseP90Hours: percentile(responses, 0.9),
    backlogAgeHours: { cases: backlog.length, p50: percentile(backlog, 0.5), p90: percentile(backlog, 0.9), max: backlog.length ? Math.round(Math.max(...backlog) * 100) / 100 : undefined },
    sloComplianceRate: { eligible: sloCases.length, met, rate: sloCases.length ? Number((met / sloCases.length).toFixed(2)) : undefined },
  };
}

export function reviewCaseAlerts(cases: readonly ReviewCase[], now = new Date()): ReviewCaseAlert[] {
  const nowTime = now.getTime();
  const alerts: ReviewCaseAlert[] = [];
  for (const item of [...cases].sort(compareCases)) {
    if (!active(item)) continue;
    const severity = item.priority === "P0" ? "critical" : "warning";
    if (!item.firstActionAt && timestamp(item.dueAt) < nowTime) alerts.push({ code: "overdue", severity, caseId: item.caseId, message: `${item.caseId} missed its first-response SLO at ${item.dueAt}` });
    if (!item.owner) alerts.push({ code: "unowned", severity, caseId: item.caseId, message: `${item.caseId} has no explicit owner` });
    if (!item.nextAction) alerts.push({ code: "no-next-action", severity, caseId: item.caseId, message: `${item.caseId} has no next action` });
  }
  return alerts;
}

/** Combines independent seed generators without coupling this module to the daily job. */
export function buildReviewCaseArtifact(existing: ReviewCaseArtifact | undefined, generators: Iterable<ReviewCaseGenerator>, now = new Date()): ReviewCaseArtifact {
  const seeds = [...generators]
    .sort((a, b) => a.id.localeCompare(b.id))
    .flatMap((generator) => [...generator.generate()]);
  const cases = upsertReviewCases(existing?.cases ?? [], seeds, now);
  return { schemaVersion: 1, generatedAt: asIso(now), cases, alerts: reviewCaseAlerts(cases, now), metrics: reviewCaseMetrics(cases, now) };
}

/** Stable, newline-terminated JSON suitable for a review/ artifact writer. */
export function serializeReviewCaseArtifact(artifact: ReviewCaseArtifact): string {
  return `${JSON.stringify({ ...artifact, cases: [...artifact.cases].sort(compareCases) }, null, 2)}\n`;
}

export function candidateArticleReviewCase(article: CandidateArticle): ReviewCaseSeed {
  return {
    type: "article", subjectId: article.id, createdAt: article.fetchedAt.toISOString(), impactScore: (article.score ?? 0) + article.sourceWeight * 8,
    priority: article.sourceWeight >= 9 ? "P0" : undefined, evidenceCount: 1, missingEvidence: article.holdReasons, nextAction: article.holdReasons[0] ?? "补充原始事实证据",
  };
}

export function candidateCompanyReviewCase(company: CandidateCompany): ReviewCaseSeed {
  return {
    type: "company", subjectId: company.id, createdAt: company.firstSeenAt, impactScore: company.verificationScore,
    evidenceCount: company.evidence.length, missingEvidence: company.openQuestions, nextAction: company.openQuestions[0] ?? "确认公司主体与融资证据",
  };
}

export function candidateSourceReviewCase(source: CandidateSource): ReviewCaseSeed {
  return {
    type: "source", subjectId: source.domain, createdAt: source.firstSeenAt, impactScore: Math.min(100, source.successfulRuns * 12 + source.selectedArticles * 8),
    evidenceCount: source.selectedArticles, missingEvidence: ["确认来源性质、稳定 feed 与事实证据边界"], nextAction: "验证 RSS/Atom/Releases 入口及样例",
  };
}

export function paperReviewCase(record: ResearchRecord): ReviewCaseSeed {
  return {
    type: "paper", subjectId: record.id, createdAt: record.firstSeenAt, impactScore: Math.min(100, record.article.scholar?.citedByCount ?? 0),
    evidenceCount: record.article.scholar ? 1 : 0, hasConflict: record.status === "已撤稿", missingEvidence: record.status === "已撤稿" ? ["确认撤稿原因与公开条目清理范围"] : ["核对论文元数据、作者与可复现实证据"],
    nextAction: record.status === "已撤稿" ? "确认撤稿处置" : "核验论文元数据与实证材料",
  };
}

/** Convenience generator for the four current candidate registries; integration remains opt-in. */
export function reviewCaseGenerator(input: {
  articles?: readonly CandidateArticle[];
  companies?: readonly CandidateCompany[];
  sources?: readonly CandidateSource[];
  papers?: readonly ResearchRecord[];
}): ReviewCaseGenerator {
  return {
    id: "candidate-registries",
    *generate() {
      yield* (input.articles ?? []).map(candidateArticleReviewCase);
      yield* (input.companies ?? []).map(candidateCompanyReviewCase);
      yield* (input.sources ?? []).map(candidateSourceReviewCase);
      yield* (input.papers ?? []).map(paperReviewCase);
    },
  };
}
