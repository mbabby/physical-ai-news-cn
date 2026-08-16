import assert from "node:assert/strict";
import test from "node:test";
import { validateCompanyThesisShape, validateWatchlistSnapshotShape } from "../src/watchlist/contracts.js";

test("accepts a complete versioned thesis and rejects missing falsifiers", () => {
  const thesis = {
    thesisId: "thesis-company-alpha-2026-W33-v1",
    companyId: "company-alpha",
    track: "forward-radar",
    lifecycle: "new",
    thesisVersion: 1,
    whyNow: "Alpha 本期新增一项可追溯合作信号。",
    routeAndDependencies: "路线依赖真实机器人数据。",
    nextValidationPoints: [{ text: "确认客户试点", dueAt: "2026-10-01" }],
    falsifiers: [{ text: "合作方撤回公告" }],
    factReferenceIds: ["event-alpha"],
    verifiedSensitiveBindings: [],
    inferenceLabels: ["AI 研究判断"],
    confidence: "medium",
    generatedAt: "2026-08-13T01:00:00Z",
    expiresAt: "2026-10-12T01:00:00Z",
    modelVersion: "model",
    promptVersion: "v1",
    methodologyVersion: "v1",
  };

  assert.equal(validateCompanyThesisShape(thesis), true);
  assert.equal(validateCompanyThesisShape({ ...thesis, falsifiers: [] }), false);
  const { verifiedSensitiveBindings: _verifiedSensitiveBindings, ...legacy } = thesis;
  assert.equal(validateCompanyThesisShape(legacy), false);
  assert.equal(validateCompanyThesisShape({ ...thesis, verifiedSensitiveBindings: [{
    field: "customer", referenceIds: ["event-alpha"], valueDigest: "a".repeat(64), secret: "must-not-survive",
  }] }), false);
  assert.equal(validateCompanyThesisShape({ ...thesis, verifiedSensitiveBindings: [{
    field: "customer", referenceIds: ["event-other"], valueDigest: "a".repeat(64),
  }] }), false);
});

test("snapshot contains references, not copied thesis prose", () => {
  assert.equal(
    validateWatchlistSnapshotShape({
      week: "2026-W33",
      snapshotVersion: 1,
      methodologyVersion: "v1",
      generatedAt: "2026-08-13T01:00:00Z",
      forwardRadar: [{ companyId: "company-a", thesisId: "thesis-a", thesisVersion: 1, group: "priority-focus" }],
      validatedMomentum: [],
      changesSinceLastWeek: [],
    }),
    true,
  );
});

test("rejects theses without version strings, dates, or references", () => {
  const base = {
    thesisId: "thesis-company-alpha-2026-W33-v1",
    companyId: "company-alpha",
    track: "forward-radar",
    lifecycle: "new",
    thesisVersion: 1,
    whyNow: "Alpha 本期新增一项可追溯合作信号。",
    routeAndDependencies: "路线依赖真实机器人数据。",
    nextValidationPoints: [{ text: "确认客户试点", dueAt: "2026-10-01" }],
    falsifiers: [{ text: "合作方撤回公告" }],
    factReferenceIds: ["event-alpha"],
    verifiedSensitiveBindings: [],
    inferenceLabels: ["AI 研究判断"],
    confidence: "medium",
    generatedAt: "2026-08-13T01:00:00Z",
    expiresAt: "2026-10-12T01:00:00Z",
    modelVersion: "model",
    promptVersion: "v1",
    methodologyVersion: "v1",
  };

  assert.equal(validateCompanyThesisShape({ ...base, promptVersion: "" }), false);
  assert.equal(validateCompanyThesisShape({ ...base, generatedAt: "not-a-date" }), false);
  assert.equal(validateCompanyThesisShape({ ...base, factReferenceIds: [] }), false);
});

test("rejects snapshots with duplicated thesis ids across tracks", () => {
  assert.equal(
    validateWatchlistSnapshotShape({
      week: "2026-W33",
      snapshotVersion: 1,
      methodologyVersion: "v1",
      generatedAt: "2026-08-13T01:00:00Z",
      forwardRadar: [{ companyId: "company-a", thesisId: "thesis-a", thesisVersion: 1, group: "priority-focus" }],
      validatedMomentum: [{ companyId: "company-a", thesisId: "thesis-a", thesisVersion: 1, group: "priority-focus" }],
      changesSinceLastWeek: [],
    }),
    false,
  );
});

test("rejects invalid ISO week numbers in snapshots", () => {
  const snapshot = {
    snapshotVersion: 1,
    methodologyVersion: "v1",
    generatedAt: "2026-08-13T01:00:00Z",
    forwardRadar: [{ companyId: "company-a", thesisId: "thesis-a", thesisVersion: 1, group: "priority-focus" }],
    validatedMomentum: [],
    changesSinceLastWeek: [],
  };

  for (const week of ["2026-W00", "2026-W54", "2025-W53"]) {
    assert.equal(validateWatchlistSnapshotShape({ ...snapshot, week }), false);
  }
  assert.equal(validateWatchlistSnapshotShape({ ...snapshot, week: "2026-W53" }), true);
});

test("rejects non-string and non-canonical timestamps and dates", () => {
  const thesis = {
    thesisId: "thesis-company-alpha-2026-W33-v1",
    companyId: "company-alpha",
    track: "forward-radar",
    lifecycle: "new",
    thesisVersion: 1,
    whyNow: "Alpha 本期新增一项可追溯合作信号。",
    routeAndDependencies: "路线依赖真实机器人数据。",
    nextValidationPoints: [{ text: "确认客户试点", dueAt: "2026-10-01" }],
    falsifiers: [{ text: "合作方撤回公告" }],
    factReferenceIds: ["event-alpha"],
    verifiedSensitiveBindings: [],
    inferenceLabels: ["AI 研究判断"],
    confidence: "medium",
    generatedAt: "2026-08-13T01:00:00Z",
    expiresAt: "2026-10-12T01:00:00Z",
    modelVersion: "model",
    promptVersion: "v1",
    methodologyVersion: "v1",
  };

  assert.equal(validateCompanyThesisShape({ ...thesis, generatedAt: 123 as unknown as string }), false);
  assert.equal(validateCompanyThesisShape({ ...thesis, generatedAt: "August 13, 2026 01:00 UTC" }), false);
  assert.equal(validateCompanyThesisShape({ ...thesis, generatedAt: "2026-02-31T01:00:00Z" }), false);
  assert.equal(
    validateCompanyThesisShape({
      ...thesis,
      nextValidationPoints: [{ text: "确认客户试点", dueAt: "2026-02-31" }],
    }),
    false,
  );
  assert.equal(
    validateWatchlistSnapshotShape({
      week: "2026-W33",
      snapshotVersion: 1,
      methodologyVersion: "v1",
      generatedAt: "August 13, 2026 01:00 UTC",
      forwardRadar: [{ companyId: "company-a", thesisId: "thesis-a", thesisVersion: 1, group: "priority-focus" }],
      validatedMomentum: [],
      changesSinceLastWeek: [],
    }),
    false,
  );
});

test("rejects invalid calendar timestamps without throwing", () => {
  const thesis = {
    thesisId: "thesis-company-alpha-2026-W33-v1",
    companyId: "company-alpha",
    track: "forward-radar",
    lifecycle: "new",
    thesisVersion: 1,
    whyNow: "Alpha 本期新增一项可追溯合作信号。",
    routeAndDependencies: "路线依赖真实机器人数据。",
    nextValidationPoints: [{ text: "确认客户试点", dueAt: "2026-10-01" }],
    falsifiers: [{ text: "合作方撤回公告" }],
    factReferenceIds: ["event-alpha"],
    inferenceLabels: ["AI 研究判断"],
    confidence: "medium",
    generatedAt: "2026-08-13T01:00:00Z",
    expiresAt: "2026-10-12T01:00:00Z",
    modelVersion: "model",
    promptVersion: "v1",
    methodologyVersion: "v1",
  };

  let thesisResult = true;
  assert.doesNotThrow(() => {
    thesisResult = validateCompanyThesisShape({ ...thesis, generatedAt: "2026-13-01T00:00:00Z" });
  });
  assert.equal(thesisResult, false);

  let plainDateResult = true;
  assert.doesNotThrow(() => {
    plainDateResult = validateCompanyThesisShape({ ...thesis, generatedAt: "2026-13-01" });
  });
  assert.equal(plainDateResult, false);

  let leapSecondResult = true;
  assert.doesNotThrow(() => {
    leapSecondResult = validateCompanyThesisShape({ ...thesis, generatedAt: "2026-01-01T00:00:60Z" });
  });
  assert.equal(leapSecondResult, false);

  let dueAtResult = true;
  assert.doesNotThrow(() => {
    dueAtResult = validateCompanyThesisShape({
      ...thesis,
      nextValidationPoints: [{ text: "确认客户试点", dueAt: "2026-02-31" }],
    });
  });
  assert.equal(dueAtResult, false);
});
