import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertAcceptedEvidenceArtifact,
  assertCommunityTaskPublicArtifact,
  assertContributionLedgerArtifact,
  assertEvidenceTaskLedgerArtifact,
  assertEvidenceTaskSeedArtifact,
  buildContributionEventId,
  buildEvidenceTaskId,
  type EvidenceIssue,
  type EvidenceIssueSnapshot,
  type EvidenceTaskCategory,
  type EvidenceTaskSeed,
  type EvidenceTaskSeedArtifact,
  type EvidenceTargetField,
} from "../src/community-evidence/contracts.js";
import { buildAcceptedEvidenceEnrichmentTargets } from "../src/evidence-enrichment-planner.js";
import { stageCommunityEvidenceArtifacts } from "../src/main.js";
import { FileTransaction } from "../src/runtime/storage.js";

const NOW = "2026-08-25T08:00:00.000Z";
const REPO = "acme/physical-ai-news-cn";
const EVIDENCE_URL = "https://evidence.example/alpha-funding";
const ARTIFACT_PATHS = [
  "review/evidence-task-seeds.json",
  "review/evidence-issue-snapshot.json",
  "review/evidence-task-ledger.json",
  "review/accepted-evidence.json",
  "review/accepted-evidence-revalidation.json",
  "community/contributions.json",
  "site/data/community-tasks.json",
] as const;

const fixtures: Record<EvidenceTaskCategory, { kind: "company" | "event" | "research"; id: string; name: string; url: string; targetField: EvidenceTargetField }> = {
  "company-funding": { kind: "company", id: "company-alpha", name: "Alpha Robotics", url: "https://alpha.example/", targetField: "funding.amount" },
  "product-deployment": { kind: "event", id: "event-beta", name: "Beta 部署", url: "https://beta.example/deployment", targetField: "deployment.customer" },
  "research-metadata": { kind: "research", id: "paper-gamma", name: "Gamma 研究", url: "https://gamma.example/paper", targetField: "research.codeUrl" },
};

function seed(category: EvidenceTaskCategory, suffix = ""): EvidenceTaskSeed {
  const fixture = fixtures[category];
  const subject = { kind: fixture.kind, id: `${fixture.id}${suffix}`, name: `${fixture.name}${suffix}`, url: fixture.url };
  const materialVersion = `material-${category}${suffix}`;
  return {
    id: buildEvidenceTaskId(subject, fixture.targetField, materialVersion),
    version: 1,
    category,
    subject,
    targetField: fixture.targetField,
    contextZh: `${fixture.name} 的单一字段仍待公开证据确认。`,
    referenceUrls: [fixture.url],
    suggestedLocations: ["官方页面"],
    qualifiedEvidenceZh: ["可公开核验的原始来源"],
    disqualifiedEvidenceZh: ["没有原始链接的转述"],
    replyTemplateZh: "证据链接：\n证据摘录：\n来源类型：",
    estimatedMinutes: 2,
    generatedWeek: "2026-W35",
    materialVersion,
    supersedesTaskId: null,
  };
}

function seeds(suffix = ""): EvidenceTaskSeedArtifact {
  const artifact: EvidenceTaskSeedArtifact = {
    schemaVersion: 1,
    generatedAt: NOW,
    generatedWeek: "2026-W35",
    seeds: (["company-funding", "product-deployment", "research-metadata"] as EvidenceTaskCategory[]).map((category) => seed(category, suffix)),
  };
  assertEvidenceTaskSeedArtifact(artifact);
  return artifact;
}

function issue(task: EvidenceTaskSeed, number: number, accepted = false): EvidenceIssue {
  return {
    number,
    taskId: task.id,
    taskVersion: task.version,
    state: "open",
    labels: ["evidence-task", `evidence-task-${task.category}`, ...(accepted ? ["accepted-evidence"] : []), "two-minute-task"].sort(),
    authorLogin: accepted ? "alice" : "maintainer",
    authorAssociation: accepted ? "FIRST_TIME_CONTRIBUTOR" : "MEMBER",
    createdAt: "2026-08-24T08:00:00.000Z",
    updatedAt: accepted ? "2026-08-25T07:00:00.000Z" : "2026-08-24T08:00:00.000Z",
    closedAt: null,
    evidenceUrls: accepted ? [EVIDENCE_URL] : [],
    submittedEvidence: accepted ? [{ contributor: "alice", evidenceUrl: EVIDENCE_URL, submittedAt: "2026-08-24T08:00:00.000Z" }] : [],
    acceptedContributors: accepted ? ["alice"] : [],
    acceptedEvidence: accepted ? [{ contributor: "alice", evidenceUrl: EVIDENCE_URL }] : [],
  };
}

function snapshot(artifact: EvidenceTaskSeedArtifact): EvidenceIssueSnapshot {
  return {
    schemaVersion: 1,
    fetchedAt: NOW,
    repo: REPO,
    issues: artifact.seeds.map((task, index) => issue(task, 41 + index, index === 0)),
  };
}

async function initializeRoot(root: string): Promise<void> {
  await Promise.all(["review", "community", "site/data", "events", "research"].map((path) => mkdir(join(root, path), { recursive: true })));
  await writeFile(join(root, "events/index.json"), '{"events":[]}\n');
  await writeFile(join(root, "events/companies.json"), "[]\n");
  await writeFile(join(root, "research/registry.json"), '{"records":[]}\n');
  await writeFile(join(root, "README.md"), "# Fixture\n");
}

async function bytes(root: string): Promise<Record<string, string>> {
  return Object.fromEntries(await Promise.all(ARTIFACT_PATHS.map(async (path) => [path, await readFile(join(root, path), "utf8")] as const)));
}

async function project(root: string, transaction: FileTransaction, artifact: EvidenceTaskSeedArtifact, fetchSnapshot: () => Promise<EvidenceIssueSnapshot>) {
  return stageCommunityEvidenceArtifacts({
    root,
    transaction,
    seeds: artifact,
    now: new Date(NOW),
    github: { token: "fixture-token", repo: REPO, fetchSnapshot },
  });
}

test("daily community evidence projection is exact, revalidation-only, deterministic, and atomic", async () => {
  const root = await mkdtemp(join(tmpdir(), "community-evidence-daily-"));
  try {
    await initializeRoot(root);
    const artifact = seeds();
    const issues = snapshot(artifact);
    const firstTransaction = new FileTransaction("community-evidence-first");
    const first = await project(root, firstTransaction, artifact, async () => issues);
    await firstTransaction.commit();

    const stored = await bytes(root);
    const storedSeeds = JSON.parse(stored["review/evidence-task-seeds.json"]!);
    const storedLedger = JSON.parse(stored["review/evidence-task-ledger.json"]!);
    const storedAccepted = JSON.parse(stored["review/accepted-evidence.json"]!);
    const storedRevalidation = JSON.parse(stored["review/accepted-evidence-revalidation.json"]!);
    const storedContributions = JSON.parse(stored["community/contributions.json"]!);
    const storedPublic = JSON.parse(stored["site/data/community-tasks.json"]!);
    assert.doesNotThrow(() => assertEvidenceTaskSeedArtifact(storedSeeds));
    assert.doesNotThrow(() => assertEvidenceTaskLedgerArtifact(storedLedger));
    assert.doesNotThrow(() => assertAcceptedEvidenceArtifact(storedAccepted));
    assert.equal(storedRevalidation.status, "degraded");
    assert.doesNotThrow(() => assertContributionLedgerArtifact(storedContributions));
    assert.doesNotThrow(() => assertCommunityTaskPublicArtifact(storedPublic));
    assert.deepEqual(storedSeeds.seeds.map((item: EvidenceTaskSeed) => item.category), ["company-funding", "product-deployment", "research-metadata"]);
    assert.equal(storedAccepted.entries.length, 1);
    assert.equal(storedPublic.tasks.length, 2);

    const targets = buildAcceptedEvidenceEnrichmentTargets(storedAccepted);
    assert.deepEqual(first.enrichmentTargets, targets);
    assert.equal(targets[0]?.evidenceUrl, EVIDENCE_URL);
    assert.equal(targets[0]?.domain, "evidence.example");
    assert.deepEqual(targets[0]?.subject, artifact.seeds[0]?.subject);
    assert.equal(targets[0]?.targetField, "funding.amount");
    assert.equal(targets[0]?.disposition, "revalidation-only");
    assert.equal(targets[0]?.mayPublish, false);
    assert.equal(targets[0]?.mayUpgradeFactGrade, false);

    for (const path of ["events/index.json", "events/companies.json", "research/registry.json", "README.md"]) {
      assert.doesNotMatch(await readFile(join(root, path), "utf8"), /alpha-funding|evidence\.example/);
    }

    const secondTransaction = new FileTransaction("community-evidence-second");
    await project(root, secondTransaction, artifact, async () => issues);
    await secondTransaction.commit();
    assert.deepEqual(await bytes(root), stored);

    const failedTransaction = new FileTransaction("community-evidence-failed-swap", { failAfterSwaps: 2 });
    await project(root, failedTransaction, artifact, async () => issues);
    await assert.rejects(() => failedTransaction.commit(), /已回滚并保留上一版/);
    assert.deepEqual(await bytes(root), stored);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("GitHub failure reuses the prior valid projection and reports degradation", async () => {
  const root = await mkdtemp(join(tmpdir(), "community-evidence-github-lkg-"));
  try {
    await initializeRoot(root);
    const artifact = seeds();
    const firstTransaction = new FileTransaction("community-evidence-lkg-first");
    await project(root, firstTransaction, artifact, async () => snapshot(artifact));
    await firstTransaction.commit();
    const previous = await bytes(root);

    const degradedTransaction = new FileTransaction("community-evidence-lkg-degraded");
    const degraded = await project(root, degradedTransaction, seeds("-changed"), async () => { throw new Error("GitHub unavailable"); });
    await degradedTransaction.commit();

    assert.equal(degraded.status.status, "部分降级");
    assert.equal(degraded.status.failed, 1);
    assert.deepEqual(await bytes(root), previous);
    assert.equal(JSON.parse(previous["site/data/community-tasks.json"]!).tasks.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an unconfigured GitHub rerun treats an empty accepted-evidence LKG as successful revalidation", async () => {
  const root = await mkdtemp(join(tmpdir(), "community-evidence-empty-revalidation-"));
  try {
    await initializeRoot(root);
    const artifact = seeds();
    const firstTransaction = new FileTransaction("community-evidence-empty-first");
    await stageCommunityEvidenceArtifacts({ root, transaction: firstTransaction, seeds: artifact, now: new Date(NOW) });
    await firstTransaction.commit();
    const previous = await bytes(root);

    const rerunTransaction = new FileTransaction("community-evidence-empty-rerun");
    const rerun = await stageCommunityEvidenceArtifacts({ root, transaction: rerunTransaction, seeds: artifact, now: new Date(NOW) });
    await rerunTransaction.commit();

    assert.deepEqual(rerun.revalidationStatus, {
      component: "EvidenceRevalidation",
      status: "成功",
      attempted: 0,
      succeeded: 0,
      failed: 0,
      detail: "上一有效社区投影没有已采纳证据，无需复核。",
    });
    assert.deepEqual(await bytes(root), previous);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("GitHub failure migrates an exact legacy v1 Issue snapshot instead of losing the LKG", async () => {
  const root = await mkdtemp(join(tmpdir(), "community-evidence-legacy-snapshot-"));
  try {
    await initializeRoot(root);
    const artifact = seeds();
    const firstTransaction = new FileTransaction("community-evidence-legacy-first");
    await project(root, firstTransaction, artifact, async () => snapshot(artifact));
    await firstTransaction.commit();
    const snapshotPath = join(root, "review", "evidence-issue-snapshot.json");
    const legacy = JSON.parse(await readFile(snapshotPath, "utf8"));
    legacy.issues.forEach((item: Record<string, unknown>) => { delete item.submittedEvidence; });
    await writeFile(snapshotPath, `${JSON.stringify(legacy, null, 2)}\n`);

    const transaction = new FileTransaction("community-evidence-legacy-fallback");
    const result = await project(root, transaction, seeds("-changed"), async () => { throw new Error("GitHub unavailable"); });
    await transaction.commit();
    assert.equal(result.status.status, "部分降级");
    const migrated = JSON.parse(await readFile(snapshotPath, "utf8"));
    assert.ok(migrated.issues.every((item: { submittedEvidence?: unknown[] }) => Array.isArray(item.submittedEvidence)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("GitHub failure preserves and safely upgrades a nonempty pre-revalidation v1 LKG", async () => {
  const root = await mkdtemp(join(tmpdir(), "community-evidence-legacy-group-"));
  try {
    await initializeRoot(root);
    const artifact = seeds();
    const firstTransaction = new FileTransaction("community-evidence-legacy-group-first");
    await project(root, firstTransaction, artifact, async () => snapshot(artifact));
    await firstTransaction.commit();

    const snapshotPath = join(root, "review", "evidence-issue-snapshot.json");
    const legacySnapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
    legacySnapshot.issues.forEach((item: Record<string, unknown>) => { delete item.submittedEvidence; });
    await writeFile(snapshotPath, `${JSON.stringify(legacySnapshot, null, 2)}\n`);
    await rm(join(root, "review", "accepted-evidence-revalidation.json"));

    const contributionsPath = join(root, "community", "contributions.json");
    const legacyContributions = JSON.parse(await readFile(contributionsPath, "utf8"));
    legacyContributions.events = legacyContributions.events.filter((event: { state: string }) => event.state !== "submitted");
    assert.doesNotThrow(() => assertContributionLedgerArtifact(legacyContributions));
    await writeFile(contributionsPath, `${JSON.stringify(legacyContributions, null, 2)}\n`);

    const preservedPaths = ARTIFACT_PATHS.filter((path) => path !== "review/evidence-issue-snapshot.json"
      && path !== "review/accepted-evidence-revalidation.json");
    const preserved = Object.fromEntries(await Promise.all(preservedPaths.map(async (path) => [path, await readFile(join(root, path), "utf8")] as const)));

    const transaction = new FileTransaction("community-evidence-legacy-group-fallback");
    const result = await project(root, transaction, seeds("-changed"), async () => { throw new Error("GitHub unavailable"); });
    await transaction.commit();

    assert.equal(result.status.status, "部分降级");
    assert.equal(result.revalidation.status, "degraded");
    assert.equal(result.revalidationStatus.attempted, result.accepted.entries.length);
    assert.equal(result.revalidationStatus.failed, result.accepted.entries.length);
    assert.ok(result.revalidation.results.every((item) => item.outcome === "deferred" && item.canonicalMatch === null));
    assert.equal(result.publication.recentContributions.some((item) => item.state === "promoted"), false);
    for (const [path, content] of Object.entries(preserved)) {
      assert.equal(await readFile(join(root, path), "utf8"), content, path);
    }
    const migratedSnapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
    assert.ok(migratedSnapshot.issues.every((item: { submittedEvidence?: unknown[] }) => Array.isArray(item.submittedEvidence)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("shape-valid accepted evidence inconsistent with the ledger fails closed without changing disk LKG", async () => {
  const root = await mkdtemp(join(tmpdir(), "community-evidence-relational-lkg-"));
  try {
    await initializeRoot(root);
    const artifact = seeds();
    const firstTransaction = new FileTransaction("community-evidence-relational-first");
    await project(root, firstTransaction, artifact, async () => snapshot(artifact));
    await firstTransaction.commit();

    const acceptedPath = join(root, "review", "accepted-evidence.json");
    const accepted = JSON.parse(await readFile(acceptedPath, "utf8"));
    accepted.entries[0].taskId = artifact.seeds[1]!.id;
    accepted.entries[0].id = buildContributionEventId({
      taskId: accepted.entries[0].taskId,
      issueNumber: accepted.entries[0].issueNumber,
      contributor: accepted.entries[0].contributor,
      evidenceUrl: accepted.entries[0].evidenceUrl,
      state: "accepted",
      occurredAt: accepted.entries[0].acceptedAt,
    });
    assert.doesNotThrow(() => assertAcceptedEvidenceArtifact(accepted));
    await writeFile(acceptedPath, `${JSON.stringify(accepted, null, 2)}\n`);
    const before = await bytes(root);

    const transaction = new FileTransaction("community-evidence-relational-degraded");
    await assert.rejects(
      () => project(root, transaction, seeds("-changed"), async () => { throw new Error("GitHub unavailable"); }),
      /accepted|采纳|ledger|账本|task/i,
    );
    assert.deepEqual(await bytes(root), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unreferenced terminal ledger history may outlive the label-filtered Issue snapshot", async () => {
  const root = await mkdtemp(join(tmpdir(), "community-evidence-ledger-history-"));
  try {
    await initializeRoot(root);
    const artifact = seeds();
    const firstTransaction = new FileTransaction("community-evidence-history-first");
    await project(root, firstTransaction, artifact, async () => snapshot(artifact));
    await firstTransaction.commit();

    const ledgerPath = join(root, "review", "evidence-task-ledger.json");
    const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
    const subject = { kind: "company", id: "company-historical", name: "Historical Robotics", url: "https://historical.example/" } as const;
    const materialVersion = "historical-material";
    ledger.entries.push({
      taskId: buildEvidenceTaskId(subject, "company.officialUrl", materialVersion), taskVersion: 1,
      category: "company-funding", subject, targetField: "company.officialUrl", materialVersion, supersedesTaskId: null,
      issueNumber: 99, issueUrl: `https://github.com/${REPO}/issues/99`, state: "closed",
      createdAt: "2026-08-20T08:00:00.000Z", updatedAt: "2026-08-24T08:00:00.000Z",
      lastActivityAt: "2026-08-24T08:00:00.000Z", closedAt: "2026-08-24T08:00:00.000Z",
    });
    ledger.entries.sort((left: { taskId: string }, right: { taskId: string }) => left.taskId < right.taskId ? -1 : 1);
    assert.doesNotThrow(() => assertEvidenceTaskLedgerArtifact(ledger));
    await writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
    const before = await bytes(root);

    const degradedTransaction = new FileTransaction("community-evidence-history-degraded");
    await project(root, degradedTransaction, seeds("-changed"), async () => { throw new Error("GitHub unavailable"); });
    await degradedTransaction.commit();
    assert.deepEqual(await bytes(root), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("append-only contribution history survives removal of its URL from a corrected Issue", async () => {
  const root = await mkdtemp(join(tmpdir(), "community-evidence-corrected-history-"));
  try {
    await initializeRoot(root);
    const artifact = seeds();
    const initialSnapshot = snapshot(artifact);
    const firstTransaction = new FileTransaction("community-evidence-corrected-first");
    await project(root, firstTransaction, artifact, async () => initialSnapshot);
    await firstTransaction.commit();

    const correctedSnapshot = structuredClone(initialSnapshot);
    const correctedIssue = correctedSnapshot.issues[0]!;
    correctedIssue.labels = ["evidence-task", "evidence-task-company-funding", "source-withdrawn", "two-minute-task"].sort();
    correctedIssue.updatedAt = NOW;
    correctedIssue.evidenceUrls = [];
    correctedIssue.submittedEvidence = [];
    correctedIssue.acceptedContributors = [];
    correctedIssue.acceptedEvidence = [];
    const secondTransaction = new FileTransaction("community-evidence-corrected-second");
    await project(root, secondTransaction, artifact, async () => correctedSnapshot);
    await secondTransaction.commit();

    const accepted = JSON.parse(await readFile(join(root, "review", "accepted-evidence.json"), "utf8"));
    const contributions = JSON.parse(await readFile(join(root, "community", "contributions.json"), "utf8"));
    assert.deepEqual(accepted.entries, []);
    assert.deepEqual(contributions.events.map((event: { state: string }) => event.state), ["submitted", "accepted", "corrected"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("accepted then corrected contribution history survives omission from a third label-filtered refresh", async () => {
  const root = await mkdtemp(join(tmpdir(), "community-evidence-three-refresh-history-"));
  try {
    await initializeRoot(root);
    const artifact = seeds();
    const acceptedSnapshot = snapshot(artifact);
    const firstTransaction = new FileTransaction("community-evidence-three-refresh-first");
    await project(root, firstTransaction, artifact, async () => acceptedSnapshot);
    await firstTransaction.commit();

    const correctedSnapshot = structuredClone(acceptedSnapshot);
    const correctedIssue = correctedSnapshot.issues[0]!;
    correctedIssue.labels = ["evidence-task", "evidence-task-company-funding", "source-withdrawn", "two-minute-task"].sort();
    correctedIssue.updatedAt = NOW;
    correctedIssue.evidenceUrls = [];
    correctedIssue.submittedEvidence = [];
    correctedIssue.acceptedContributors = [];
    correctedIssue.acceptedEvidence = [];
    const secondTransaction = new FileTransaction("community-evidence-three-refresh-second");
    await project(root, secondTransaction, artifact, async () => correctedSnapshot);
    await secondTransaction.commit();
    const beforeOmission = JSON.parse(await readFile(join(root, "community", "contributions.json"), "utf8"));
    assert.deepEqual(beforeOmission.events.map((event: { state: string }) => event.state), ["submitted", "accepted", "corrected"]);

    const omittedSnapshot = structuredClone(correctedSnapshot);
    omittedSnapshot.issues = omittedSnapshot.issues.slice(1);
    const thirdTransaction = new FileTransaction("community-evidence-three-refresh-third");
    await project(root, thirdTransaction, artifact, async () => omittedSnapshot);
    await thirdTransaction.commit();

    const afterOmission = JSON.parse(await readFile(join(root, "community", "contributions.json"), "utf8"));
    const ledger = JSON.parse(await readFile(join(root, "review", "evidence-task-ledger.json"), "utf8"));
    assert.deepEqual(afterOmission.events, beforeOmission.events);
    assert.equal(ledger.entries.some((entry: { taskId: string }) => entry.taskId === artifact.seeds[0]!.id), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a changed-material seed may receive its ledger-derived supersession link", async () => {
  const root = await mkdtemp(join(tmpdir(), "community-evidence-successor-"));
  try {
    await initializeRoot(root);
    const artifact = seeds();
    const issues = snapshot(artifact);
    const firstTransaction = new FileTransaction("community-evidence-successor-first");
    await project(root, firstTransaction, artifact, async () => issues);
    await firstTransaction.commit();

    const successorSeeds = structuredClone(artifact);
    const successor = successorSeeds.seeds[0]!;
    const oldTaskId = successor.id;
    successor.materialVersion = "material-company-funding-v2";
    successor.id = buildEvidenceTaskId(successor.subject, successor.targetField, successor.materialVersion);
    assertEvidenceTaskSeedArtifact(successorSeeds);
    const secondTransaction = new FileTransaction("community-evidence-successor-second");
    await project(root, secondTransaction, successorSeeds, async () => issues);
    await secondTransaction.commit();

    const ledger = JSON.parse(await readFile(join(root, "review", "evidence-task-ledger.json"), "utf8"));
    const successorEntry = ledger.entries.find((entry: { taskId: string }) => entry.taskId === successor.id);
    assert.equal(successorEntry?.supersedesTaskId, oldTaskId);
    assert.equal(successorEntry?.taskVersion, 2);
    assert.equal(successorEntry?.state, "ready");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("canonical-promoted label alone cannot create a promoted contribution", async () => {
  const root = await mkdtemp(join(tmpdir(), "community-evidence-promoted-target-"));
  try {
    await initializeRoot(root);
    const artifact = seeds();
    const promotedSnapshot = snapshot(artifact);
    promotedSnapshot.issues[0]!.labels = [...promotedSnapshot.issues[0]!.labels, "canonical-promoted"].sort();
    const firstTransaction = new FileTransaction("community-evidence-promoted-first");
    await project(root, firstTransaction, artifact, async () => promotedSnapshot);
    await firstTransaction.commit();

    const contributionsPath = join(root, "community", "contributions.json");
    const contributions = JSON.parse(await readFile(contributionsPath, "utf8"));
    assert.equal(contributions.events.some((event: { state: string }) => event.state === "promoted"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("orphan accepted contribution history cannot remain active after acceptance is removed", async () => {
  const root = await mkdtemp(join(tmpdir(), "community-evidence-orphan-acceptance-"));
  try {
    await initializeRoot(root);
    const artifact = seeds();
    const firstTransaction = new FileTransaction("community-evidence-orphan-first");
    await project(root, firstTransaction, artifact, async () => snapshot(artifact));
    await firstTransaction.commit();

    const snapshotPath = join(root, "review", "evidence-issue-snapshot.json");
    const savedSnapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
    savedSnapshot.issues[0].labels = ["evidence-task", "evidence-task-company-funding", "two-minute-task"].sort();
    savedSnapshot.issues[0].acceptedContributors = [];
    savedSnapshot.issues[0].acceptedEvidence = [];
    await writeFile(snapshotPath, `${JSON.stringify(savedSnapshot, null, 2)}\n`);
    const acceptedPath = join(root, "review", "accepted-evidence.json");
    const accepted = JSON.parse(await readFile(acceptedPath, "utf8"));
    accepted.entries = [];
    assertAcceptedEvidenceArtifact(accepted);
    await writeFile(acceptedPath, `${JSON.stringify(accepted, null, 2)}\n`);
    const before = await bytes(root);

    const fallback = new FileTransaction("community-evidence-orphan-fallback");
    await assert.rejects(
      () => project(root, fallback, seeds("-changed"), async () => { throw new Error("GitHub unavailable"); }),
      /accepted|acceptance|采纳|lifecycle|生命周期|贡献/i,
    );
    assert.deepEqual(await bytes(root), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("configured GitHub failure without an LKG fails closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "community-evidence-github-no-lkg-"));
  try {
    await initializeRoot(root);
    const transaction = new FileTransaction("community-evidence-no-lkg");
    await assert.rejects(
      () => project(root, transaction, seeds(), async () => { throw new Error("GitHub unavailable"); }),
      /GitHub.*上一有效|上一有效.*GitHub/,
    );
    for (const path of ARTIFACT_PATHS) {
      await assert.rejects(() => readFile(join(root, path), "utf8"), (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
