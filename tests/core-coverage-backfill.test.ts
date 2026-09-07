import assert from "node:assert/strict";
import test from "node:test";
import {
  backfillTasksToReviewCaseSeeds,
  buildActiveBackfillQueue,
  buildBackfillReviewCaseSeeds,
  buildBackfillTasks,
  reopenCheckedBackfillTasks,
  selectInitialBackfillCompanyIds,
  type BackfillTask,
} from "../src/core-coverage/backfill.js";
import type { CoverageMember, CoverageVersion } from "../src/core-coverage/contracts.js";
import { applyReviewCaseActions, upsertReviewCases } from "../src/review-cases.js";
import { assignReviewCases } from "../src/review-assignment.js";

const NOW = new Date("2026-09-06T00:00:00.000Z");

function member(companyId: string, coverageRegion: CoverageMember["coverageRegion"], tier: CoverageMember["tier"]): CoverageMember {
  return { companyId, coverageRegion, tier, reasonZh: `覆盖 ${companyId}`, ownerRole: "maintainer" };
}

function coverage(members: CoverageMember[]): CoverageVersion {
  return { schemaVersion: 1, version: "2026-Q3", effectiveFrom: "2026-09-06", previousVersion: null, changeReasonZh: "fixture", members };
}

const MEMBERS = Array.from({ length: 30 }, (_, index) => {
  const regions = ["china", "north-america", "other"] as const;
  const tiers = ["commercial", "platform", "strategic"] as const;
  return member(`company-${String(index + 1).padStart(2, "0")}`, regions[index % 3]!, tiers[Math.floor(index / 3) % 3]!);
});

test("builds 120 stable field tasks and preserves prior dispositions without inventing checked work", () => {
  const first = buildBackfillTasks(coverage(MEMBERS), [], NOW);
  assert.equal(first.length, 120);
  assert.equal(new Set(first.map((item) => item.taskId)).size, 120);
  assert.ok(first.every((item) => item.status === "pending" && item.reason === "none" && item.evidenceUrls.length === 0));
  assert.deepEqual(new Set(first.map((item) => item.field)), new Set(["identity", "capital", "product", "deployment"]));

  const handled: BackfillTask[] = first.map((item, index) => index === 0
    ? { ...item, status: "checked", evidenceUrls: [" https://example.com/proof ", "https://example.com/proof"], lastActionAt: "2026-09-06T02:00:00Z" }
    : index === 1 ? { ...item, status: "blocked", reason: "rate-limited", lastActionAt: "2026-09-06T03:00:00Z" } : item);
  const rerun = buildBackfillTasks(coverage(MEMBERS), handled, new Date("2026-09-08T00:00:00Z"));
  assert.equal(rerun[0]!.taskId, first[0]!.taskId);
  assert.equal(rerun[0]!.firstSeenAt, first[0]!.firstSeenAt);
  assert.equal(rerun[0]!.status, "checked");
  assert.deepEqual(rerun[0]!.evidenceUrls, ["https://example.com/proof"]);
  assert.equal(rerun[1]!.status, "blocked");
  assert.equal(rerun[1]!.reason, "rate-limited");
});

test("selects the first 10 companies with region and tier interleaving", () => {
  const selected = selectInitialBackfillCompanyIds(coverage(MEMBERS), 10);
  assert.equal(selected.length, 10);
  const selectedMembers = selected.map((id) => MEMBERS.find((item) => item.companyId === id)!);
  assert.deepEqual(selectedMembers.slice(0, 9).map((item) => `${item.coverageRegion}/${item.tier}`), [
    "china/commercial", "north-america/commercial", "other/commercial",
    "china/platform", "north-america/platform", "other/platform",
    "china/strategic", "north-america/strategic", "other/strategic",
  ]);
});

test("bounds the active queue at 20 and prioritizes public errors and retractions", () => {
  const tasks = buildBackfillTasks(coverage(MEMBERS.slice(0, 10)), [], NOW);
  const queue = buildActiveBackfillQueue(tasks, [
    { taskId: tasks[30]!.taskId, kind: "new-finding" },
    { taskId: tasks[31]!.taskId, kind: "retraction" },
    { taskId: tasks[32]!.taskId, kind: "public-error" },
  ]);
  assert.equal(queue.length, 20);
  assert.deepEqual(queue.slice(0, 3).map((item) => item.taskId), [tasks[32]!.taskId, tasks[31]!.taskId, tasks[30]!.taskId]);
  assert.ok(queue.every((item) => item.status !== "checked"));
});

test("duplicate priority signals retain the highest urgency regardless of input order", () => {
  const tasks = buildBackfillTasks(coverage(MEMBERS.slice(0, 10)), [], NOW);
  const signals = [
    { taskId: tasks[31]!.taskId, kind: "public-error" as const },
    { taskId: tasks[31]!.taskId, kind: "new-finding" as const },
    { taskId: tasks[32]!.taskId, kind: "retraction" as const },
  ];
  const forward = buildActiveBackfillQueue(tasks, signals);
  const reversed = buildActiveBackfillQueue(tasks, [...signals].reverse());
  assert.deepEqual(forward.map((item) => item.taskId), reversed.map((item) => item.taskId));
  assert.deepEqual(forward.slice(0, 2).map((item) => item.taskId), [tasks[31]!.taskId, tasks[32]!.taskId]);
});

test("composes the mixed first-10 cohort and bounded active queue into ReviewCase seeds", () => {
  const version = coverage(MEMBERS);
  const tasks = buildBackfillTasks(version, [], NOW);
  const firstTen = new Set(selectInitialBackfillCompanyIds(version, 10));
  const seeds = buildBackfillReviewCaseSeeds(version, tasks, [{ taskId: tasks.at(-1)!.taskId, kind: "new-finding" }]);
  assert.equal(seeds.length, 20);
  const taskById = new Map(tasks.map((task) => [task.taskId, task]));
  assert.ok(seeds.every((seed) => firstTen.has(taskById.get(seed.subjectId)!.companyId)));
  assert.ok(seeds.every((seed) => seed.type === "company" && seed.priority === "P2"));
  assert.ok(!seeds.some((seed) => seed.subjectId === tasks.at(-1)!.taskId), "signals outside the active cohort must not bypass batching");
});

test("global public errors and retractions preempt ordinary cohort gaps", () => {
  const version = coverage(MEMBERS);
  const tasks = buildBackfillTasks(version, [], NOW);
  const outside = tasks.at(-1)!;
  const seeds = buildBackfillReviewCaseSeeds(version, tasks, [{ taskId: outside.taskId, kind: "public-error" }]);
  assert.equal(seeds.length, 20);
  assert.equal(seeds[0]!.subjectId, outside.taskId);
});

test("new urgent corrections reopen only affected checked tasks once, preserving dispositions and the 20-task bound", () => {
  const version = coverage(MEMBERS);
  const tasks = buildBackfillTasks(version, [], NOW).map((task): BackfillTask => ({ ...task, status: "checked", evidenceUrls: ["https://example.com/proof"], lastActionAt: NOW.toISOString() }));
  const signals = tasks.slice(0, 25).map((task, index) => ({ taskId: task.taskId, kind: index === 0 ? "public-error" as const : "retraction" as const, signalId: `correction-${index}` }));
  const reopened = reopenCheckedBackfillTasks(tasks, signals, new Date("2026-09-07T00:00:00Z"));
  assert.equal(reopened.filter((task) => task.status === "pending").length, 25);
  assert.deepEqual(reopened.slice(25), tasks.slice(25));
  assert.equal(reopened[0].firstSeenAt, tasks[0].firstSeenAt);
  assert.deepEqual(reopened[0].dispositionHistory?.[0], { status: "checked", reason: "none", evidenceUrls: ["https://example.com/proof"], lastActionAt: NOW.toISOString(), reopenedAt: "2026-09-07T00:00:00.000Z", signals: [signals[0]] });
  assert.equal(buildBackfillReviewCaseSeeds(version, reopened, signals).length, 20);
  const handled = buildBackfillTasks(version, reopened.map((task) => ({ ...task, status: "checked" })), new Date("2026-09-08T00:00:00Z"));
  assert.deepEqual(reopenCheckedBackfillTasks(handled, signals, new Date("2026-09-08T00:00:00Z")), handled, "old correction IDs cannot reopen adjudicated work");
  assert.equal(reopenCheckedBackfillTasks(handled, [{ ...signals[0], signalId: "new-correction" }], new Date("2026-09-08T00:00:00Z"))[0].dispositionHistory?.length, 2);
  assert.deepEqual(reopenCheckedBackfillTasks(handled, [{ ...signals[0], kind: "new-finding" }], NOW), handled);
});

test("advances to the next interleaved unfinished-company cohort", () => {
  const version = coverage(MEMBERS);
  const tasks = buildBackfillTasks(version, [], NOW);
  const firstTen = new Set(selectInitialBackfillCompanyIds(version, 10));
  const checkpoint = tasks.map((task): BackfillTask => firstTen.has(task.companyId)
    ? { ...task, status: "checked", lastActionAt: "2026-09-07T00:00:00Z" }
    : task);
  const seeds = buildBackfillReviewCaseSeeds(version, checkpoint);
  const taskById = new Map(checkpoint.map((task) => [task.taskId, task]));
  assert.equal(seeds.length, 20);
  assert.ok(seeds.every((seed) => !firstTen.has(taskById.get(seed.subjectId)!.companyId)));
});

test("blocked first cohort yields active slots to later pending work while explicit new evidence revives triage", () => {
  const version = coverage(MEMBERS);
  const firstTen = new Set(selectInitialBackfillCompanyIds(version, 10));
  const tasks = buildBackfillTasks(version, [], NOW).map((task): BackfillTask => firstTen.has(task.companyId) ? { ...task, status: "blocked", reason: "missing-evidence" } : task);
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  const seeds = buildBackfillReviewCaseSeeds(version, tasks);
  assert.equal(seeds.length, 20);
  assert.ok(seeds.every((seed) => !firstTen.has(byId.get(seed.subjectId)!.companyId)));
  const blocked = tasks.find((task) => task.status === "blocked")!;
  const resumed = buildBackfillReviewCaseSeeds(version, tasks, [{ taskId: blocked.taskId, kind: "new-finding" }]);
  assert.equal(resumed[0].subjectId, blocked.taskId);
  assert.equal(blocked.status, "blocked");
  assert.equal(tasks.filter((task) => task.status === "blocked").length, 40);
});

test("adapts tasks into existing ReviewCase and assignment capacity with a 72h first-action SLO", () => {
  const tasks = buildBackfillTasks(coverage(MEMBERS.slice(0, 3)), [], NOW);
  const seeds = backfillTasksToReviewCaseSeeds(tasks.slice(0, 3));
  const cases = upsertReviewCases([], seeds, NOW);
  assert.ok(cases.every((item) => item.type === "company" && item.priority === "P2"));
  assert.ok(cases.every((item) => item.dueAt === "2026-09-09T00:00:00.000Z"));

  const assignments = assignReviewCases(cases, [{ ownerId: "reviewer", maxActiveCases: 1 }], [], NOW);
  assert.equal(assignments.filter((item) => item.status === "assigned").length, 1);
  assert.equal(assignments.filter((item) => item.status === "unassigned" && item.reason === "capacity-exhausted").length, 2);

  const acted = applyReviewCaseActions(cases, [{ caseId: cases[0]!.caseId, action: "probe", at: "2026-09-07T00:00:00Z" }]);
  const rerun = upsertReviewCases(acted, seeds, new Date("2026-09-08T00:00:00Z"));
  assert.equal(rerun.find((item) => item.caseId === cases[0]!.caseId)!.firstActionAt, "2026-09-07T00:00:00.000Z");
  assert.ok(rerun.slice(1).every((item) => item.firstActionAt === null));
});

test("a blocked task stays blocked across resume runs and duplicate URLs are normalized", () => {
  const [created] = buildBackfillTasks(coverage(MEMBERS.slice(0, 1)), [], NOW);
  const blocked: BackfillTask = {
    ...created!, status: "blocked", reason: "unavailable", evidenceUrls: ["https://example.com/a", " https://example.com/a ", "https://example.com/b"], lastActionAt: "2026-09-06T04:00:00Z",
  };
  const [resumed] = buildBackfillTasks(coverage(MEMBERS.slice(0, 1)), [blocked], new Date("2026-09-07T00:00:00Z"));
  assert.equal(resumed!.status, "blocked");
  assert.equal(resumed!.lastActionAt, "2026-09-06T04:00:00.000Z");
  assert.deepEqual(resumed!.evidenceUrls, ["https://example.com/a", "https://example.com/b"]);
});
