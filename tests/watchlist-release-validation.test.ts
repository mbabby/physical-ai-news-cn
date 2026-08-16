import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileTransaction } from "../src/runtime/storage.js";
import type { CompanyThesis, CompanyThesisArtifact, WatchlistSnapshot } from "../src/watchlist/contracts.js";
import {
  validateCurrentWatchlistHistoryFiles,
  mergeWatchlistThesisArtifact,
  stageWatchlistRelease,
  validateWatchlistRelease,
} from "../src/watchlist/release-validation.js";
import type { WatchlistPublicView } from "../src/watchlist/public-view.js";

const GENERATED_AT = "2026-08-17T01:00:00.000Z";

function thesis(overrides: Partial<CompanyThesis> = {}): CompanyThesis {
  return {
    thesisId: "thesis-alpha",
    companyId: "company-alpha",
    track: "forward-radar",
    lifecycle: "new",
    thesisVersion: 1,
    whyNow: "AI 研究判断：Alpha Robotics 出现新的规范事实。",
    routeAndDependencies: "AI 研究判断：路线依赖后续真实部署验证。",
    nextValidationPoints: [{ text: "核验后续真实部署。", dueAt: "2026-10-01" }],
    falsifiers: [{ text: "规范事实被撤回。" }],
    factReferenceIds: ["event-alpha"],
    verifiedSensitiveBindings: [],
    inferenceLabels: ["AI 研究判断"],
    confidence: "medium",
    generatedAt: "2026-08-16T01:00:00.000Z",
    expiresAt: "2026-10-15T01:00:00.000Z",
    modelVersion: "model-v1",
    promptVersion: "prompt-v1",
    methodologyVersion: "method-v1",
    ...overrides,
  };
}

function snapshot(overrides: Partial<WatchlistSnapshot> = {}): WatchlistSnapshot {
  return {
    week: "2026-W34",
    snapshotVersion: 1,
    methodologyVersion: "method-v1",
    generatedAt: GENERATED_AT,
    forwardRadar: [{ companyId: "company-alpha", thesisId: "thesis-alpha", thesisVersion: 1, group: "priority-focus" }],
    validatedMomentum: [],
    changesSinceLastWeek: [],
    ...overrides,
  };
}

function artifact(items: CompanyThesis[] = [thesis()]): CompanyThesisArtifact {
  return { schemaVersion: 1, generatedAt: GENERATED_AT, theses: items };
}

function view(overrides: Partial<WatchlistPublicView> = {}): WatchlistPublicView {
  const card: WatchlistPublicView["forwardRadar"][number] = {
    companyId: "company-alpha",
    companyName: "Alpha Robotics",
    thesisId: "thesis-alpha",
    thesisVersion: 1,
    track: "forward-radar",
    group: "priority-focus",
    lifecycle: "new",
    lifecycleLabel: "新进入",
    whyNow: "AI 研究判断：Alpha Robotics 出现新的规范事实。",
    routeAndDependencies: "AI 研究判断：路线依赖后续真实部署验证。",
    nextValidationPoints: [{ text: "核验后续真实部署。", dueAt: "2026-10-01" }],
    falsifiers: [{ text: "规范事实被撤回。" }],
    evidenceLinks: [{ eventId: "event-alpha", title: "Alpha Robotics 发布进展", url: "https://alpha.example/release", source: "Alpha Robotics", grade: "A" }],
    capital: { status: "evidence-insufficient", summary: "证据不足（不代表未融资）" },
  };
  return {
    week: "2026-W34",
    snapshotVersion: 1,
    methodologyVersion: "method-v1",
    lastSuccessfulAt: GENERATED_AT,
    companyIds: ["company-alpha"],
    forwardRadar: [card],
    validatedMomentum: [],
    changes: [],
    ...overrides,
  };
}

function readme(): string {
  return [
    "> 观察名单快照：2026-W34 · v1",
    "",
    "### 前瞻雷达",
    "",
    "- **[Alpha Robotics](https://mbabby.github.io/physical-ai-news-cn/companies.html#company-alpha)** · 重点关注 · 新进入",
    "  - 为什么现在值得看：AI 研究判断：Alpha Robotics 出现新的规范事实。",
    "",
    "### 验证动量",
    "",
    "- 暂无达到公开门槛的公司。",
  ].join("\n");
}

function release(overrides: Partial<Parameters<typeof validateWatchlistRelease>[0]> = {}) {
  return {
    snapshot: snapshot(),
    theses: artifact(),
    dashboard: { watchlist: view() },
    readme: readme(),
    ...overrides,
  };
}

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

test("release validation requires the current immutable history file with identical bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "watchlist-current-history-"));
  const currentPath = join(root, "watchlist", "current.json");
  const historyPath = join(root, "watchlist", "history", "2026-W34-v1.json");
  try {
    await mkdir(join(root, "watchlist", "history"), { recursive: true });
    await writeFile(currentPath, json(snapshot()));
    await assert.rejects(() => validateCurrentWatchlistHistoryFiles(root, snapshot()), /缺少.*不可变历史/);

    await writeFile(historyPath, json({ ...snapshot(), generatedAt: "2026-08-17T00:00:00.000Z" }));
    await assert.rejects(() => validateCurrentWatchlistHistoryFiles(root, snapshot()), /字节.*不一致/);

    await writeFile(historyPath, json(snapshot()));
    await assert.doesNotReject(() => validateCurrentWatchlistHistoryFiles(root, snapshot()));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a week mismatch across snapshot, dashboard and README", () => {
  assert.throws(() => validateWatchlistRelease(release({ dashboard: { watchlist: view({ week: "2026-W33" }) } })), /周.*不一致/);
});

test("rejects a broken exact thesis reference and methodology version mismatch", () => {
  assert.throws(() => validateWatchlistRelease(release({ theses: artifact([thesis({ thesisVersion: 2 })]) })), /判断版本/);
  assert.throws(() => validateWatchlistRelease(release({ theses: artifact([thesis({ methodologyVersion: "method-v2" })]) })), /方法论版本/);
});

test("rejects company-set mismatches in dashboard and README", () => {
  assert.throws(() => validateWatchlistRelease(release({ dashboard: { watchlist: view({ companyIds: [] }) } })), /公司集合/);
  assert.throws(() => validateWatchlistRelease(release({ readme: readme().replace("#company-alpha", "#company-beta") })), /公司集合/);
});

test("rejects public score, rank, candidate id and private diagnostics leakage", () => {
  for (const [target, leaked] of [
    ["snapshot", { ...snapshot(), selectionScore: 99 }],
    ["dashboard", { watchlist: { ...view(), rank: 1 } }],
    ["theses", { ...artifact(), theses: [{ ...thesis(), sentenceCitations: [] }] }],
  ] as const) {
    assert.throws(() => validateWatchlistRelease(release({ [target]: leaked })), /私有诊断|候选标识|分数|排名/);
  }
  assert.throws(() => validateWatchlistRelease(release({
    snapshot: snapshot({ forwardRadar: [{ ...snapshot().forwardRadar[0]!, companyId: "candidate-03950aa949fb" }] }),
  })), /候选标识/);
  assert.throws(() => validateWatchlistRelease(release({ readme: `${readme()}\n内部 rank: 1` })), /私有诊断|分数|排名/);
});

test("rejects falsified and expired selected theses", () => {
  assert.throws(() => validateWatchlistRelease(release({ theses: artifact([thesis({ lifecycle: "falsified" })]) })), /不可公开/);
  assert.throws(() => validateWatchlistRelease(release({ theses: artifact([thesis({ expiresAt: GENERATED_AT })]) })), /已过期/);
});

test("requires a visible AI research judgment disclosure", () => {
  assert.throws(() => validateWatchlistRelease(release({ readme: readme().replaceAll("AI 研究判断", "研究观察") })), /AI 研究判断/);
  assert.throws(() => validateWatchlistRelease(release({
    theses: artifact([thesis({ inferenceLabels: ["manual"] })]),
    history: [snapshot()],
  })), /判断标签.*AI 研究判断/);
});

test("an invalid staged snapshot leaves every public artifact unchanged", async () => {
  const root = await mkdtemp(join(tmpdir(), "watchlist-invalid-stage-"));
  const paths = [
    "watchlist/current.json",
    "watchlist/theses.json",
    "watchlist/history/2026-W34-v1.json",
    "site/data/dashboard.json",
    "README.md",
  ];
  try {
    for (const path of paths) {
      await mkdir(join(root, path, ".."), { recursive: true });
      await writeFile(join(root, path), `last-known-good:${path}\n`);
    }
    const before = await Promise.all(paths.map((path) => readFile(join(root, path), "utf8")));
    const transaction = new FileTransaction("invalid-watchlist-stage");
    await assert.rejects(() => stageWatchlistRelease({
      transaction,
      root,
      ...release({ dashboard: { watchlist: view({ week: "2026-W33" }) } }),
    }), /周.*不一致/);
    await transaction.commit();
    assert.deepEqual(await Promise.all(paths.map((path) => readFile(join(root, path), "utf8"))), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("failure injection rolls back the whole Watchlist public group", async () => {
  const root = await mkdtemp(join(tmpdir(), "watchlist-rollback-"));
  const existingPaths = [
    "watchlist/current.json",
    "watchlist/theses.json",
    "watchlist/history/2026-W34-v1.json",
    "site/data/dashboard.json",
    "README.md",
  ];
  const newHistoryPath = "watchlist/history/2026-W34-v2.json";
  try {
    for (const path of existingPaths) {
      await mkdir(join(root, path, ".."), { recursive: true });
      await writeFile(join(root, path), `last-known-good:${path}\n`);
    }
    const before = await Promise.all(existingPaths.map((path) => readFile(join(root, path), "utf8")));
    const transaction = new FileTransaction("watchlist-release-rollback", { failAfterSwaps: 3 });
    await stageWatchlistRelease({
      transaction,
      root,
      ...release({
        snapshot: snapshot({ snapshotVersion: 2 }),
        dashboard: { watchlist: view({ snapshotVersion: 2 }) },
        readme: readme().replace("v1", "v2"),
      }),
    });
    await assert.rejects(() => transaction.commit(), /已回滚/);
    assert.deepEqual(await Promise.all(existingPaths.map((path) => readFile(join(root, path), "utf8"))), before);
    await assert.rejects(() => readFile(join(root, newHistoryPath), "utf8"), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("immutable history rejects different bytes and accepts identical bytes idempotently", async () => {
  const root = await mkdtemp(join(tmpdir(), "watchlist-history-collision-"));
  try {
    const historyPath = join(root, "watchlist", "history", "2026-W34-v1.json");
    await mkdir(join(root, "watchlist", "history"), { recursive: true });
    await writeFile(historyPath, json({ ...snapshot(), generatedAt: "2026-08-17T00:00:00.000Z" }));
    await assert.rejects(() => stageWatchlistRelease({ transaction: new FileTransaction("history-different"), root, ...release() }), /历史快照.*冲突/);

    await rm(historyPath);
    const paths = [
      "watchlist/current.json",
      "watchlist/theses.json",
      "watchlist/history/2026-W34-v1.json",
      "site/data/dashboard.json",
      "README.md",
    ];
    const first = new FileTransaction("history-first-cycle");
    await stageWatchlistRelease({ transaction: first, root, ...release() });
    assert.equal(first.size, 5);
    await first.commit();
    const firstBytes = await Promise.all(paths.map((path) => readFile(join(root, path), "utf8")));

    const second = new FileTransaction("history-second-cycle");
    await stageWatchlistRelease({ transaction: second, root, ...release() });
    assert.equal(second.size, 4);
    await second.commit();
    assert.deepEqual(await Promise.all(paths.map((path) => readFile(join(root, path), "utf8"))), firstBytes);
    assert.equal(await readFile(historyPath, "utf8"), json(snapshot()));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("public thesis merge retains every exact version referenced by current and history", () => {
  const historicThesis = thesis({ thesisVersion: 1 });
  const currentThesis = thesis({ thesisVersion: 2, lifecycle: "strengthening", generatedAt: GENERATED_AT, expiresAt: "2026-10-16T01:00:00.000Z" });
  const history = snapshot({ week: "2026-W33", forwardRadar: [{ companyId: "company-alpha", thesisId: "thesis-alpha", thesisVersion: 1, group: "priority-focus" }] });
  const current = snapshot({ snapshotVersion: 2, forwardRadar: [{ companyId: "company-alpha", thesisId: "thesis-alpha", thesisVersion: 2, group: "priority-focus" }] });
  const merged = mergeWatchlistThesisArtifact({
    snapshot: current,
    histories: [history],
    previous: artifact([historicThesis]),
    candidates: [currentThesis],
  });
  assert.deepEqual(merged.theses.map((item) => [item.thesisId, item.thesisVersion]), [["thesis-alpha", 1], ["thesis-alpha", 2]]);
  assert.throws(() => mergeWatchlistThesisArtifact({
    snapshot: current,
    histories: [history],
    previous: artifact([historicThesis]),
    candidates: [{ ...currentThesis, whyNow: "AI 研究判断：冲突版本。" }, currentThesis],
  }), /判断版本.*冲突/);
});
