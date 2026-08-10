import { createHash } from "node:crypto";

/**
 * A decision unit deliberately contains references, not facts. Consumers must
 * resolve these IDs against the event, claim and research-card owners.
 */
export type DecisionReferenceKind = "event" | "claim" | "research-decision-card";

export interface DecisionReference {
  kind: DecisionReferenceKind;
  id: string;
}

export type DecisionFunnelStage = "discovered" | "shortlisted" | "evaluating" | "decided" | "acted" | "dismissed";
export type DecisionUnitStatus = "active" | "converted" | "rejected";
export type DecisionAuditAction = "created" | "references-linked" | "stage-transition";

export interface DecisionUnitAuditEvent {
  /** Idempotency key supplied by the producer, or the deterministic create event ID. */
  eventId: string;
  at: string;
  action: DecisionAuditAction;
  fromStage: DecisionFunnelStage | null;
  toStage: DecisionFunnelStage;
  actorId: string;
  detail: string;
  referenceIds: string[];
}

export interface DecisionUnit {
  unitId: string;
  /** Stable pseudonymous account/team ID. Display names are not identity. */
  actorId: string;
  /** Stable product/domain key for the decision the actor is making. */
  decisionKey: string;
  references: DecisionReference[];
  stage: DecisionFunnelStage;
  status: DecisionUnitStatus;
  createdAt: string;
  updatedAt: string;
  auditTrail: DecisionUnitAuditEvent[];
}

export interface DecisionUnitSeed {
  actorId: string;
  decisionKey: string;
  references: readonly DecisionReference[];
  createdAt?: string;
}

export interface DecisionFunnelTransition {
  unitId: string;
  /** Required idempotency key. Reusing it for a different transition is rejected. */
  eventId: string;
  toStage: DecisionFunnelStage;
  actorId: string;
  at?: string;
  detail?: string;
}

export interface DecisionFunnelMetrics {
  totalUnits: number;
  byStage: Record<DecisionFunnelStage, number>;
  active: number;
  converted: number;
  rejected: number;
  transitionEvents: number;
  conversionRate: number | undefined;
}

export interface DecisionUnitArtifact {
  schemaVersion: 1;
  generatedAt: string;
  units: DecisionUnit[];
  funnel: DecisionFunnelMetrics;
}

const STAGES: readonly DecisionFunnelStage[] = ["discovered", "shortlisted", "evaluating", "decided", "acted", "dismissed"];
const ALLOWED_TRANSITIONS: Record<DecisionFunnelStage, readonly DecisionFunnelStage[]> = {
  discovered: ["shortlisted", "evaluating", "dismissed"],
  shortlisted: ["evaluating", "dismissed"],
  evaluating: ["decided", "dismissed"],
  decided: ["acted", "dismissed"],
  acted: [],
  dismissed: [],
};

function required(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} must not be empty`);
  return trimmed;
}

function asIso(value: string | Date): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid decision-unit timestamp: ${value}`);
  return date.toISOString();
}

function referenceKey(reference: DecisionReference): string { return `${reference.kind}:${reference.id}`; }

function normalizeReferences(references: readonly DecisionReference[]): DecisionReference[] {
  const byKey = new Map<string, DecisionReference>();
  for (const input of references) {
    if (!(["event", "claim", "research-decision-card"] as const).includes(input.kind)) throw new Error(`Unknown decision reference kind: ${input.kind}`);
    const reference = { kind: input.kind, id: required(input.id, "Decision reference id") };
    byKey.set(referenceKey(reference), reference);
  }
  if (!byKey.size) throw new Error("Decision unit must reference at least one stable ID");
  return [...byKey.values()].sort((left, right) => referenceKey(left).localeCompare(referenceKey(right)));
}

function statusFor(stage: DecisionFunnelStage): DecisionUnitStatus {
  return stage === "acted" ? "converted" : stage === "dismissed" ? "rejected" : "active";
}

function cloneUnit(unit: DecisionUnit): DecisionUnit {
  return {
    ...unit,
    references: unit.references.map((reference) => ({ ...reference })),
    auditTrail: unit.auditTrail.map((event) => ({ ...event, referenceIds: [...event.referenceIds] })),
  };
}

/** Stable across display-copy or referenced-fact changes. */
export function decisionUnitId(actorId: string, decisionKey: string): string {
  const actor = required(actorId, "Decision actorId");
  const decision = required(decisionKey, "Decision decisionKey");
  const digest = createHash("sha256").update(`${actor}\n${decision}`).digest("hex").slice(0, 16);
  return `decision-${digest}`;
}

/**
 * Produce the stable ID for a materialized claim without copying its statement
 * or value into a decision unit. Evidence IDs make repeated claim types unique.
 */
export function claimDecisionReferenceId(input: { companyId: string; claimType: string; evidenceIds: readonly string[] }): string {
  const companyId = required(input.companyId, "Claim companyId");
  const claimType = required(input.claimType, "Claim claimType");
  const evidenceIds = [...new Set(input.evidenceIds.map((item) => required(item, "Claim evidence id")))].sort();
  const digest = createHash("sha256").update(`${companyId}\n${claimType}\n${evidenceIds.join("\n")}`).digest("hex").slice(0, 16);
  return `claim-${digest}`;
}

export function eventDecisionReference(eventId: string): DecisionReference {
  return { kind: "event", id: required(eventId, "Event stable id") };
}

export function claimDecisionReference(input: { companyId: string; claimType: string; evidenceIds: readonly string[] }): DecisionReference {
  return { kind: "claim", id: claimDecisionReferenceId(input) };
}

export function researchDecisionCardReference(paperId: string): DecisionReference {
  const id = required(paperId, "ResearchDecisionCard stable paper id");
  if (id === "unknown") throw new Error("ResearchDecisionCard stable paper id must be known");
  return { kind: "research-decision-card", id };
}

/** Deterministic upsert. Existing state is never reset by a generator rerun. */
export function upsertDecisionUnits(existing: readonly DecisionUnit[], seeds: Iterable<DecisionUnitSeed>, now = new Date()): DecisionUnit[] {
  const nowIso = asIso(now);
  const byId = new Map(existing.map((unit) => [unit.unitId, cloneUnit(unit)]));
  const orderedSeeds = [...seeds].sort((left, right) => decisionUnitId(left.actorId, left.decisionKey).localeCompare(decisionUnitId(right.actorId, right.decisionKey)));
  for (const seed of orderedSeeds) {
    const actorId = required(seed.actorId, "Decision actorId");
    const decisionKey = required(seed.decisionKey, "Decision decisionKey");
    const references = normalizeReferences(seed.references);
    const unitId = decisionUnitId(actorId, decisionKey);
    const saved = byId.get(unitId);
    if (!saved) {
      const createdAt = asIso(seed.createdAt ?? nowIso);
      byId.set(unitId, {
        unitId, actorId, decisionKey, references, stage: "discovered", status: "active", createdAt, updatedAt: createdAt,
        auditTrail: [{
          eventId: `${unitId}:created`, at: createdAt, action: "created", fromStage: null, toStage: "discovered", actorId: "system",
          detail: "Decision unit created from stable references", referenceIds: references.map(referenceKey),
        }],
      });
      continue;
    }
    const merged = normalizeReferences([...saved.references, ...references]);
    const added = merged.filter((reference) => !saved.references.some((item) => referenceKey(item) === referenceKey(reference)));
    if (!added.length) continue;
    saved.references = merged;
    saved.updatedAt = nowIso;
    const referenceIds = added.map(referenceKey);
    saved.auditTrail.push({
      eventId: `${unitId}:references:${createHash("sha256").update(referenceIds.join("\n")).digest("hex").slice(0, 12)}`,
      at: nowIso, action: "references-linked", fromStage: saved.stage, toStage: saved.stage, actorId: "system",
      detail: "New stable references linked", referenceIds,
    });
  }
  return [...byId.values()].sort((left, right) => left.unitId.localeCompare(right.unitId));
}

function sameTransition(event: DecisionUnitAuditEvent, input: DecisionFunnelTransition): boolean {
  return event.action === "stage-transition" && event.toStage === input.toStage
    && event.actorId === input.actorId.trim() && event.detail === (input.detail?.trim() || `Moved to ${input.toStage}`);
}

/** Apply append-only funnel events with strict idempotency and transition validation. */
export function applyDecisionFunnelTransitions(units: readonly DecisionUnit[], transitions: Iterable<DecisionFunnelTransition>, now = new Date()): DecisionUnit[] {
  const byId = new Map(units.map((unit) => [unit.unitId, cloneUnit(unit)]));
  for (const input of transitions) {
    const unit = byId.get(input.unitId);
    if (!unit) throw new Error(`Unknown decision unit: ${input.unitId}`);
    const eventId = required(input.eventId, "Decision transition eventId");
    const actorId = required(input.actorId, "Decision transition actorId");
    if (!STAGES.includes(input.toStage)) throw new Error(`Unknown decision funnel stage: ${input.toStage}`);
    const prior = unit.auditTrail.find((event) => event.eventId === eventId);
    if (prior) {
      if (sameTransition(prior, { ...input, actorId })) continue;
      throw new Error(`Decision transition eventId conflict: ${eventId}`);
    }
    if (!ALLOWED_TRANSITIONS[unit.stage].includes(input.toStage)) throw new Error(`Invalid decision funnel transition: ${unit.stage} -> ${input.toStage}`);
    const at = asIso(input.at ?? now);
    if (new Date(at).getTime() < new Date(unit.updatedAt).getTime()) throw new Error(`Decision transition predates unit state: ${eventId}`);
    const fromStage = unit.stage;
    unit.stage = input.toStage;
    unit.status = statusFor(input.toStage);
    unit.updatedAt = at;
    unit.auditTrail.push({
      eventId, at, action: "stage-transition", fromStage, toStage: input.toStage, actorId,
      detail: input.detail?.trim() || `Moved to ${input.toStage}`, referenceIds: unit.references.map(referenceKey),
    });
  }
  return [...byId.values()].sort((left, right) => left.unitId.localeCompare(right.unitId));
}

export function decisionFunnelMetrics(units: readonly DecisionUnit[]): DecisionFunnelMetrics {
  const byStage = Object.fromEntries(STAGES.map((stage) => [stage, 0])) as Record<DecisionFunnelStage, number>;
  for (const unit of units) byStage[unit.stage] += 1;
  const converted = units.filter((unit) => unit.status === "converted").length;
  return {
    totalUnits: units.length, byStage, active: units.filter((unit) => unit.status === "active").length, converted,
    rejected: units.filter((unit) => unit.status === "rejected").length,
    transitionEvents: units.reduce((total, unit) => total + unit.auditTrail.filter((event) => event.action === "stage-transition").length, 0),
    conversionRate: units.length ? Number((converted / units.length).toFixed(4)) : undefined,
  };
}

export function buildDecisionUnitArtifact(
  existing: DecisionUnitArtifact | undefined,
  seeds: Iterable<DecisionUnitSeed>,
  transitions: Iterable<DecisionFunnelTransition> = [],
  now = new Date(),
): DecisionUnitArtifact {
  const units = applyDecisionFunnelTransitions(upsertDecisionUnits(existing?.units ?? [], seeds, now), transitions, now);
  return { schemaVersion: 1, generatedAt: asIso(now), units, funnel: decisionFunnelMetrics(units) };
}
