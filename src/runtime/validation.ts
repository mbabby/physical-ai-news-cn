import { hasCompleteChineseCopy, hasCompleteChineseResearchCopy } from "../publication.js";
import type { DailyArchive, EventStore, ResearchRecord, RunHistory, RunManifest } from "../types.js";
import { blockingHistoryContinuityErrors } from "./health.js";
import { validateFacts } from "../facts-contract.js";
import { validateWatchlistRelease, type WatchlistReleaseValidationInput } from "../watchlist/release-validation.js";
import type { ResearchDecisionCard } from "../research-decision-card.js";
import type { CompanyClaimLedger } from "../company-claim-ledger.js";
import type { BenchmarkResultLedger } from "../benchmark-result-ledger.js";
import { validateDualLedgers } from "../dual-ledger.js";
import { validateDecisionProductArtifact, type DecisionProductArtifact } from "../decision-products/contracts.js";
import { buildDecisionFeedManifest, renderDecisionFeed } from "../decision-products/subscriptions.js";
import type { DashboardData } from "../site-data.js";
import type { WatchlistPublicView } from "../watchlist/public-view.js";
import {
  assertAcceptedEvidenceArtifact,
  assertCommunityTaskPublicArtifact,
  assertContributionLedgerArtifact,
  assertEvidenceIssueSnapshot,
  assertEvidenceTaskLedgerArtifact,
  assertEvidenceTaskSeedArtifact,
  buildContributionEventId,
  type AcceptedEvidenceArtifact,
  type CommunityTaskPublicArtifact,
  type ContributionLedgerArtifact,
  type EvidenceIssueSnapshot,
  type EvidenceTaskLedgerArtifact,
  type EvidenceTaskSeedArtifact,
} from "../community-evidence/contracts.js";
import {
  assertAcceptedEvidenceRevalidationArtifact,
  canonicalMatchMatchesArtifacts,
  type AcceptedEvidenceRevalidationArtifact,
} from "../community-evidence/revalidation.js";

export interface PublicationValidationInput {
  archive: DailyArchive;
  events: EventStore;
  research: ResearchRecord[];
  researchDecisionCards: ResearchDecisionCard[];
  readme: string;
  expectedDate: string;
  previousCompleteResearchCount?: number;
  watchlist?: WatchlistReleaseValidationInput;
}

export interface CommunityEvidenceReleaseValidationInput {
  seeds: EvidenceTaskSeedArtifact;
  snapshot: EvidenceIssueSnapshot;
  ledger: EvidenceTaskLedgerArtifact;
  accepted: AcceptedEvidenceArtifact;
  contributions: ContributionLedgerArtifact;
  publicTasks: CommunityTaskPublicArtifact;
  previousPublicTasks?: CommunityTaskPublicArtifact;
  previousContributions?: ContributionLedgerArtifact;
  previousRevalidation?: AcceptedEvidenceRevalidationArtifact;
  communityMetrics: unknown;
  revalidation: AcceptedEvidenceRevalidationArtifact;
  canonicalMatchContext?: {
    companies: import("../types.js").CompanyProfile[];
    companyClaimLedger: CompanyClaimLedger;
    events: EventStore["events"];
    researchDecisionCards: ResearchDecisionCard[];
    researchRecords: ResearchRecord[];
    benchmarkResultLedger: BenchmarkResultLedger;
    decisionProducts: DecisionProductArtifact;
    pagesBaseUrl: string;
  };
  canonicalPublicFacts?: readonly unknown[];
}

/** Exclude public attribution/progress data from the canonical-fact evidence scan. */
export function canonicalDashboardFacts(dashboard: DashboardData): Omit<DashboardData, "communityEvidence"> {
  const { communityEvidence: _communityEvidence, ...canonicalFacts } = dashboard;
  return canonicalFacts;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function contributionPair(value: { taskId: string; issueNumber: number; contributor: string; evidenceUrl: string }): string {
  return `${value.taskId}\n${value.issueNumber}\n${value.contributor}\n${value.evidenceUrl}`;
}

function collectPublicUrls(value: unknown, result = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    for (const match of value.matchAll(/https:\/\/[^\s<>"']+/g)) {
      const candidate = match[0].replace(/[),.;\]}]+$/g, "");
      try { result.add(new URL(candidate).href); } catch { /* validated elsewhere */ }
    }
  } else if (Array.isArray(value)) value.forEach((item) => collectPublicUrls(item, result));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => collectPublicUrls(item, result));
  return result;
}

function rejectOfficialAggregators(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(rejectOfficialAggregators);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  const candidateUrl = [record.link, record.url, record.aggregatorLink].find((item): item is string => typeof item === "string");
  const aggregator = candidateUrl && /(?:^|\.)(?:news\.google\.com|feedly\.com|flipboard\.com|news\.bing\.com)$/i.test((() => {
    try { return new URL(candidateUrl).hostname; } catch { return ""; }
  })());
  const classifiedOfficial = record.grade === "A" || record.evidenceState === "official"
    || (typeof record.sourceClass === "string" && record.sourceClass.includes("official"));
  if ((aggregator || Boolean(record.discoveredViaAggregator)) && classifiedOfficial) {
    throw new Error("Aggregator evidence cannot be classified as official");
  }
  Object.values(record).forEach(rejectOfficialAggregators);
}

function exactObject(value: unknown, keys: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !sameValue(Object.keys(value).sort(), [...keys].sort())) throw new Error(`Community metrics ${label} must have exact keys`);
}

function metricCount(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function metricRatio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(4));
}

function validateCommunityMetrics(input: CommunityEvidenceReleaseValidationInput): void {
  const value = input.communityMetrics;
  exactObject(value, ["generatedAt", "repository", "traffic", "contributors", "openTasks", "categoryCoverage", "acceptedThisWeek",
    "newContributorsThisWeek", "staleRatio", "invalidRatio", "promotionConversion"], "artifact");
  if (typeof value.generatedAt !== "string" || !Number.isFinite(Date.parse(value.generatedAt))) throw new Error("Community metrics generatedAt is invalid");
  exactObject(value.repository, ["stars", "forks", "subscribers", "openIssues"], "repository");
  if (!Object.values(value.repository).every(metricCount)) throw new Error("Community metrics repository counts are invalid");
  exactObject(value.traffic, ["status", "views14d", "uniqueVisitors14d", "clones14d", "uniqueCloners14d", "referrers"], "traffic");
  if (value.traffic.status !== "available" && value.traffic.status !== "unavailable") throw new Error("Community metrics traffic status is invalid");
  const trafficCounts = [value.traffic.views14d, value.traffic.uniqueVisitors14d, value.traffic.clones14d, value.traffic.uniqueCloners14d];
  if (value.traffic.status === "unavailable") {
    if (trafficCounts.some((item) => item !== null) || value.traffic.referrers !== null) throw new Error("Unavailable community traffic must use null values");
  } else if (!trafficCounts.every(metricCount) || !Array.isArray(value.traffic.referrers)) {
    throw new Error("Available community traffic is incomplete");
  }
  exactObject(value.contributors, ["codeContributors", "acceptedEvidenceContributors", "count"], "contributors");
  const code = value.contributors.codeContributors;
  const acceptedContributors = value.contributors.acceptedEvidenceContributors;
  if (!Array.isArray(code) || !Array.isArray(acceptedContributors)
    || !code.every((item) => typeof item === "string") || !acceptedContributors.every((item) => typeof item === "string")
    || !metricCount(value.contributors.count)
    || value.contributors.count !== new Set([...code, ...acceptedContributors]).size) {
    throw new Error("Community metrics contributor aggregate is invalid");
  }
  const expectedAcceptedContributors = [...new Set(input.contributions.events
    .filter((event) => event.state === "accepted")
    .map((event) => event.contributor))].sort();
  if (!sameValue(acceptedContributors, expectedAcceptedContributors)) {
    throw new Error("Community metrics accepted evidence contributors do not match the validated contribution ledger");
  }

  const generatedAt = new Date(value.generatedAt);
  const day = generatedAt.getUTCDay() || 7;
  const start = Date.UTC(generatedAt.getUTCFullYear(), generatedAt.getUTCMonth(), generatedAt.getUTCDate() - day + 1);
  const end = start + 7 * 86_400_000;
  const acceptedThisWeek = input.contributions.events.filter((event) => event.state === "accepted"
    && Date.parse(event.occurredAt) >= start && Date.parse(event.occurredAt) < end);
  const previousContributors = new Set(input.contributions.events.filter((event) => event.state === "accepted"
    && Date.parse(event.occurredAt) < start).map((event) => event.contributor));
  const acceptedPairs = new Set(input.contributions.events.filter((event) => event.state === "accepted").map(contributionPair));
  const promotedPairs = new Set(input.contributions.events.filter((event) => event.state === "promoted").map(contributionPair));
  const wip = input.ledger.entries.filter((entry) => ["open", "contributed", "stale"].includes(entry.state));
  const expected = {
    openTasks: input.publicTasks.tasks.length,
    categoryCoverage: [...new Set(input.publicTasks.tasks.map((task) => task.category))].sort(),
    acceptedThisWeek: acceptedThisWeek.length,
    newContributorsThisWeek: new Set(acceptedThisWeek.map((event) => event.contributor)
      .filter((contributor) => !previousContributors.has(contributor))).size,
    staleRatio: metricRatio(wip.filter((entry) => entry.state === "stale").length, wip.length),
    invalidRatio: metricRatio(input.ledger.entries.filter((entry) => entry.state === "rejected").length, input.ledger.entries.length),
    promotionConversion: metricRatio([...promotedPairs].filter((pair) => acceptedPairs.has(pair)).length, acceptedPairs.size),
  };
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (!sameValue(value[key], expectedValue)) throw new Error(`Community metrics ${key} does not match current evidence artifacts`);
  }
}

/** Validate every community-evidence projection as one release unit. */
export function validateCommunityEvidenceRelease(input: CommunityEvidenceReleaseValidationInput): void {
  assertEvidenceTaskSeedArtifact(input.seeds);
  assertEvidenceIssueSnapshot(input.snapshot);
  assertEvidenceTaskLedgerArtifact(input.ledger);
  assertAcceptedEvidenceArtifact(input.accepted);
  assertContributionLedgerArtifact(input.contributions);
  assertCommunityTaskPublicArtifact(input.publicTasks);
  assertAcceptedEvidenceRevalidationArtifact(input.revalidation);
  if (input.previousPublicTasks) assertCommunityTaskPublicArtifact(input.previousPublicTasks);
  if (input.previousContributions) assertContributionLedgerArtifact(input.previousContributions);
  if (input.previousRevalidation) assertAcceptedEvidenceRevalidationArtifact(input.previousRevalidation);

  const generatedAt = input.ledger.generatedAt;
  if (input.seeds.generatedAt !== generatedAt || input.accepted.generatedAt !== generatedAt
    || input.contributions.generatedAt !== generatedAt || input.publicTasks.generatedAt !== generatedAt
    || input.revalidation.generatedAt !== generatedAt) {
    throw new Error("Community evidence release artifacts do not share one generation clock");
  }
  if (input.previousContributions && !input.previousContributions.events.every((event, index) =>
    sameValue(event, input.contributions.events[index]))) {
    throw new Error("Contribution history must retain the previous event list as an exact append-only prefix");
  }
  if (input.previousRevalidation && !input.previousRevalidation.results.every((result, index) =>
    sameValue(result, input.revalidation.results[index]))) {
    throw new Error("Accepted evidence revalidation history must retain the previous result list as an exact append-only prefix");
  }

  const seeds = new Map(input.seeds.seeds.map((seed) => [seed.id, seed]));
  const ledger = new Map(input.ledger.entries.map((entry) => [entry.taskId, entry]));
  const issues = new Map(input.snapshot.issues.map((issue) => [issue.taskId, issue]));
  const wip = input.ledger.entries.filter((entry) => ["open", "contributed", "stale"].includes(entry.state));
  if (wip.length > 5) throw new Error(`Community evidence WIP exceeds the hard cap of five: ${wip.length}`);
  const activeMaterial = new Set<string>();
  for (const entry of wip) {
    const identity = `${entry.subject.kind}\n${entry.subject.id}\n${entry.targetField}`;
    if (activeMaterial.has(identity)) throw new Error(`Duplicate open community evidence task: ${entry.taskId}`);
    activeMaterial.add(identity);
  }

  for (const entry of input.ledger.entries) {
    const seed = seeds.get(entry.taskId);
    if (seed && (seed.version !== entry.taskVersion || seed.category !== entry.category
      || !sameValue(seed.subject, entry.subject) || seed.targetField !== entry.targetField
      || seed.materialVersion !== entry.materialVersion || seed.supersedesTaskId !== entry.supersedesTaskId)) {
      throw new Error(`Community evidence task ${entry.taskId} does not match its seed subject/reference identity`);
    }
    if (entry.issueNumber === null) continue;
    const expectedIssueUrl = `https://github.com/${input.snapshot.repo}/issues/${entry.issueNumber}`;
    if (entry.issueUrl !== expectedIssueUrl) throw new Error(`Community evidence task ${entry.taskId} has a mismatched Issue link`);
    const issue = issues.get(entry.taskId);
    if (issue && (issue.number !== entry.issueNumber || issue.taskVersion !== entry.taskVersion
      || !issue.labels.includes(`evidence-task-${entry.category}`))) {
      throw new Error(`Community evidence task ${entry.taskId} does not match its Issue identity/state`);
    }
  }
  for (const issue of input.snapshot.issues) {
    const entry = ledger.get(issue.taskId);
    if (!entry || entry.issueNumber !== issue.number || entry.taskVersion !== issue.taskVersion) {
      throw new Error(`Community evidence Issue ${issue.number} cannot resolve to exactly one ledger task`);
    }
  }

  const activePairs = new Set<string>();
  const activeAcceptance = new Map<string, ContributionLedgerArtifact["events"][number]>();
  const promotedPairs = new Set<string>();
  const promotionAcceptanceIds = new Map<string, string>();
  const submittedPairs = new Set<string>();
  const grandfatheredAcceptanceIds = new Set<string>();
  const previousSubmittedPairs = new Set<string>();
  for (const event of input.previousContributions?.events ?? []) {
    const key = contributionPair(event);
    if (event.state === "submitted") previousSubmittedPairs.add(key);
    else if (event.state === "accepted" && !previousSubmittedPairs.has(key)) grandfatheredAcceptanceIds.add(event.id);
  }
  for (const event of input.contributions.events) {
    if (event.id !== buildContributionEventId(event)) throw new Error(`Community contribution ${event.id} has an invalid stable identity`);
    const task = ledger.get(event.taskId);
    if (!task || task.issueNumber !== event.issueNumber || task.category !== event.category
      || !sameValue(task.subject, event.subject) || task.targetField !== event.targetField
      || event.sourceUrl !== `https://github.com/${input.snapshot.repo}/issues/${event.issueNumber}`) {
      throw new Error(`Community contribution ${event.id} does not match its task or Issue reference`);
    }
    const key = contributionPair(event);
    if (event.state === "submitted") {
      if (activePairs.has(key) || submittedPairs.has(key)) throw new Error(`Community contribution ${event.id} has a duplicate submitted lifecycle`);
      submittedPairs.add(key);
    } else if (event.state === "accepted") {
      if ((!submittedPairs.has(key) && !grandfatheredAcceptanceIds.has(event.id)) || activePairs.has(key)) throw new Error(`Community contribution ${event.id} has an accepted lifecycle without a submitted event or has a duplicate acceptance`);
      activePairs.add(key);
      activeAcceptance.set(key, event);
    }
    else if (event.state === "promoted") {
      if (!activePairs.has(key) || promotedPairs.has(key)) throw new Error(`Community contribution ${event.id} has an invalid promotion lifecycle`);
      promotionAcceptanceIds.set(event.id, activeAcceptance.get(key)!.id);
      promotedPairs.add(key);
    } else if (event.state === "corrected" || event.state === "withdrawn") {
      if (!activePairs.has(key)) throw new Error(`Community contribution ${event.id} ended before acceptance`);
      activePairs.delete(key);
      activeAcceptance.delete(key);
      promotedPairs.delete(key);
    }
  }

  const acceptedPairs = new Set(input.accepted.entries.map(contributionPair));
  for (const entry of input.accepted.entries) {
    const task = ledger.get(entry.taskId);
    const issue = issues.get(entry.taskId);
    const key = contributionPair(entry);
    const acceptance = activeAcceptance.get(key);
    if (entry.id !== buildContributionEventId({ ...entry, state: "accepted", occurredAt: entry.acceptedAt })
      || !task || !issue || task.state !== "accepted" || task.issueNumber !== entry.issueNumber
      || !issue.labels.includes("accepted-evidence") || task.category !== entry.category
      || !sameValue(task.subject, entry.subject) || task.targetField !== entry.targetField
      || !issue.acceptedEvidence.some((item) => item.contributor === entry.contributor && item.evidenceUrl === entry.evidenceUrl)
      || !acceptance || entry.id !== acceptance.id || entry.acceptedAt !== acceptance.occurredAt) {
      throw new Error(`Accepted contributor/evidence record ${entry.id} is not active in the Issue lifecycle`);
    }
  }
  if (activePairs.size !== acceptedPairs.size || [...activePairs].some((key) => !acceptedPairs.has(key))) {
    throw new Error("Active contribution history and accepted-evidence records disagree");
  }

  const acceptanceEvents = new Map(input.contributions.events.filter((event) => event.state === "accepted").map((event) => [event.id, event]));
  for (const result of input.revalidation.results) {
    const acceptance = acceptanceEvents.get(result.acceptedEvidenceId);
    if (!acceptance || acceptance.taskId !== result.taskId || acceptance.issueNumber !== result.issueNumber
      || acceptance.contributor !== result.contributor || acceptance.evidenceUrl !== result.evidenceUrl
      || acceptance.subject.id !== result.subjectId || acceptance.targetField !== result.targetField
      || Date.parse(acceptance.occurredAt) > Date.parse(result.attemptedAt)) {
      throw new Error(`Accepted evidence revalidation result ${result.acceptedEvidenceId} is not bound to its historical acceptance event`);
    }
  }
  const currentResults = input.revalidation.results.filter((result) => result.attemptedAt === generatedAt);
  if (currentResults.length !== input.accepted.entries.length) {
    throw new Error("Every active accepted evidence entry must have exactly one current revalidation result");
  }
  const currentByAcceptedId = new Map(currentResults.map((result) => [result.acceptedEvidenceId, result]));
  if (currentByAcceptedId.size !== currentResults.length) throw new Error("Current accepted evidence revalidation results are duplicated");
  for (const entry of input.accepted.entries) {
    const result = currentByAcceptedId.get(entry.id);
    if (!result || result.taskId !== entry.taskId || result.issueNumber !== entry.issueNumber
      || result.contributor !== entry.contributor || result.evidenceUrl !== entry.evidenceUrl
      || result.subjectId !== entry.subject.id || result.targetField !== entry.targetField) {
      throw new Error(`Active accepted evidence ${entry.id} lacks an exact current revalidation binding`);
    }
  }

  const previousPromotionIds = new Set((input.previousContributions?.events ?? []).filter((event) => event.state === "promoted").map((event) => event.id));
  const previousProofs = input.previousRevalidation?.results ?? [];
  for (const [eventIndex, event] of input.contributions.events.entries()) {
    if (event.state !== "promoted") continue;
    const proof = input.revalidation.results.find((result) => result.outcome === "matched" && result.canonicalMatch
      && result.acceptedEvidenceId === promotionAcceptanceIds.get(event.id)
      && result.taskId === event.taskId && result.issueNumber === event.issueNumber && result.contributor === event.contributor
      && result.evidenceUrl === event.evidenceUrl && result.subjectId === event.subject.id && result.targetField === event.targetField
      && result.canonicalMatch.matchedAt === event.occurredAt && result.canonicalMatch.publicTargetUrl === event.publicTargetUrl);
    const laterTerminal = input.contributions.events.slice(eventIndex + 1).some((candidate) => contributionPair(candidate) === contributionPair(event)
      && (candidate.state === "corrected" || candidate.state === "withdrawn"));
    const inheritedPromotion = previousPromotionIds.has(event.id);
    const inheritedProof = inheritedPromotion && proof
      && previousProofs.some((candidate) => sameValue(candidate, proof));
    const currentCanonicalProof = proof?.canonicalMatch && input.canonicalMatchContext
      ? canonicalMatchMatchesArtifacts(event, proof.canonicalMatch, { ...input.canonicalMatchContext, now: new Date(proof.canonicalMatch.matchedAt) })
      : false;
    const validProof = inheritedPromotion
      ? laterTerminal ? Boolean(inheritedProof) : currentCanonicalProof
      : proof?.attemptedAt === input.revalidation.generatedAt && currentCanonicalProof;
    if (!proof?.canonicalMatch || !validProof) {
      throw new Error(`Promoted community contribution ${event.id} lacks a successful canonical revalidation proof`);
    }
  }

  const priorPublicById = new Map((input.previousPublicTasks?.tasks ?? []).map((task) => [task.id, task]));
  const expectedPublic = input.ledger.entries
    .filter((entry) => entry.state === "open" || entry.state === "contributed")
    .map((entry) => {
      const seed = seeds.get(entry.taskId);
      const issue = issues.get(entry.taskId);
      const prior = priorPublicById.get(entry.taskId);
      if ((!seed && !prior) || !issue || entry.issueNumber === null) throw new Error(`Public community task ${entry.taskId} lacks a seed, LKG projection, or Issue`);
      if (issue.state !== "open" || issue.closedAt !== null
        || issue.labels.some((label) => ["accepted-evidence", "evidence-rejected", "rejected-evidence"].includes(label))) {
        throw new Error(`Public community task ${entry.taskId} points to a closed or terminal Issue`);
      }
      return {
        id: entry.taskId, version: entry.taskVersion, category: entry.category, subject: entry.subject,
        targetField: entry.targetField, contextZh: seed?.contextZh ?? prior!.contextZh, issueNumber: entry.issueNumber,
        issueUrl: entry.issueUrl!, estimatedMinutes: 2 as const, generatedWeek: seed?.generatedWeek ?? prior!.generatedWeek, state: entry.state,
      };
    })
    .sort((left, right) => left.category.localeCompare(right.category) || left.subject.name.localeCompare(right.subject.name)
      || left.targetField.localeCompare(right.targetField) || left.id.localeCompare(right.id));
  if (!sameValue(input.publicTasks.tasks, expectedPublic)) {
    throw new Error("Public community tasks are not the exact ordered open-task ledger subset");
  }

  const canonicalFacts = input.canonicalPublicFacts ?? [];
  canonicalFacts.forEach(rejectOfficialAggregators);
  const publicUrls = collectPublicUrls(canonicalFacts);
  for (const entry of input.accepted.entries) {
    if (publicUrls.has(new URL(entry.evidenceUrl).href) && !promotedPairs.has(contributionPair(entry))) {
      throw new Error(`Accepted evidence entered a canonical public fact without a normal promotion record: ${entry.id}`);
    }
  }
  validateCommunityMetrics(input);
}

export function validateDualLedgerPublication(input: {
  company: CompanyClaimLedger;
  benchmark: BenchmarkResultLedger;
  companyIds: ReadonlySet<string>;
  companyEventOwners?: ReadonlyMap<string, string>;
  paperIds: ReadonlySet<string>;
  decisionCards: readonly ResearchDecisionCard[];
  expectedGeneratedAt: string;
}): void {
  validateDualLedgers(input);
}

export interface DecisionProductPublicationValidationInput {
  artifact: unknown;
  expectedArtifact: DecisionProductArtifact;
  dashboard: Pick<DashboardData, "generatedAt" | "decisionProducts" | "topSignals" | "companyRadar" | "research">;
  readme: string;
  feedManifest: unknown;
  feeds: Readonly<Record<string, string>>;
  expectedGeneratedAt: string;
  companyEventOwners: ReadonlyMap<string, string>;
  benchmarkResultLedger: BenchmarkResultLedger;
  repositoryUrl: string;
  pagesUrl: string;
  watchlist: WatchlistPublicView;
}

const stableBytes = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

function orderedIds(value: unknown, key: string): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => item && typeof item === "object" && key in item ? String((item as Record<string, unknown>)[key]) : "");
}

function assertSameIds(actual: string[], expected: string[], label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label}身份或顺序与 Decision Product 不一致`);
}

function validatePassportBenchmarkEvidence(artifact: DecisionProductArtifact, ledger: BenchmarkResultLedger): void {
  const entriesByPaper = new Map<string, BenchmarkResultLedger["entries"]>();
  for (const entry of ledger.entries) entriesByPaper.set(entry.paperId, [...(entriesByPaper.get(entry.paperId) ?? []), entry]);
  const fieldNames = { name: "benchmark", metric: "metric", result: "result", baseline: "baseline", delta: "delta" } as const;
  for (const passport of artifact.researchPassports) {
    for (const [publicField, ledgerField] of Object.entries(fieldNames) as Array<[keyof typeof fieldNames, typeof fieldNames[keyof typeof fieldNames]]>) {
      const value = passport.benchmark[publicField];
      if (value === "unknown") continue;
      const bound = (entriesByPaper.get(passport.paperId) ?? []).some((entry) => {
        const field = entry.fields[ledgerField];
        return field.status === "verified" && field.value === value && field.evidenceUrls.length > 0
          && field.evidenceUrls.every((url) => passport.benchmark.evidenceUrls.includes(url));
      });
      if (!bound) throw new Error(`Research Passport 已知 Benchmark 字段缺少账本证据：${passport.paperId}.${publicField}`);
    }
  }
}

/** Validate the shared materialized product and every public projection without re-ranking. */
export function validateDecisionProductPublication(input: DecisionProductPublicationValidationInput): void {
  validateDecisionProductArtifact(input.expectedArtifact);
  validateDecisionProductArtifact(input.artifact);
  const artifact = input.artifact;
  if (stableBytes(artifact) !== stableBytes(input.expectedArtifact)) throw new Error("Decision Product 与规范输入重建结果不一致");
  if (artifact.generatedAt !== input.expectedGeneratedAt || artifact.subscriptions.generatedAt !== artifact.generatedAt
    || input.dashboard.generatedAt !== artifact.generatedAt) throw new Error("Decision Product、运行清单与 dashboard 生成时间不一致");
  if (!input.dashboard.decisionProducts || stableBytes(input.dashboard.decisionProducts) !== stableBytes(artifact)) {
    throw new Error("dashboard 内嵌 Decision Product 与公开工件不一致");
  }
  assertSameIds(orderedIds(input.dashboard.topSignals, "signalId"), artifact.topSignals.map((item) => item.signalId), "dashboard Top Signals");
  assertSameIds(orderedIds(input.dashboard.companyRadar, "cardId"), artifact.companyCards.map((item) => item.cardId), "dashboard 公司卡");
  assertSameIds(orderedIds(input.dashboard.research, "passportId"), artifact.researchPassports.map((item) => item.passportId), "dashboard Research Passports");
  const readmeIds = [...input.readme.matchAll(/<!-- decision-signal:([^ ]+) -->/g)].map((match) => match[1]!);
  assertSameIds(readmeIds, artifact.topSignals.map((item) => item.signalId), "README Top Signals");
  for (const card of artifact.companyCards) for (const change of card.recentChanges) {
    if (input.companyEventOwners.get(change.eventId) !== card.companyId) throw new Error(`公司卡事件归属不一致：${card.companyId}:${change.eventId}`);
  }
  validatePassportBenchmarkEvidence(artifact, input.benchmarkResultLedger);
  const expectedManifest = buildDecisionFeedManifest(artifact);
  if (stableBytes(input.feedManifest) !== stableBytes(expectedManifest)) throw new Error("Decision Feed manifest 与公开工件不一致");
  for (const feed of expectedManifest.feeds) {
    const expected = renderDecisionFeed(artifact, feed.route, input);
    if (input.feeds[feed.path] !== expected) throw new Error(`Decision Feed 字节或 GUID 顺序不一致：${feed.path}`);
  }
}

export function validatePublication(input: PublicationValidationInput): void {
  const errors: string[] = [];
  if (input.archive.date !== input.expectedDate) errors.push(`日报日期 ${input.archive.date} 与运行日期 ${input.expectedDate} 不一致`);
  const articleIds = input.archive.articles.map((article) => article.id);
  if (new Set(articleIds).size !== articleIds.length) errors.push("日报含重复文章 ID");
  for (const article of input.archive.articles) {
    if (!hasCompleteChineseCopy(article)) errors.push(`公开文章缺少完整中文事实简介：${article.id}`);
    if (!/^https?:\/\//.test(article.link)) errors.push(`公开文章链接无效：${article.id}`);
  }
  const eventIds = input.events.events.map((event) => event.id);
  if (new Set(eventIds).size !== eventIds.length) errors.push("事件中心含重复事件 ID");
  for (const event of input.events.events) {
    if (!event.evidence.length || event.evidence.some((evidence) => !/^https?:\/\//.test(evidence.link))) errors.push(`事件缺少可追溯证据：${event.id}`);
    if (event.status === "已确证") {
      const contract = validateFacts({
        type: event.type,
        eventDate: event.eventDate ?? event.occurredAt,
        firstSeenAt: event.firstSeenAt,
        verifiedAt: event.lastVerifiedAt,
        materiallyChangedAt: event.lastUpdatedAt,
        public: true,
        evidence: event.evidence.map((item) => ({ id: item.link, link: item.link, source: item.source, grade: item.grade, publishedAt: item.publishedAt })),
      });
      if (!contract.valid) errors.push(`已确证事件违反公开事实契约：${event.id}（${contract.issues.map((issue) => issue.code).join(", ")}）`);
    }
  }
  const researchMinimum = Math.min(6, input.previousCompleteResearchCount ?? 0);
  if (input.research.length < researchMinimum) errors.push(`研究卡从 ${researchMinimum} 篇倒退到 ${input.research.length} 篇`);
  const decisionCardsById = new Map<string, ResearchDecisionCard[]>();
  for (const card of input.researchDecisionCards) {
    const paperId = String(card.identity.paperId.value);
    const cards = decisionCardsById.get(paperId) ?? [];
    cards.push(card);
    decisionCardsById.set(paperId, cards);
  }
  for (const record of input.research) {
    if (!hasCompleteChineseResearchCopy(record.article)) errors.push(`公开研究卡缺少完整中文标题或两句事实简介：${record.id}`);
    if (record.article.scholar?.isRetracted) errors.push(`公开研究卡包含已撤稿论文：${record.id}`);
    const cards = decisionCardsById.get(record.id) ?? [];
    if (cards.length === 0) errors.push(`公开研究记录缺少研究决策卡：${record.id}`);
    else if (cards.length > 1) errors.push(`公开研究记录存在重复研究决策卡：${record.id}`);
    else if (!cards[0]!.eligibleForTopResearch || cards[0]!.gates.length > 0) errors.push(`公开研究记录未通过研究发布门槛：${record.id}（${cards[0]!.gates.map((gate) => gate.code).join(", ") || "eligible=false"}）`);
  }
  if (/暂无中文简介|暂未生成中文摘要|中文简介暂未生成/.test(input.readme)) errors.push("README 出现公开占位简介");
  if (errors.length) throw new Error(`发布质量门槛未通过：\n- ${errors.join("\n- ")}`);
  if (input.watchlist) validateWatchlistRelease(input.watchlist);
}

const validIsoDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
const validTimestamp = (value: string): boolean => Number.isFinite(Date.parse(value));

/** Cross-file contract validation. Publication copy may evolve, but these
 * invariants must remain stable for the workflow, dashboard and reviewers. */
export function validatePublicationArtifacts(archive: DailyArchive, manifest: RunManifest, history?: RunHistory): void {
  const errors: string[] = [];
  if (manifest.schemaVersion !== 1) errors.push(`不支持的运行清单版本：${manifest.schemaVersion}`);
  if (!validIsoDate(manifest.date) || manifest.date !== archive.date) errors.push("运行清单与日报日期不一致");
  if (!manifest.runId.startsWith(`${manifest.date}-`)) errors.push("runId 未包含运行日期前缀");
  if (!validTimestamp(manifest.startedAt) || !validTimestamp(manifest.finishedAt)) errors.push("运行清单时间戳无效");
  else if (Date.parse(manifest.finishedAt) < Date.parse(manifest.startedAt)) errors.push("运行结束时间早于开始时间");
  if (!Number.isInteger(manifest.outputs) || manifest.outputs < 1) errors.push("输出文件计数无效");
  for (const [name, count] of Object.entries(manifest.quality)) {
    if (!Number.isInteger(count) || count < 0) errors.push(`质量计数无效：${name}`);
  }
  const publicTotal = manifest.quality.publicIndustryItems + manifest.quality.publicResearchItems;
  if (publicTotal !== archive.articles.length) errors.push(`公开条目计数不一致：manifest=${publicTotal}，archive=${archive.articles.length}`);
  if (manifest.quality.candidates !== (archive.candidates?.length ?? 0)) errors.push("候选条目计数与日报不一致");
  const sourceFailures = archive.sourceOutcomes?.filter((outcome) => outcome.status === "failure").length ?? 0;
  if (manifest.quality.sourceFailures !== sourceFailures) errors.push("失败信源计数与日报不一致");
  const sourceNames = archive.sourceOutcomes?.map((outcome) => outcome.source) ?? [];
  if (new Set(sourceNames).size !== sourceNames.length) errors.push("日报含重复信源状态");
  const serviceNames = manifest.services.map((service) => service.component);
  if (new Set(serviceNames).size !== serviceNames.length) errors.push("运行清单含重复服务状态");
  for (const service of manifest.services) {
    if (service.attempted < service.succeeded + service.failed) errors.push(`${service.component} 请求计数小于成功与失败之和`);
  }
  const archiveServices = new Map((archive.runtimeStatus ?? []).map((service) => [service.component, service]));
  for (const service of manifest.services) {
    const archived = archiveServices.get(service.component);
    if (!archived || archived.status !== service.status || archived.attempted !== service.attempted || archived.succeeded !== service.succeeded || archived.failed !== service.failed) {
      errors.push(`${service.component} 状态在运行清单与日报间不一致`);
    }
  }
  for (const article of [...archive.articles, ...(archive.candidates ?? [])]) {
    if (!article.id || !article.source || !/^https:\/\//.test(article.link)) errors.push(`文章基础契约不完整：${article.id || "unknown"}`);
    if (!validTimestamp(String(article.publishedAt)) || !validTimestamp(String(article.fetchedAt))) errors.push(`文章时间戳无效：${article.id || "unknown"}`);
  }
  if (history) {
    if (history.schemaVersion !== 1 || history.runs[0]?.runId !== manifest.runId) errors.push("运行历史没有以当前清单为最新记录");
    errors.push(...blockingHistoryContinuityErrors(history));
  }
  if (errors.length) throw new Error(`发布产物契约未通过：\n- ${errors.join("\n- ")}`);
}
