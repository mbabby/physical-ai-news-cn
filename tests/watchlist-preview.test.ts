import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import type { CompanyClaimLedger } from "../src/company-claim-ledger.js";
import { FileTransaction, readJsonStrict } from "../src/runtime/storage.js";
import type { CompanyProfile, EventRecord } from "../src/types.js";
import type { CompanyThesis } from "../src/watchlist/contracts.js";
import { scheduleAtomId, type CompanyThesisDraft, type ThesisGenerationResult } from "../src/watchlist/generator.js";
import { buildCanonicalFactAtoms } from "../src/watchlist/validation.js";
import type { SelectedThesisSeed } from "../src/watchlist/scoring.js";
import {
  buildWatchlistPreview,
  formatWatchlistPreviewMarkdown,
  stageWatchlistPreview,
  validateWatchlistPreviewArtifact,
  type WatchlistPreviewArtifact,
} from "../src/watchlist/preview.js";

const NOW = new Date("2026-08-14T08:00:00.000Z");
const GENERATED_AT = "2026-08-14T08:00:00.000Z";
const EXPIRES_AT = "2026-10-13T08:00:00.000Z";
const company: CompanyProfile = {
  entityId: "company-alpha", entityType: "公司", name: "Alpha Robotics", region: "美国",
  routes: ["VLA 与具身模型", "部署与商业化"], thesis: "test", officialUrl: "https://alpha.example",
};

function event(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: "event-alpha", title: "Alpha Robotics 宣布 Atlas-X 工厂部署", type: "部署案例",
    entities: ["Alpha Robotics"], primaryEntity: "Alpha Robotics", routes: ["VLA 与具身模型", "部署与商业化"],
    status: "已确证", occurredAt: "2026-08-14T06:00:00.000Z", eventDate: "2026-08-14",
    firstSeenAt: "2026-08-14T06:00:00.000Z", lastUpdatedAt: "2026-08-14T06:00:00.000Z",
    lastMaterialChangeAt: "2026-08-14T06:00:00.000Z", lastVerifiedAt: "2026-08-14T06:30:00.000Z",
    facts: ["Alpha Robotics 已公布 Atlas-X 工厂部署"], openQuestions: [], timeline: [],
    productDeployment: { product: "Atlas-X", customers: [], deployment: "工厂部署" },
    evidence: [{ link: "https://alpha.example/atlas-x", source: "Alpha Robotics 官网", grade: "A", publishedAt: "2026-08-14T06:00:00.000Z", supports: "Atlas-X 工厂部署" }],
    ...overrides,
  };
}

function seed(overrides: Partial<SelectedThesisSeed> = {}): SelectedThesisSeed {
  return {
    companyId: "company-alpha", companyName: "Alpha Robotics", track: "validated-momentum",
    routes: ["VLA 与具身模型", "部署与商业化"], factReferenceIds: ["event-alpha"], evidenceGrade: "A",
    verifiedSensitiveFields: [], unknownSensitiveFields: ["amount", "valuation", "customer", "revenue", "order"],
    evidenceSummary: ["Alpha Robotics 宣布 Atlas-X 工厂部署"], score: 70, components: [], eligible: true,
    ineligibilityReasons: [], primaryRoute: "VLA 与具身模型", selectionGroup: "priority-focus",
    ...overrides,
  };
}

function citationsFor(draft: Pick<CompanyThesisDraft, "whyNow" | "routeAndDependencies" | "nextValidationPoints" | "falsifiers">) {
  const atoms = buildCanonicalFactAtoms([event()]).map((atom) => atom.id);
  return [
    { path: "whyNow", sentenceIndex: 0, text: draft.whyNow, claimKind: "analysis" as const, referenceIds: ["event-alpha"], factAtomIds: atoms, sensitiveFields: [] },
    { path: "routeAndDependencies", sentenceIndex: 0, text: draft.routeAndDependencies, claimKind: "analysis" as const, referenceIds: ["event-alpha"], factAtomIds: atoms, sensitiveFields: [] },
    ...draft.nextValidationPoints.map((point, index) => ({ path: `nextValidationPoints.${index}`, sentenceIndex: 0, text: point.text, claimKind: "validation-point" as const, referenceIds: ["event-alpha"], factAtomIds: [...atoms, scheduleAtomId(`nextValidationPoints.${index}`, point.dueAt)], sensitiveFields: [] })),
    ...draft.falsifiers.map((item, index) => ({ path: `falsifiers.${index}`, sentenceIndex: 0, text: item.text, claimKind: "falsifier" as const, referenceIds: ["event-alpha"], factAtomIds: atoms, sensitiveFields: [] })),
  ];
}

function draft(overrides: Partial<CompanyThesisDraft> = {}): CompanyThesisDraft {
  const base = {
    companyId: "company-alpha", track: "validated-momentum" as const,
    whyNow: "AI 研究判断：Alpha Robotics 的 Atlas-X 工厂部署形成新的公开验证节点。",
    routeAndDependencies: "AI 研究判断：Atlas-X 路线依赖真实工厂数据和后续验证。",
    nextValidationPoints: [{ text: "核验 Alpha Robotics 是否公布 Atlas-X 后续部署数据。", dueAt: "2026-09-30" }],
    falsifiers: [{ text: "Alpha Robotics 撤回 Atlas-X 工厂部署公告。" }], factReferenceIds: ["event-alpha"],
    inferenceLabels: ["AI 研究判断"], confidence: "high" as const, generatedAt: GENERATED_AT, expiresAt: EXPIRES_AT,
    modelVersion: "model-v1", promptVersion: "watchlist-thesis-v1", methodologyVersion: "v1",
  };
  return { ...base, sentenceCitations: citationsFor(base), ...overrides };
}

function thesis(overrides: Partial<CompanyThesis> = {}): CompanyThesis {
  const { sentenceCitations: _citations, ...published } = draft();
  return { thesisId: "thesis-alpha", lifecycle: "new", thesisVersion: 1, ...published, ...overrides };
}

function ledger(unresolvedQuestions: string[] = []): CompanyClaimLedger {
  const metrics = { populatedFields: 1, totalFields: 1, fieldCompletenessRate: 1, staleClaimCount: 0, staleEvidenceCount: 0, eligibleEventCount: 1, attributedEventCount: 1, eventCoverageRate: 1 };
  return {
    generatedAt: GENERATED_AT, limit: 15,
    companies: [{ companyId: "company-alpha", companyName: "Alpha Robotics", selectionScore: 1, metrics,
      claims: [{ companyId: "company-alpha", claimType: "deployment", statement: "Atlas-X 工厂部署", value: "工厂部署", evidenceIds: ["event-alpha:evidence:1"], evidenceUrls: ["https://alpha.example/atlas-x"], evidenceState: "verified", eventDate: "2026-08-14", verifiedAt: GENERATED_AT, freshness: { ttlDays: 90, state: "fresh", expiresAt: "2026-11-12T08:00:00.000Z", daysSinceVerified: 0 }, unresolvedQuestions }] }],
    metrics: { ...metrics, selectedCompanyCount: 1, companiesWithEligibleEvents: 1 },
  };
}

function generator(result: ThesisGenerationResult) {
  return {
    generate: async (): Promise<ThesisGenerationResult> => result,
    status: () => ({ component: "LLM" as const, status: result.ok ? "成功" as const : "部分降级" as const, attempted: 1, succeeded: result.ok ? 1 : 0, failed: result.ok ? 0 : 1, detail: "safe" }),
  };
}

function input(generation: ThesisGenerationResult, previous?: WatchlistPreviewArtifact, overrides: Record<string, unknown> = {}) {
  return {
    selected: { forwardRadar: [], validatedMomentum: [seed()] }, companies: [company], canonicalEvents: [event()],
    claimLedger: ledger(), previous, generator: generator(generation), now: NOW, ...overrides,
  };
}

test("preview publishes only a newly generated thesis that passes every validation gate", async () => {
  const result = await buildWatchlistPreview(input({ ok: true, draft: draft() }));
  assert.equal(result.preview.theses.length, 1);
  assert.equal(result.preview.theses[0]?.companyId, "company-alpha");
  assert.deepEqual(result.status, { component: "Watchlist", status: "成功", attempted: 1, succeeded: 1, failed: 0, detail: "生成 1 张新判断卡；保留 0 张上一有效版本；排除 0 家。" });
  assert.equal(validateWatchlistPreviewArtifact(result.preview), true);
});

test("invalid generated prose is absent instead of leaking a partial thesis", async () => {
  const invalid = draft({ whyNow: "Buy Alpha Robotics for a guaranteed return." });
  const result = await buildWatchlistPreview(input({ ok: true, draft: invalid }));
  assert.deepEqual(result.preview.theses, []);
  assert.equal(result.status.failed, 1);
});

test("malformed generation keeps a still-valid previously validated card", async () => {
  const previous = { schemaVersion: 1 as const, generatedAt: "2026-08-14T01:00:00.000Z", theses: [thesis({ generatedAt: "2026-08-14T01:00:00.000Z", expiresAt: "2026-10-13T01:00:00.000Z" })] };
  const result = await buildWatchlistPreview(input({ ok: false, code: "invalid-json" }, previous));
  assert.deepEqual(result.preview.theses, previous.theses);
  assert.equal(result.status.failed, 1);
  assert.match(result.status.detail, /保留 1/);
});

test("six-hour cooldown skips regeneration and preserves the prior card", async () => {
  const recent = thesis({ generatedAt: "2026-08-14T04:00:00.000Z", expiresAt: "2026-10-13T04:00:00.000Z" });
  const previous = { schemaVersion: 1 as const, generatedAt: recent.generatedAt, theses: [recent] };
  const result = await buildWatchlistPreview(input({ ok: true, draft: draft() }, previous));
  assert.deepEqual(result.preview, previous);
  assert.deepEqual({ attempted: result.status.attempted, succeeded: result.status.succeeded, failed: result.status.failed }, { attempted: 0, succeeded: 0, failed: 0 });
});

test("unchanged fixed-clock generation is idempotent", async () => {
  const prior = thesis({ generatedAt: "2026-08-14T00:00:00.000Z", expiresAt: "2026-10-13T00:00:00.000Z" });
  const unchangedEvent = event({ lastMaterialChangeAt: "2026-08-13T23:00:00.000Z", lastUpdatedAt: "2026-08-13T23:00:00.000Z" });
  const previous = { schemaVersion: 1 as const, generatedAt: "2026-08-14T00:00:00.000Z", theses: [prior] };
  const first = await buildWatchlistPreview(input({ ok: true, draft: draft() }, previous, { canonicalEvents: [unchangedEvent] }));
  const second = await buildWatchlistPreview(input({ ok: true, draft: draft() }, first.preview, { canonicalEvents: [unchangedEvent] }));
  assert.deepEqual(first.preview, previous);
  assert.deepEqual(second.preview, previous);
  assert.equal(first.status.attempted, 0);
  assert.equal(second.status.attempted, 0);
  assert.equal(formatWatchlistPreviewMarkdown(second.preview), formatWatchlistPreviewMarkdown(previous));
});

test("conflict, expiry, falsification, and sensitive-ledger conflict cannot use last-known-good", async () => {
  const active = thesis({ generatedAt: "2026-08-13T00:00:00.000Z", expiresAt: "2026-10-12T00:00:00.000Z" });
  const cases = [
    { previousThesis: active, canonicalEvents: [event({ status: "待复核" })], claimLedger: ledger() },
    { previousThesis: thesis({ generatedAt: "2026-06-15T08:00:00.000Z", expiresAt: NOW.toISOString() }), canonicalEvents: [event()], claimLedger: ledger() },
    { previousThesis: thesis({ ...active, lifecycle: "falsified" }), canonicalEvents: [event()], claimLedger: ledger() },
    { previousThesis: active, canonicalEvents: [event()], claimLedger: ledger(["客户归属冲突"]) },
    { previousThesis: active, canonicalEvents: [event({ evidence: [{ ...event().evidence[0]!, grade: "B" }] })], claimLedger: ledger() },
  ];
  for (const scenario of cases) {
    const previous = { schemaVersion: 1 as const, generatedAt: scenario.previousThesis.generatedAt, theses: [scenario.previousThesis] };
    const result = await buildWatchlistPreview(input({ ok: false, code: "invalid-shape" }, previous, scenario));
    assert.deepEqual(result.preview.theses, []);
  }
});

test("corrupt previous preview fails closed before generation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "watchlist-preview-corrupt-"));
  const path = join(directory, "watchlist-preview.json");
  await writeFile(path, "{broken", "utf8");
  await assert.rejects(readJsonStrict(path, { optional: true, label: "内部观察名单预览", validate: validateWatchlistPreviewArtifact }), /已损坏.*停止发布/);
  assert.equal(validateWatchlistPreviewArtifact({ schemaVersion: 1, generatedAt: GENERATED_AT, theses: [{ ...thesis(), whyNow: "not AI labelled" }] }), false);
});

test("preview and companion status roll back together when transaction commit fails", async () => {
  const directory = await mkdtemp(join(tmpdir(), "watchlist-preview-transaction-"));
  const reviewDir = join(directory, "review");
  const previewPath = join(reviewDir, "watchlist-preview.json");
  const markdownPath = join(reviewDir, "watchlist-preview.md");
  const statusPath = join(reviewDir, "runtime-status.md");
  await mkdir(reviewDir, { recursive: true });
  await Promise.all([writeFile(previewPath, "old-json", "utf8"), writeFile(markdownPath, "old-md", "utf8"), writeFile(statusPath, "old-status", "utf8")]);
  const transaction = new FileTransaction("watchlist-test", { failAfterSwaps: 2 });
  stageWatchlistPreview(transaction, reviewDir, { schemaVersion: 1, generatedAt: GENERATED_AT, theses: [thesis()] });
  transaction.stage(statusPath, "new-status");
  await assert.rejects(transaction.commit(), /已回滚/);
  assert.deepEqual(await Promise.all([readFile(previewPath, "utf8"), readFile(markdownPath, "utf8"), readFile(statusPath, "utf8")]), ["old-json", "old-md", "old-status"]);
});
