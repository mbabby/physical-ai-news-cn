import {
  assertAcceptedEvidenceArtifact,
  assertCommunityTaskPublicArtifact,
  assertContributionLedgerArtifact,
  assertEvidenceTaskLedgerArtifact,
  assertEvidenceTaskSeedArtifact,
  type AcceptedEvidenceArtifact,
  type CommunityTaskPublicArtifact,
  type ContributionLedgerArtifact,
  type ContributionState,
  type EvidenceTaskCategory,
  type EvidenceTaskLedgerArtifact,
  type EvidenceTaskSeedArtifact,
} from "./contracts.js";

const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const UNSUPPORTED_NEGATIVE = /(?:没有|暂无|尚无|未)(?:融资|部署|代码|数据集|权重|客户|投资方)|(?:no|not|without|unavailable|absent)\s+(?:funding|deployment|code|dataset|weights?)/i;
const RECENT_STATES = new Set<ContributionState>(["accepted", "promoted", "corrected", "withdrawn"]);

export interface CommunityContributionPublicRecord {
  contributor: string;
  category: EvidenceTaskCategory;
  subjectName: string;
  subjectUrl: string;
  state: Exclude<ContributionState, "submitted">;
  occurredAt: string;
  issueUrl: string;
  evidenceUrl: string;
  publicTargetUrl: string | null;
}

export interface CommunityEvidencePublication {
  taskArtifact: CommunityTaskPublicArtifact;
  metrics: {
    openTasks: number;
    weeklyAccepted: number;
    newContributors: number;
  };
  recentContributions: CommunityContributionPublicRecord[];
}

export interface BuildCommunityEvidencePublicationInput {
  seeds: EvidenceTaskSeedArtifact;
  ledger: EvidenceTaskLedgerArtifact;
  accepted: AcceptedEvidenceArtifact;
  contributions: ContributionLedgerArtifact;
  repository: string;
  generatedAt: string;
  previousTasks?: CommunityTaskPublicArtifact;
}

function validateInput(input: BuildCommunityEvidencePublicationInput): void {
  assertEvidenceTaskSeedArtifact(input.seeds);
  assertEvidenceTaskLedgerArtifact(input.ledger);
  assertAcceptedEvidenceArtifact(input.accepted);
  assertContributionLedgerArtifact(input.contributions);
  if (input.previousTasks) assertCommunityTaskPublicArtifact(input.previousTasks);
  if (!REPOSITORY.test(input.repository)) throw new Error("Invalid community publication repository");
  const generatedAt = new Date(input.generatedAt);
  const canonical = generatedAt.toISOString();
  if (!Number.isFinite(generatedAt.getTime())
    || (canonical !== input.generatedAt && canonical.replace(".000Z", "Z") !== input.generatedAt)) {
    throw new Error("Invalid community publication timestamp");
  }
  if (input.ledger.generatedAt !== input.generatedAt || input.accepted.generatedAt !== input.generatedAt
    || input.contributions.generatedAt !== input.generatedAt) {
    throw new Error("Community publication artifacts must share one generation clock");
  }
}

function issueUrl(repository: string, issueNumber: number): string {
  return `https://github.com/${repository}/issues/${issueNumber}`;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function buildCommunityTaskPublicArtifact(input: BuildCommunityEvidencePublicationInput): CommunityTaskPublicArtifact {
  validateInput(input);
  const seeds = new Map(input.seeds.seeds.map((seed) => [seed.id, seed]));
  const priorTasks = new Map((input.previousTasks?.tasks ?? []).map((task) => [task.id, task]));
  const tasks = input.ledger.entries.flatMap((entry) => {
    if ((entry.state !== "open" && entry.state !== "contributed") || entry.issueNumber === null) return [];
    const seed = seeds.get(entry.taskId);
    const prior = priorTasks.get(entry.taskId);
    if (!seed && !prior) throw new Error(`Public community task ${entry.taskId} has no validated seed or prior projection`);
    const contextZh = seed?.contextZh ?? prior!.contextZh;
    if (UNSUPPORTED_NEGATIVE.test(contextZh)) throw new Error("Public community task contains an unsupported negative unknown claim");
    return [{
      id: entry.taskId,
      version: entry.taskVersion,
      category: entry.category,
      subject: entry.subject,
      targetField: entry.targetField,
      contextZh,
      issueNumber: entry.issueNumber,
      issueUrl: issueUrl(input.repository, entry.issueNumber),
      estimatedMinutes: 2 as const,
      generatedWeek: seed?.generatedWeek ?? prior!.generatedWeek,
      state: entry.state,
    }];
  }).sort((left, right) => compareStrings(left.category, right.category)
    || compareStrings(left.subject.name, right.subject.name)
    || compareStrings(left.targetField, right.targetField)
    || compareStrings(left.id, right.id));
  const artifact: CommunityTaskPublicArtifact = { schemaVersion: 1, generatedAt: input.generatedAt, tasks };
  assertCommunityTaskPublicArtifact(artifact);
  return artifact;
}

function weekStart(timestamp: string): number {
  const date = new Date(timestamp);
  const day = date.getUTCDay() || 7;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - day + 1);
}

export function buildCommunityEvidencePublication(input: BuildCommunityEvidencePublicationInput): CommunityEvidencePublication {
  const taskArtifact = buildCommunityTaskPublicArtifact(input);
  const start = weekStart(input.generatedAt);
  const end = start + 7 * 86_400_000;
  const acceptedThisWeek = input.contributions.events.filter((event) => {
    const timestamp = Date.parse(event.occurredAt);
    if (event.state !== "accepted") return false;
    return timestamp >= start && timestamp < end;
  });
  const previouslyAccepted = new Set(input.contributions.events
    .filter((event) => event.state === "accepted" && Date.parse(event.occurredAt) < start)
    .map((event) => event.contributor));
  const newContributors = new Set(acceptedThisWeek
    .map((event) => event.contributor)
    .filter((contributor) => !previouslyAccepted.has(contributor))).size;
  const recentContributions = input.contributions.events
    .filter((event): event is typeof event & { state: Exclude<ContributionState, "submitted"> } => RECENT_STATES.has(event.state))
    .slice(-12)
    .reverse()
    .map((event) => ({
      contributor: event.contributor,
      category: event.category,
      subjectName: event.subject.name,
      subjectUrl: event.subject.url,
      state: event.state,
      occurredAt: event.occurredAt,
      issueUrl: issueUrl(input.repository, event.issueNumber),
      evidenceUrl: event.evidenceUrl,
      publicTargetUrl: event.publicTargetUrl,
    }));
  return {
    taskArtifact,
    metrics: { openTasks: taskArtifact.tasks.length, weeklyAccepted: acceptedThisWeek.length, newContributors },
    recentContributions,
  };
}
