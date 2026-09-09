import assert from "node:assert/strict";
import test from "node:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate } from "../src/main.js";
import { validateFacts } from "../src/facts-contract.js";
import { resolveTitleEntity } from "../src/entity-resolution.js";
import { prepareReviewedBackfill, type ReviewedBackfill } from "../src/core-coverage/reviewed-ingest.js";
import { runReviewedOfflineGeneration } from "../scripts/core30-reviewed-backfill.js";
import { projectCanonicalCompanyClaimFields } from "../src/company-claim-ledger.js";
import { buildCompanyDossiers, formatRecentEvents } from "../src/event-center.js";
import { buildDashboard } from "../src/site-data.js";
import { FileTransaction } from "../src/runtime/storage.js";
import { migrateEventTime } from "../src/event-time.js";
import { upsertEvents } from "../src/event-center.js";
import { projectCoreCoverageEventDates } from "../src/core-coverage/timeline.js";
import { company, event } from "./core-coverage-fixtures.js";
import { resetPublicationFixture } from "./publication-fixture.js";
import { assertCoreResearchPublished, seedCoreResearchFixture } from "./core-research-fixture.js";

test("explicit unknown occurrence, publication and material clocks survive canonical regeneration", () => {
  for (const record of [
    event("product", { title: "Alpha Robotics 发布机器人产品", occurredAt: "unknown", eventDate: "unknown", lastEvidenceAt: "2026-08-21T00:00:00Z", lastMaterialChangeAt: "unknown", lastUpdatedAt: "unknown" }),
    event("product", { title: "Alpha Robotics 发布机器人产品", lastEvidenceAt: "unknown", evidence: [{ ...event("product").evidence[0], publishedAt: "unknown" }] }),
  ]) {
    const migrated = migrateEventTime(record);
    const normalized = (value: string | undefined) => value === "unknown" ? value : new Date(value!).toISOString();
    assert.equal(migrated.occurredAt, normalized(record.occurredAt));
    assert.equal(migrated.eventDate, record.eventDate);
    assert.equal(migrated.lastEvidenceAt, normalized(record.lastEvidenceAt));
    assert.equal(migrated.lastMaterialChangeAt, normalized(record.lastMaterialChangeAt));
    const regenerated = upsertEvents({ updatedAt: "2026-09-07T01:00:00Z", events: [record] }, [], new Date("2026-09-07T01:00:00Z"), [company]);
    assert.equal(regenerated.events[0].occurredAt, normalized(record.occurredAt));
    assert.equal(regenerated.events[0].lastEvidenceAt, normalized(record.lastEvidenceAt));
  }
});

export const reviewedInput = {
  schemaVersion: 1, reviewedAt: "2026-09-07T01:00:00.000Z",
  identities: [{ companyId: "unitree", evidence: [{ link: "https://www.unitree.com/about/", source: "Unitree official", checkedAt: "2026-09-07T01:00:00.000Z", supports: "宇树科技 Unitree Robotics develops legged robots." }] }],
  events: [{ companyId: "unitree", url: "https://www.unitree.com/reviewed-test-release", source: "Unitree official", titleZh: "宇树科技发布 As2 四足机器人", summaryZh: "宇树科技官方时间线记载 As2 四足机器人的发布；该记录仅证明产品发布，不据此推断客户部署或独立验证结果。", type: "产品发布", occurredOn: "2026-02-24", publishedOn: "unknown", occurrenceExcerpt: "On February 24, Unitree launched the As2 quadruped robot.", fields: [{ field: "product", value: "As2", excerpt: "Unitree launched the As2 quadruped robot.", locator: "Official company timeline / Year of 2026" }], gaps: ["页面发布时间未知；部署与客户未知。"] }],
};

test("fact gate accepts literal unknown clocks but still rejects malformed supplied dates", () => {
  const input = { type: "产品发布", eventDate: "unknown", publishedAt: "unknown", materiallyChangedAt: "unknown", evidence: [{ id: "official", link: "https://www.unitree.com/about/", source: "Unitree", grade: "A" as const }] };
  assert.equal(validateFacts(input).valid, true);
  assert.ok(validateFacts({ ...input, eventDate: "2026-not-a-date" }).issues.some((issue) => issue.code === "invalid-time"));
});

test("reviewed date-only proof accepts Shanghai today before UTC midnight and rejects tomorrow or malformed days", async () => {
  const profiles = JSON.parse(await readFile(new URL("../events/companies.json", import.meta.url), "utf8"));
  const now = new Date("2026-09-06T17:00:00.000Z");
  const input = { ...structuredClone(reviewedInput), reviewedAt: now.toISOString(), identities: [],
    events: reviewedInput.events.map((item) => ({ ...item, kind: "product-release", occurredOn: "2026-09-07", publishedOn: "2026-09-07" })) } as ReviewedBackfill;
  const prepared = prepareReviewedBackfill(profiles, undefined, input, now);
  const record = prepared.store.events[0];
  for (const candidate of [record, migrateEventTime(record), upsertEvents(prepared.store, [], now, prepared.companies).events[0]]) {
    const projected = projectCoreCoverageEventDates(candidate, now);
    assert.equal(projected.occurredOn, "2026-09-07");
    assert.equal(projected.publishedOn, "2026-09-07");
  }
  const unknown = structuredClone(input); unknown.events[0].occurredOn = "unknown"; unknown.events[0].publishedOn = "unknown";
  const unknownRecord = migrateEventTime(prepareReviewedBackfill(profiles, undefined, unknown, now).store.events[0]);
  assert.equal(projectCoreCoverageEventDates(unknownRecord, now).occurredOn, "unknown");
  assert.equal(projectCoreCoverageEventDates(unknownRecord, now).publishedOn, "unknown");
  for (const field of ["occurredOn", "publishedOn"] as const) {
    for (const value of ["2026-09-08", "2026-02-30", "2026-13-01", "2026-9-07", "2026-09-07T00:00:00Z", "UNKNOWN"]) {
      const corrupt = structuredClone(input); corrupt.events[0][field] = value;
      assert.throws(() => prepareReviewedBackfill(profiles, undefined, corrupt, now), `${field}: ${value}`);
    }
  }
});

test("Shanghai 01:00 reviewed calendar proof qualifies the Brief through normal generation and receipt replay", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "core-reviewed-calendar-"));
  const repositoryRoot = new URL("../", import.meta.url).pathname;
  const now = new Date("2026-09-06T17:00:00.000Z");
  const input = { ...structuredClone(reviewedInput), reviewedAt: now.toISOString(),
    identities: reviewedInput.identities.map((identity) => ({ ...identity, evidence: identity.evidence.map((proof) => ({ ...proof, checkedAt: now.toISOString() })) })),
    events: reviewedInput.events.map((item) => ({ ...item, kind: "product-release", occurredOn: "2026-09-07", publishedOn: "2026-09-07" })) } as ReviewedBackfill;
  try {
    for (const path of ["README.md", "daily", "weekly", "sources", "review", "resources", "events", "experiments", "research", "routes", "metrics", "site", "watchlist", "community", "config"]) await cp(join(repositoryRoot, path), join(outputRoot, path), { recursive: true });
    await resetPublicationFixture(outputRoot, now, { coreCoverage: true });
    await seedCoreResearchFixture(outputRoot);
    const paths = ["events/index.json", "events/companies.json", "events/company-claim-ledger.json", "site/data/core-coverage.json", "site/data/core-coverage-history.json", "events/core-coverage-history.json", "review/core30-backfill.json", "site/feeds/core-coverage.xml", "README.md"];
    await runReviewedOfflineGeneration({ outputRoot, now, input });
    await assertCoreResearchPublished(outputRoot, now);
    const before = await Promise.all(paths.map((path) => readFile(join(outputRoot, path), "utf8")));
    const artifact = JSON.parse(before[3]);
    const brief = artifact.briefs.find((item: any) => item.companyId === "unitree");
    assert.equal(brief.completeness, "complete");
    assert.equal(artifact.metrics.completeBriefs, 1);
    assert.equal(brief.knownFacts[0].occurredOn, "2026-09-07");
    assert.equal(brief.knownFacts[0].publishedOn, "2026-09-07");
    assert.equal(brief.knownFacts[0].date, "2026-09-07");
    const record = JSON.parse(before[0]).events.find((item: any) => item.evidence.some((proof: any) => proof.link === input.events[0].url));
    assert.equal(record.occurredAt, "2026-09-07");
    assert.equal(record.evidence[0].publishedAt, "2026-09-07");
    assert.equal(record.lastEvidenceAt, "2026-09-07");
    assert.equal(record.firstSeenAt, now.toISOString());
    assert.equal(record.lastVerifiedAt, now.toISOString());
    assert.equal(record.lastMaterialChangeAt, "unknown");
    await runReviewedOfflineGeneration({ outputRoot, now });
    assert.deepEqual(await Promise.all(paths.map((path) => readFile(join(outputRoot, path), "utf8"))), before);
    await runReviewedOfflineGeneration({ outputRoot, now, input });
    assert.deepEqual(await Promise.all(paths.map((path) => readFile(join(outputRoot, path), "utf8"))), before);
    record.occurredAt = "2026-09-07T00:00:00.000Z";
    record.evidence[0].publishedAt = "2026-09-07T00:00:00.000Z";
    const store = JSON.parse(before[0]); store.events = [record];
    await writeFile(join(outputRoot, "events/index.json"), JSON.stringify(store));
    await runReviewedOfflineGeneration({ outputRoot, now });
    const future = JSON.parse(await readFile(join(outputRoot, "site/data/core-coverage.json"), "utf8"));
    const futureBrief = future.briefs.find((item: any) => item.companyId === "unitree");
    assert.equal(futureBrief.completeness, "coverage-only", "a real future timestamp cannot qualify as a calendar date");
    assert.equal(futureBrief.knownFacts[0].occurredOn, "unknown");
    assert.equal(futureBrief.knownFacts[0].publishedOn, "unknown");
    assert.equal(future.metrics.completeBriefs, 0);
  } finally { await rm(outputRoot, { recursive: true, force: true }); }
});

test("catalog Skild AI shadows its legacy default alias but distinct explicit identities stay ambiguous", () => {
  const skild = { ...company, entityId: "skild-ai", name: "Skild AI" };
  assert.equal(resolveTitleEntity("Skild AI 完成融资", [skild]).canonicalSubject, "Skild AI");
  assert.equal(resolveTitleEntity("Skild AI 完成融资", [skild, { ...company, name: "Other Company", aliases: ["Skild AI"] }]).disposition, "review");
});

test("explicit invalid canonical kinds fail closed instead of silently invoking legacy inference", () => {
  assert.throws(() => projectCanonicalCompanyClaimFields({ ...event(), kind: "invented-kind" } as any));
});

test("legacy company dossiers and headlines drop withdrawn evidence without deleting the canonical event", () => {
  const record = event("funding", { title: "Alpha Robotics 完成 Seed 融资", facts: ["Alpha Robotics 宣布完成融资，资金用于推进机器人研发与部署验证。"], evidence: [{ ...event("funding").evidence[0], withdrawn: true }] as any });
  assert.deepEqual(buildCompanyDossiers([company], [record])[0].funding, []);
  assert.equal(formatRecentEvents([record], new Date("2026-09-07T01:00:00Z")).includes(record.title), false);
  assert.equal(buildDashboard({ updatedAt: "2026-09-07T01:00:00Z", events: [record] }, [company], [], new Date("2026-09-07T01:00:00Z")).confirmedSignals.length, 0);
  assert.equal(buildCompanyDossiers([company], [{ ...record, evidence: event("funding").evidence, evidenceState: "withdrawn" } as any])[0].funding.length, 0);
});

test("legacy public dossiers and headlines require A or independent B+B, never single B or discovery", () => {
  const record = event("funding", { title: "Alpha Robotics 完成 Seed 融资", facts: ["Alpha Robotics 宣布完成融资，资金用于机器人研发及真实场景验证。"] });
  const a = record.evidence[0];
  const b = { ...a, grade: "B" as const, source: "Industry One", link: "https://industry-one.example/funding" };
  const c = { ...b, source: "Industry Two", link: "https://industry-two.example/funding" };
  for (const [evidence, eligible] of [[ [b], false ], [ [a], true ], [ [b, c], true ], [ [{ ...a, source: "Google News" }], false ]] as const) {
    const candidate = { ...record, evidence: [...evidence] };
    assert.equal(buildCompanyDossiers([company], [candidate])[0].funding.length, eligible ? 1 : 0);
    assert.equal(formatRecentEvents([candidate], new Date("2026-09-07T01:00:00Z")).includes(record.title), eligible);
  }
});

test("next-day first ingestion uses documented review observation without advancing genuine verification", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "core-reviewed-next-day-"));
  const repositoryRoot = new URL("../", import.meta.url).pathname;
  try {
    for (const path of ["README.md", "daily", "weekly", "sources", "review", "resources", "events", "experiments", "research", "routes", "metrics", "site", "watchlist", "community", "config"]) await cp(join(repositoryRoot, path), join(outputRoot, path), { recursive: true });
    const input = JSON.parse(await readFile(join(repositoryRoot, "review/core30-reviewed-backfill.json"), "utf8"));
    const now = new Date("2026-09-08T01:00:00.000Z");
    await resetPublicationFixture(outputRoot, now, { coreCoverage: true });
    await seedCoreResearchFixture(outputRoot);
    await runReviewedOfflineGeneration({ outputRoot, input, now });
    await assertCoreResearchPublished(outputRoot, now);
    const bytes = await readFile(join(outputRoot, "events/index.json"), "utf8");
    const store = JSON.parse(bytes);
    assert.equal(store.events.length, 16);
    for (const record of store.events) {
      assert.equal(record.firstSeenAt, "2026-09-07T01:00:00.000Z");
      assert.equal(record.lastVerifiedAt, "2026-09-07T01:00:00.000Z");
      assert.equal(record.lastMaterialChangeAt, "unknown");
    }
    await runReviewedOfflineGeneration({ outputRoot, input, now });
    assert.equal(await readFile(join(outputRoot, "events/index.json"), "utf8"), bytes);
  } finally { await rm(outputRoot, { recursive: true, force: true }); }
});

test("explicit reviewed input enters canonical transactional generation without guessing publication or deployment", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "core-reviewed-test-"));
  const repositoryRoot = new URL("../", import.meta.url).pathname;
  const keys = ["LLM_API_KEY", "OPENALEX_API_KEY", "GITHUB_TOKEN", "GITHUB_REPOSITORY"];
  const saved = keys.map((key) => process.env[key]); keys.forEach((key) => delete process.env[key]);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("No network in reviewed ingestion test"); };
  try {
    for (const path of ["README.md", "daily", "weekly", "sources", "review", "resources", "events", "experiments", "research", "routes", "metrics", "site/data", "site/feeds", "watchlist", "community", "config"]) await cp(join(repositoryRoot, path), join(outputRoot, path), { recursive: true });
    const empty = async () => ({ articles: [], failures: [], sourceOutcomes: [] });
    const input = { ...reviewedInput, events: reviewedInput.events.map((event) => ({ ...event, kind: "product-release" })) } as ReviewedBackfill;
    const now = new Date(reviewedInput.reviewedAt);
    await resetPublicationFixture(outputRoot, now, { coreCoverage: true });
    await seedCoreResearchFixture(outputRoot);
    await runReviewedOfflineGeneration({ outputRoot, now, input });
    await assertCoreResearchPublished(outputRoot, now);
    const events = JSON.parse(await readFile(join(outputRoot, "events/index.json"), "utf8"));
    const record = events.events.find((item: any) => item.evidence.some((proof: any) => proof.link === reviewedInput.events[0].url));
    assert.ok(record, "reviewed URL must reach the canonical event store");
    assert.equal(record.evidence[0].publishedAt, "unknown");
    assert.equal(record.lastEvidenceAt, "unknown");
    assert.equal(record.occurredAt, "2026-02-24");
    assert.deepEqual(record.productDeployment, { product: "As2", customers: [] });
    const artifact = JSON.parse(await readFile(join(outputRoot, "site/data/core-coverage.json"), "utf8"));
    assert.equal(artifact.briefs.find((brief: any) => brief.companyId === "unitree").completeness, "complete");
    const checkpoint = JSON.parse(await readFile(join(outputRoot, "review/core30-backfill.json"), "utf8"));
    assert.equal(checkpoint.tasks.find((task: any) => task.companyId === "unitree" && task.field === "product").status, "checked");
    assert.equal(checkpoint.tasks.find((task: any) => task.companyId === "unitree" && task.field === "capital").reason, "missing-evidence");
    const paths = ["events/index.json", "events/companies.json", "events/company-claim-ledger.json", "site/data/core-coverage.json", "site/data/core-coverage-history.json", "events/core-coverage-history.json", "review/core30-backfill.json", "site/feeds/core-coverage.xml", "README.md"];
    const before = await Promise.all(paths.map((path) => readFile(join(outputRoot, path), "utf8")));
    await runReviewedOfflineGeneration({ outputRoot, now, input });
    assert.deepEqual(await Promise.all(paths.map((path) => readFile(join(outputRoot, path), "utf8"))), before);
    await runReviewedOfflineGeneration({ outputRoot, now });
    assert.deepEqual(await Promise.all(paths.map((path) => readFile(join(outputRoot, path), "utf8"))), before, "ordinary regeneration must preserve reviewed canonical facts without reading private input");
    const secondIdentity = structuredClone(input); secondIdentity.events = [];
    secondIdentity.identities[0].evidence[0].link = "https://www.unitree.com/second-reviewed-proof";
    await assert.rejects(() => generate({ root: outputRoot, now, collect: empty, collectX: empty, reviewedBackfill: secondIdentity,
      transaction: new FileTransaction("reviewed-rollback", { failAfterPath: join(outputRoot, "events/companies.json") }) }));
    assert.deepEqual(await Promise.all(paths.map((path) => readFile(join(outputRoot, path), "utf8"))), before, "reviewed identities and generated public surfaces roll back together");
    record.evidence[0].withdrawn = true;
    await writeFile(join(outputRoot, "events/index.json"), JSON.stringify(events));
    await runReviewedOfflineGeneration({ outputRoot, now });
    const reopened = JSON.parse(await readFile(join(outputRoot, "review/core30-backfill.json"), "utf8"));
    const productTask = reopened.tasks.find((task: any) => task.companyId === "unitree" && task.field === "product");
    assert.equal(productTask.status, "pending", "ordinary withdrawal must reopen the previously checked product task without receipt replay");
    assert.equal(productTask.dispositionHistory[0].status, "checked");
    assert.deepEqual(reopened.tasks.filter((task: any) => task.taskId !== productTask.taskId), checkpoint.tasks.filter((task: any) => task.taskId !== productTask.taskId));
    const cases = JSON.parse(await readFile(join(outputRoot, "review/cases.json"), "utf8"));
    assert.ok(cases.cases.some((item: any) => item.subjectId === productTask.taskId));
    const correctionBytes = await Promise.all(paths.map((path) => readFile(join(outputRoot, path), "utf8")));
    await runReviewedOfflineGeneration({ outputRoot, now });
    assert.deepEqual(await Promise.all(paths.map((path) => readFile(join(outputRoot, path), "utf8"))), correctionBytes);
    await runReviewedOfflineGeneration({ outputRoot, now, input });
    const withdrawn = JSON.parse(await readFile(join(outputRoot, "site/data/core-coverage.json"), "utf8"));
    assert.equal(withdrawn.briefs.find((brief: any) => brief.companyId === "unitree").knownFacts.length, 0);
    assert.equal(JSON.parse(await readFile(join(outputRoot, "events/index.json"), "utf8")).events.find((item: any) => item.id === record.id).evidence[0].withdrawn, true);
    assert.equal((await readFile(join(outputRoot, "site/feeds/core-coverage.xml"), "utf8")).includes(record.id), false);
    assert.ok(JSON.parse(await readFile(join(outputRoot, "site/data/core-coverage-history.json"), "utf8")).corrections.some((change: any) => change.reason === "source-withdrawn"));
    const invalid = structuredClone(input); invalid.events[0].url = "https://other-company.example/release";
    assert.throws(() => prepareReviewedBackfill(JSON.parse(before[1]), events, invalid, now), /not official/);
    for (const mutate of [
      (receipt: any) => receipt.events.push(receipt.events[0]),
      (receipt: any) => receipt.events[0].kind = "research-author-report",
      (receipt: any) => receipt.events[0].fields[0].excerpt = "",
      (receipt: any) => receipt.events[0].occurredOn = "2026-99-99",
      (receipt: any) => receipt.events[0].occurredOn = "UNKNOWN",
      (receipt: any) => receipt.events[0].companyId = "untracked",
    ]) { const corrupt = structuredClone(input); mutate(corrupt); assert.throws(() => prepareReviewedBackfill(JSON.parse(before[1]), events, corrupt, now)); }
    const conflict = structuredClone(events); conflict.events.find((item: any) => item.id === record.id).evidenceState = "conflicted";
    assert.equal((prepareReviewedBackfill(JSON.parse(before[1]), conflict, input, now).store.events.find((item: any) => item.id === record.id) as any).evidenceState, "conflicted");
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((key, index) => { if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index]; });
    await rm(outputRoot, { recursive: true, force: true });
  }
});
