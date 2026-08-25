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
  "community/contributions.json",
  "site/data/community-tasks.json",
] as const;

const fixtures: Record<EvidenceTaskCategory, { kind: "company" | "event" | "research"; id: string; name: string; url: string; targetField: EvidenceTargetField }> = {
  "company-funding": { kind: "company", id: "company-alpha", name: "Alpha Robotics", url: "https://alpha.example/", targetField: "funding.amount" },
  "product-deployment": { kind: "event", id: "event-beta", name: "Beta 部署", url: "https://beta.example/deployment", targetField: "deployment.customer" },
  "research-metadata": { kind: "research", id: "paper-gamma", name: "Gamma 研究", url: "https://gamma.example/paper", targetField: "research.codeUrl" },
};

function seed(category: EvidenceTaskCategory): EvidenceTaskSeed {
  const fixture = fixtures[category];
  const subject = { kind: fixture.kind, id: fixture.id, name: fixture.name, url: fixture.url };
  const materialVersion = `material-${category}`;
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

function seeds(): EvidenceTaskSeedArtifact {
  const artifact: EvidenceTaskSeedArtifact = {
    schemaVersion: 1,
    generatedAt: NOW,
    generatedWeek: "2026-W35",
    seeds: (["company-funding", "product-deployment", "research-metadata"] as EvidenceTaskCategory[]).map(seed),
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
    const storedContributions = JSON.parse(stored["community/contributions.json"]!);
    const storedPublic = JSON.parse(stored["site/data/community-tasks.json"]!);
    assert.doesNotThrow(() => assertEvidenceTaskSeedArtifact(storedSeeds));
    assert.doesNotThrow(() => assertEvidenceTaskLedgerArtifact(storedLedger));
    assert.doesNotThrow(() => assertAcceptedEvidenceArtifact(storedAccepted));
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
    const degraded = await project(root, degradedTransaction, artifact, async () => { throw new Error("GitHub unavailable"); });
    await degradedTransaction.commit();

    assert.equal(degraded.status.status, "部分降级");
    assert.equal(degraded.status.failed, 1);
    assert.deepEqual(await bytes(root), previous);
    assert.equal(JSON.parse(previous["site/data/community-tasks.json"]!).tasks.length, 2);
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
