import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  assertAcceptedEvidenceArtifact,
  assertContributionLedgerArtifact,
  buildEvidenceTaskId,
  type AcceptedEvidenceArtifact,
  type ContributionLedgerArtifact,
  type EvidenceIssue,
  type EvidenceIssueSnapshot,
  type EvidenceTaskLedgerArtifact,
  type EvidenceTaskLedgerEntry,
} from "../src/community-evidence/contracts.js";
import { projectAcceptedEvidence } from "../src/community-evidence/contributions.js";

const NOW = "2026-08-24T12:00:00Z";
const ACCEPTED_AT = "2026-08-24T10:00:00Z";
const REPO = "acme/physical-ai-news-cn";
const subject = { kind: "company" as const, id: "company-alpha", name: "Alpha Robotics", url: "https://alpha.example/" };
const taskId = buildEvidenceTaskId(subject, "funding.amount", "material-1");

function issue(overrides: Partial<EvidenceIssue> = {}): EvidenceIssue {
  return {
    number: 41,
    taskId,
    taskVersion: 1,
    state: "closed",
    labels: ["accepted-evidence", "two-minute-task"],
    authorLogin: "alice",
    authorAssociation: "FIRST_TIMER",
    createdAt: "2026-08-20T00:00:00Z",
    updatedAt: ACCEPTED_AT,
    closedAt: ACCEPTED_AT,
    evidenceUrls: ["https://evidence.example/report"],
    acceptedContributors: ["alice"],
    acceptedEvidence: [{ contributor: "alice", evidenceUrl: "https://evidence.example/report" }],
    ...overrides,
  };
}

function issues(items: EvidenceIssue[]): EvidenceIssueSnapshot {
  return { schemaVersion: 1, fetchedAt: NOW, repo: REPO, issues: items };
}

function ledgerEntry(overrides: Partial<EvidenceTaskLedgerEntry> = {}): EvidenceTaskLedgerEntry {
  return {
    taskId,
    taskVersion: 1,
    category: "company-funding",
    subject,
    targetField: "funding.amount",
    materialVersion: "material-1",
    supersedesTaskId: null,
    issueNumber: 41,
    issueUrl: `https://github.com/${REPO}/issues/41`,
    state: "accepted",
    createdAt: "2026-08-20T00:00:00Z",
    updatedAt: ACCEPTED_AT,
    lastActivityAt: ACCEPTED_AT,
    closedAt: ACCEPTED_AT,
    ...overrides,
  };
}

function taskLedger(entries: EvidenceTaskLedgerEntry[] = [ledgerEntry()]): EvidenceTaskLedgerArtifact {
  return { schemaVersion: 1, generatedAt: NOW, entries };
}

function accepted(entries: AcceptedEvidenceArtifact["entries"] = []): AcceptedEvidenceArtifact {
  return { schemaVersion: 1, generatedAt: NOW, entries };
}

function contributions(events: ContributionLedgerArtifact["events"] = []): ContributionLedgerArtifact {
  return { schemaVersion: 1, generatedAt: NOW, events };
}

function eventId(contributor: string, evidenceUrl: string, state: string, occurredAt: string): string {
  return createHash("sha256").update(`${taskId}41${contributor}${evidenceUrl}${state}${occurredAt}`).digest("hex");
}

test("first acceptance uses only canonical task-ledger metadata and credits the Issue author", () => {
  const result = projectAcceptedEvidence({
    issues: issues([issue()]),
    taskLedger: taskLedger(),
    previousAccepted: accepted(),
    previousContributions: contributions(),
    now: NOW,
  });

  assert.deepEqual(result.accepted.entries, [{
    id: eventId("alice", "https://evidence.example/report", "accepted", ACCEPTED_AT),
    taskId,
    issueNumber: 41,
    category: "company-funding",
    subject,
    targetField: "funding.amount",
    contributor: "alice",
    evidenceUrl: "https://evidence.example/report",
    acceptedAt: ACCEPTED_AT,
  }]);
  assert.deepEqual(result.contributions.events, [{
    id: eventId("alice", "https://evidence.example/report", "accepted", ACCEPTED_AT),
    taskId,
    issueNumber: 41,
    contributor: "alice",
    evidenceUrl: "https://evidence.example/report",
    category: "company-funding",
    subject,
    targetField: "funding.amount",
    state: "accepted",
    occurredAt: ACCEPTED_AT,
    sourceUrl: `https://github.com/${REPO}/issues/41`,
    publicTargetUrl: null,
  }]);
  assert.doesNotThrow(() => assertAcceptedEvidenceArtifact(result.accepted));
  assert.doesNotThrow(() => assertContributionLedgerArtifact(result.contributions));
});

test("does not credit the Issue author before accepted-evidence exists", () => {
  const result = projectAcceptedEvidence({
    issues: issues([issue({ labels: ["two-minute-task"], acceptedContributors: [], acceptedEvidence: [] })]),
    taskLedger: taskLedger([ledgerEntry({ state: "contributed", closedAt: null })]),
    previousAccepted: accepted(),
    previousContributions: contributions(),
    now: NOW,
  });
  assert.deepEqual(result.accepted.entries, []);
  assert.deepEqual(result.contributions.events, []);
});

test("credits only explicitly accepted commenters bound to their evidence URL", () => {
  const result = projectAcceptedEvidence({
    issues: issues([issue({
      evidenceUrls: ["https://evidence.example/alice", "https://evidence.example/helper"],
      acceptedContributors: ["alice", "helper"],
      acceptedEvidence: [
        { contributor: "alice", evidenceUrl: "https://evidence.example/alice" },
        { contributor: "helper", evidenceUrl: "https://evidence.example/helper" },
      ],
    })]),
    taskLedger: taskLedger(),
    previousAccepted: accepted(),
    previousContributions: contributions(),
    now: NOW,
  });
  assert.deepEqual(result.accepted.entries.map((entry) => [entry.contributor, entry.evidenceUrl]), [
    ["helper", "https://evidence.example/helper"],
    ["alice", "https://evidence.example/alice"],
  ].sort((left, right) => eventId(left[0]!, left[1]!, "accepted", ACCEPTED_AT).localeCompare(eventId(right[0]!, right[1]!, "accepted", ACCEPTED_AT))));
});

test("fails closed when accepted task ledger identity is missing or mismatched", async (t) => {
  const base = {
    issues: issues([issue()]),
    previousAccepted: accepted(),
    previousContributions: contributions(),
    now: NOW,
  };
  await t.test("missing task", () => {
    assert.throws(() => projectAcceptedEvidence({ ...base, taskLedger: taskLedger([]) }), /exactly one task ledger entry/);
  });
  await t.test("duplicate task", () => {
    assert.throws(
      () => projectAcceptedEvidence({ ...base, taskLedger: taskLedger([ledgerEntry(), ledgerEntry()]) }),
      /exactly one task ledger entry/,
    );
  });
  await t.test("issue number mismatch", () => {
    assert.throws(() => projectAcceptedEvidence({ ...base, taskLedger: taskLedger([ledgerEntry({ issueNumber: 42 })]) }), /issue number/);
  });
  await t.test("task version mismatch", () => {
    assert.throws(() => projectAcceptedEvidence({ ...base, taskLedger: taskLedger([ledgerEntry({ taskVersion: 2 })]) }), /task version/);
  });
  await t.test("task identity mismatch", () => {
    const other = { ...subject, id: "company-other", name: "Other Robotics" };
    assert.throws(
      () => projectAcceptedEvidence({ ...base, taskLedger: taskLedger([ledgerEntry({ subject: other })]) }),
      /task ledger|identity/,
    );
  });
});

test("withdrawal, canonical promotion, and source correction append transitions without rewriting history", () => {
  const first = projectAcceptedEvidence({
    issues: issues([issue()]), taskLedger: taskLedger(), previousAccepted: accepted(), previousContributions: contributions(), now: NOW,
  });
  const withdrawnAt = "2026-08-25T10:00:00Z";
  const withdrawn = projectAcceptedEvidence({
    issues: { ...issues([issue({ labels: ["two-minute-task"], updatedAt: withdrawnAt, acceptedContributors: [], acceptedEvidence: [] })]), fetchedAt: withdrawnAt },
    taskLedger: { ...taskLedger(), generatedAt: withdrawnAt },
    previousAccepted: first.accepted,
    previousContributions: first.contributions,
    now: withdrawnAt,
  });
  assert.deepEqual(withdrawn.accepted.entries, []);
  assert.deepEqual(withdrawn.contributions.events.map((event) => event.state), ["accepted", "withdrawn"]);

  const promotedAt = "2026-08-26T10:00:00Z";
  const promoted = projectAcceptedEvidence({
    issues: { ...issues([issue({ labels: ["accepted-evidence", "canonical-promoted", "two-minute-task"], updatedAt: promotedAt })]), fetchedAt: promotedAt },
    taskLedger: { ...taskLedger(), generatedAt: promotedAt },
    previousAccepted: withdrawn.accepted,
    previousContributions: withdrawn.contributions,
    now: promotedAt,
  });
  assert.deepEqual(promoted.contributions.events.map((event) => event.state).sort(), ["accepted", "accepted", "promoted", "withdrawn"].sort());
  assert.equal(promoted.contributions.events.find((event) => event.state === "promoted")?.publicTargetUrl, subject.url);

  const correctedAt = "2026-08-27T10:00:00Z";
  const corrected = projectAcceptedEvidence({
    issues: { ...issues([issue({ labels: ["accepted-evidence", "source-withdrawn", "two-minute-task"], updatedAt: correctedAt })]), fetchedAt: correctedAt },
    taskLedger: { ...taskLedger(), generatedAt: correctedAt },
    previousAccepted: promoted.accepted,
    previousContributions: promoted.contributions,
    now: correctedAt,
  });
  assert.equal(corrected.contributions.events.at(-1)?.state, "corrected");
  assert.deepEqual(corrected.contributions.events.slice(0, promoted.contributions.events.length), promoted.contributions.events);

  const repeated = projectAcceptedEvidence({
    issues: { ...issues([issue({ labels: ["accepted-evidence", "source-withdrawn", "two-minute-task"], updatedAt: correctedAt })]), fetchedAt: correctedAt },
    taskLedger: { ...taskLedger(), generatedAt: correctedAt },
    previousAccepted: corrected.accepted,
    previousContributions: corrected.contributions,
    now: correctedAt,
  });
  assert.deepEqual(repeated.contributions.events, corrected.contributions.events);
});

test("rejects mutated contribution event identities", () => {
  const first = projectAcceptedEvidence({
    issues: issues([issue()]), taskLedger: taskLedger(), previousAccepted: accepted(), previousContributions: contributions(), now: NOW,
  });
  const mutated = { ...first.contributions.events[0]!, contributor: "mallory" };
  assert.throws(
    () => projectAcceptedEvidence({
      issues: issues([issue()]), taskLedger: taskLedger(), previousAccepted: first.accepted,
      previousContributions: contributions([mutated]), now: NOW,
    }),
    /history.*mutated|identity/i,
  );
});

test("preserves accepted entry identity and time across unrelated Issue updates", () => {
  const first = projectAcceptedEvidence({
    issues: issues([issue()]), taskLedger: taskLedger(), previousAccepted: accepted(), previousContributions: contributions(), now: NOW,
  });
  const later = "2026-08-25T10:00:00Z";
  const repeated = projectAcceptedEvidence({
    issues: { ...issues([issue({ updatedAt: later })]), fetchedAt: later },
    taskLedger: { ...taskLedger(), generatedAt: later },
    previousAccepted: first.accepted,
    previousContributions: first.contributions,
    now: later,
  });
  assert.deepEqual(repeated.accepted.entries, first.accepted.entries);
  assert.deepEqual(repeated.contributions.events, first.contributions.events);
});

test("preserves original acceptance identity and time when accepted evidence is promoted", () => {
  const first = projectAcceptedEvidence({
    issues: issues([issue()]), taskLedger: taskLedger(), previousAccepted: accepted(), previousContributions: contributions(), now: NOW,
  });
  const promotedAt = "2026-08-25T10:00:00Z";
  const promoted = projectAcceptedEvidence({
    issues: { ...issues([issue({ labels: ["accepted-evidence", "canonical-promoted", "two-minute-task"], updatedAt: promotedAt })]), fetchedAt: promotedAt },
    taskLedger: { ...taskLedger(), generatedAt: promotedAt },
    previousAccepted: first.accepted,
    previousContributions: first.contributions,
    now: promotedAt,
  });
  assert.deepEqual(promoted.accepted.entries, first.accepted.entries);
  assert.equal(promoted.contributions.events[0]?.state, "accepted");
  assert.equal(promoted.contributions.events[0]?.occurredAt, ACCEPTED_AT);
  assert.equal(promoted.contributions.events[1]?.state, "promoted");
});

test("fails closed instead of silently clearing accepted evidence with no bound URL", () => {
  assert.throws(
    () => projectAcceptedEvidence({
      issues: issues([issue({ acceptedContributors: [], acceptedEvidence: [], evidenceUrls: [] })]),
      taskLedger: taskLedger(),
      previousAccepted: accepted(),
      previousContributions: contributions(),
      now: NOW,
    }),
    /accepted.*evidence URL/i,
  );
});

test("fails closed when a previously active accepted Issue disappears from the snapshot", () => {
  const first = projectAcceptedEvidence({
    issues: issues([issue()]), taskLedger: taskLedger(), previousAccepted: accepted(), previousContributions: contributions(), now: NOW,
  });
  assert.throws(
    () => projectAcceptedEvidence({
      issues: issues([]),
      taskLedger: taskLedger(),
      previousAccepted: first.accepted,
      previousContributions: first.contributions,
      now: NOW,
    }),
    /missing.*snapshot/i,
  );
});
