import { createHash } from "node:crypto";
import type { CompanyThesis, ThesisLifecycle, WatchlistTrack } from "./contracts.js";
import type { CompanyThesisDraft, ThesisGenerationResult } from "./generator.js";
import { thesisDraftDigest, type ThesisValidationResult } from "./validation.js";

const TERMINAL_LIFECYCLES = new Set<ThesisLifecycle>(["falsified", "expired"]);
const EXPIRY_MS = 60 * 24 * 60 * 60 * 1_000;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

const LIFECYCLE_TRANSITIONS: Record<ThesisLifecycle, ReadonlySet<ThesisLifecycle>> = {
  new: new Set(["strengthening", "awaiting-validation", "downgraded", "falsified", "expired"]),
  strengthening: new Set(["strengthening", "awaiting-validation", "downgraded", "falsified", "expired"]),
  "awaiting-validation": new Set(["strengthening", "awaiting-validation", "downgraded", "falsified", "expired"]),
  downgraded: new Set(["strengthening", "awaiting-validation", "downgraded", "falsified", "expired"]),
  falsified: new Set(["new"]),
  expired: new Set(["new"]),
};

const TRACK_TRANSITIONS: Record<WatchlistTrack, ReadonlySet<WatchlistTrack>> = {
  "forward-radar": new Set(["forward-radar", "validated-momentum"]),
  "validated-momentum": new Set(["validated-momentum"]),
};

export interface ThesisLifecycleCandidate {
  draft: CompanyThesisDraft;
  lifecycle: ThesisLifecycle;
}

export type ThesisLifecycleDecision =
  | { outcome: "publish"; from: ThesisLifecycle | null; to: ThesisLifecycle; thesis: CompanyThesis }
  | { outcome: "remove"; from: ThesisLifecycle | null; to: "falsified" | "expired"; reason: "terminal-lifecycle" | "expired" }
  | {
    outcome: "reject";
    from: ThesisLifecycle | null;
    to: ThesisLifecycle;
    reason: "company-mismatch" | "invalid-transition" | "invalid-timestamp" | "track-regression";
  };

export type FailedThesisGeneration = Extract<ThesisGenerationResult, { ok: false }>;

function isFailedGeneration(
  attempted: CompanyThesisDraft | FailedThesisGeneration,
): attempted is FailedThesisGeneration {
  return "ok" in attempted && attempted.ok === false;
}

function timestamp(value: string): number | undefined {
  if (!ISO_TIMESTAMP.test(value)) return undefined;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return undefined;
  const normalized = new Date(parsed).toISOString();
  return normalized === value || normalized === value.replace("Z", ".000Z") ? parsed : undefined;
}

function isStillValid(thesis: CompanyThesis | undefined, nowMs: number): thesis is CompanyThesis {
  if (!thesis || TERMINAL_LIFECYCLES.has(thesis.lifecycle)) return false;
  const generatedAt = timestamp(thesis.generatedAt);
  const expiresAt = timestamp(thesis.expiresAt);
  return generatedAt !== undefined && expiresAt !== undefined
    && expiresAt - generatedAt === EXPIRY_MS
    && expiresAt > nowMs;
}

function newThesisId(companyId: string, now: Date, previous: CompanyThesis | undefined): string {
  const previousCycle = previous ? `${previous.thesisId}\0${previous.thesisVersion}` : "initial";
  const digest = createHash("sha256")
    .update(`${companyId}\0${now.toISOString()}\0${previousCycle}`)
    .digest("hex")
    .slice(0, 16);
  return `thesis-${companyId}-${digest}`;
}

function materializeThesis(
  candidate: ThesisLifecycleCandidate,
  thesisId: string,
  thesisVersion: number,
): CompanyThesis {
  const { draft, lifecycle } = candidate;
  return {
    thesisId,
    companyId: draft.companyId,
    track: draft.track,
    lifecycle,
    thesisVersion,
    whyNow: draft.whyNow,
    routeAndDependencies: draft.routeAndDependencies,
    nextValidationPoints: draft.nextValidationPoints,
    falsifiers: draft.falsifiers,
    factReferenceIds: draft.factReferenceIds,
    inferenceLabels: draft.inferenceLabels,
    confidence: draft.confidence,
    generatedAt: draft.generatedAt,
    expiresAt: draft.expiresAt,
    modelVersion: draft.modelVersion,
    promptVersion: draft.promptVersion,
    methodologyVersion: draft.methodologyVersion,
  };
}

export function resolveThesisLifecycle(
  previous: CompanyThesis | undefined,
  current: ThesisLifecycleCandidate,
  now: Date,
): ThesisLifecycleDecision {
  const nowMs = now.getTime();
  const generatedAt = timestamp(current.draft.generatedAt);
  const currentExpiresAt = timestamp(current.draft.expiresAt);
  const from = previous?.lifecycle ?? null;
  if (!Number.isFinite(nowMs)) {
    return { outcome: "reject", from, to: current.lifecycle, reason: "invalid-timestamp" };
  }
  if (previous && previous.companyId !== current.draft.companyId) {
    return { outcome: "reject", from, to: current.lifecycle, reason: "company-mismatch" };
  }
  if (current.lifecycle === "falsified" || current.lifecycle === "expired") {
    return {
      outcome: "remove",
      from,
      to: current.lifecycle,
      reason: current.lifecycle === "expired" ? "expired" : "terminal-lifecycle",
    };
  }
  if (generatedAt === undefined || currentExpiresAt === undefined || currentExpiresAt - generatedAt !== EXPIRY_MS) {
    return { outcome: "reject", from, to: current.lifecycle, reason: "invalid-timestamp" };
  }
  if (currentExpiresAt <= nowMs) {
    return { outcome: "remove", from, to: "expired", reason: "expired" };
  }

  const previousIsActive = isStillValid(previous, nowMs);
  const effectivePreviousLifecycle: ThesisLifecycle | null = previousIsActive ? previous.lifecycle : previous ? "expired" : null;
  if (effectivePreviousLifecycle === null) {
    if (current.lifecycle !== "new") {
      return { outcome: "reject", from, to: current.lifecycle, reason: "invalid-transition" };
    }
  } else if (!LIFECYCLE_TRANSITIONS[effectivePreviousLifecycle].has(current.lifecycle)) {
    return { outcome: "reject", from, to: current.lifecycle, reason: "invalid-transition" };
  }

  if (previousIsActive && !TRACK_TRANSITIONS[previous.track].has(current.draft.track)) {
    return { outcome: "reject", from, to: current.lifecycle, reason: "track-regression" };
  }

  const thesisId = previousIsActive ? previous.thesisId : newThesisId(current.draft.companyId, now, previous);
  const thesisVersion = previousIsActive ? previous.thesisVersion + 1 : 1;
  return {
    outcome: "publish",
    from,
    to: current.lifecycle,
    thesis: materializeThesis(current, thesisId, thesisVersion),
  };
}

export function selectLastKnownGood(
  previous: CompanyThesis | undefined,
  attempted: CompanyThesisDraft | FailedThesisGeneration,
  validation: ThesisValidationResult | undefined,
  now: Date,
): CompanyThesis | undefined {
  const nowMs = now.getTime();
  const generationFailed = isFailedGeneration(attempted);
  const sameCompany = generationFailed || previous?.companyId === attempted.companyId;
  const fallback = Number.isFinite(nowMs) && sameCompany && isStillValid(previous, nowMs) ? previous : undefined;
  if (generationFailed) return fallback;
  if (!validation?.publishable || validation.draftDigest !== thesisDraftDigest(attempted)) return fallback;

  const decision = resolveThesisLifecycle(
    previous,
    { draft: attempted, lifecycle: fallback ? "strengthening" : "new" },
    now,
  );
  return decision.outcome === "publish" ? decision.thesis : fallback;
}
