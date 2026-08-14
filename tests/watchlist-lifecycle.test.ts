import assert from "node:assert/strict";
import test from "node:test";
import type { CompanyThesis } from "../src/watchlist/contracts.js";
import type { CompanyThesisDraft } from "../src/watchlist/generator.js";
import {
  resolveThesisLifecycle,
  selectLastKnownGood,
  type ThesisLifecycleCandidate,
} from "../src/watchlist/lifecycle.js";
import type { ThesisValidationResult } from "../src/watchlist/validation.js";

const NOW = new Date("2026-08-14T01:00:00.000Z");
const GENERATED_AT = "2026-08-14T00:00:00.000Z";
const EXPIRES_AT = "2026-10-13T00:00:00.000Z";

function draft(overrides: Partial<CompanyThesisDraft> = {}): CompanyThesisDraft {
  return {
    companyId: "company-alpha",
    track: "forward-radar",
    whyNow: "AI 研究判断：Alpha 出现新的公开验证信号。",
    routeAndDependencies: "AI 研究判断：路线依赖后续部署数据。",
    nextValidationPoints: [{ text: "核验后续部署数据。", dueAt: "2026-09-30" }],
    falsifiers: [{ text: "公司撤回部署公告。" }],
    factReferenceIds: ["event-alpha"],
    inferenceLabels: ["AI 研究判断"],
    confidence: "medium",
    generatedAt: GENERATED_AT,
    expiresAt: EXPIRES_AT,
    modelVersion: "model-v1",
    promptVersion: "prompt-v1",
    methodologyVersion: "method-v1",
    sentenceCitations: [],
    ...overrides,
  };
}

function thesis(overrides: Partial<CompanyThesis> = {}): CompanyThesis {
  const { sentenceCitations: _sentenceCitations, ...base } = draft();
  return {
    ...base,
    thesisId: "thesis-existing",
    lifecycle: "new",
    thesisVersion: 1,
    ...overrides,
  };
}

function candidate(lifecycle: ThesisLifecycleCandidate["lifecycle"], overrides: Partial<CompanyThesisDraft> = {}): ThesisLifecycleCandidate {
  return { draft: draft(overrides), lifecycle };
}

const valid: ThesisValidationResult = {
  publishable: true,
  issues: [],
  citationCoverage: { citedSentences: 4, totalSentences: 4, ratio: 1 },
  sensitiveFields: [],
};

test("allows new to strengthening and increments the system-owned version", () => {
  const result = resolveThesisLifecycle(thesis(), candidate("strengthening"), NOW);

  assert.equal(result.outcome, "publish");
  if (result.outcome !== "publish") return;
  assert.equal(result.thesis.lifecycle, "strengthening");
  assert.equal(result.thesis.thesisId, "thesis-existing");
  assert.equal(result.thesis.thesisVersion, 2);
});

test("allows new to awaiting-validation", () => {
  const result = resolveThesisLifecycle(thesis(), candidate("awaiting-validation"), NOW);

  assert.equal(result.outcome, "publish");
  if (result.outcome !== "publish") return;
  assert.equal(result.thesis.lifecycle, "awaiting-validation");
});

test("allows validated momentum to be downgraded without changing track", () => {
  const previous = thesis({ track: "validated-momentum", lifecycle: "strengthening", thesisVersion: 4 });
  const result = resolveThesisLifecycle(previous, candidate("downgraded", { track: "validated-momentum" }), NOW);

  assert.equal(result.outcome, "publish");
  if (result.outcome !== "publish") return;
  assert.equal(result.thesis.track, "validated-momentum");
  assert.equal(result.thesis.lifecycle, "downgraded");
  assert.equal(result.thesis.thesisVersion, 5);
});

test("allows forward radar to advance to validated momentum", () => {
  const result = resolveThesisLifecycle(
    thesis({ lifecycle: "awaiting-validation", thesisVersion: 2 }),
    candidate("strengthening", { track: "validated-momentum" }),
    NOW,
  );

  assert.equal(result.outcome, "publish");
  if (result.outcome !== "publish") return;
  assert.equal(result.thesis.track, "validated-momentum");
  assert.equal(result.thesis.thesisVersion, 3);
});

test("rejects validated momentum returning to forward radar", () => {
  const result = resolveThesisLifecycle(
    thesis({ track: "validated-momentum", lifecycle: "strengthening" }),
    candidate("awaiting-validation", { track: "forward-radar" }),
    NOW,
  );

  assert.deepEqual(result, {
    outcome: "reject",
    from: "strengthening",
    to: "awaiting-validation",
    reason: "track-regression",
  });
});

test("removes a falsified thesis from the current watchlist", () => {
  const result = resolveThesisLifecycle(thesis(), candidate("falsified"), NOW);

  assert.deepEqual(result, { outcome: "remove", from: "new", to: "falsified", reason: "terminal-lifecycle" });
});

test("removes a thesis at the exact expiry instant", () => {
  const exactExpiry = new Date(EXPIRES_AT);
  const result = resolveThesisLifecycle(thesis(), candidate("strengthening"), exactExpiry);

  assert.deepEqual(result, { outcome: "remove", from: "new", to: "expired", reason: "expired" });
});

test("a failed generation retains a still-valid previous thesis", () => {
  const previous = thesis({ thesisVersion: 3 });

  const selected = selectLastKnownGood(previous, { ok: false, code: "llm-unavailable" }, undefined, NOW);

  assert.deepEqual(selected, previous);
});

test("a blocked draft retains a still-valid previous thesis", () => {
  const previous = thesis({ thesisVersion: 3 });
  const blocked: ThesisValidationResult = {
    ...valid,
    publishable: false,
    issues: [{ code: "no-material-change", message: "no material change" }],
  };

  assert.deepEqual(selectLastKnownGood(previous, draft(), blocked, NOW), previous);
});

test("a falsified or expired thesis is never returned as last-known-good", () => {
  const failure = { ok: false, code: "invalid-json" } as const;

  assert.equal(selectLastKnownGood(thesis({ lifecycle: "falsified" }), failure, undefined, NOW), undefined);
  assert.equal(selectLastKnownGood(thesis({ expiresAt: NOW.toISOString() }), failure, undefined, NOW), undefined);
});

test("re-entry after falsification starts a new deterministic identity at version one", () => {
  const previous = thesis({ lifecycle: "falsified", thesisId: "thesis-old", thesisVersion: 8 });

  const first = selectLastKnownGood(previous, draft(), valid, NOW);
  const second = selectLastKnownGood(previous, draft(), valid, NOW);

  assert.ok(first);
  assert.ok(second);
  assert.equal(first.lifecycle, "new");
  assert.equal(first.thesisVersion, 1);
  assert.notEqual(first.thesisId, previous.thesisId);
  assert.equal(second.thesisId, first.thesisId);
});

test("same-timestamp re-entry cannot resurrect the prior thesis identity", () => {
  const initial = resolveThesisLifecycle(undefined, candidate("new"), NOW);
  assert.equal(initial.outcome, "publish");
  if (initial.outcome !== "publish") return;
  const falsified = { ...initial.thesis, lifecycle: "falsified" as const, thesisVersion: 9 };

  const reentered = resolveThesisLifecycle(falsified, candidate("new"), NOW);

  assert.equal(reentered.outcome, "publish");
  if (reentered.outcome !== "publish") return;
  assert.notEqual(reentered.thesis.thesisId, falsified.thesisId);
  assert.equal(reentered.thesis.thesisVersion, 1);
});

test("model-shaped identity and version fields cannot control materialized theses", () => {
  const attempted = {
    ...draft(),
    thesisId: "model-controlled-id",
    thesisVersion: 999,
    lifecycle: "falsified",
  } as CompanyThesisDraft;

  const selected = selectLastKnownGood(undefined, attempted, valid, NOW);

  assert.ok(selected);
  assert.notEqual(selected.thesisId, "model-controlled-id");
  assert.equal(selected.thesisVersion, 1);
  assert.equal(selected.lifecycle, "new");
  assert.equal("sentenceCitations" in selected, false);
});
