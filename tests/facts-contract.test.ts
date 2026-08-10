import assert from "node:assert/strict";
import test from "node:test";
import { UNKNOWN, assertFacts, deriveFactTimes, derivePublication, validateFacts } from "../src/facts-contract.js";

const times = {
  eventDate: "2026-08-01",
  publishedAt: "2026-08-02T08:00:00.000Z",
  firstSeenAt: "2026-08-03T08:00:00.000Z",
  verifiedAt: "2026-08-03T09:00:00.000Z",
  materiallyChangedAt: "2026-08-03T09:00:00.000Z",
};

test("A proof confirms a funding fact and maps legacy time aliases without inventing dates", () => {
  const result = assertFacts({
    type: "投融资", occurredAt: times.eventDate, lastEvidenceAt: times.publishedAt,
    firstSeenAt: times.firstSeenAt, lastVerifiedAt: times.verifiedAt, lastUpdatedAt: times.materiallyChangedAt,
    public: true,
    evidence: [{ id: "official", grade: "A", source: "公司官网", link: "https://example.com/news" }],
  });
  assert.equal(result.kind, "funding");
  assert.equal(result.evidenceState, "confirmed");
  assert.equal(result.publicEligible, true);
  assert.deepEqual(result.times, times);
});

test("two independent B sources confirm, while syndicated B copies do not", () => {
  const confirmed = derivePublication({ evidence: [
    { id: "one", grade: "B", link: "https://media-one.example/story", independentOrigin: "wire-one" },
    { id: "two", grade: "B", link: "https://media-two.example/story", independentOrigin: "wire-two" },
  ] });
  assert.equal(confirmed.evidenceState, "confirmed");
  assert.equal(confirmed.publicEligible, true);

  const syndicated = validateFacts({ kind: "deployment", public: true, evidenceState: "confirmed", evidence: [
    { id: "one", grade: "B", link: "https://media-one.example/story", independentOrigin: "same-wire" },
    { id: "two", grade: "B", link: "https://media-two.example/story", independentOrigin: "same-wire" },
  ] });
  assert.equal(syndicated.evidenceState, "developing");
  assert.equal(syndicated.valid, false);
  assert.ok(syndicated.issues.some((issue) => issue.code === "b-sources-not-independent"));
});

test("a single B source is developing and cannot be asserted as confirmed", () => {
  const result = validateFacts({ kind: "pilot", evidenceState: "confirmed", evidence: [
    { id: "media", grade: "B", source: "产业媒体", link: "https://media.example/pilot" },
  ] });
  assert.equal(result.evidenceState, "developing");
  assert.equal(result.publicEligible, false);
  assert.ok(result.issues.some((issue) => issue.code === "single-b-cannot-confirm"));
  assert.throws(() => assertFacts({ kind: "pilot", evidenceState: "confirmed", evidence: [{ grade: "B", link: "https://media.example/pilot" }] }));
});

test("discovery sources remain candidates and cannot be selected for public evidence", () => {
  const result = validateFacts({ kind: "product-release", public: true, publicEvidenceIds: ["lead"], evidence: [
    { id: "lead", grade: "A", source: "Google News", link: "https://news.google.com/rss/articles/lead", publicationPolicy: "仅作线索发现" },
  ] });
  assert.equal(result.evidenceState, "candidate");
  assert.equal(result.publicEligible, false);
  assert.ok(result.issues.some((issue) => issue.code === "discovery-evidence-public"));
});

test("missing legacy times degrade to unknown and never use a current timestamp", () => {
  const result = deriveFactTimes({ firstSeenAt: "not a date" });
  assert.deepEqual(result, {
    eventDate: UNKNOWN, publishedAt: UNKNOWN, firstSeenAt: UNKNOWN, verifiedAt: UNKNOWN, materiallyChangedAt: UNKNOWN,
  });
  assert.equal(validateFacts({ kind: "研究作者报告", firstSeenAt: "not a date" }).valid, false);
});

test("research author reports and independent replications keep distinct public semantics", () => {
  assert.equal(assertFacts({ kind: "研究作者报告", evidence: [{ grade: "A", link: "https://arxiv.org/abs/1" }] }).kind, "research-author-report");
  assert.equal(assertFacts({ kind: "独立复现", evidence: [{ grade: "A", link: "https://lab.example/reproduction" }] }).kind, "independent-replication");
});
