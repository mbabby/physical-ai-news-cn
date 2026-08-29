import assert from "node:assert/strict";
import test from "node:test";
import {
  assertAcceptedEvidenceArtifact,
  assertCommunityTaskPublicArtifact,
  assertContributionLedgerArtifact,
  assertEvidenceIssueSnapshot,
  assertEvidenceTaskLedgerArtifact,
  assertEvidenceTaskSeed,
  assertEvidenceTaskSeedArtifact,
  buildContributionEventId,
  buildEvidenceTaskId,
  migrateLegacyEvidenceIssueSnapshot,
  type EvidenceSubject,
  type EvidenceTaskSeed,
} from "../src/community-evidence/contracts.js";

const subject: EvidenceSubject = {
  kind: "company",
  id: "company-alpha",
  name: "Alpha Robotics",
  url: "https://alpha.example/",
};

function validSeed(overrides: Partial<EvidenceTaskSeed> = {}): EvidenceTaskSeed {
  const targetField = overrides.targetField ?? "funding.amount";
  const materialVersion = overrides.materialVersion ?? "v1";
  return {
    id: buildEvidenceTaskId(subject, targetField, materialVersion),
    version: 1,
    category: "company-funding",
    subject,
    targetField,
    contextZh: "Alpha Robotics 的融资金额仍待公开证据确认。",
    referenceUrls: ["https://alpha.example/", "https://news.example/alpha"],
    suggestedLocations: ["公司新闻稿", "监管披露"],
    qualifiedEvidenceZh: ["公司或投资方发布的融资公告"],
    disqualifiedEvidenceZh: ["无来源的聚合页"],
    replyTemplateZh: "证据链接：\n证据摘录：\n来源类型：",
    estimatedMinutes: 2,
    generatedWeek: "2026-W35",
    materialVersion,
    supersedesTaskId: null,
    ...overrides,
  };
}

test("public evidence seed accepts exactly one target field and no private keys", () => {
  const seed = validSeed({ targetField: "funding.amount" });
  assert.doesNotThrow(() => assertEvidenceTaskSeed(seed));
  assert.throws(() => assertEvidenceTaskSeed({ ...seed, targetFields: ["funding.amount", "funding.round"] }), /exact keys/);
  assert.throws(() => assertEvidenceTaskSeed({ ...seed, rankScore: 91 }), /private boundary/);
});

test("stable task id changes only when the material version changes", () => {
  assert.equal(buildEvidenceTaskId(subject, "funding.amount", "v1"), buildEvidenceTaskId(subject, "funding.amount", "v1"));
  assert.notEqual(buildEvidenceTaskId(subject, "funding.amount", "v1"), buildEvidenceTaskId(subject, "funding.amount", "v2"));
  assert.equal(
    buildEvidenceTaskId(subject, "funding.amount", "v1"),
    buildEvidenceTaskId({ ...subject, name: "Alpha Robotics Inc.", url: "https://www.alpha.example/" }, "funding.amount", "v1"),
  );
});

test("seed artifact requires normalized HTTPS references and sorted deduplicated arrays", () => {
  const seed = validSeed();
  assert.doesNotThrow(() => assertEvidenceTaskSeedArtifact({
    schemaVersion: 1,
    generatedAt: "2026-08-24T01:00:00Z",
    generatedWeek: "2026-W35",
    seeds: [seed],
  }));

  for (const referenceUrls of [
    ["http://alpha.example/"],
    ["https://alpha.example"],
    ["https://alpha.example/", "https://alpha.example/"],
    ["https://z.example/", "https://a.example/"],
    [],
    ["https://a.example/", "https://b.example/", "https://c.example/", "https://d.example/"],
  ]) {
    assert.throws(() => assertEvidenceTaskSeed(validSeed({ referenceUrls })), /referenceUrls/);
  }
  assert.throws(() => assertEvidenceTaskSeed(validSeed({ suggestedLocations: ["监管披露", "公司新闻稿"] })), /sorted/);
});

test("recursive private-boundary scan rejects private keys, markers, and review URLs", () => {
  const artifact = {
    schemaVersion: 1,
    generatedAt: "2026-08-24T01:00:00Z",
    generatedWeek: "2026-W35",
    seeds: [validSeed()],
  };
  const corruptions = [
    { ...artifact, rawModelOutput: "hidden" },
    { ...artifact, seeds: [{ ...validSeed(), subject: { ...subject, apiKey: "hidden" } }] },
    { ...artifact, seeds: [{ ...validSeed(), contextZh: "internal rank diagnostics" }] },
    { ...artifact, seeds: [{ ...validSeed(), referenceUrls: ["https://github.com/acme/repo/blob/main/review/private.json"] }] },
    { ...artifact, seeds: [{ ...validSeed(), contextZh: "rankScore" }] },
    { ...artifact, seeds: [{ ...validSeed(), contextZh: "RankScore" }] },
    { ...artifact, seeds: [{ ...validSeed(), contextZh: "score91" }] },
    { ...artifact, seeds: [{ ...validSeed(), contextZh: "rank2" }] },
    { ...artifact, seeds: [{ ...validSeed(), contextZh: "candidate_id" }] },
    { ...artifact, seeds: [{ ...validSeed(), referenceUrls: ["https://github.com/acme/repo/review"] }] },
    { ...artifact, seeds: [{ ...validSeed(), referenceUrls: ["https://github.com/acme/repo?path=review/private.json"] }] },
    { ...artifact, seeds: [{ ...validSeed(), referenceUrls: ["https://github.com/acme/repo/%72eview/private.json"] }] },
    { ...artifact, seeds: [{ ...validSeed(), referenceUrls: ["https://github.com/acme/repo/%72eview/%ZZ"] }] },
    { ...artifact, seeds: [{ ...validSeed(), referenceUrls: ["https://github.com/acme/repo/%25252525252572eview/private.json"] }] },
  ];
  for (const corrupted of corruptions) assert.throws(() => assertEvidenceTaskSeedArtifact(corrupted), /private boundary/);
});

test("ISO weeks reject week 53 in years that contain only 52 weeks", () => {
  assert.throws(() => assertEvidenceTaskSeed(validSeed({ generatedWeek: "2025-W53" })), /ISO week/);
  assert.doesNotThrow(() => assertEvidenceTaskSeed(validSeed({ generatedWeek: "2026-W53" })));
});

test("every artifact validator enforces exact nested keys and canonical clocks", () => {
  const issueSnapshot = {
    schemaVersion: 1,
    fetchedAt: "2026-08-24T01:00:00Z",
    repo: "acme/physical-ai-news-cn",
    issues: [{
      number: 42,
      taskId: validSeed().id,
      taskVersion: 1,
      state: "open",
      labels: ["evidence-task-company-funding", "two-minute-task"],
      authorLogin: "alice",
      authorAssociation: "CONTRIBUTOR",
      createdAt: "2026-08-20T01:00:00Z",
      updatedAt: "2026-08-23T01:00:00Z",
      closedAt: null,
      evidenceUrls: ["https://alpha.example/funding"],
      submittedEvidence: [],
      acceptedContributors: [],
      acceptedEvidence: [],
    }],
  };
  assert.doesNotThrow(() => assertEvidenceIssueSnapshot(issueSnapshot));

  const ledger = {
    schemaVersion: 1,
    generatedAt: "2026-08-24T01:00:00Z",
    entries: [{
      taskId: validSeed().id,
      taskVersion: 1,
      category: "company-funding",
      subject,
      targetField: "funding.amount",
      materialVersion: "v1",
      supersedesTaskId: null,
      issueNumber: 42,
      issueUrl: "https://github.com/acme/physical-ai-news-cn/issues/42",
      state: "open",
      createdAt: "2026-08-20T01:00:00Z",
      updatedAt: "2026-08-23T01:00:00Z",
      lastActivityAt: "2026-08-23T01:00:00Z",
      closedAt: null,
    }],
  };
  assert.doesNotThrow(() => assertEvidenceTaskLedgerArtifact(ledger));

  const accepted = {
    schemaVersion: 1,
    generatedAt: "2026-08-24T01:00:00Z",
    entries: [{
      id: buildContributionEventId({
        taskId: validSeed().id,
        issueNumber: 42,
        contributor: "alice",
        evidenceUrl: "https://alpha.example/funding",
        state: "accepted",
        occurredAt: "2026-08-24T01:00:00Z",
      }),
      taskId: validSeed().id,
      issueNumber: 42,
      category: "company-funding",
      subject,
      targetField: "funding.amount",
      contributor: "alice",
      evidenceUrl: "https://alpha.example/funding",
      acceptedAt: "2026-08-24T01:00:00Z",
    }],
  };
  assert.doesNotThrow(() => assertAcceptedEvidenceArtifact(accepted));

  const contributions = {
    schemaVersion: 1,
    generatedAt: "2026-08-24T01:00:00Z",
    events: [{
      id: buildContributionEventId({
        taskId: validSeed().id,
        issueNumber: 42,
        contributor: "alice",
        evidenceUrl: "https://alpha.example/funding",
        state: "accepted",
        occurredAt: "2026-08-24T01:00:00Z",
      }),
      taskId: validSeed().id,
      issueNumber: 42,
      contributor: "alice",
      evidenceUrl: "https://alpha.example/funding",
      category: "company-funding",
      subject,
      targetField: "funding.amount",
      state: "accepted",
      occurredAt: "2026-08-24T01:00:00Z",
      sourceUrl: "https://github.com/acme/physical-ai-news-cn/issues/42",
      publicTargetUrl: null,
    }],
  };
  assert.doesNotThrow(() => assertContributionLedgerArtifact(contributions));

  const publicArtifact = {
    schemaVersion: 1,
    generatedAt: "2026-08-24T01:00:00Z",
    tasks: [{
      id: validSeed().id,
      version: 1,
      category: "company-funding",
      subject,
      targetField: "funding.amount",
      contextZh: "Alpha Robotics 的融资金额仍待公开证据确认。",
      issueNumber: 42,
      issueUrl: "https://github.com/acme/physical-ai-news-cn/issues/42",
      estimatedMinutes: 2,
      generatedWeek: "2026-W35",
      state: "open",
    }],
  };
  assert.doesNotThrow(() => assertCommunityTaskPublicArtifact(publicArtifact));

  assert.throws(() => assertEvidenceIssueSnapshot({ ...issueSnapshot, issues: [{ ...issueSnapshot.issues[0], body: "raw discussion" }] }), /exact keys/);
  assert.throws(() => assertEvidenceTaskLedgerArtifact({ ...ledger, generatedAt: "2026-08-24 01:00:00Z" }), /timestamp/);
  assert.throws(() => assertAcceptedEvidenceArtifact({ ...accepted, entries: [{ ...accepted.entries[0], prompt: "hidden" }] }), /private boundary/);
  assert.throws(() => assertContributionLedgerArtifact({ ...contributions, events: [{ ...contributions.events[0], secret: "hidden" }] }), /private boundary/);
  assert.throws(() => assertCommunityTaskPublicArtifact({ ...publicArtifact, tasks: [{ ...publicArtifact.tasks[0], seedId: "hidden" }] }), /private boundary/);
  assert.throws(() => assertCommunityTaskPublicArtifact({ ...publicArtifact, tasks: [{ ...publicArtifact.tasks[0], state: "stale" }] }), /state/);
});

test("issue snapshots retain exact contributor-to-evidence attribution", () => {
  const base = {
    schemaVersion: 1,
    fetchedAt: "2026-08-24T01:00:00Z",
    repo: "acme/physical-ai-news-cn",
    issues: [{
      number: 42,
      taskId: validSeed().id,
      taskVersion: 1,
      state: "open",
      labels: ["accepted-evidence", "two-minute-task"],
      authorLogin: "alice",
      authorAssociation: "CONTRIBUTOR",
      createdAt: "2026-08-20T01:00:00Z",
      updatedAt: "2026-08-23T01:00:00Z",
      closedAt: null,
      evidenceUrls: ["https://alpha.example/funding", "https://investor.example/alpha"],
      submittedEvidence: [
        { contributor: "alice", evidenceUrl: "https://alpha.example/funding", submittedAt: "2026-08-21T01:00:00Z" },
        { contributor: "bob", evidenceUrl: "https://investor.example/alpha", submittedAt: "2026-08-22T01:00:00Z" },
      ],
      acceptedContributors: ["alice", "bob"],
      acceptedEvidence: [
        { contributor: "alice", evidenceUrl: "https://alpha.example/funding" },
        { contributor: "bob", evidenceUrl: "https://investor.example/alpha" },
      ],
    }],
  };
  assert.doesNotThrow(() => assertEvidenceIssueSnapshot(base));
  assert.throws(() => assertEvidenceIssueSnapshot({
    ...base,
    issues: [{ ...base.issues[0], acceptedEvidence: [{ contributor: "alice", evidenceUrl: "https://investor.example/alpha" }] }],
  }), /acceptedEvidence/);
});

test("Issue authors accept GitHub bot actors without allowing bots as evidence contributors", () => {
  const base = {
    schemaVersion: 1,
    fetchedAt: "2026-08-24T01:00:00Z",
    repo: "acme/physical-ai-news-cn",
    issues: [{
      number: 42,
      taskId: validSeed().id,
      taskVersion: 1,
      state: "open",
      labels: ["two-minute-task"],
      authorLogin: "github-actions[bot]",
      authorAssociation: "NONE",
      createdAt: "2026-08-20T01:00:00Z",
      updatedAt: "2026-08-23T01:00:00Z",
      closedAt: null,
      evidenceUrls: ["https://alpha.example/funding"],
      submittedEvidence: [],
      acceptedContributors: [],
      acceptedEvidence: [],
    }],
  };
  assert.doesNotThrow(() => assertEvidenceIssueSnapshot(base));
  assert.throws(() => assertEvidenceIssueSnapshot({
    ...base,
    issues: [{
      ...base.issues[0],
      acceptedContributors: ["github-actions[bot]"],
      acceptedEvidence: [{ contributor: "github-actions[bot]", evidenceUrl: "https://alpha.example/funding" }],
    }],
  }), /contributor|login/i);
});

test("migrates only the exact legacy v1 Issue shape and fail-closes unknown fields", () => {
  const current = {
    schemaVersion: 1,
    fetchedAt: "2026-08-24T01:00:00Z",
    repo: "acme/physical-ai-news-cn",
    issues: [{
      number: 42, taskId: validSeed().id, taskVersion: 1, state: "open", labels: ["accepted-evidence", "two-minute-task"],
      authorLogin: "alice", authorAssociation: "CONTRIBUTOR", createdAt: "2026-08-20T01:00:00Z",
      updatedAt: "2026-08-23T01:00:00Z", closedAt: null, evidenceUrls: ["https://alpha.example/funding"],
      submittedEvidence: [{ contributor: "alice", evidenceUrl: "https://alpha.example/funding", submittedAt: "2026-08-21T01:00:00Z" }],
      acceptedContributors: ["alice"], acceptedEvidence: [{ contributor: "alice", evidenceUrl: "https://alpha.example/funding" }],
    }],
  };
  const legacy = structuredClone(current) as typeof current & { issues: Array<Record<string, unknown>> };
  delete legacy.issues[0]!.submittedEvidence;
  const migrated = migrateLegacyEvidenceIssueSnapshot(legacy);
  assert.deepEqual(migrated.issues[0]?.submittedEvidence, [{
    contributor: "alice", evidenceUrl: "https://alpha.example/funding", submittedAt: "2026-08-23T01:00:00Z",
  }]);
  assert.doesNotThrow(() => assertEvidenceIssueSnapshot(migrated));
  assert.throws(() => migrateLegacyEvidenceIssueSnapshot({ ...legacy, unsafeLegacyField: true }), /exact keys|legacy/i);
});

test("category contracts bind the canonical subject kind", () => {
  const researchSubject: EvidenceSubject = { kind: "research", id: "paper-alpha", name: "Alpha Policy", url: "https://arxiv.org/abs/2608.00001" };
  const invalid = validSeed({ subject: researchSubject });
  invalid.id = buildEvidenceTaskId(researchSubject, invalid.targetField, invalid.materialVersion);
  assert.throws(() => assertEvidenceTaskSeed(invalid), /subject kind/);
});

test("issue and ledger lifecycle clocks must be causally ordered", () => {
  const seed = validSeed();
  const issue = {
    number: 42,
    taskId: seed.id,
    taskVersion: 1,
    state: "closed",
    labels: ["two-minute-task"],
    authorLogin: "alice",
    authorAssociation: "CONTRIBUTOR",
    createdAt: "2026-08-24T01:00:00Z",
    updatedAt: "2026-08-23T01:00:00Z",
    closedAt: "2026-08-22T01:00:00Z",
    evidenceUrls: [],
    submittedEvidence: [],
    acceptedContributors: [],
    acceptedEvidence: [],
  };
  assert.throws(() => assertEvidenceIssueSnapshot({ schemaVersion: 1, fetchedAt: "2026-08-24T02:00:00Z", repo: "acme/repo", issues: [issue] }), /clock order/);

  const entry = {
    taskId: seed.id,
    taskVersion: 1,
    category: seed.category,
    subject: seed.subject,
    targetField: seed.targetField,
    materialVersion: seed.materialVersion,
    supersedesTaskId: null,
    issueNumber: 42,
    issueUrl: "https://github.com/acme/repo/issues/42",
    state: "closed",
    createdAt: "2026-08-24T01:00:00Z",
    updatedAt: "2026-08-23T01:00:00Z",
    lastActivityAt: "2026-08-22T01:00:00Z",
    closedAt: "2026-08-21T01:00:00Z",
  };
  assert.throws(() => assertEvidenceTaskLedgerArtifact({ schemaVersion: 1, generatedAt: "2026-08-24T02:00:00Z", entries: [entry] }), /clock order/);
});

test("accepted and contribution records cannot be newer than their artifacts", () => {
  const seed = validSeed();
  const acceptedEntry = {
    id: buildContributionEventId({
      taskId: seed.id,
      issueNumber: 42,
      contributor: "alice",
      evidenceUrl: "https://alpha.example/funding",
      state: "accepted",
      occurredAt: "2026-08-25T01:00:00Z",
    }),
    taskId: seed.id,
    issueNumber: 42,
    category: seed.category,
    subject: seed.subject,
    targetField: seed.targetField,
    contributor: "alice",
    evidenceUrl: "https://alpha.example/funding",
    acceptedAt: "2026-08-25T01:00:00Z",
  };
  assert.throws(() => assertAcceptedEvidenceArtifact({ schemaVersion: 1, generatedAt: "2026-08-24T01:00:00Z", entries: [acceptedEntry] }), /newer than generatedAt/);

  const event = {
    id: buildContributionEventId({
      taskId: seed.id,
      issueNumber: 42,
      contributor: "alice",
      evidenceUrl: "https://alpha.example/funding",
      state: "accepted",
      occurredAt: "2026-08-25T01:00:00Z",
    }),
    taskId: seed.id,
    issueNumber: 42,
    contributor: "alice",
    evidenceUrl: "https://alpha.example/funding",
    category: seed.category,
    subject: seed.subject,
    targetField: seed.targetField,
    state: "accepted",
    occurredAt: "2026-08-25T01:00:00Z",
    sourceUrl: "https://github.com/acme/repo/issues/42",
    publicTargetUrl: null,
  };
  assert.throws(() => assertContributionLedgerArtifact({ schemaVersion: 1, generatedAt: "2026-08-24T01:00:00Z", events: [event] }), /newer than generatedAt/);
});

test("stable contribution IDs are public and independently enforced by exact validators", () => {
  const identity = {
    taskId: "evidence-task-0123456789abcdef01234567",
    issueNumber: 42,
    contributor: "alice",
    evidenceUrl: "https://alpha.example/funding",
    state: "accepted" as const,
    occurredAt: "2026-08-24T01:00:00Z",
  };
  const expected = "084b85e4435c73d8df80c0e8fdb910ff522de7b4967e30d3a2bd0557d5b9abd5";
  assert.equal(buildContributionEventId(identity), expected);

  const acceptedEntry = {
    id: expected,
    taskId: identity.taskId,
    issueNumber: identity.issueNumber,
    category: "company-funding" as const,
    subject,
    targetField: "funding.amount" as const,
    contributor: identity.contributor,
    evidenceUrl: identity.evidenceUrl,
    acceptedAt: identity.occurredAt,
  };
  const event = {
    ...identity,
    id: expected,
    category: "company-funding" as const,
    subject,
    targetField: "funding.amount" as const,
    sourceUrl: "https://github.com/acme/repo/issues/42",
    publicTargetUrl: null,
  };
  assert.doesNotThrow(() => assertAcceptedEvidenceArtifact({ schemaVersion: 1, generatedAt: identity.occurredAt, entries: [acceptedEntry] }));
  assert.doesNotThrow(() => assertContributionLedgerArtifact({ schemaVersion: 1, generatedAt: identity.occurredAt, events: [event] }));
  assert.throws(() => assertAcceptedEvidenceArtifact({
    schemaVersion: 1,
    generatedAt: identity.occurredAt,
    entries: [{ ...acceptedEntry, id: "forged-but-matching" }],
  }), /stable|identity|id/i);
  assert.throws(() => assertContributionLedgerArtifact({
    schemaVersion: 1,
    generatedAt: identity.occurredAt,
    events: [{ ...event, id: "forged-but-matching" }],
  }), /stable|identity|id/i);
});

test("contribution IDs preserve issue-number and contributor field boundaries", () => {
  const shared = {
    taskId: "evidence-task-0123456789abcdef01234567",
    evidenceUrl: "https://alpha.example/funding",
    state: "accepted" as const,
    occurredAt: "2026-08-24T01:00:00Z",
  };
  const first = { ...shared, issueNumber: 1, contributor: "23" };
  const second = { ...shared, issueNumber: 12, contributor: "3" };

  assert.notEqual(buildContributionEventId(first), buildContributionEventId(second));
});

test("accepted and contribution validators reject an ID copied across a field-boundary collision", () => {
  const shared = {
    taskId: "evidence-task-0123456789abcdef01234567",
    evidenceUrl: "https://alpha.example/funding",
    state: "accepted" as const,
    occurredAt: "2026-08-24T01:00:00Z",
  };
  const first = { ...shared, issueNumber: 1, contributor: "23" };
  const second = { ...shared, issueNumber: 12, contributor: "3" };
  const copiedId = buildContributionEventId(first);
  const acceptedEntry = {
    id: copiedId,
    taskId: second.taskId,
    issueNumber: second.issueNumber,
    category: "company-funding" as const,
    subject,
    targetField: "funding.amount" as const,
    contributor: second.contributor,
    evidenceUrl: second.evidenceUrl,
    acceptedAt: second.occurredAt,
  };
  const event = {
    ...second,
    id: copiedId,
    category: "company-funding" as const,
    subject,
    targetField: "funding.amount" as const,
    sourceUrl: "https://github.com/acme/repo/issues/12",
    publicTargetUrl: null,
  };

  assert.throws(
    () => assertAcceptedEvidenceArtifact({ schemaVersion: 1, generatedAt: second.occurredAt, entries: [acceptedEntry] }),
    /stable|identity|id/i,
  );
  assert.throws(
    () => assertContributionLedgerArtifact({ schemaVersion: 1, generatedAt: second.occurredAt, events: [event] }),
    /stable|identity|id/i,
  );
});
