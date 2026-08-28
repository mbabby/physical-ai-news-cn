import assert from "node:assert/strict";
import test from "node:test";
import {
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
import { validateCommunityEvidenceRelease } from "../src/runtime/validation.js";
import { selectContributionHistoryBaseline } from "../src/validate-release.js";

const NOW = "2026-08-25T10:00:00.000Z";
const CREATED_AT = "2026-08-24T08:00:00.000Z";
const ACCEPTED_AT = "2026-08-25T09:00:00.000Z";
const REPOSITORY = "acme/physical-ai-news-cn";
const EVIDENCE_URL = "https://alpha.example/funding";
const ACCEPTED_EVENT_ID = "contribution-event-accepted-alpha";

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
  const issues: EvidenceIssueSnapshot["issues"] = seeds.map((seed, index) => ({
    number: 41 + index, taskId: seed.id, taskVersion: 1, state: index === 0 ? "closed" : "open",
    labels: [...(index === 0 ? ["accepted-evidence"] : []), "evidence-task", `evidence-task-${seed.category}`, "two-minute-task"].sort(),
    authorLogin: index === 0 ? "alice" : "maintainer", authorAssociation: index === 0 ? "FIRST_TIME_CONTRIBUTOR" : "MEMBER",
    createdAt: CREATED_AT, updatedAt: index === 0 ? ACCEPTED_AT : NOW, closedAt: index === 0 ? ACCEPTED_AT : null,
    evidenceUrls: index === 0 ? [EVIDENCE_URL] : [], acceptedContributors: index === 0 ? ["alice"] : [],
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
      id: ACCEPTED_EVENT_ID, taskId: acceptedSeed.id, issueNumber: 41, category: acceptedSeed.category,
      subject: acceptedSeed.subject, targetField: acceptedSeed.targetField, contributor: "alice", evidenceUrl: EVIDENCE_URL,
      acceptedAt: ACCEPTED_AT,
    }],
  };
  const acceptedEvent: ContributionLedgerArtifact["events"][number] = {
    id: ACCEPTED_EVENT_ID, taskId: acceptedSeed.id, issueNumber: 41, contributor: "alice",
    evidenceUrl: EVIDENCE_URL, category: acceptedSeed.category, subject: acceptedSeed.subject,
    targetField: acceptedSeed.targetField, state: "accepted", occurredAt: ACCEPTED_AT,
    sourceUrl: `https://github.com/${REPOSITORY}/issues/41`, publicTargetUrl: null,
  };
  const contributions: ContributionLedgerArtifact = { schemaVersion: 1, generatedAt: NOW, events: [acceptedEvent] };
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
  return { seeds: seedArtifact, snapshot, ledger, accepted, contributions, publicTasks, communityMetrics, canonicalPublicFacts: [] as unknown[] };
}

test("accepts one exact, lifecycle-consistent community evidence release", () => {
  assert.doesNotThrow(() => validateCommunityEvidenceRelease(releaseFixture()));
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
  input.contributions.events[0]!.contributor = "mallory";
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
  input.contributions.events.push({
    ...structuredClone(input.contributions.events[0]!),
    id: "contribution-event-duplicate-acceptance",
    occurredAt: "2026-08-25T09:30:00.000Z",
  });
  assert.throws(() => validateCommunityEvidenceRelease(input), /duplicate|lifecycle|重复|生命周期/i);
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
