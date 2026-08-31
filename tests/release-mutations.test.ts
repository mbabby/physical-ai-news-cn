import assert from "node:assert/strict";
import test from "node:test";
import {
  buildContributionEventId,
  buildEvidenceTaskId,
  type AcceptedEvidenceArtifact,
  type CommunityTaskPublicArtifact,
  type ContributionLedgerArtifact,
  type EvidenceIssueSnapshot,
  type EvidenceTaskCategory,
  type EvidenceTaskLedgerArtifact,
  type EvidenceTaskSeed,
  type EvidenceTaskSeedArtifact,
  type EvidenceTargetField,
} from "../src/community-evidence/contracts.js";
import { canonicalDashboardFacts, validateCommunityEvidenceRelease } from "../src/runtime/validation.js";
import { selectContributionHistoryBaseline, selectRevalidationHistoryBaseline } from "../src/validate-release.js";
import { buildCompanyClaimLedger } from "../src/company-claim-ledger.js";
import { stableDecisionId } from "../src/decision-products/contracts.js";
import type { TopSignalsDraft } from "../src/top-signals-growth/contracts.js";
import { validatePublishedTopSignalsArtifact } from "../src/top-signals-growth/publish.js";
import { renderTopSignalsArchive } from "../src/top-signals-growth/render.js";
import type { CompanyProfile, EventRecord } from "../src/types.js";

const NOW = "2026-08-25T10:00:00.000Z";
const CREATED_AT = "2026-08-24T08:00:00.000Z";
const ACCEPTED_AT = "2026-08-25T09:00:00.000Z";
const REPOSITORY = "acme/physical-ai-news-cn";
const EVIDENCE_URL = "https://alpha.example/funding";
const PAGES = "https://mbabby.github.io/physical-ai-news-cn";

const definitions: Array<[EvidenceTaskCategory, EvidenceTargetField, "company" | "event" | "research"]> = [
  ["company-funding", "funding.amount", "company"],
  ["product-deployment", "deployment.customer", "event"],
  ["research-metadata", "research.codeUrl", "research"],
];

function releaseFixture() {
  const seeds = definitions.map(([category, targetField, kind], index): EvidenceTaskSeed => {
    const subject = { kind, id: `subject-${index}`, name: `Subject ${index}`, url: `https://subject-${index}.example/` };
    const materialVersion = `material-${index}`;
    return {
      id: buildEvidenceTaskId(subject, targetField, materialVersion), version: 1, category, subject, targetField,
      contextZh: `${subject.name} 的一个字段需要原始来源确认。`, referenceUrls: [subject.url], suggestedLocations: ["官方页面"],
      qualifiedEvidenceZh: ["可公开核验的原始来源"], disqualifiedEvidenceZh: ["没有原始链接的转述"],
      replyTemplateZh: "证据链接：\n证据摘录：\n来源类型：", estimatedMinutes: 2, generatedWeek: "2026-W35",
      materialVersion, supersedesTaskId: null,
    };
  }).sort((left, right) => left.category.localeCompare(right.category));
  const seedArtifact: EvidenceTaskSeedArtifact = { schemaVersion: 1, generatedAt: NOW, generatedWeek: "2026-W35", seeds };
  const acceptedSeed = seeds[0]!;
  const acceptedEventId = buildContributionEventId({
    taskId: acceptedSeed.id,
    issueNumber: 41,
    contributor: "alice",
    evidenceUrl: EVIDENCE_URL,
    state: "accepted",
    occurredAt: ACCEPTED_AT,
  });
  const issues: EvidenceIssueSnapshot["issues"] = seeds.map((seed, index) => ({
    number: 41 + index, taskId: seed.id, taskVersion: 1, state: index === 0 ? "closed" : "open",
    labels: [...(index === 0 ? ["accepted-evidence"] : []), "evidence-task", `evidence-task-${seed.category}`, "two-minute-task"].sort(),
    authorLogin: index === 0 ? "alice" : "maintainer", authorAssociation: index === 0 ? "FIRST_TIME_CONTRIBUTOR" : "MEMBER",
    createdAt: CREATED_AT, updatedAt: index === 0 ? ACCEPTED_AT : NOW, closedAt: index === 0 ? ACCEPTED_AT : null,
    evidenceUrls: index === 0 ? [EVIDENCE_URL] : [],
    submittedEvidence: index === 0 ? [{ contributor: "alice", evidenceUrl: EVIDENCE_URL, submittedAt: CREATED_AT }] : [],
    acceptedContributors: index === 0 ? ["alice"] : [],
    acceptedEvidence: index === 0 ? [{ contributor: "alice", evidenceUrl: EVIDENCE_URL }] : [],
  }));
  const snapshot: EvidenceIssueSnapshot = { schemaVersion: 1, fetchedAt: NOW, repo: REPOSITORY, issues };
  const ledger: EvidenceTaskLedgerArtifact = {
    schemaVersion: 1, generatedAt: NOW,
    entries: seeds.map((seed, index) => ({
      taskId: seed.id, taskVersion: 1, category: seed.category, subject: seed.subject, targetField: seed.targetField,
      materialVersion: seed.materialVersion, supersedesTaskId: null, issueNumber: 41 + index,
      issueUrl: `https://github.com/${REPOSITORY}/issues/${41 + index}`, state: index === 0 ? "accepted" : "open",
      createdAt: CREATED_AT, updatedAt: index === 0 ? ACCEPTED_AT : NOW, lastActivityAt: index === 0 ? ACCEPTED_AT : NOW,
      closedAt: index === 0 ? ACCEPTED_AT : null,
    })).sort((left, right) => left.taskId.localeCompare(right.taskId)),
  };
  const accepted: AcceptedEvidenceArtifact = {
    schemaVersion: 1, generatedAt: NOW,
    entries: [{
      id: acceptedEventId, taskId: acceptedSeed.id, issueNumber: 41, category: acceptedSeed.category,
      subject: acceptedSeed.subject, targetField: acceptedSeed.targetField, contributor: "alice", evidenceUrl: EVIDENCE_URL,
      acceptedAt: ACCEPTED_AT,
    }],
  };
  const acceptedEvent: ContributionLedgerArtifact["events"][number] = {
    id: acceptedEventId, taskId: acceptedSeed.id, issueNumber: 41, contributor: "alice",
    evidenceUrl: EVIDENCE_URL, category: acceptedSeed.category, subject: acceptedSeed.subject,
    targetField: acceptedSeed.targetField, state: "accepted", occurredAt: ACCEPTED_AT,
    sourceUrl: `https://github.com/${REPOSITORY}/issues/41`, publicTargetUrl: null,
  };
  const submittedEvent = {
    ...acceptedEvent,
    id: buildContributionEventId({ ...acceptedEvent, state: "submitted", occurredAt: CREATED_AT }),
    state: "submitted" as const,
    occurredAt: CREATED_AT,
  };
  const contributions: ContributionLedgerArtifact = { schemaVersion: 1, generatedAt: NOW, events: [submittedEvent, acceptedEvent] };
  const publicTasks: CommunityTaskPublicArtifact = {
    schemaVersion: 1, generatedAt: NOW,
    tasks: seeds.slice(1).map((seed, index) => ({
      id: seed.id, version: 1, category: seed.category, subject: seed.subject, targetField: seed.targetField,
      contextZh: seed.contextZh, issueNumber: 42 + index, issueUrl: `https://github.com/${REPOSITORY}/issues/${42 + index}`,
      estimatedMinutes: 2, generatedWeek: seed.generatedWeek, state: "open",
    })),
  };
  const communityMetrics = {
    generatedAt: NOW,
    repository: { stars: 1, forks: 0, subscribers: 0, openIssues: 3 },
    traffic: { status: "unavailable", views14d: null, uniqueVisitors14d: null, clones14d: null, uniqueCloners14d: null, referrers: null },
    contributors: { codeContributors: ["maintainer"], acceptedEvidenceContributors: ["alice"], count: 2 },
    openTasks: 2, categoryCoverage: ["product-deployment", "research-metadata"], acceptedThisWeek: 1,
    newContributorsThisWeek: 1, staleRatio: 0, invalidRatio: 0, promotionConversion: 0,
  };
  const revalidation = {
    schemaVersion: 1 as const, generatedAt: NOW, status: "success" as const,
    results: [{
      acceptedEvidenceId: acceptedEventId, taskId: acceptedSeed.id, issueNumber: 41, contributor: "alice",
      evidenceUrl: EVIDENCE_URL, subjectId: acceptedSeed.subject.id, targetField: acceptedSeed.targetField, attemptedAt: NOW,
      fetch: { status: "success" as const, failureCode: null, contentType: "text/html", byteLength: 50 },
      source: { domain: "alpha.example", tier: "A" as const, classification: "company-official" as const },
      candidateValue: null,
      checks: { entity: "pass" as const, sourceTier: "pass" as const, fieldConsistency: "fail" as const, conflict: "pass" as const, date: "pass" as const },
      outcome: "insufficient" as const, canonicalMatch: null,
    }],
  };
  return { seeds: seedArtifact, snapshot, ledger, accepted, contributions, publicTasks, communityMetrics, revalidation, canonicalPublicFacts: [] as unknown[] };
}

function withValidPromotion(input = releaseFixture()) {
  const entry = input.accepted.entries[0]!;
  const company = {
    entityId: entry.subject.id, name: entry.subject.name, region: "全球", routes: [], thesis: "fixture",
    officialUrl: entry.subject.url, officialDomains: [new URL(entry.subject.url).hostname],
  } as CompanyProfile;
  const event: EventRecord = {
    id: "event-community-proof", title: `${entry.subject.name} raises $10M`, type: "投融资", entities: [entry.subject.name],
    primaryEntity: entry.subject.name, routes: [], status: "已确证", occurredAt: CREATED_AT, firstSeenAt: CREATED_AT,
    lastEvidenceAt: CREATED_AT, lastUpdatedAt: CREATED_AT, lastVerifiedAt: ACCEPTED_AT,
    facts: [`${entry.subject.name} raises $10M`], openQuestions: [], timeline: [],
    evidence: [{ link: entry.evidenceUrl, source: `${entry.subject.name} 官网`, grade: "A", publishedAt: CREATED_AT, supports: "融资金额 $10M" }],
    funding: { entityStatus: "已确认", amount: "$10M", investors: [] },
  };
  const companyClaimLedger = buildCompanyClaimLedger([company], [event], { now: new Date(NOW) });
  const claim = companyClaimLedger.companies[0]!.claims.find((item) => item.claimType === "funding")!;
  const acceptedEvent = input.contributions.events.find((event) => event.state === "accepted")!;
  const publicTargetUrl = `${PAGES}/companies.html#${stableDecisionId("company", entry.subject.id)}`;
  const promotedEvent = {
    ...acceptedEvent,
    id: buildContributionEventId({ ...entry, state: "promoted", occurredAt: NOW }),
    state: "promoted" as const,
    occurredAt: NOW,
    publicTargetUrl,
  };
  input.contributions.events.push(promotedEvent);
  input.communityMetrics.promotionConversion = 1;
  input.revalidation = {
    schemaVersion: 1,
    generatedAt: NOW,
    status: "success",
    results: [{
      acceptedEvidenceId: entry.id, taskId: entry.taskId, issueNumber: entry.issueNumber, contributor: entry.contributor,
      evidenceUrl: entry.evidenceUrl, subjectId: entry.subject.id, targetField: entry.targetField, attemptedAt: NOW,
      fetch: { status: "success", failureCode: null, contentType: "text/html", byteLength: 100 },
      source: { domain: new URL(entry.evidenceUrl).hostname, tier: "A", classification: "company-official" },
      candidateValue: "$10M",
      checks: { entity: "pass", sourceTier: "pass", fieldConsistency: "pass", conflict: "pass", date: "pass" },
      outcome: "matched",
      canonicalMatch: {
        subjectId: entry.subject.id, targetField: entry.targetField, evidenceUrl: entry.evidenceUrl,
        publicTargetUrl, canonicalArtifact: "company-claim-ledger", canonicalRecordId: claim.claimId,
        sourceTier: "A", matchedAt: NOW,
      },
    }],
  };
  input.canonicalMatchContext = {
    companies: [company],
    companyClaimLedger,
    events: [event],
    researchDecisionCards: [],
    researchRecords: [],
    benchmarkResultLedger: { generatedAt: NOW, entries: [] },
    decisionProducts: {
      schemaVersion: 1, generatedAt: NOW, periodStart: "2026-08-25", topSignals: [], researchPassports: [],
      companyCards: [{
        cardId: stableDecisionId("company", entry.subject.id), companyId: entry.subject.id, companyName: entry.subject.name,
        officialUrl: entry.subject.url, region: "全球", stage: "创业公司", routes: ["部署与商业化"],
        capital: { status: "verified", summary: "融资金额 $10M", evidence: [{ evidenceId: "capital-proof", url: entry.evidenceUrl, source: "官网", grade: "A" }] },
        validationStage: "客户试点", productDeployment: { status: "unknown", summary: "证据不足（不代表没有产品或部署进展）", evidence: [] },
        recentChanges: [], watchlist: { track: "unknown", lifecycle: "持续复核", whyNow: "规范证据已更新", nextValidationPoints: [] },
        unknownFields: [], updatedAt: NOW,
      }],
      subscriptions: { generatedAt: NOW, entries: [] },
    },
    pagesBaseUrl: PAGES,
  };
  return input;
}

test("accepts promotion only with exact current revalidation and a canonical field proof", () => {
  const input = withValidPromotion();
  input.canonicalPublicFacts = [{ evidence: [{ link: EVIDENCE_URL }] }];
  assert.doesNotThrow(() => validateCommunityEvidenceRelease(input));

  for (const mutate of [
    (candidate: ReturnType<typeof withValidPromotion>) => { candidate.revalidation.results = []; },
    (candidate: ReturnType<typeof withValidPromotion>) => { candidate.revalidation.results[0]!.subjectId = "wrong-subject"; },
    (candidate: ReturnType<typeof withValidPromotion>) => { candidate.revalidation.results[0]!.canonicalMatch!.canonicalRecordId = "wrong-claim"; },
    (candidate: ReturnType<typeof withValidPromotion>) => { candidate.revalidation.results[0]!.canonicalMatch!.sourceTier = "B"; },
    (candidate: ReturnType<typeof withValidPromotion>) => { candidate.revalidation.results[0]!.canonicalMatch!.matchedAt = ACCEPTED_AT; },
    (candidate: ReturnType<typeof withValidPromotion>) => { candidate.revalidation.results[0]!.canonicalMatch!.publicTargetUrl = candidate.accepted.entries[0]!.subject.url; },
    (candidate: ReturnType<typeof withValidPromotion>) => { candidate.canonicalMatchContext!.decisionProducts.companyCards = []; },
    (candidate: ReturnType<typeof withValidPromotion>) => { candidate.canonicalMatchContext!.companyClaimLedger.companies[0]!.claims[0]!.fields.amount.evidenceUrls = []; },
  ]) {
    const candidate = withValidPromotion();
    mutate(candidate);
    assert.throws(() => validateCommunityEvidenceRelease(candidate), /revalidation|proof|promotion|promoted|canonical|复核|晋升/i);
  }
});

test("a new promotion cannot reuse a historical match beside a current insufficient result", () => {
  const input = withValidPromotion();
  const historicalMatchedAt = "2026-08-25T09:30:00.000Z";
  const promoted = input.contributions.events.find((event) => event.state === "promoted")!;
  promoted.occurredAt = historicalMatchedAt;
  promoted.id = buildContributionEventId(promoted);
  input.previousContributions = {
    ...structuredClone(input.contributions),
    events: structuredClone(input.contributions.events.filter((event) => event.state !== "promoted")),
  };

  const historicalProof = structuredClone(input.revalidation.results[0]!);
  historicalProof.attemptedAt = historicalMatchedAt;
  historicalProof.canonicalMatch!.matchedAt = historicalMatchedAt;
  const currentInsufficient = structuredClone(historicalProof);
  currentInsufficient.attemptedAt = NOW;
  currentInsufficient.candidateValue = null;
  currentInsufficient.checks.fieldConsistency = "fail";
  currentInsufficient.outcome = "insufficient";
  currentInsufficient.canonicalMatch = null;
  input.revalidation.results = [historicalProof, currentInsufficient];

  assert.throws(() => validateCommunityEvidenceRelease(input), /current|revalidation|promotion|promoted|复核|晋升/i);
});

test("accepts one exact, lifecycle-consistent community evidence release", () => {
  assert.doesNotThrow(() => validateCommunityEvidenceRelease(releaseFixture()));
});

test("rejects acceptance without an earlier submitted event", () => {
  const input = releaseFixture();
  input.contributions.events = input.contributions.events.filter((event) => event.state !== "submitted");
  assert.throws(() => validateCommunityEvidenceRelease(input), /submitted|accept.*lifecycle/i);
});

test("grandfathers only a previously committed accepted lifecycle that predates submitted attribution", () => {
  const legacy = releaseFixture();
  legacy.contributions.events = legacy.contributions.events.filter((event) => event.state !== "submitted");
  legacy.previousContributions = structuredClone(legacy.contributions);
  assert.doesNotThrow(() => validateCommunityEvidenceRelease(legacy));

  const uncommitted = releaseFixture();
  uncommitted.contributions.events = uncommitted.contributions.events.filter((event) => event.state !== "submitted");
  assert.throws(() => validateCommunityEvidenceRelease(uncommitted), /submitted|accept.*lifecycle/i);
});

test("a grandfathered acceptance pair cannot authorize a later submitted-less acceptance", () => {
  const input = releaseFixture();
  const originalAcceptance = structuredClone(input.contributions.events.find((event) => event.state === "accepted")!);
  const withdrawnAt = "2026-08-25T09:15:00.000Z";
  const reacceptedAt = "2026-08-25T09:30:00.000Z";
  const withdrawn = { ...originalAcceptance, state: "withdrawn" as const, occurredAt: withdrawnAt };
  withdrawn.id = buildContributionEventId(withdrawn);
  const reaccepted = { ...originalAcceptance, state: "accepted" as const, occurredAt: reacceptedAt };
  reaccepted.id = buildContributionEventId(reaccepted);

  input.previousContributions = { ...structuredClone(input.contributions), events: [originalAcceptance] };
  input.contributions.events = [originalAcceptance, withdrawn, reaccepted];
  input.accepted.entries[0] = { ...input.accepted.entries[0]!, id: reaccepted.id, acceptedAt: reacceptedAt };
  input.snapshot.issues[0]!.updatedAt = reacceptedAt;
  input.revalidation.results[0]!.acceptedEvidenceId = reaccepted.id;
  input.communityMetrics.acceptedThisWeek = 2;

  assert.throws(() => validateCommunityEvidenceRelease(input), /submitted|accept.*lifecycle/i);
});

test("requires a same-release exact revalidation result for every active accepted entry", () => {
  const stale = releaseFixture();
  stale.revalidation.generatedAt = ACCEPTED_AT;
  stale.revalidation.results[0]!.attemptedAt = ACCEPTED_AT;
  assert.throws(() => validateCommunityEvidenceRelease(stale), /generation clock|current revalidation/i);

  const missing = releaseFixture();
  missing.revalidation.results = [];
  assert.throws(() => validateCommunityEvidenceRelease(missing), /current revalidation/i);
});

test("revalidation results retain the committed history as an exact append-only prefix", () => {
  const input = releaseFixture();
  input.previousRevalidation = structuredClone(input.revalidation);
  input.revalidation.results[0]!.candidateValue = "$10M";
  assert.throws(() => validateCommunityEvidenceRelease(input), /revalidation history|append-only prefix/i);
});

test("a later correction preserves the historical promotion proof without requiring withdrawn evidence to remain canonical", () => {
  const input = withValidPromotion();
  const correctedAt = "2026-08-25T11:00:00.000Z";
  input.previousContributions = structuredClone(input.contributions);
  input.previousRevalidation = structuredClone(input.revalidation);
  const entry = input.accepted.entries[0]!;
  input.contributions.events.push({
    ...input.contributions.events.find((event) => event.state === "accepted")!,
    id: buildContributionEventId({ ...entry, state: "corrected", occurredAt: correctedAt }),
    state: "corrected",
    occurredAt: correctedAt,
    publicTargetUrl: null,
  });
  input.accepted.entries = [];
  input.snapshot.fetchedAt = correctedAt;
  input.snapshot.issues[0]!.updatedAt = correctedAt;
  input.snapshot.issues[0]!.labels = [...new Set([...input.snapshot.issues[0]!.labels, "source-withdrawn"])].sort();
  input.seeds.generatedAt = correctedAt;
  input.ledger.generatedAt = correctedAt;
  input.accepted.generatedAt = correctedAt;
  input.contributions.generatedAt = correctedAt;
  input.publicTasks.generatedAt = correctedAt;
  input.revalidation.generatedAt = correctedAt;
  input.communityMetrics.generatedAt = correctedAt;
  input.canonicalMatchContext!.companyClaimLedger.companies[0]!.claims[0]!.fields.amount.evidenceUrls = [];
  input.canonicalMatchContext!.decisionProducts.companyCards[0]!.capital.evidence = [];

  assert.doesNotThrow(() => validateCommunityEvidenceRelease(input));

  input.revalidation.results[0]!.candidateValue = "$9M";
  assert.throws(() => validateCommunityEvidenceRelease(input), /revalidation history|append-only prefix/i);
});

test("accepts an active LKG public task after its current seed ages out", () => {
  const input = releaseFixture();
  input.previousPublicTasks = structuredClone(input.publicTasks);
  const priorTaskId = input.publicTasks.tasks[0]!.id;
  input.seeds.seeds = input.seeds.seeds.filter((seed) => seed.id !== priorTaskId);
  assert.doesNotThrow(() => validateCommunityEvidenceRelease(input));
});

test("rejects mutated seedless public copy that disagrees with the prior LKG projection", () => {
  const input = releaseFixture();
  input.previousPublicTasks = structuredClone(input.publicTasks);
  const priorTaskId = input.publicTasks.tasks[0]!.id;
  input.seeds.seeds = input.seeds.seeds.filter((seed) => seed.id !== priorTaskId);
  input.publicTasks.tasks[0]!.contextZh = "被改写的公开任务说明。";
  assert.throws(() => validateCommunityEvidenceRelease(input), /LKG|prior|previous|context|not the exact|不一致/i);
});

test("rejects private key, score, and model-output leakage", () => {
  const input = releaseFixture();
  (input.publicTasks.tasks[0] as unknown as Record<string, unknown>).rawModelOutput = { score: 99 };
  assert.throws(() => validateCommunityEvidenceRelease(input), /private|exact keys|boundary/i);
});

test("rejects Review metadata and ranking diagnostics from public Top Signals JSON", () => {
  const draft: TopSignalsDraft = {
    schemaVersion: 1,
    experimentId: "github-top-signals-2026-08",
    week: "2026-W37",
    generatedAt: "2026-09-10T10:00:00.000Z",
    periodStart: "2026-09-07",
    periodEnd: "2026-09-13",
    signals: [{
      signalId: stableDecisionId("signal", "release-mutation-event"),
      eventId: "release-mutation-event",
      entityId: "company-release-mutation",
      entityName: "Release Mutation Robotics",
      titleZh: "Release Mutation Robotics 完成产品部署",
      factsZh: ["Release Mutation Robotics 完成产品部署。", "该部署已获得官方证据确认。"],
      kind: "部署案例",
      routes: ["部署与商业化"],
      occurredAt: "2026-09-09T02:00:00.000Z",
      verifiedAt: "2026-09-10T09:00:00.000Z",
      changedThisWeek: true,
      evidenceState: "official",
      evidence: [{ evidenceId: stableDecisionId("evidence", "release-mutation-event\nhttps://alpha.example/deployment"), url: "https://alpha.example/deployment", source: "Alpha", grade: "A" }],
      impact: ["company", "product-deployment"],
      whyItMatters: "AI 研究判断：该部署提供了可复核的商业化信号。",
      rankReasons: ["官方一手证据"],
      nextValidationPoint: "继续核验部署数量与付费客户。",
      scoreBreakdown: { industryCapitalImpact: 28, evidenceQuality: 25, recency: 16, informationGain: 15, strategicRelevance: 10, total: 94 },
    }],
  };
  const releaseUrl = "https://github.com/mbabby/physical-ai-news-cn/releases/tag/top-signals-2026-W37";
  assert.doesNotThrow(() => validatePublishedTopSignalsArtifact(renderTopSignalsArchive(draft, releaseUrl, "2026-09-10T13:05:00.000Z")));

  for (const key of ["generatedAt", "changedThisWeek", "rankReasons", "scoreBreakdown", "rawModelOutput"]) {
    const artifact = renderTopSignalsArchive(draft, releaseUrl, "2026-09-10T13:05:00.000Z");
    const target = key === "generatedAt" ? artifact as unknown as Record<string, unknown> : artifact.signals[0] as unknown as Record<string, unknown>;
    target[key] = key === "scoreBreakdown" ? { total: 99 } : "private";
    assert.throws(() => validatePublishedTopSignalsArtifact(artifact), undefined, key);
  }

  const invalidWeek = renderTopSignalsArchive(draft, releaseUrl, "2026-09-10T13:05:00.000Z");
  invalidWeek.week = "2026-W99";
  invalidWeek.releaseUrl = "https://github.com/mbabby/physical-ai-news-cn/releases/tag/top-signals-2026-W99";
  assert.throws(() => validatePublishedTopSignalsArtifact(invalidWeek), /week|artifact|contract|周/i);

  const invalidPeriod = renderTopSignalsArchive(draft, releaseUrl, "2026-09-10T13:05:00.000Z");
  invalidPeriod.periodStart = "2026-99-99";
  assert.throws(() => validatePublishedTopSignalsArtifact(invalidPeriod), /period|date|artifact|contract|日期/i);
});

test("rejects a task carrying multiple target fields", () => {
  const input = releaseFixture();
  (input.seeds.seeds[0] as unknown as Record<string, unknown>).targetFields = ["funding.amount", "funding.round"];
  assert.throws(() => validateCommunityEvidenceRelease(input), /target|exact keys/i);
});

test("rejects subject or reference identity drift across projections", () => {
  const input = releaseFixture();
  input.publicTasks.tasks[0]!.subject = input.seeds.seeds[2]!.subject;
  assert.throws(() => validateCommunityEvidenceRelease(input), /subject|任务|不一致/i);
});

test("rejects an aggregator classified as official evidence", () => {
  const input = releaseFixture();
  input.canonicalPublicFacts = [{ evidence: [{ link: "https://news.google.com/rss/articles/abc", source: "Google News", grade: "A" }] }];
  assert.throws(() => validateCommunityEvidenceRelease(input), /aggregator|聚合|official|官方/i);
});

test("does not treat a false aggregator marker as aggregator evidence", () => {
  const input = releaseFixture();
  input.canonicalPublicFacts = [{ evidence: [{ link: "https://alpha.example/official", grade: "A", discoveredViaAggregator: false }] }];
  assert.doesNotThrow(() => validateCommunityEvidenceRelease(input));
});

test("rejects duplicate public tasks and WIP above five", () => {
  const input = releaseFixture();
  for (let index = 3; index < 7; index += 1) {
    const base = structuredClone(input.seeds.seeds[1]!);
    base.subject = { ...base.subject, id: `overflow-${index}`, name: `Overflow ${index}`, url: `https://overflow-${index}.example/` };
    base.materialVersion = `overflow-${index}`;
    base.id = buildEvidenceTaskId(base.subject, base.targetField, base.materialVersion);
    input.seeds.seeds.push(base);
    input.snapshot.issues.push({ ...structuredClone(input.snapshot.issues[1]!), number: 41 + index, taskId: base.id });
    input.ledger.entries.push({ ...structuredClone(input.ledger.entries.find((entry) => entry.taskId === input.seeds.seeds[1]!.id)!), taskId: base.id, subject: base.subject, materialVersion: base.materialVersion, issueNumber: 41 + index, issueUrl: `https://github.com/${REPOSITORY}/issues/${41 + index}` });
    input.publicTasks.tasks.push({ ...structuredClone(input.publicTasks.tasks[0]!), id: base.id, subject: base.subject, issueNumber: 41 + index, issueUrl: `https://github.com/${REPOSITORY}/issues/${41 + index}` });
  }
  input.seeds.seeds.sort((a, b) => a.category.localeCompare(b.category) || a.subject.name.localeCompare(b.subject.name) || a.targetField.localeCompare(b.targetField) || a.id.localeCompare(b.id));
  input.snapshot.issues.sort((a, b) => a.number - b.number);
  input.ledger.entries.sort((a, b) => a.taskId.localeCompare(b.taskId));
  input.publicTasks.tasks.sort((a, b) => a.category.localeCompare(b.category) || a.subject.name.localeCompare(b.subject.name) || a.targetField.localeCompare(b.targetField) || a.id.localeCompare(b.id));
  assert.throws(() => validateCommunityEvidenceRelease(input), /WIP|five|5|重复/i);
});

test("rejects duplicate active material identity below the WIP cap", () => {
  const input = releaseFixture();
  const original = input.ledger.entries.find((entry) => entry.state === "open")!;
  const duplicate = structuredClone(original);
  duplicate.materialVersion = "duplicate-material";
  duplicate.taskId = buildEvidenceTaskId(duplicate.subject, duplicate.targetField, duplicate.materialVersion);
  duplicate.issueNumber = 99;
  duplicate.issueUrl = `https://github.com/${REPOSITORY}/issues/99`;
  input.ledger.entries.push(duplicate);
  input.ledger.entries.sort((a, b) => a.taskId.localeCompare(b.taskId));
  assert.throws(() => validateCommunityEvidenceRelease(input), /duplicate open|重复|identity/i);
});

test("rejects a stale or closed ledger task retained in public open tasks", () => {
  const input = releaseFixture();
  const task = input.publicTasks.tasks[0]!;
  const ledger = input.ledger.entries.find((entry) => entry.taskId === task.id)!;
  ledger.state = "stale";
  assert.throws(() => validateCommunityEvidenceRelease(input), /public|公开|活跃|state|状态/i);
});

test("rejects a remotely closed Issue retained in public open tasks", () => {
  const input = releaseFixture();
  const task = input.publicTasks.tasks[0]!;
  const issue = input.snapshot.issues.find((item) => item.taskId === task.id)!;
  issue.state = "closed";
  issue.closedAt = NOW;
  assert.throws(() => validateCommunityEvidenceRelease(input), /closed|Issue|公开|关闭/i);
});

test("rejects active acceptance after accepted-evidence label removal", () => {
  const input = releaseFixture();
  input.snapshot.issues[0]!.labels = input.snapshot.issues[0]!.labels.filter((label) => label !== "accepted-evidence");
  assert.throws(() => validateCommunityEvidenceRelease(input), /accepted|采纳|label|标签/i);
});

test("rejects credit for a commenter whose evidence was not accepted", () => {
  const input = releaseFixture();
  input.accepted.entries[0]!.contributor = "mallory";
  input.contributions.events.find((event) => event.state === "accepted")!.contributor = "mallory";
  assert.throws(() => validateCommunityEvidenceRelease(input), /contributor|贡献|accepted|采纳/i);
});

test("rejects deleted or reordered append-only contribution history", () => {
  const input = releaseFixture();
  input.previousContributions = structuredClone(input.contributions);
  input.contributions.events = [];
  assert.throws(() => validateCommunityEvidenceRelease(input), /prefix|history|历史|append/i);
});

test("rejects duplicate acceptance in one active contribution lifecycle", () => {
  const input = releaseFixture();
  const duplicate = {
    ...structuredClone(input.contributions.events.find((event) => event.state === "accepted")!),
    occurredAt: "2026-08-25T09:30:00.000Z",
  };
  duplicate.id = buildContributionEventId(duplicate);
  input.contributions.events.push(duplicate);
  assert.throws(() => validateCommunityEvidenceRelease(input), /duplicate|lifecycle|重复|生命周期/i);
});

test("release validation recomputes a consistently forged accepted and contribution ID", () => {
  const input = releaseFixture();
  input.accepted.entries[0]!.id = "forged-but-matching";
  input.contributions.events.find((event) => event.state === "accepted")!.id = "forged-but-matching";
  assert.throws(() => validateCommunityEvidenceRelease(input), /stable|identity|id/i);
});

test("binds an accepted record to the exact acceptance event ID and timestamp", () => {
  for (const mutate of [
    (input: ReturnType<typeof releaseFixture>) => { input.accepted.entries[0]!.id = "accepted-evidence-forged"; },
    (input: ReturnType<typeof releaseFixture>) => { input.accepted.entries[0]!.acceptedAt = "2026-08-25T09:00:01.000Z"; },
  ]) {
    const input = releaseFixture();
    mutate(input);
    assert.throws(() => validateCommunityEvidenceRelease(input), /acceptance|accepted|采纳|event|事件/i);
  }
});

test("rejects accepted evidence in a canonical fact without a promotion record", () => {
  const input = releaseFixture();
  input.canonicalPublicFacts = [{ facts: ["已写入规范事实"], evidence: [{ link: EVIDENCE_URL, source: "Alpha 官网", grade: "A" }] }];
  assert.throws(() => validateCommunityEvidenceRelease(input), /promotion|promoted|晋升|公开事实/i);
});

test("rejects accepted evidence embedded in public Markdown without a promotion record", () => {
  const input = releaseFixture();
  input.canonicalPublicFacts = [`公开说明：[证据](${EVIDENCE_URL})`];
  assert.throws(() => validateCommunityEvidenceRelease(input), /promotion|promoted|晋升|公开事实/i);
});

test("canonical dashboard scanning ignores community attribution but still rejects the same URL in a real fact", () => {
  const attributionOnly = releaseFixture();
  attributionOnly.canonicalPublicFacts = [canonicalDashboardFacts({
    communityEvidence: { acceptedEvidence: [{ evidenceUrl: EVIDENCE_URL }] },
    topSignals: [],
  } as never)];
  assert.doesNotThrow(() => validateCommunityEvidenceRelease(attributionOnly));

  const canonicalFact = releaseFixture();
  canonicalFact.canonicalPublicFacts = [canonicalDashboardFacts({
    communityEvidence: { acceptedEvidence: [{ evidenceUrl: EVIDENCE_URL }] },
    topSignals: [{ evidenceUrl: EVIDENCE_URL }],
  } as never)];
  assert.throws(() => validateCommunityEvidenceRelease(canonicalFact), /promotion|promoted|公开事实/i);
});

test("rejects forged or ranking-bearing aggregate community metrics", () => {
  for (const mutate of [
    (input: ReturnType<typeof releaseFixture>) => { input.communityMetrics.openTasks = 5; },
    (input: ReturnType<typeof releaseFixture>) => { (input.communityMetrics as Record<string, unknown>).topContributors = ["alice"]; },
  ]) {
    const input = releaseFixture();
    mutate(input);
    assert.throws(() => validateCommunityEvidenceRelease(input), /metrics|metric|指标|exact|ranking|排名/i);
  }
});

test("selects the parent contribution artifact when a clean checkout equals HEAD", () => {
  const current = releaseFixture().contributions;
  const parent = structuredClone(current);
  parent.generatedAt = "2026-08-25T09:00:00.000Z";
  parent.events = [];
  assert.deepEqual(selectContributionHistoryBaseline(current, structuredClone(current), parent), parent);
  assert.deepEqual(selectContributionHistoryBaseline(current, undefined, parent), parent);
});

test("selects the parent revalidation artifact when a clean checkout equals HEAD", () => {
  const current = releaseFixture().revalidation;
  const parent = structuredClone(current);
  parent.generatedAt = ACCEPTED_AT;
  parent.results[0]!.attemptedAt = ACCEPTED_AT;
  assert.deepEqual(selectRevalidationHistoryBaseline(current, structuredClone(current), parent), parent);
  assert.deepEqual(selectRevalidationHistoryBaseline(current, undefined, parent), parent);
});
