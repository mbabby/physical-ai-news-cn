import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildCompanyClaimLedger } from "../src/company-claim-ledger.js";
import { buildCoreCoverageArtifact, buildCoreCoverageHistory, coreCoverageReviewSeeds, validateCoreCoverageArtifact, validateCoreCoveragePublication, validateCoreCoverageRelease, loadCoreCoverageState, stageCoreCoverage } from "../src/core-coverage/materialize.js";
import { buildBackfillTasks } from "../src/core-coverage/backfill.js";
import { generate } from "../src/main.js";
import { validateRelease } from "../src/validate-release.js";
import { FileTransaction } from "../src/runtime/storage.js";
import { buildReviewCaseArtifact, compareCases, serializeReviewCaseArtifact } from "../src/review-cases.js";
import { buildReviewAssignmentArtifact } from "../src/review-assignment.js";
import type { CompanyProfile, DigestResult } from "../src/types.js";
import type { CoverageVersion } from "../src/core-coverage/contracts.js";
import { company, event, NOW } from "./core-coverage-fixtures.js";
import { resetPublicationFixture } from "./publication-fixture.js";
import { assertCoreResearchPublished, seedCoreResearchFixture } from "./core-research-fixture.js";

function inputs() {
  const companies: CompanyProfile[] = Array.from({ length: 30 }, (_, index) => index === 0 ? company : { ...company, entityId: `subject-${index}`, name: `Subject ${index}`, profileEvidence: [] });
  const coverage: CoverageVersion = { schemaVersion: 1, version: "2026-Q3", effectiveFrom: "2026-09-01", previousVersion: null, changeReasonZh: "研究覆盖", members: companies.map((profile, index) => ({ companyId: profile.entityId!, coverageRegion: index < 12 ? "china" : index < 24 ? "north-america" : "other", tier: index < 22 ? "commercial" : index < 27 ? "platform" : "strategic", reasonZh: "跟踪机器人验证", ownerRole: "maintainer" })) };
  const events = [event()];
  return { companies, coverage, events, now: NOW, ledger: buildCompanyClaimLedger(companies, events, { now: NOW, coverageCompanyIds: companies.map((profile) => profile.entityId!) }) };
}

test("Core artifact has all 30 subjects, exact identity metrics and no private ownership", () => {
  const input = inputs();
  const artifact = buildCoreCoverageArtifact(input);
  assert.equal(artifact.briefs.length, 30);
  assert.deepEqual(artifact.windows, { backfillStart: "2025-09-06", currentStart: "2026-06-09", through: "2026-09-06" });
  assert.deepEqual(artifact.metrics, { coveredSubjects: 1, completeBriefs: 1, coverageRatio: 1 / 30 });
  assert.deepEqual(artifact.subjects[0], { companyId: "alpha", name: "Alpha Robotics", routes: [], entityType: "公司", officialUrl: "https://alpha.example" });
  assert.equal(JSON.stringify(artifact).includes("ownerRole"), false);
  assert.deepEqual(buildCoreCoverageArtifact(input), artifact);
});

test("strict artifact rejects duplicates, wrong metrics, internal fields and broken dependency bindings", () => {
  const original = buildCoreCoverageArtifact(inputs());
  const mutations = [
    (a: any) => a.briefs.push(a.briefs[0]),
    (a: any) => a.metrics.coveredSubjects = 30,
    (a: any) => a.metrics.completeBriefs = 30,
    (a: any) => a.metrics.coverageRatio = 1,
    (a: any) => a.coverage.members[0].ownerRole = "maintainer",
    (a: any) => a.briefs[0].knownFacts[0].fields.product.privatePrompt = "secret",
    (a: any) => a.briefs[0].analyses[0].claimIds = ["unrelated-claim"],
    (a: any) => a.briefs[0].analyses[0].evidenceIds = ["unrelated-evidence"],
    (a: any) => a.briefs[0].knownFacts[0].companyId = "subject-1",
    (a: any) => a.briefs[0].knownFacts[0].fields.product.value = { privatePrompt: "secret" },
  ];
  for (const mutate of mutations) { const artifact = structuredClone(original); mutate(artifact); assert.throws(() => validateCoreCoverageArtifact(artifact)); }
});

test("canonical publication rejects stale withdrawn facts and preserves append-only corrections", () => {
  const input = inputs();
  const previous = buildCoreCoverageArtifact(input);
  const previousHistory = buildCoreCoverageHistory(previous);
  const events = input.events.map((record) => ({ ...record, evidence: record.evidence.map((proof) => ({ ...proof, withdrawn: true })) }));
  const currentInput = { ...input, events, ledger: buildCompanyClaimLedger(input.companies, events, { now: NOW, coverageCompanyIds: input.companies.map((profile) => profile.entityId!) }) };
  assert.throws(() => validateCoreCoveragePublication(previous, currentInput));
  const current = buildCoreCoverageArtifact(currentInput);
  assert.equal(current.briefs[0].analyses.length, 0);
  const history = buildCoreCoverageHistory(current, previousHistory);
  assert.ok(history.corrections.some((change) => change.reason === "source-withdrawn"));
  assert.deepEqual(history.snapshots[0], previous);
  assert.deepEqual(buildCoreCoverageHistory(current, history), history);
});

test("public conflicts reopen only the checked task owning the changed field and do not replay old issues", () => {
  const input = inputs();
  const previous = buildCoreCoverageArtifact(input);
  const current = structuredClone(previous);
  const fact = current.briefs[0].knownFacts[0];
  current.briefs[0].reviewIssues = [{ claimId: fact.claimId, reason: "conflict", fieldPath: "product" }];
  delete fact.fields.product;
  const state = { coverage: input.coverage, tasks: buildBackfillTasks(input.coverage, [], NOW).map((task) => ({ ...task, status: "checked" as const, lastActionAt: NOW.toISOString() })), archivedTasks: [], previousArtifact: previous };
  const seeds = coreCoverageReviewSeeds(state, current);
  assert.equal(seeds.length, 1);
  const target = state.tasks.find((task) => task.companyId === "alpha" && task.field === "product")!;
  assert.equal(seeds[0].subjectId, target.taskId);
  assert.equal(target.status, "pending");
  assert.equal(state.tasks.filter((task) => task.status === "checked").length, 119);
  target.status = "checked";
  state.previousArtifact = current;
  assert.deepEqual(coreCoverageReviewSeeds(state, current), []);
});

test("lab research facts remain publishable without inheriting parent funding", () => {
  const input = inputs(); input.companies[0] = { ...company, entityType: "实验室" };
  input.events = [event("product", { type: "研究与数据" })];
  input.ledger = buildCompanyClaimLedger(input.companies, input.events, { now: NOW, coverageCompanyIds: input.companies.map((profile) => profile.entityId!) });
  const artifact = buildCoreCoverageArtifact(input);
  assert.equal(artifact.briefs[0].knownFacts[0].claimType, "research-team");
  assert.equal(artifact.metrics.completeBriefs, 1);
});

test("quarterly editorial removal preserves prior facts without falsely claiming evidence withdrawal", () => {
  const input = inputs();
  const previous = buildCoreCoverageHistory(buildCoreCoverageArtifact(input));
  const now = new Date("2026-10-01T01:00:00Z");
  const replacement = { ...company, entityId: "replacement", name: "Replacement", profileEvidence: [] };
  const coverage: CoverageVersion = { ...input.coverage, version: "2026-Q4", previousVersion: input.coverage.version, effectiveFrom: "2026-10-01", members: input.coverage.members.map((member, index) => index ? member : { ...member, companyId: "replacement" }) };
  const artifact = buildCoreCoverageArtifact({ ...input, now, coverage, companies: [...input.companies, replacement], ledger: { ...input.ledger, generatedAt: now.toISOString() } });
  const history = buildCoreCoverageHistory(artifact, previous);
  assert.equal(history.corrections.length, 0);
  assert.equal(history.snapshots[0].briefs[0].knownFacts.length, 1);
});

test("Core state rejects malformed JSON and incomplete public groups; future config stays disabled", async () => {
  const root = await mkdtemp(join(tmpdir(), "core-state-"));
  const input = inputs();
  try {
    await mkdir(join(root, "config"));
    await writeFile(join(root, "config/core-coverage.json"), "{bad");
    await assert.rejects(() => loadCoreCoverageState(root, input.companies, NOW));
    await writeFile(join(root, "config/core-coverage.json"), JSON.stringify({ ...input.coverage, effectiveFrom: "2027-01-01" }));
    assert.equal(await loadCoreCoverageState(root, input.companies, NOW), undefined);
    await writeFile(join(root, "config/core-coverage.json"), JSON.stringify(input.coverage));
    await mkdir(join(root, "site/data"), { recursive: true });
    await writeFile(join(root, "site/data/core-coverage.json"), JSON.stringify(buildCoreCoverageArtifact(input)));
    await assert.rejects(() => loadCoreCoverageState(root, input.companies, NOW), /完整|group|配套/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

const falsyJson = [null, false, 0, ""];
const coreGroupPaths = ["site/data/core-coverage.json", "events/core-coverage-history.json", "site/data/core-coverage-history.json", "review/core30-backfill.json"];

for (const value of falsyJson) {
  test(`present falsy config ${JSON.stringify(value)} fails closed without overwriting the Core group`, async () => {
    const root = await mkdtemp(join(tmpdir(), "core-falsy-config-")); const input = inputs();
    try {
      await mkdir(join(root, "config")); await writeFile(join(root, "config/core-coverage.json"), JSON.stringify(input.coverage));
      const state = (await loadCoreCoverageState(root, input.companies, NOW))!;
      const tx = new FileTransaction(); stageCoreCoverage({ root, transaction: tx, artifact: buildCoreCoverageArtifact(input), state }); await tx.commit();
      const before = await Promise.all(coreGroupPaths.map((path) => readFile(join(root, path), "utf8")));
      await writeFile(join(root, "config/core-coverage.json"), JSON.stringify(value));
      await assert.rejects(() => loadCoreCoverageState(root, input.companies, NOW));
      assert.deepEqual(await Promise.all(coreGroupPaths.map((path) => readFile(join(root, path), "utf8"))), before);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  for (const path of [...coreGroupPaths, "all"]) {
    test(`active present falsy ${JSON.stringify(value)} at ${path} is corruption, not first publication`, async () => {
      const root = await mkdtemp(join(tmpdir(), "core-falsy-active-")); const input = inputs();
      try {
        await mkdir(join(root, "config")); await writeFile(join(root, "config/core-coverage.json"), JSON.stringify(input.coverage));
        const paths = path === "all" ? coreGroupPaths : [path];
        for (const target of paths) { await mkdir(join(root, target, ".."), { recursive: true }); await writeFile(join(root, target), JSON.stringify(value)); }
        await assert.rejects(async () => {
          const state = await loadCoreCoverageState(root, input.companies, NOW);
          assert.ok(state, "an active config cannot silently disable publication");
          const tx = new FileTransaction(); stageCoreCoverage({ root, transaction: tx, artifact: buildCoreCoverageArtifact(input), state }); await tx.commit();
        });
        for (const target of paths) assert.equal(await readFile(join(root, target), "utf8"), JSON.stringify(value));
      } finally { await rm(root, { recursive: true, force: true }); }
    });
  }

  for (const path of coreGroupPaths.slice(0, 3)) {
    test(`disabled release rejects the existing primitive ${JSON.stringify(value)} at ${path}`, async () => {
      const root = await mkdtemp(join(tmpdir(), "core-falsy-disabled-")); const input = inputs();
      try {
        await mkdir(join(root, path, ".."), { recursive: true }); await writeFile(join(root, path), JSON.stringify(value));
        await assert.rejects(() => validateCoreCoverageRelease(root, input.companies, input.events, input.ledger, NOW));
        assert.equal(await readFile(join(root, path), "utf8"), JSON.stringify(value));
      } finally { await rm(root, { recursive: true, force: true }); }
    });
  }
}

test("review source priority survives artifact sorting and owner capacity without changing legacy defaults", () => {
  const cases = buildReviewCaseArtifact(undefined, [{ id: "core", generate: () => [
    { type: "company", subjectId: "later", priority: "P2", sourcePriority: 0 },
    { type: "company", subjectId: "urgent", priority: "P2", sourcePriority: 19 },
  ] }], NOW);
  assert.equal(JSON.parse(serializeReviewCaseArtifact(cases)).cases[0].subjectId, "later");
  const assignments = buildReviewAssignmentArtifact(cases.cases, [{ ownerId: "maintainer", maxActiveCases: 1 }], undefined, NOW);
  assert.equal(assignments.assignments.find((item) => item.owner === "maintainer")?.caseId, cases.cases.find((item) => item.subjectId === "later")!.caseId);
  assert.throws(() => buildReviewCaseArtifact(undefined, [{ id: "bad", generate: () => [{ type: "company", subjectId: "bad", sourcePriority: -1 }] }], NOW));
  const corrupted = structuredClone(cases); corrupted.cases[0].sourcePriority = 20;
  assert.throws(() => buildReviewCaseArtifact(corrupted, [], NOW));
});

test("mixed legacy and ranked Core cases have a consistent total order", () => {
  const cases = buildReviewCaseArtifact(undefined, [{ id: "mixed", generate: () => [
    { type: "company", subjectId: "core-first", priority: "P2", sourcePriority: 0, createdAt: "2026-09-06T00:00:00Z" },
    { type: "company", subjectId: "core-second", priority: "P2", sourcePriority: 1, createdAt: "2026-09-04T00:00:00Z" },
    { type: "company", subjectId: "legacy", priority: "P2", createdAt: "2026-09-05T00:00:00Z" },
  ] }], NOW);
  assert.deepEqual(cases.cases.map((item) => item.subjectId), ["legacy", "core-first", "core-second"]);
  assert.ok(compareCases(cases.cases[0], cases.cases[2]) < 0);
});

test("quarter rollover preserves old versions and all 120 checkpoint dispositions", async () => {
  const root = await mkdtemp(join(tmpdir(), "core-quarter-")); const input = inputs();
  try {
    await mkdir(join(root, "config")); await writeFile(join(root, "config/core-coverage.json"), JSON.stringify(input.coverage));
    const state = (await loadCoreCoverageState(root, input.companies, NOW))!;
    state.tasks[0].status = "blocked"; state.tasks[0].reason = "unavailable";
    const tx = new FileTransaction(); stageCoreCoverage({ root, transaction: tx, artifact: buildCoreCoverageArtifact(input), state }); await tx.commit();
    const now = new Date("2026-10-01T01:00:00Z");
    const coverage = { ...input.coverage, version: "2026-Q4", previousVersion: input.coverage.version, effectiveFrom: "2026-10-01" };
    await writeFile(join(root, "config/core-coverage.json"), JSON.stringify(coverage));
    const next = (await loadCoreCoverageState(root, input.companies, now))!;
    assert.equal(next.tasks.length, 120); assert.equal(next.archivedTasks.length, 120); assert.equal(next.archivedTasks[0].reason, "unavailable");
    const artifact = buildCoreCoverageArtifact({ ...input, coverage, now, ledger: { ...input.ledger, generatedAt: now.toISOString() } });
    const second = new FileTransaction(); stageCoreCoverage({ root, transaction: second, artifact, state: next }); await second.commit();
    await validateCoreCoverageRelease(root, input.companies, input.events, { ...input.ledger, generatedAt: now.toISOString() }, now);
    const history = JSON.parse(await readFile(join(root, "events/core-coverage-history.json"), "utf8"));
    assert.deepEqual(history.versions.map((version: any) => version.version), ["2026-Q3", "2026-Q4"]);
    await rm(join(root, "config/core-coverage.json"));
    assert.equal(await loadCoreCoverageState(root, input.companies, now), undefined);
    await assert.rejects(() => validateCoreCoverageRelease(root, input.companies, input.events, input.ledger, now), /未启用/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Core group uses FileTransaction rollback and preserves raw checkpoint dispositions", async () => {
  const root = await mkdtemp(join(tmpdir(), "core-transaction-"));
  const input = inputs();
  try {
    await mkdir(join(root, "config")); await mkdir(join(root, "review"));
    await writeFile(join(root, "config/core-coverage.json"), JSON.stringify(input.coverage));
    const tasks = buildBackfillTasks(input.coverage, [], NOW);
    tasks[0] = { ...tasks[0], status: "checked", reason: "none", evidenceUrls: ["https://alpha.example/about"], lastActionAt: NOW.toISOString() };
    tasks[1] = { ...tasks[1], status: "blocked", reason: "rate-limited", lastActionAt: NOW.toISOString() };
    await writeFile(join(root, "review/core30-backfill.json"), JSON.stringify(tasks));
    const state = (await loadCoreCoverageState(root, input.companies, NOW))!;
    assert.deepEqual(state.tasks, tasks);
    const artifact = buildCoreCoverageArtifact(input);
    const tx = new FileTransaction();
    stageCoreCoverage({ root, transaction: tx, artifact, state }); await tx.commit();
    const paths = ["site/data/core-coverage.json", "events/core-coverage-history.json", "review/core30-backfill.json", "site/data/core-coverage-history.json"];
    const before = await Promise.all(paths.map((path) => readFile(join(root, path), "utf8")));
    const publicHistory = JSON.parse(before[3]);
    assert.deepEqual(Object.keys(publicHistory).sort(), ["corrections", "generatedAt", "schemaVersion", "versions"]);
    assert.equal(publicHistory.generatedAt, artifact.generatedAt);
    const failed = new FileTransaction("core-failure", { failAfterPath: join(root, "site/data/core-coverage.json") });
    stageCoreCoverage({ root, transaction: failed, artifact: buildCoreCoverageArtifact({ ...input, now: new Date("2026-09-07T01:00:00Z"), ledger: { ...input.ledger, generatedAt: "2026-09-07T01:00:00.000Z" } }), state });
    await assert.rejects(() => failed.commit());
    assert.deepEqual(await Promise.all(paths.map((path) => readFile(join(root, path), "utf8"))), before);
    const checkpoint = JSON.parse(before[2]);
    const wrong = structuredClone(checkpoint);
    wrong.tasks[0].companyId = "unknown-subject";
    const { backfillTaskId } = await import("../src/core-coverage/backfill.js");
    wrong.tasks[0].taskId = backfillTaskId(input.coverage.version, "unknown-subject", wrong.tasks[0].field);
    await writeFile(join(root, paths[2]), JSON.stringify(wrong));
    await assert.rejects(() => loadCoreCoverageState(root, input.companies, NOW));
    await writeFile(join(root, paths[2]), before[2]);
    await rm(join(root, paths[0])); await rm(join(root, paths[1]));
    await assert.rejects(() => loadCoreCoverageState(root, input.companies, NOW), /完整|配套/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

const empty = async (): Promise<DigestResult> => ({ articles: [], failures: [], sourceOutcomes: [] });
test("main publishes Core group, retains legacy facts and assigns bounded P2 tasks through existing owners", async () => {
  const root = await mkdtemp(join(tmpdir(), "core-main-"));
  const repositoryRoot = new URL("../", import.meta.url).pathname;
  const keys = ["LLM_API_KEY", "OPENALEX_API_KEY", "GITHUB_TOKEN", "GITHUB_REPOSITORY"];
  const saved = keys.map((key) => process.env[key]); keys.forEach((key) => delete process.env[key]);
  try {
    for (const path of ["README.md", "daily", "weekly", "sources", "review", "resources", "events", "experiments", "research", "routes", "metrics", "site/data", "site/feeds", "watchlist", "community", "config"]) await cp(join(repositoryRoot, path), join(root, path), { recursive: true });
    await resetPublicationFixture(root, NOW, { coreCoverage: true });
    await seedCoreResearchFixture(root);
    for (const path of ["site/data/decision-products.json", "site/data/core-coverage.json", "site/data/core-coverage-history.json", "events/core-coverage-history.json", "watchlist/current.json", "watchlist/theses.json", "watchlist/history", "review/core30-backfill.json"]) await rm(join(root, path), { recursive: true, force: true });
    await mkdir(join(root, "watchlist/history"), { recursive: true });
    await writeFile(join(root, "review/owners-config.json"), JSON.stringify({ owners: [{ ownerId: "maintainer", maxActiveCases: 3, priorities: ["P2"], caseTypes: ["company"] }] }));
    await generate({ root, now: NOW, collect: empty, collectX: empty });
    await assertCoreResearchPublished(root, NOW);
    const artifact = JSON.parse(await readFile(join(root, "site/data/core-coverage.json"), "utf8"));
    assert.equal(artifact.briefs.length, 30);
    const coreFeed = await readFile(join(root, "site/feeds/core-coverage.xml"), "utf8");
    assert.match(coreFeed, /Physical AI · Core 30/);
    assert.match(await readFile(join(root, "README.md"), "utf8"), new RegExp(`固定研究覆盖 ${artifact.coverage.version}[\\s\\S]*完整 Brief`));
    const checkpoint = JSON.parse(await readFile(join(root, "review/core30-backfill.json"), "utf8"));
    assert.equal(checkpoint.tasks.length, 120);
    assert.ok(checkpoint.tasks.every((task: any) => task.status === "pending"));
    const cases = JSON.parse(await readFile(join(root, "review/cases.json"), "utf8"));
    const coreCases = cases.cases.filter((item: any) => item.subjectId.startsWith("core30-backfill-"));
    assert.equal(coreCases.length, 20);
    const assignments = JSON.parse(await readFile(join(root, "review/assignments.json"), "utf8"));
    const coreIds = new Set(coreCases.map((item: any) => item.caseId));
    assert.equal(assignments.assignments.filter((item: any) => coreIds.has(item.caseId)).length, 20);
    assert.equal(assignments.assignments.filter((item: any) => coreIds.has(item.caseId) && item.owner === "maintainer").length, 3);
    assert.deepEqual(assignments.assignments.filter((item: any) => coreIds.has(item.caseId) && item.owner === "maintainer").map((item: any) => item.caseId).sort(), coreCases.slice(0, 3).map((item: any) => item.caseId).sort());
    const companies = JSON.parse(await readFile(join(root, "events/companies.json"), "utf8"));
    const events = JSON.parse(await readFile(join(root, "events/index.json"), "utf8"));
    const ledger = JSON.parse(await readFile(join(root, "events/company-claim-ledger.json"), "utf8"));
    const legacy = buildCompanyClaimLedger(companies, events.events, { now: NOW });
    assert.ok(legacy.companies.every((entry) => ledger.companies.some((stored: any) => stored.companyId === entry.companyId)));
    assert.equal(JSON.parse(await readFile(join(root, "site/data/decision-products.json"), "utf8")).schemaVersion, 1);
    const paths = ["site/data/core-coverage.json", "events/core-coverage-history.json", "review/core30-backfill.json", "review/cases.json", "review/assignments.json", "site/data/core-coverage-history.json", "site/feeds/core-coverage.xml", "README.md"];
    const before = await Promise.all(paths.map((path) => readFile(join(root, path), "utf8")));
    await generate({ root, now: NOW, collect: empty, collectX: empty });
    await assertCoreResearchPublished(root, NOW);
    assert.deepEqual(await Promise.all(paths.map((path) => readFile(join(root, path), "utf8"))), before);
    await validateRelease(root);
    await writeFile(join(root, "site/feeds/core-coverage.xml"), coreFeed.replace("Physical AI · Core 30", "Forged Core 30"));
    await assert.rejects(() => validateRelease(root), /Core 30 Feed/);
    await writeFile(join(root, "site/feeds/core-coverage.xml"), coreFeed);
    await assert.rejects(() => generate({ root, now: NOW, collect: empty, collectX: empty, transaction: new FileTransaction("main-core-failure", { failAfterPath: join(root, paths[0]) }) }));
    assert.deepEqual(await Promise.all(paths.map((path) => readFile(join(root, path), "utf8"))), before);
    await writeFile(join(root, "config/core-coverage.json"), "{bad");
    await assert.rejects(() => generate({ root, now: NOW, collect: empty, collectX: empty }));
    assert.deepEqual(await Promise.all(paths.map((path) => readFile(join(root, path), "utf8"))), before);
  } finally { keys.forEach((key, index) => saved[index] === undefined ? delete process.env[key] : process.env[key] = saved[index]); await rm(root, { recursive: true, force: true }); }
});
