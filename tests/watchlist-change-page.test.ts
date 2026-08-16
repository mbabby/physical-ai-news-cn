import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileTransaction } from "../src/runtime/storage.js";
import type { WatchlistSnapshot } from "../src/watchlist/contracts.js";
import {
  buildWatchlistChangePage,
  stageWatchlistChangePage,
  validateWatchlistChangePage,
  type WatchlistChangePage,
} from "../src/watchlist/change-page.js";
import type { WatchlistPublicCard, WatchlistPublicView } from "../src/watchlist/public-view.js";

const GENERATED_AT = "2026-08-17T01:00:00.000Z";

function snapshot(week: string, version: number, entries: Array<{ companyId: string; thesisId: string; thesisVersion: number }>): WatchlistSnapshot {
  return {
    week,
    snapshotVersion: version,
    methodologyVersion: "method-v1",
    generatedAt: GENERATED_AT,
    forwardRadar: entries.map((entry) => ({ ...entry, group: "priority-focus" as const })),
    validatedMomentum: [],
    changesSinceLastWeek: [],
  };
}

function card(overrides: Partial<WatchlistPublicCard> = {}): WatchlistPublicCard {
  return {
    companyId: "company-alpha",
    companyName: "Alpha Robotics",
    thesisId: "thesis-alpha",
    thesisVersion: 1,
    track: "forward-radar",
    group: "priority-focus",
    lifecycle: "new",
    lifecycleLabel: "新进入",
    routes: ["VLA 与具身模型"],
    whyNow: "AI 研究判断：出现新的规范事实。",
    routeAndDependencies: "AI 研究判断：需要后续部署验证。",
    nextValidationPoints: [{ text: "核验真实部署。", dueAt: "2026-10-01" }],
    falsifiers: [{ text: "规范事实被撤回。" }],
    evidenceLinks: [{ eventId: "event-alpha", title: "Alpha 官方发布", url: "https://alpha.example/release", source: "Alpha 官方", grade: "A" }],
    capital: { status: "evidence-insufficient", summary: "证据不足（不代表未融资）" },
    ...overrides,
  };
}

function view(snapshotValue: WatchlistSnapshot, cards: WatchlistPublicCard[]): WatchlistPublicView {
  return {
    week: snapshotValue.week,
    snapshotVersion: snapshotValue.snapshotVersion,
    methodologyVersion: snapshotValue.methodologyVersion,
    lastSuccessfulAt: snapshotValue.generatedAt,
    companyIds: cards.map((item) => item.companyId),
    forwardRadar: cards,
    validatedMomentum: [],
    changes: [],
  };
}

function page(current: WatchlistSnapshot, snapshots: WatchlistSnapshot[], views: WatchlistPublicView[]): WatchlistChangePage {
  return buildWatchlistChangePage({ current, snapshots, views });
}

test("derives supported public lifecycle deltas and omits an exit without public exit evidence", () => {
  const baseline = snapshot("2026-W33", 1, [
    { companyId: "company-strengthening", thesisId: "thesis-strengthening", thesisVersion: 1 },
    { companyId: "company-awaiting", thesisId: "thesis-awaiting", thesisVersion: 1 },
    { companyId: "company-downgrade", thesisId: "thesis-downgrade", thesisVersion: 1 },
    { companyId: "company-exit", thesisId: "thesis-exit", thesisVersion: 1 },
  ]);
  const current = snapshot("2026-W34", 1, [
    { companyId: "company-addition", thesisId: "thesis-addition", thesisVersion: 1 },
    { companyId: "company-strengthening", thesisId: "thesis-strengthening", thesisVersion: 2 },
    { companyId: "company-awaiting", thesisId: "thesis-awaiting", thesisVersion: 2 },
    { companyId: "company-downgrade", thesisId: "thesis-downgrade", thesisVersion: 2 },
  ]);
  const baselineView = view(baseline, [
    card({ companyId: "company-strengthening", companyName: "Strengthening", thesisId: "thesis-strengthening" }),
    card({ companyId: "company-awaiting", companyName: "Awaiting", thesisId: "thesis-awaiting" }),
    card({ companyId: "company-downgrade", companyName: "Downgrade", thesisId: "thesis-downgrade" }),
    card({ companyId: "company-exit", companyName: "Exit", thesisId: "thesis-exit" }),
  ]);
  const currentView = view(current, [
    card({ companyId: "company-addition", companyName: "Addition", thesisId: "thesis-addition" }),
    card({ companyId: "company-strengthening", companyName: "Strengthening", thesisId: "thesis-strengthening", thesisVersion: 2, lifecycle: "strengthening", lifecycleLabel: "持续强化", whyNow: "AI 研究判断：规范部署证据增加。" }),
    card({ companyId: "company-awaiting", companyName: "Awaiting", thesisId: "thesis-awaiting", thesisVersion: 2, lifecycle: "awaiting-validation", lifecycleLabel: "等待验证", whyNow: "AI 研究判断：等待下一验证点。" }),
    card({ companyId: "company-downgrade", companyName: "Downgrade", thesisId: "thesis-downgrade", thesisVersion: 2, lifecycle: "downgraded", lifecycleLabel: "判断降级", whyNow: "AI 研究判断：部署证据不足。" }),
  ]);

  const artifact = page(current, [current, baseline], [currentView, baselineView]);

  assert.deepEqual(artifact.changes.map((item) => [item.companyId, item.kind]), [
    ["company-addition", "addition"],
    ["company-awaiting", "awaiting-validation"],
    ["company-downgrade", "downgrade"],
    ["company-strengthening", "strengthening"],
  ]);
  for (const item of artifact.changes) {
    assert.ok(item.whatChanged.length > 0);
    assert.ok(item.why.length > 0);
    assert.deepEqual(item.evidenceLinks, [{ eventId: "event-alpha", title: "Alpha 官方发布", url: "https://alpha.example/release", source: "Alpha 官方", grade: "A" }]);
  }
});

test("uses only the immediate predecessor and reports an explicit empty first-snapshot baseline", () => {
  const first = snapshot("2026-W32", 1, [{ companyId: "company-alpha", thesisId: "thesis-alpha", thesisVersion: 1 }]);
  const middle = snapshot("2026-W33", 1, [{ companyId: "company-beta", thesisId: "thesis-beta", thesisVersion: 1 }]);
  const current = snapshot("2026-W34", 1, [{ companyId: "company-beta", thesisId: "thesis-beta", thesisVersion: 1 }]);
  const firstView = view(first, [card()]);
  const middleView = view(middle, [card({ companyId: "company-beta", companyName: "Beta Robotics", thesisId: "thesis-beta" })]);
  const currentView = view(current, [card({ companyId: "company-beta", companyName: "Beta Robotics", thesisId: "thesis-beta" })]);
  const artifact = page(current, [first, current, middle], [firstView, currentView, middleView]);
  assert.deepEqual(artifact.baseline, { week: "2026-W33", snapshotVersion: 1, generatedAt: GENERATED_AT });
  assert.deepEqual(artifact.changes, []);

  const firstArtifact = page(first, [first], [firstView]);
  assert.equal(firstArtifact.baseline, null);
  assert.equal(firstArtifact.emptyBaseline, true);
  assert.deepEqual(firstArtifact.changes, []);
});

test("emits a same-week correction only for a changed public thesis value, never a version or score-only change", () => {
  const baseline = snapshot("2026-W34", 1, [{ companyId: "company-alpha", thesisId: "thesis-alpha", thesisVersion: 1 }]);
  const current = snapshot("2026-W34", 2, [{ companyId: "company-alpha", thesisId: "thesis-alpha", thesisVersion: 2 }]);
  const previous = view(baseline, [card()]);
  const corrected = view(current, [card({ thesisVersion: 2, whyNow: "AI 研究判断：修正后的规范事实。" })]);
  assert.deepEqual(page(current, [baseline, current], [previous, corrected]).changes.map((item) => item.kind), ["correction"]);

  for (const lifecycle of ["strengthening", "awaiting-validation", "downgraded"] as const) {
    const lifecycleCorrection = view(current, [card({
      thesisVersion: 2,
      lifecycle,
      lifecycleLabel: lifecycle === "strengthening" ? "持续强化" : lifecycle === "awaiting-validation" ? "等待验证" : "判断降级",
      whyNow: `AI 研究判断：${lifecycle} 的修正。`,
    })]);
    assert.deepEqual(page(current, [baseline, current], [previous, lifecycleCorrection]).changes.map((item) => item.kind), ["correction"]);
  }

  const scoreOnly = view(current, [card({ thesisVersion: 2 })]);
  assert.deepEqual(page(current, [baseline, current], [previous, scoreOnly]).changes, []);
});

test("fails closed for unsafe evidence and private candidate or score leakage", () => {
  const baseline = snapshot("2026-W33", 1, []);
  const current = snapshot("2026-W34", 1, [{ companyId: "company-alpha", thesisId: "thesis-alpha", thesisVersion: 1 }]);
  const empty = view(baseline, []);
  assert.throws(() => page(current, [baseline, current], [empty, view(current, [card({ evidenceLinks: [{ ...card().evidenceLinks[0]!, url: "http://alpha.example/release" }] })])]), /HTTPS/);
  assert.throws(() => page(current, [baseline, current], [empty, view(current, [card({ whyNow: "AI 研究判断：candidate-secret 未公开。" })])]), /候选标识/);
  assert.throws(() => page(current, [baseline, current], [empty, view(current, [card({ whyNow: "AI 研究判断：score 99。" })])]), /私有诊断/);
});

test("rejects public cards that do not reference the exact immutable snapshot thesis version", () => {
  const baseline = snapshot("2026-W33", 1, []);
  const current = snapshot("2026-W34", 1, [{ companyId: "company-alpha", thesisId: "thesis-alpha", thesisVersion: 1 }]);
  assert.throws(() => page(current, [baseline, current], [
    view(baseline, []),
    view(current, [card({ thesisId: "thesis-other" })]),
  ]), /快照|snapshot/i);
});

test("serializes change artifacts deterministically and stages them atomically", async () => {
  const baseline = snapshot("2026-W33", 1, []);
  const current = snapshot("2026-W34", 1, [{ companyId: "company-alpha", thesisId: "thesis-alpha", thesisVersion: 1 }]);
  const artifact = page(current, [current, baseline], [view(current, [card()]), view(baseline, [])]);
  assert.doesNotThrow(() => validateWatchlistChangePage(artifact));
  assert.deepEqual(artifact, JSON.parse(JSON.stringify(artifact)));
  const root = await mkdtemp(join(tmpdir(), "watchlist-change-page-"));
  const output = join(root, "site", "data", "watchlist-changes.json");
  try {
    const first = new FileTransaction("watchlist-change-first");
    stageWatchlistChangePage({ transaction: first, root, artifact });
    await first.commit();
    const bytes = await readFile(output, "utf8");

    const second = new FileTransaction("watchlist-change-second");
    stageWatchlistChangePage({ transaction: second, root, artifact: page(current, [baseline, current], [view(baseline, []), view(current, [card()])]) });
    await second.commit();
    assert.equal(await readFile(output, "utf8"), bytes);

    await writeFile(output, "last-known-good\n", "utf8");
    const rollback = new FileTransaction("watchlist-change-rollback", { failAfterSwaps: 1 });
    stageWatchlistChangePage({ transaction: rollback, root, artifact });
    rollback.stage(join(root, "site", "data", "other-public-file.json"), "new\n");
    await assert.rejects(() => rollback.commit(), /已回滚/);
    assert.equal(await readFile(output, "utf8"), "last-known-good\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects malformed snapshot identities in a serialized public change artifact", () => {
  const baseline = snapshot("2026-W33", 1, []);
  const current = snapshot("2026-W34", 1, [{ companyId: "company-alpha", thesisId: "thesis-alpha", thesisVersion: 1 }]);
  const artifact = page(current, [baseline, current], [view(baseline, []), view(current, [card()])]);
  assert.throws(() => validateWatchlistChangePage({ ...artifact, current: { ...artifact.current, week: "2026-W99" } }), /身份/);
  assert.throws(() => validateWatchlistChangePage({ ...artifact, current: { ...artifact.current, generatedAt: "not-a-timestamp" } }), /身份/);
});
