import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  assertEvidenceTaskLedgerArtifact,
  buildEvidenceTaskId,
  type EvidenceIssue,
  type EvidenceIssueSnapshot,
  type EvidenceSubject,
  type EvidenceTaskCategory,
  type EvidenceTaskLedgerArtifact,
  type EvidenceTaskLedgerEntry,
  type EvidenceTaskSeed,
  type EvidenceTaskSeedArtifact,
  type EvidenceTargetField,
} from "../src/community-evidence/contracts.js";
import { planEvidenceIssueActions } from "../src/community-evidence/task-ledger.js";

const NOW = "2026-08-24T12:00:00Z";
const REPO = "acme/physical-ai-news-cn";

const categoryFixture: Record<EvidenceTaskCategory, { subject: EvidenceSubject; targetField: EvidenceTargetField }> = {
  "company-funding": {
    subject: { kind: "company", id: "company-alpha", name: "Alpha Robotics", url: "https://alpha.example/" },
    targetField: "funding.amount",
  },
  "product-deployment": {
    subject: { kind: "event", id: "event-beta", name: "Beta 部署", url: "https://beta.example/deployment" },
    targetField: "deployment.customer",
  },
  "research-metadata": {
    subject: { kind: "research", id: "paper-gamma", name: "Gamma 研究", url: "https://gamma.example/paper" },
    targetField: "research.codeUrl",
  },
};

function seed(category: EvidenceTaskCategory, suffix = "1", overrides: Partial<EvidenceTaskSeed> = {}): EvidenceTaskSeed {
  const fixture = categoryFixture[category];
  const subject = overrides.subject ?? { ...fixture.subject, id: `${fixture.subject.id}-${suffix}`, name: `${fixture.subject.name} ${suffix}` };
  const targetField = overrides.targetField ?? fixture.targetField;
  const materialVersion = overrides.materialVersion ?? `material-${suffix}`;
  return {
    id: buildEvidenceTaskId(subject, targetField, materialVersion),
    version: 1,
    category,
    subject,
    targetField,
    contextZh: `${subject.name} 的单一字段仍待公开证据确认。`,
    referenceUrls: [subject.url],
    suggestedLocations: ["官方页面"],
    qualifiedEvidenceZh: ["可公开核验的原始来源"],
    disqualifiedEvidenceZh: ["没有原始链接的转述"],
    replyTemplateZh: "证据链接：\n证据摘录：\n来源类型：",
    estimatedMinutes: 2,
    generatedWeek: "2026-W35",
    materialVersion,
    supersedesTaskId: null,
    ...overrides,
  };
}

function seeds(items: EvidenceTaskSeed[]): EvidenceTaskSeedArtifact {
  return {
    schemaVersion: 1,
    generatedAt: NOW,
    generatedWeek: "2026-W35",
    seeds: items.sort((left, right) => left.category < right.category ? -1 : left.category > right.category ? 1
      : left.subject.name < right.subject.name ? -1 : left.subject.name > right.subject.name ? 1
        : left.targetField < right.targetField ? -1 : left.targetField > right.targetField ? 1
          : left.id < right.id ? -1 : 1),
  };
}

function issue(task: EvidenceTaskSeed, overrides: Partial<EvidenceIssue> = {}): EvidenceIssue {
  return {
    number: 40,
    taskId: task.id,
    taskVersion: task.version,
    state: "open",
    labels: ["evidence-task", `evidence-task-${task.category}`, "two-minute-task"].sort(),
    authorLogin: "maintainer",
    authorAssociation: "MEMBER",
    createdAt: "2026-08-20T12:00:00Z",
    updatedAt: "2026-08-24T00:00:00Z",
    closedAt: null,
    evidenceUrls: [],
    acceptedContributors: [],
    acceptedEvidence: [],
    ...overrides,
  };
}

function issues(items: EvidenceIssue[]): EvidenceIssueSnapshot {
  return { schemaVersion: 1, fetchedAt: NOW, repo: REPO, issues: items.sort((left, right) => left.number - right.number) };
}

function ledger(items: EvidenceTaskLedgerEntry[] = []): EvidenceTaskLedgerArtifact {
  return { schemaVersion: 1, generatedAt: NOW, entries: items.sort((left, right) => left.taskId < right.taskId ? -1 : 1) };
}

function entry(task: EvidenceTaskSeed, overrides: Partial<EvidenceTaskLedgerEntry> = {}): EvidenceTaskLedgerEntry {
  return {
    taskId: task.id,
    taskVersion: task.version,
    category: task.category,
    subject: task.subject,
    targetField: task.targetField,
    materialVersion: task.materialVersion,
    supersedesTaskId: task.supersedesTaskId,
    issueNumber: 40,
    issueUrl: `https://github.com/${REPO}/issues/40`,
    state: "open",
    createdAt: "2026-08-20T12:00:00Z",
    updatedAt: "2026-08-24T00:00:00Z",
    lastActivityAt: "2026-08-24T00:00:00Z",
    closedAt: null,
    ...overrides,
  };
}

test("fills at most five WIP slots with category reservation then deterministic seed order", () => {
  const company1 = seed("company-funding", "1");
  const company2 = seed("company-funding", "2");
  const company3 = seed("company-funding", "3");
  const product1 = seed("product-deployment", "1");
  const product2 = seed("product-deployment", "2");
  const research1 = seed("research-metadata", "1");
  const research2 = seed("research-metadata", "2");
  const ordered = [company1, company2, company3, product1, product2, research1, research2];

  const result = planEvidenceIssueActions({ seeds: seeds(ordered), issues: issues([]), previousLedger: ledger(), now: NOW });
  const created = result.actions.filter((action) => action.action === "create");

  assert.deepEqual(created.map((action) => action.taskId), [company1.id, product1.id, research1.id, company2.id, company3.id]);
  assert.equal(result.ledger.entries.filter((item) => ["ready", "open", "contributed", "stale"].includes(item.state)).length, 5);
  assert.doesNotThrow(() => assertEvidenceTaskLedgerArtifact(result.ledger));
  assert.equal(JSON.stringify(result), JSON.stringify(planEvidenceIssueActions({ seeds: seeds(ordered), issues: issues([]), previousLedger: ledger(), now: NOW })));
});

test("counts open, contributed, and stale as WIP and never duplicates a stable task ID", () => {
  const existing = seed("company-funding", "existing");
  const candidates = [seed("company-funding", "2"), seed("product-deployment", "2"), seed("research-metadata", "2"), seed("research-metadata", "3")];
  const snapshot = issues([issue(existing, { evidenceUrls: ["https://evidence.example/item"], number: 41 })]);
  const previous = ledger([entry(existing, { issueNumber: 41, issueUrl: `https://github.com/${REPO}/issues/41` })]);

  const result = planEvidenceIssueActions({ seeds: seeds([existing, ...candidates]), issues: snapshot, previousLedger: previous, now: NOW, wipLimit: 3 });

  assert.equal(result.actions.filter((action) => action.action === "create").length, 2);
  assert.equal(result.actions.some((action) => action.action === "create" && action.taskId === existing.id), false);
  assert.equal(result.ledger.entries.find((item) => item.taskId === existing.id)?.state, "contributed");
  assert.equal(new Set(result.ledger.entries.map((item) => item.taskId)).size, result.ledger.entries.length);
});

test("counts prior ledger WIP conservatively when the current snapshot omits it", () => {
  const priorOpen = seed("company-funding", "prior-open");
  const candidates = [seed("product-deployment", "candidate"), seed("research-metadata", "candidate")];

  const result = planEvidenceIssueActions({
    seeds: seeds(candidates),
    issues: issues([]),
    previousLedger: ledger([entry(priorOpen)]),
    now: NOW,
    wipLimit: 2,
  });

  assert.equal(result.actions.filter((action) => action.action === "create").length, 1);
});

test("marks seven-day inactivity stale and closes fourteen-day inactivity", () => {
  const staleTask = seed("company-funding", "stale");
  const expiredTask = seed("product-deployment", "expired");
  const snapshot = issues([
    issue(staleTask, { number: 41, createdAt: "2026-08-17T12:00:00Z", updatedAt: "2026-08-17T12:00:00Z" }),
    issue(expiredTask, { number: 42, createdAt: "2026-08-10T12:00:00Z", updatedAt: "2026-08-10T12:00:00Z" }),
  ]);
  const previous = ledger([
    entry(staleTask, { issueNumber: 41, issueUrl: `https://github.com/${REPO}/issues/41`, createdAt: "2026-08-17T12:00:00Z", updatedAt: "2026-08-17T12:00:00Z", lastActivityAt: "2026-08-17T12:00:00Z" }),
    entry(expiredTask, { issueNumber: 42, issueUrl: `https://github.com/${REPO}/issues/42`, createdAt: "2026-08-10T12:00:00Z", updatedAt: "2026-08-10T12:00:00Z", lastActivityAt: "2026-08-10T12:00:00Z" }),
  ]);

  const result = planEvidenceIssueActions({ seeds: seeds([staleTask, expiredTask]), issues: snapshot, previousLedger: previous, now: NOW });

  assert.deepEqual(result.actions.slice(0, 2), [
    { action: "mark-stale", issueNumber: 41, taskId: staleTask.id },
    { action: "close", issueNumber: 42, taskId: expiredTask.id, reason: "inactive-14-days" },
  ]);
  assert.equal(result.ledger.entries.find((item) => item.taskId === staleTask.id)?.state, "stale");
  assert.equal(result.ledger.entries.find((item) => item.taskId === expiredTask.id)?.state, "closed");
});

test("a bot-applied stale label does not reset the fourteen-day inactivity clock", () => {
  const task = seed("company-funding", "stale-clock");
  const day0 = "2026-08-10T12:00:00Z";
  const day7 = "2026-08-17T12:00:00Z";
  const day7LabelApplied = "2026-08-17T18:00:00Z";
  const first = planEvidenceIssueActions({
    seeds: { ...seeds([task]), generatedAt: day7 },
    issues: { ...issues([issue(task, { number: 41, createdAt: day0, updatedAt: day0 })]), fetchedAt: day7 },
    previousLedger: { ...ledger([entry(task, { issueNumber: 41, issueUrl: `https://github.com/${REPO}/issues/41`, createdAt: day0, updatedAt: day0, lastActivityAt: day0 })]), generatedAt: day7 },
    now: day7,
  });
  assert.deepEqual(first.actions, [{ action: "mark-stale", issueNumber: 41, taskId: task.id }]);

  const second = planEvidenceIssueActions({
    seeds: seeds([task]),
    issues: issues([issue(task, { number: 41, createdAt: day0, updatedAt: day7LabelApplied, labels: ["evidence-task", "stale"] })]),
    previousLedger: first.ledger,
    now: NOW,
  });

  assert.deepEqual(second.actions, [{ action: "close", issueNumber: 41, taskId: task.id, reason: "inactive-14-days" }]);
});

test("genuine activity after stale resets the inactivity clock", () => {
  const task = seed("company-funding", "stale-new-activity");
  const day0 = "2026-08-10T12:00:00Z";
  const day7 = "2026-08-17T12:00:00Z";
  const contributionAt = "2026-08-17T12:02:00Z";
  const first = planEvidenceIssueActions({
    seeds: { ...seeds([task]), generatedAt: day7 },
    issues: { ...issues([issue(task, { number: 41, createdAt: day0, updatedAt: day0 })]), fetchedAt: day7 },
    previousLedger: { ...ledger([entry(task, { issueNumber: 41, issueUrl: `https://github.com/${REPO}/issues/41`, createdAt: day0, updatedAt: day0, lastActivityAt: day0 })]), generatedAt: day7 },
    now: day7,
  });

  const second = planEvidenceIssueActions({
    seeds: seeds([task]),
    issues: issues([issue(task, {
      number: 41,
      createdAt: day0,
      updatedAt: contributionAt,
      labels: ["evidence-task", "stale"],
      evidenceUrls: ["https://evidence.example/new"],
    })]),
    previousLedger: first.ledger,
    now: NOW,
  });

  assert.deepEqual(second.actions, []);
  assert.equal(second.ledger.entries.find((item) => item.taskId === task.id)?.lastActivityAt, contributionAt);
  assert.equal(second.ledger.entries.find((item) => item.taskId === task.id)?.state, "contributed");

  const third = planEvidenceIssueActions({
    seeds: seeds([task]),
    issues: issues([issue(task, {
      number: 41,
      createdAt: day0,
      updatedAt: contributionAt,
      labels: ["evidence-task", "stale"],
      evidenceUrls: ["https://evidence.example/new"],
    })]),
    previousLedger: second.ledger,
    now: NOW,
  });
  assert.equal(third.ledger.entries.find((item) => item.taskId === task.id)?.state, "contributed");
});

test("keeps accepted, rejected, and remotely closed history without consuming WIP", () => {
  const accepted = seed("company-funding", "accepted");
  const rejected = seed("product-deployment", "rejected");
  const closed = seed("research-metadata", "closed");
  const replacement = seed("research-metadata", "replacement");
  const snapshot = issues([
    issue(accepted, { number: 41, labels: ["accepted-evidence", "evidence-task"], evidenceUrls: ["https://evidence.example/accepted"] }),
    issue(rejected, { number: 42, labels: ["evidence-task", "rejected-evidence"] }),
    issue(closed, { number: 43, state: "closed", closedAt: "2026-08-23T12:00:00Z", updatedAt: "2026-08-23T12:00:00Z" }),
  ]);
  const previous = ledger([
    entry(accepted, { issueNumber: 41, issueUrl: `https://github.com/${REPO}/issues/41` }),
    entry(rejected, { issueNumber: 42, issueUrl: `https://github.com/${REPO}/issues/42` }),
    entry(closed, { issueNumber: 43, issueUrl: `https://github.com/${REPO}/issues/43` }),
  ]);

  const result = planEvidenceIssueActions({ seeds: seeds([accepted, rejected, closed, replacement]), issues: snapshot, previousLedger: previous, now: NOW, wipLimit: 1 });

  assert.deepEqual(result.actions.map((action) => action.action === "close" ? action.reason : action.action), ["accepted", "rejected", "create"]);
  assert.deepEqual(result.ledger.entries.filter((item) => [accepted.id, rejected.id, closed.id].includes(item.taskId)).map((item) => item.state).sort(), ["accepted", "closed", "rejected"]);
});

test("creates a versioned successor only for a changed material version and supersedes open history", () => {
  const oldTask = seed("company-funding", "old");
  const sameMaterial = seed("company-funding", "ignored", { subject: oldTask.subject, targetField: oldTask.targetField, materialVersion: oldTask.materialVersion });
  const successor = seed("company-funding", "successor", {
    subject: oldTask.subject,
    targetField: oldTask.targetField,
    materialVersion: "material-v2",
  });
  const snapshot = issues([issue(oldTask, { number: 41 })]);
  const previous = ledger([entry(oldTask, { issueNumber: 41, issueUrl: `https://github.com/${REPO}/issues/41` })]);

  const unchanged = planEvidenceIssueActions({ seeds: seeds([sameMaterial]), issues: snapshot, previousLedger: previous, now: NOW });
  assert.equal(unchanged.actions.some((action) => action.action === "create"), false);

  const changed = planEvidenceIssueActions({ seeds: seeds([successor]), issues: snapshot, previousLedger: previous, now: NOW });
  assert.deepEqual(changed.actions[0], { action: "close", issueNumber: 41, taskId: oldTask.id, reason: "superseded" });
  assert.equal(changed.actions[1]?.action, "create");
  assert.equal(changed.actions[1]?.taskId, successor.id);
  assert.equal(changed.ledger.entries.find((item) => item.taskId === oldTask.id)?.state, "superseded");
  assert.equal(changed.ledger.entries.find((item) => item.taskId === successor.id)?.taskVersion, 2);
});

test("a successor closes an older active variant even when a newer historical version is terminal", () => {
  const v1 = seed("company-funding", "identity-v1");
  const v2 = seed("company-funding", "identity-v2", {
    subject: v1.subject,
    targetField: v1.targetField,
    materialVersion: "identity-material-v2",
    version: 2,
    supersedesTaskId: v1.id,
  });
  const v3 = seed("company-funding", "identity-v3", {
    subject: v1.subject,
    targetField: v1.targetField,
    materialVersion: "identity-material-v3",
  });
  const previous = ledger([
    entry(v1, { issueNumber: 41, issueUrl: `https://github.com/${REPO}/issues/41` }),
    entry(v2, {
      issueNumber: 42,
      issueUrl: `https://github.com/${REPO}/issues/42`,
      state: "closed",
      closedAt: "2026-08-23T00:00:00Z",
      updatedAt: "2026-08-23T00:00:00Z",
      lastActivityAt: "2026-08-23T00:00:00Z",
    }),
  ]);

  const result = planEvidenceIssueActions({
    seeds: seeds([v3]),
    issues: issues([issue(v1, { number: 41 })]),
    previousLedger: previous,
    now: NOW,
  });

  assert.deepEqual(result.actions[0], { action: "close", issueNumber: 41, taskId: v1.id, reason: "superseded" });
  assert.equal(result.actions[1]?.action, "create");
  assert.equal(result.ledger.entries.find((item) => item.taskId === v1.id)?.state, "superseded");
  assert.equal(result.ledger.entries.find((item) => item.taskId === v3.id)?.taskVersion, 3);
  assert.equal(result.ledger.entries.filter((item) => ["ready", "open", "contributed", "stale"].includes(item.state)).length, 1);
});

test("fails closed when history contains multiple active variants for one subject and field", () => {
  const v1 = seed("company-funding", "duplicate-active-v1");
  const v2 = seed("company-funding", "duplicate-active-v2", {
    subject: v1.subject,
    targetField: v1.targetField,
    materialVersion: "duplicate-active-material-v2",
    version: 2,
    supersedesTaskId: v1.id,
  });

  assert.throws(() => planEvidenceIssueActions({
    seeds: seeds([]),
    issues: issues([]),
    previousLedger: ledger([entry(v1), entry(v2, { issueNumber: 42, issueUrl: `https://github.com/${REPO}/issues/42` })]),
    now: NOW,
  }), /multiple active variants/);
});

test("does not supersede an open task when no successor slot is available", () => {
  const oldTask = seed("company-funding", "old-no-slot");
  const successor = seed("company-funding", "new-no-slot", {
    subject: oldTask.subject,
    targetField: oldTask.targetField,
    materialVersion: "changed-material",
  });
  const result = planEvidenceIssueActions({
    seeds: seeds([successor]),
    issues: issues([issue(oldTask, { number: 41 })]),
    previousLedger: ledger([entry(oldTask, { issueNumber: 41, issueUrl: `https://github.com/${REPO}/issues/41` })]),
    now: NOW,
    wipLimit: 0,
  });

  assert.deepEqual(result.actions, []);
  assert.equal(result.ledger.entries.find((item) => item.taskId === oldTask.id)?.state, "open");
});

test("selects only one unfinished material variant for the same subject and field", () => {
  const first = seed("company-funding", "variant-a");
  const second = seed("company-funding", "variant-b", {
    subject: first.subject,
    targetField: first.targetField,
    materialVersion: "another-material-version",
  });

  const result = planEvidenceIssueActions({ seeds: seeds([first, second]), issues: issues([]), previousLedger: ledger(), now: NOW });

  assert.equal(result.actions.filter((action) => action.action === "create").length, 1);
});

test("rejects input whose existing WIP already exceeds the hard cap", () => {
  const oldTask = seed("company-funding", "over-cap-old");
  const successor = seed("company-funding", "over-cap-new", {
    subject: oldTask.subject,
    targetField: oldTask.targetField,
    materialVersion: "over-cap-changed-material",
  });
  const otherTasks = [
    seed("company-funding", "over-cap-2"),
    seed("company-funding", "over-cap-3"),
    seed("product-deployment", "over-cap-1"),
    seed("product-deployment", "over-cap-2"),
    seed("research-metadata", "over-cap-1"),
  ];
  const priorEntries = [oldTask, ...otherTasks].map((task, index) => entry(task, {
    issueNumber: 50 + index,
    issueUrl: `https://github.com/${REPO}/issues/${50 + index}`,
  }));

  assert.throws(() => planEvidenceIssueActions({
    seeds: seeds([successor]),
    issues: issues([]),
    previousLedger: ledger(priorEntries),
    now: NOW,
  }), /WIP hard cap of 5/);
});

test("formats a safe one-field two-minute Issue body with reconciliation markers", () => {
  const task = seed("company-funding", "body");
  const result = planEvidenceIssueActions({ seeds: seeds([task]), issues: issues([]), previousLedger: ledger(), now: NOW });
  const action = result.actions[0];
  assert.equal(action?.action, "create");
  if (action?.action !== "create") return;

  assert.match(action.title, /Alpha Robotics body/);
  assert.match(action.body, new RegExp(`<!-- evidence-task-id:${task.id} -->`));
  assert.match(action.body, /<!-- evidence-task-version:1 -->/);
  assert.match(action.body, /预计 2 分钟/);
  assert.match(action.body, /待补字段：`funding\.amount`/);
  assert.match(action.body, /证据链接：/);
  assert.deepEqual(action.labels, ["evidence-task", "evidence-task-company-funding", "two-minute-task"]);
  assert.doesNotMatch(action.body, /candidate.?id|seed.?id|score|rank|prompt|token|secret|raw.?model/i);
  assert.equal((action.body.match(/待补字段：/g) ?? []).length, 1);
});

test("JSON CLI validates inputs and writes byte-stable exact JSON", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidence-task-ledger-"));
  const task = seed("company-funding", "cli");
  const paths = {
    seeds: join(root, "seeds.json"),
    issues: join(root, "issues.json"),
    ledger: join(root, "ledger.json"),
    first: join(root, "first.json"),
    second: join(root, "second.json"),
  };
  await Promise.all([
    writeFile(paths.seeds, JSON.stringify(seeds([task])), "utf8"),
    writeFile(paths.issues, JSON.stringify(issues([])), "utf8"),
    writeFile(paths.ledger, JSON.stringify(ledger()), "utf8"),
  ]);
  const command = ["--import", "tsx", "src/community-evidence/plan-issue-actions.ts"];
  const validFlags = ["--seeds", paths.seeds, "--issues", paths.issues, "--ledger", paths.ledger, "--now", NOW, "--out"];
  const run = (flags: string[]) => spawnSync(process.execPath, [...command, ...flags], { cwd: process.cwd(), encoding: "utf8" });
  const first = run([...validFlags, paths.first]);
  const second = run([...validFlags, paths.second]);

  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(first.stdout, "");
  assert.equal(second.stdout, "");
  assert.equal(await readFile(paths.first, "utf8"), await readFile(paths.second, "utf8"));
  const output = JSON.parse(await readFile(paths.first, "utf8")) as Record<string, unknown>;
  assert.deepEqual(Object.keys(output), ["actions", "ledger"]);

  await writeFile(paths.ledger, JSON.stringify({ ...ledger(), privateScore: 9 }), "utf8");
  const invalid = run([...validFlags, paths.first]);
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /Invalid community evidence contract/);

  await writeFile(paths.ledger, JSON.stringify(ledger()), "utf8");
  const malformedFlags = [
    [...validFlags, paths.first, "--unknown", "value"],
    [...validFlags, paths.first, "--now", NOW],
    validFlags.slice(0, -1),
    [...validFlags.slice(0, -1), "--out"],
    [...validFlags.slice(0, 7), "not-a-time", ...validFlags.slice(8), paths.first],
  ];
  for (const flags of malformedFlags) {
    const malformed = run(flags);
    assert.notEqual(malformed.status, 0, flags.join(" "));
  }
});
