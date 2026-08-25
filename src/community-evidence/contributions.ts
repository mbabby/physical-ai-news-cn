import { createHash } from "node:crypto";
import {
  assertAcceptedEvidenceArtifact,
  assertContributionLedgerArtifact,
  assertEvidenceIssueSnapshot,
  assertEvidenceTaskLedgerArtifact,
  buildEvidenceTaskId,
  type AcceptedEvidenceArtifact,
  type AcceptedEvidenceEntry,
  type ContributionLedgerArtifact,
  type ContributionState,
  type ContributionStateEvent,
  type EvidenceIssue,
  type EvidenceTaskLedgerArtifact,
  type EvidenceTaskLedgerEntry,
} from "./contracts.js";

function eventIdentity(input: {
  taskId: string;
  issueNumber: number;
  contributor: string;
  evidenceUrl: string;
  state: ContributionState;
  occurredAt: string;
}): string {
  return createHash("sha256")
    .update(`${input.taskId}${input.issueNumber}${input.contributor}${input.evidenceUrl}${input.state}${input.occurredAt}`)
    .digest("hex");
}

function pairIdentity(input: { taskId: string; issueNumber: number; contributor: string; evidenceUrl: string }): string {
  return `${input.taskId}\n${input.issueNumber}\n${input.contributor}\n${input.evidenceUrl}`;
}

function validateHistory(previous: ContributionLedgerArtifact): void {
  assertContributionLedgerArtifact(previous);
  for (const event of previous.events) {
    if (event.id !== eventIdentity(event)) throw new Error(`Contribution history event identity was mutated: ${event.id}`);
  }
}

function resolveTask(issue: EvidenceIssue, ledger: EvidenceTaskLedgerArtifact): EvidenceTaskLedgerEntry {
  const matches = ledger.entries.filter((entry) => entry.taskId === issue.taskId);
  if (matches.length !== 1) throw new Error(`Accepted Issue ${issue.number} must resolve exactly one task ledger entry`);
  const task = matches[0]!;
  if (task.issueNumber !== issue.number) throw new Error(`Accepted Issue ${issue.number} conflicts with task ledger issue number`);
  if (task.taskVersion !== issue.taskVersion) throw new Error(`Accepted Issue ${issue.number} conflicts with task ledger task version`);
  if (task.taskId !== buildEvidenceTaskId(task.subject, task.targetField, task.materialVersion)) {
    throw new Error(`Accepted Issue ${issue.number} conflicts with task ledger identity`);
  }
  return task;
}

function desiredState(issue: EvidenceIssue): ContributionState | null {
  if (issue.labels.includes("source-withdrawn")) return "corrected";
  if (issue.labels.includes("canonical-promoted")) return "promoted";
  if (issue.labels.includes("accepted-evidence")) return "accepted";
  return null;
}

function compareEvents(left: ContributionStateEvent, right: ContributionStateEvent): number {
  return left.occurredAt < right.occurredAt ? -1 : left.occurredAt > right.occurredAt ? 1
    : left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function activeAcceptedTransition(events: ContributionStateEvent[]): ContributionStateEvent | undefined {
  let accepted: ContributionStateEvent | undefined;
  let acceptedIndex = -1;
  let terminalIndex = -1;
  events.forEach((event, index) => {
    if (event.state === "accepted") {
      accepted = event;
      acceptedIndex = index;
    }
    if (event.state === "withdrawn" || event.state === "corrected") terminalIndex = index;
  });
  return acceptedIndex > terminalIndex ? accepted : undefined;
}

export function projectAcceptedEvidence(input: {
  issues: import("./contracts.js").EvidenceIssueSnapshot;
  taskLedger: EvidenceTaskLedgerArtifact;
  previousAccepted: AcceptedEvidenceArtifact;
  previousContributions: ContributionLedgerArtifact;
  now: string;
}): { accepted: AcceptedEvidenceArtifact; contributions: ContributionLedgerArtifact } {
  assertEvidenceIssueSnapshot(input.issues);
  assertAcceptedEvidenceArtifact(input.previousAccepted);
  validateHistory(input.previousContributions);

  const rawEntries = input.taskLedger as unknown as { entries?: unknown };
  if (Array.isArray(rawEntries.entries)) {
    const identities = rawEntries.entries
      .filter((entry): entry is { taskId: unknown } => Boolean(entry) && typeof entry === "object" && "taskId" in entry)
      .map((entry) => entry.taskId);
    if (new Set(identities).size !== identities.length) throw new Error("Accepted Issue must resolve exactly one task ledger entry; duplicate task identity found");
  }
  assertEvidenceTaskLedgerArtifact(input.taskLedger);
  const nowMs = Date.parse(input.now);
  if (!Number.isFinite(nowMs)
    || Date.parse(input.issues.fetchedAt) > nowMs
    || Date.parse(input.taskLedger.generatedAt) > nowMs
    || Date.parse(input.previousAccepted.generatedAt) > nowMs
    || Date.parse(input.previousContributions.generatedAt) > nowMs) {
    throw new Error("Community evidence projection inputs cannot be newer than now");
  }

  const previousEvents = input.previousContributions.events;
  const latestByPair = new Map<string, ContributionStateEvent>();
  const historyByPair = new Map<string, ContributionStateEvent[]>();
  for (const event of previousEvents) {
    const identity = pairIdentity(event);
    latestByPair.set(identity, event);
    const history = historyByPair.get(identity) ?? [];
    history.push(event);
    historyByPair.set(identity, history);
  }
  const previousAcceptedByPair = new Map(input.previousAccepted.entries.map((entry) => [pairIdentity(entry), entry]));
  const currentAccepted: AcceptedEvidenceEntry[] = [];
  const transitions: ContributionStateEvent[] = [];
  const currentPairs = new Set<string>();

  for (const issue of input.issues.issues) {
    const state = desiredState(issue);
    if (!state) continue;
    const task = resolveTask(issue, input.taskLedger);
    if ((state === "accepted" || state === "promoted") && issue.acceptedEvidence.length === 0) {
      throw new Error(`Accepted Issue ${issue.number} must bind at least one accepted evidence URL`);
    }
    for (const pair of issue.acceptedEvidence) {
      const identity = pairIdentity({ taskId: issue.taskId, issueNumber: issue.number, ...pair });
      currentPairs.add(identity);
      let activeAcceptedEntry: AcceptedEvidenceEntry | undefined;
      if (state === "accepted" || state === "promoted") {
        const priorActive = previousAcceptedByPair.get(identity);
        const acceptedTransition = activeAcceptedTransition(historyByPair.get(identity) ?? []);
        if (priorActive) {
          if (!acceptedTransition || priorActive.id !== acceptedTransition.id || priorActive.acceptedAt !== acceptedTransition.occurredAt) {
            throw new Error(`Active accepted evidence history was mutated for Issue ${issue.number}`);
          }
          activeAcceptedEntry = priorActive;
        } else if (acceptedTransition) {
          activeAcceptedEntry = {
            id: acceptedTransition.id,
            taskId: issue.taskId,
            issueNumber: issue.number,
            category: task.category,
            subject: task.subject,
            targetField: task.targetField,
            contributor: pair.contributor,
            evidenceUrl: pair.evidenceUrl,
            acceptedAt: acceptedTransition.occurredAt,
          };
        } else {
          const newAcceptance: ContributionStateEvent = {
            id: eventIdentity({ taskId: issue.taskId, issueNumber: issue.number, ...pair, state: "accepted", occurredAt: issue.updatedAt }),
            taskId: issue.taskId,
            issueNumber: issue.number,
            contributor: pair.contributor,
            evidenceUrl: pair.evidenceUrl,
            category: task.category,
            subject: task.subject,
            targetField: task.targetField,
            state: "accepted",
            occurredAt: issue.updatedAt,
            sourceUrl: `https://github.com/${input.issues.repo}/issues/${issue.number}`,
            publicTargetUrl: null,
          };
          transitions.push(newAcceptance);
          latestByPair.set(identity, newAcceptance);
          activeAcceptedEntry = {
            id: newAcceptance.id,
            taskId: issue.taskId,
            issueNumber: issue.number,
            category: task.category,
            subject: task.subject,
            targetField: task.targetField,
            contributor: pair.contributor,
            evidenceUrl: pair.evidenceUrl,
            acceptedAt: newAcceptance.occurredAt,
          };
        }
        currentAccepted.push(activeAcceptedEntry);
      }
      const sameAcceptancePromotion = state === "promoted" && activeAcceptedEntry !== undefined
        && (historyByPair.get(identity) ?? []).some((event) => event.state === "promoted" && event.occurredAt === activeAcceptedEntry.acceptedAt);
      if (state === "accepted" || sameAcceptancePromotion || latestByPair.get(identity)?.state === state) continue;
      const event: ContributionStateEvent = {
        id: eventIdentity({ taskId: issue.taskId, issueNumber: issue.number, ...pair, state, occurredAt: issue.updatedAt }),
        taskId: issue.taskId,
        issueNumber: issue.number,
        contributor: pair.contributor,
        evidenceUrl: pair.evidenceUrl,
        category: task.category,
        subject: task.subject,
        targetField: task.targetField,
        state,
        occurredAt: issue.updatedAt,
        sourceUrl: `https://github.com/${input.issues.repo}/issues/${issue.number}`,
        publicTargetUrl: state === "promoted" ? task.subject.url : null,
      };
      transitions.push(event);
      latestByPair.set(identity, event);
    }
  }

  for (const entry of input.previousAccepted.entries) {
    const identity = pairIdentity(entry);
    if (currentPairs.has(identity)) continue;
    const issue = input.issues.issues.find((candidate) => candidate.taskId === entry.taskId && candidate.number === entry.issueNumber);
    if (!issue) throw new Error(`Previously accepted Issue ${entry.issueNumber} is missing from the current snapshot`);
    const state: ContributionState = issue.labels.includes("source-withdrawn") ? "corrected" : "withdrawn";
    if (latestByPair.get(identity)?.state === state) continue;
    const task = resolveTask(issue, input.taskLedger);
    const event: ContributionStateEvent = {
      id: eventIdentity({ ...entry, state, occurredAt: issue.updatedAt }),
      taskId: entry.taskId,
      issueNumber: entry.issueNumber,
      contributor: entry.contributor,
      evidenceUrl: entry.evidenceUrl,
      category: task.category,
      subject: task.subject,
      targetField: task.targetField,
      state,
      occurredAt: issue.updatedAt,
      sourceUrl: `https://github.com/${input.issues.repo}/issues/${issue.number}`,
      publicTargetUrl: null,
    };
    transitions.push(event);
    latestByPair.set(identity, event);
  }

  transitions.sort(compareEvents);
  if (transitions.length > 0 && previousEvents.length > 0 && compareEvents(previousEvents.at(-1)!, transitions[0]!) >= 0) {
    throw new Error("Contribution history cannot append a transition before existing history");
  }
  const acceptedArtifact: AcceptedEvidenceArtifact = {
    schemaVersion: 1,
    generatedAt: input.now,
    entries: currentAccepted.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  };
  const contributionArtifact: ContributionLedgerArtifact = {
    schemaVersion: 1,
    generatedAt: input.now,
    events: [...previousEvents, ...transitions],
  };
  assertAcceptedEvidenceArtifact(acceptedArtifact);
  assertContributionLedgerArtifact(contributionArtifact);
  if (!previousEvents.every((event, index) => contributionArtifact.events[index] === event)) {
    throw new Error("Contribution history was deleted or mutated");
  }
  return { accepted: acceptedArtifact, contributions: contributionArtifact };
}
