import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveLedgerCorrections,
  ledgerField,
  unknownLedgerField,
  validateLedgerField,
} from "../src/ledger-contracts.ts";

test("unknown fields carry no value, evidence, or observation clocks", () => {
  assert.deepEqual(unknownLedgerField<string>(), {
    value: "unknown",
    status: "unknown",
    evidenceIds: [],
    evidenceUrls: [],
    observedAt: "unknown",
    verifiedAt: "unknown",
  });
  assert.throws(() => validateLedgerField({
    value: "10M",
    status: "unknown",
    evidenceIds: [],
    evidenceUrls: [],
  }));
});

test("known fields require a value and evidence", () => {
  assert.throws(() => validateLedgerField({
    value: "10M",
    status: "verified",
    evidenceIds: [],
    evidenceUrls: [],
  }));
  assert.throws(() => validateLedgerField({
    value: "unknown",
    status: "developing",
    evidenceIds: ["e1"],
    evidenceUrls: ["https://a.example/evidence"],
  }));
});

test("developing fields retain a provisional value and canonical evidence order", () => {
  assert.deepEqual(ledgerField({
    value: "10M",
    status: "developing",
    evidenceIds: ["e2", "e1"],
    evidenceUrls: ["https://b.example/evidence", "https://a.example/evidence"],
    observedAt: "2026-08-22T00:00:00.000Z",
  }), {
    value: "10M",
    status: "developing",
    evidenceIds: ["e1", "e2"],
    evidenceUrls: ["https://a.example/evidence", "https://b.example/evidence"],
    observedAt: "2026-08-22T00:00:00.000Z",
    verifiedAt: "unknown",
  });
});

test("field validation rejects relative URLs and duplicate evidence IDs", () => {
  assert.throws(() => validateLedgerField({
    value: "10M",
    status: "verified",
    evidenceIds: ["e1"],
    evidenceUrls: ["/evidence"],
  }));
  assert.throws(() => validateLedgerField({
    value: "10M",
    status: "verified",
    evidenceIds: ["e1", "e1"],
    evidenceUrls: ["https://a.example/evidence"],
  }));
});

test("conflicted fields require at least two distinct canonical alternatives", () => {
  assert.throws(() => validateLedgerField({
    value: "unknown",
    status: "conflicted",
    evidenceIds: ["e1"],
    evidenceUrls: ["https://a.example/evidence"],
    conflictingValues: ["10M", "10M"],
  }));
  assert.deepEqual(ledgerField({
    value: "unknown",
    status: "conflicted",
    evidenceIds: ["e2", "e1"],
    evidenceUrls: ["https://b.example/evidence", "https://a.example/evidence"],
    conflictingValues: ["20M", "10M"],
  }), {
    value: "unknown",
    status: "conflicted",
    evidenceIds: ["e1", "e2"],
    evidenceUrls: ["https://a.example/evidence", "https://b.example/evidence"],
    observedAt: "unknown",
    verifiedAt: "unknown",
    conflictingValues: ["10M", "20M"],
  });
});

const known = (
  value: string,
  status: "verified" | "developing" = "verified",
  evidenceIds = ["e1"],
  verifiedAt = "2026-08-22T00:00:00.000Z",
) => ledgerField({
  value,
  status,
  evidenceIds,
  evidenceUrls: evidenceIds.map((id) => `https://${id}.example/evidence`),
  observedAt: "2026-08-20T00:00:00.000Z",
  verifiedAt,
});

const conflicted = () => ledgerField({
  value: "unknown",
  status: "conflicted",
  evidenceIds: ["e2", "e1"],
  evidenceUrls: ["https://e2.example/evidence", "https://e1.example/evidence"],
  observedAt: "2026-08-20T00:00:00.000Z",
  verifiedAt: "unknown",
  conflictingValues: ["20M", "10M"],
});

const corrections = <T>(before: ReturnType<typeof ledgerField<T>>, after: ReturnType<typeof ledgerField<T>>) => deriveLedgerCorrections({
  ledgerType: "company-claim",
  subjectId: "company-alpha",
  fieldPath: "fields.amount",
  before,
  after,
  correctedAt: "2026-08-23T00:00:00.000Z",
});

test("derives each correction reason from the material field transition", () => {
  assert.equal(corrections(known("10M", "developing"), known("10M", "verified", ["e2", "e1"]))[0]?.reason, "new-evidence");
  assert.equal(corrections(known("10M"), conflicted())[0]?.reason, "conflict-detected");
  assert.equal(corrections(conflicted(), known("20M"))[0]?.reason, "conflict-resolved");
  assert.equal(corrections(known("10M", "verified", ["e2", "e1"]), known("10M", "developing"))[0]?.reason, "source-withdrawn");
  assert.equal(corrections(known("10M"), known("11M"))[0]?.reason, "metadata-correction");
});

test("corrections bind canonical before, after, evidence, and stable subject keys", () => {
  const [correction] = corrections(known("10M"), conflicted());
  assert.ok(correction);
  assert.match(correction.correctionId, /^ledger-correction-[a-f0-9]{24}$/);
  assert.equal(correction.ledgerType, "company-claim");
  assert.equal(correction.subjectId, "company-alpha");
  assert.equal(correction.fieldPath, "fields.amount");
  assert.deepEqual(correction.evidenceIds, ["e1", "e2"]);
  assert.deepEqual(correction.after.conflictingValues, ["10M", "20M"]);
  assert.equal(correction.correctedAt, "2026-08-23T00:00:00.000Z");
});

test("reordered evidence and verification-clock-only changes create no correction", () => {
  const before = known("10M", "verified", ["e1", "e2"], "2026-08-21T00:00:00.000Z");
  const after = {
    ...before,
    evidenceIds: ["e2", "e1"],
    evidenceUrls: ["https://e2.example/evidence", "https://e1.example/evidence"],
    verifiedAt: "2026-08-23T00:00:00.000Z",
  };
  assert.deepEqual(corrections(before, after), []);
});

test("preserves prior corrections and does not append the same material transition twice", () => {
  const before = known("10M", "developing");
  const after = known("10M", "verified", ["e2", "e1"]);
  const first = corrections(before, after);
  const rerun = deriveLedgerCorrections({
    ledgerType: "company-claim",
    subjectId: "company-alpha",
    fieldPath: "fields.amount",
    before,
    after,
    previousCorrections: first,
    correctedAt: "2026-08-24T00:00:00.000Z",
  });
  assert.deepEqual(rerun, first);
});

test("records a repeated material transition after an intervening reversal", () => {
  const stateA = known("10M");
  const stateB = known("11M");
  const first = deriveLedgerCorrections({
    ledgerType: "company-claim", subjectId: "company-alpha", fieldPath: "fields.amount",
    before: stateA, after: stateB, correctedAt: "2026-08-23T00:00:00.000Z",
  });
  const reversed = deriveLedgerCorrections({
    ledgerType: "company-claim", subjectId: "company-alpha", fieldPath: "fields.amount",
    before: stateB, after: stateA, previousCorrections: first, correctedAt: "2026-08-24T00:00:00.000Z",
  });
  const repeated = deriveLedgerCorrections({
    ledgerType: "company-claim", subjectId: "company-alpha", fieldPath: "fields.amount",
    before: stateA, after: stateB, previousCorrections: reversed, correctedAt: "2026-08-25T00:00:00.000Z",
  });

  assert.equal(repeated.length, 3);
  assert.equal(new Set(repeated.map((item) => item.correctionId)).size, 3);
  assert.deepEqual(repeated.map((item) => [item.before.value, item.after.value]), [
    ["10M", "11M"], ["11M", "10M"], ["10M", "11M"],
  ]);
});
