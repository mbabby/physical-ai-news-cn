import type { CommunityTaskPublicArtifact, ContributionLedgerArtifact, EvidenceTaskLedgerArtifact } from "./contracts.js";

export interface FlywheelInput {
  publicTasks?: Pick<CommunityTaskPublicArtifact, "tasks">;
  ledger?: Pick<EvidenceTaskLedgerArtifact, "entries">;
  contributions?: Pick<ContributionLedgerArtifact, "events">;
  now?: Date;
}

/** Pure local projection shared by the daily transaction and GitHub sampler. */
export function buildFlywheelMetrics({ publicTasks, ledger, contributions, now = new Date() }: FlywheelInput = {}) {
  const tasks = publicTasks?.tasks ?? [];
  const entries = ledger?.entries ?? [];
  const events = contributions?.events ?? [];
  const day = now.getUTCDay() || 7;
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day + 1);
  const end = start + 7 * 86_400_000;
  const ratio = (n: number, d: number) => d === 0 ? 0 : Number((n / d).toFixed(4));
  const pair = (event: ContributionLedgerArtifact["events"][number]) => [event.taskId, event.issueNumber, event.contributor, event.evidenceUrl].join("\n");
  const accepted = events.filter((event) => event.state === "accepted");
  const acceptedThisWeek = accepted.filter((event) => Date.parse(event.occurredAt) >= start && Date.parse(event.occurredAt) < end);
  const priorContributors = new Set(accepted.filter((event) => Date.parse(event.occurredAt) < start).map((event) => event.contributor));
  const acceptedPairs = new Set(accepted.map(pair));
  const promotedPairs = new Set(events.filter((event) => event.state === "promoted").map(pair));
  const wip = entries.filter((entry) => ["open", "contributed", "stale"].includes(entry.state));
  return {
    openTasks: tasks.length,
    categoryCoverage: [...new Set(tasks.map((task) => task.category))].sort(),
    acceptedThisWeek: acceptedThisWeek.length,
    newContributorsThisWeek: new Set(acceptedThisWeek.map((event) => event.contributor).filter((login) => !priorContributors.has(login))).size,
    staleRatio: ratio(wip.filter((entry) => entry.state === "stale").length, wip.length),
    invalidRatio: ratio(entries.filter((entry) => entry.state === "rejected").length, entries.length),
    promotionConversion: ratio([...promotedPairs].filter((key) => acceptedPairs.has(key)).length, acceptedPairs.size),
  };
}

export function refreshLocalCommunityMetrics(previous: Record<string, unknown>, input: FlywheelInput) {
  const contributors = previous.contributors as { codeContributors: string[] };
  if (!Array.isArray(contributors?.codeContributors) || !contributors.codeContributors.every((login) => typeof login === "string")
    || typeof previous.generatedAt !== "string" || !Number.isFinite(Date.parse(previous.generatedAt))) {
    throw new Error("Community metrics sampling baseline is invalid");
  }
  const acceptedEvidenceContributors = [...new Set((input.contributions?.events ?? []).filter((event) => event.state === "accepted").map((event) => event.contributor))].sort();
  // Keep the external sample clock and values; daily generation performs no
  // GitHub metrics request. The release gate uses this clock for weekly counts.
  return {
    ...previous,
    ...buildFlywheelMetrics({ ...input, now: new Date(previous.generatedAt) }),
    contributors: {
      codeContributors: contributors.codeContributors,
      acceptedEvidenceContributors,
      count: new Set([...contributors.codeContributors, ...acceptedEvidenceContributors]).size,
    },
  };
}
