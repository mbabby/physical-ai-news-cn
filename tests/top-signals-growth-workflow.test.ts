import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { stableDecisionId, type DecisionProductArtifact } from "../src/decision-products/contracts.js";
import { FileTransaction } from "../src/runtime/storage.js";
import { topSignalsContentSha256, type TopSignalsApproval, type TopSignalsDraft } from "../src/top-signals-growth/contracts.js";
import {
  prepareTopSignalsRelease,
  publishTopSignalsRelease,
  resolveTopSignalsReleaseRun,
} from "../src/top-signals-growth/publish.js";
import { renderTopSignalsRelease } from "../src/top-signals-growth/render.js";

const CONFIG = {
  schemaVersion: 1,
  experimentId: "github-top-signals-2026-08",
  startDate: "2026-08-31",
  endDate: "2026-09-13",
  manualWeek: "2026-W36",
  automaticWeek: "2026-W37",
  baselineStars: 1,
  targetStars: 11,
  targetExternalAuthors: 3,
  minSignals: 3,
  maxSignals: 5,
  maxSignalsPerEntity: 2,
  maxSignalsPerKind: 3,
  channels: ["github-release", "readme", "github-value-contribution"],
} as const;
const execFileAsync = promisify(execFile);
const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function draftFixture(week: "2026-W36" | "2026-W37" = "2026-W37"): TopSignalsDraft {
  return {
    schemaVersion: 1,
    experimentId: CONFIG.experimentId,
    week,
    generatedAt: week === "2026-W36" ? "2026-09-03T10:00:00.000Z" : "2026-09-10T10:00:00.000Z",
    periodStart: week === "2026-W36" ? "2026-08-31" : "2026-09-07",
    periodEnd: week === "2026-W36" ? "2026-09-06" : "2026-09-13",
    signals: Array.from({ length: 3 }, (_, index) => {
      const eventId = `event-${index + 1}`;
      const url = `https://alpha.example/news/${index + 1}`;
      return {
        signalId: stableDecisionId("signal", eventId),
        eventId,
        entityId: `company-${index + 1}`,
        entityName: `Alpha Robotics ${index + 1}`,
        titleZh: `Alpha Robotics 发布进展 ${index + 1}`,
        factsZh: [`Alpha Robotics 发布进展 ${index + 1}。`, `该进展已获得公开证据支持 ${index + 1}。`],
        kind: "投融资" as const,
        routes: ["本体与硬件" as const],
        occurredAt: week === "2026-W36" ? "2026-09-02T02:00:00.000Z" : "2026-09-09T02:00:00.000Z",
        verifiedAt: week === "2026-W36" ? "2026-09-03T01:00:00.000Z" : "2026-09-10T01:00:00.000Z",
        changedThisWeek: true,
        evidenceState: "official" as const,
        evidence: [{ evidenceId: stableDecisionId("evidence", `${eventId}\n${url}`), url, source: "Alpha Robotics", grade: "A" as const }],
        impact: ["company" as const, "capital" as const],
        whyItMatters: "AI 研究判断：该事件为相关公司与技术路线带来新的资本信号。",
        rankReasons: ["本周发生实质变化", "官方一手证据", "资本事件"],
        nextValidationPoint: "核验资金到账与研发计划进展。",
        scoreBreakdown: { industryCapitalImpact: 5, evidenceQuality: 5, recency: 5, informationGain: 4, strategicRelevance: 4, total: 23 },
      };
    }),
  };
}

async function fixtureRoot(draft: TopSignalsDraft, approval?: TopSignalsApproval): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "top-signals-release-first-"));
  await mkdir(join(root, "experiments"), { recursive: true });
  await mkdir(join(root, "review", "top-signals-drafts"), { recursive: true });
  await mkdir(join(root, "site", "data"), { recursive: true });
  const decisionProducts: DecisionProductArtifact = {
    schemaVersion: 1,
    generatedAt: draft.generatedAt,
    periodStart: draft.periodStart,
    topSignals: draft.signals.map(({ nextValidationPoint: _next, scoreBreakdown: _score, ...signal }) => signal),
    companyCards: [],
    researchPassports: [],
    subscriptions: { generatedAt: draft.generatedAt, entries: [] },
  };
  await writeFile(join(root, "experiments", "top-signals-growth.json"), `${JSON.stringify(CONFIG, null, 2)}\n`);
  await writeFile(join(root, "review", "top-signals-drafts", `${draft.week}.json`), `${JSON.stringify(draft, null, 2)}\n`);
  await writeFile(join(root, "site", "data", "decision-products.json"), `${JSON.stringify(decisionProducts, null, 2)}\n`);
  if (approval) {
    await mkdir(join(root, "review", "top-signals-approvals"), { recursive: true });
    await writeFile(join(root, "review", "top-signals-approvals", `${draft.week}.json`), `${JSON.stringify(approval, null, 2)}\n`);
  }
  await writeFile(join(root, "README.md"), "before\n<!-- DECISION_SIGNALS_START -->\n\nold\n\n<!-- DECISION_SIGNALS_END -->\nafter\n");
  return root;
}

const readJson = async <T>(path: string): Promise<T> => JSON.parse(await readFile(path, "utf8")) as T;

test("prepare writes exact Release notes and a publishable gate to the caller directory", async () => {
  const draft = draftFixture();
  const root = await fixtureRoot(draft);
  const out = await mkdtemp(join(tmpdir(), "top-signals-prepare-"));
  try {
    const prepared = await prepareTopSignalsRelease(root, draft.week, out);
    assert.equal(prepared.gate.status, "publishable");
    assert.equal(await readFile(join(out, "notes.md"), "utf8"), `${renderTopSignalsRelease(draft)}\n`);
    assert.deepEqual(await readJson(join(out, "gate.json")), prepared.gate);
    assert.deepEqual(prepared.draft, draft);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(out, { recursive: true, force: true });
  }
});

test("prepare rejects a draft that no longer matches the current canonical Decision Product", async () => {
  const draft = draftFixture();
  const root = await fixtureRoot(draft);
  const out = await mkdtemp(join(tmpdir(), "top-signals-stale-prepare-"));
  try {
    const path = join(root, "site", "data", "decision-products.json");
    const artifact = await readJson<DecisionProductArtifact>(path);
    artifact.topSignals[0]!.titleZh = "当前 Decision Product 已更新标题";
    await writeFile(path, `${JSON.stringify(artifact, null, 2)}\n`);
    await assert.rejects(() => prepareTopSignalsRelease(root, draft.week, out), /Decision Product|canonical|规范/i);
    await assert.rejects(() => access(join(out, "notes.md")));
    await assert.rejects(() => access(join(out, "gate.json")));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(out, { recursive: true, force: true });
  }
});

test("release trigger resolution limits manual W36 and scheduled W37 to the fixed experiment", () => {
  assert.deepEqual(resolveTopSignalsReleaseRun({ eventName: "workflow_dispatch", requestedWeek: "2026-W36", today: "2026-09-03", config: CONFIG }), {
    run: true,
    week: "2026-W36",
  });
  assert.deepEqual(resolveTopSignalsReleaseRun({ eventName: "schedule", today: "2026-09-03", config: CONFIG }), { run: false, week: null });
  assert.deepEqual(resolveTopSignalsReleaseRun({ eventName: "schedule", today: "2026-09-10", config: CONFIG }), { run: true, week: "2026-W37" });
  assert.deepEqual(resolveTopSignalsReleaseRun({ eventName: "schedule", today: "2026-09-17", config: CONFIG }), { run: false, week: null });
  assert.throws(() => resolveTopSignalsReleaseRun({ eventName: "workflow_dispatch", requestedWeek: "2026-W37", today: "2026-09-10", config: CONFIG }), /manual|dispatch|W36/i);
});

test("prepare writes stable blocked reasons before exiting non-zero", async () => {
  const draft = draftFixture("2026-W36");
  const root = await fixtureRoot(draft);
  const firstOut = await mkdtemp(join(tmpdir(), "top-signals-blocked-first-"));
  const secondOut = await mkdtemp(join(tmpdir(), "top-signals-blocked-second-"));
  try {
    await assert.rejects(() => prepareTopSignalsRelease(root, draft.week, firstOut), /缺少人工批准/);
    await assert.rejects(() => prepareTopSignalsRelease(root, draft.week, secondOut), /缺少人工批准/);
    const first = await readJson<{ status: string; reasons: string[] }>(join(firstOut, "gate.json"));
    const second = await readJson<{ status: string; reasons: string[] }>(join(secondOut, "gate.json"));
    assert.equal(first.status, "blocked");
    assert.deepEqual(first.reasons, ["缺少人工批准"]);
    assert.deepEqual(second.reasons, first.reasons);
    assert.equal(await readFile(join(firstOut, "notes.md"), "utf8"), `${renderTopSignalsRelease(draft)}\n`);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(firstOut, { recursive: true, force: true });
    await rm(secondOut, { recursive: true, force: true });
  }
});

test("blocked prepare CLI exits non-zero without contacting GitHub", async () => {
  const draft = draftFixture("2026-W36");
  const root = await fixtureRoot(draft);
  const out = await mkdtemp(join(tmpdir(), "top-signals-blocked-cli-"));
  try {
    await assert.rejects(
      () => execFileAsync(process.execPath, [
        "--import", "tsx", join(repositoryRoot, "src", "top-signals-growth", "cli.ts"),
        "prepare", "--root", root, "--week", draft.week, "--out", out,
      ], { cwd: repositoryRoot }),
      (error: unknown) => {
        const result = error as { code?: number; stderr?: string };
        return result.code === 1 && Boolean(result.stderr?.includes("缺少人工批准"));
      },
    );
    assert.deepEqual((await readJson<{ reasons: string[] }>(join(out, "gate.json"))).reasons, ["缺少人工批准"]);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(out, { recursive: true, force: true });
  }
});

test("prepare rejects unconfigured and mismatched weeks", async () => {
  const draft = draftFixture();
  const root = await fixtureRoot(draft);
  const out = await mkdtemp(join(tmpdir(), "top-signals-invalid-week-"));
  try {
    await assert.rejects(() => prepareTopSignalsRelease(root, "2026-W38", out), /configured|配置|week|周/i);
    await writeFile(join(root, "review", "top-signals-drafts", "2026-W36.json"), `${JSON.stringify(draft, null, 2)}\n`);
    await assert.rejects(() => prepareTopSignalsRelease(root, "2026-W36", out), /match|匹配|week|周/i);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(out, { recursive: true, force: true });
  }
});

test("publish atomically writes archives, Latest, receipt and README after a canonical Release URL", async () => {
  const draft = draftFixture();
  const root = await fixtureRoot(draft);
  const releaseUrl = `https://github.com/mbabby/physical-ai-news-cn/releases/tag/top-signals-${draft.week}`;
  const publishedAt = "2026-09-10T13:05:00.000Z";
  try {
    const published = await publishTopSignalsRelease({ root, draft, releaseUrl, publishedAt });
    const archivePath = join(root, "weekly", "top-signals", `${draft.week}.json`);
    const archiveBytes = await readFile(archivePath, "utf8");
    assert.deepEqual(JSON.parse(archiveBytes), published);
    assert.equal(await readFile(join(root, "weekly", "top-signals", "latest.json"), "utf8"), archiveBytes);
    assert.equal(await readFile(join(root, "weekly", "top-signals", `${draft.week}.md`), "utf8"), `${renderTopSignalsRelease(draft)}\n`);
    assert.deepEqual(await readJson(join(root, "review", "top-signals-publication-receipt.json")), {
      schemaVersion: 1,
      experimentId: draft.experimentId,
      week: draft.week,
      contentSha256: topSignalsContentSha256(draft),
      releaseUrl,
      publishedAt,
    });
    const readme = await readFile(join(root, "README.md"), "utf8");
    assert.deepEqual([...readme.matchAll(/<!-- top-signal:([^ ]+) -->/g)].map((match) => match[1]), draft.signals.map((item) => item.signalId));
    assert.match(readme, new RegExp(releaseUrl.replace(/[.?]/g, "\\$&")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("publish rejects a noncanonical Release URL without changing public files", async () => {
  const draft = draftFixture();
  const root = await fixtureRoot(draft);
  const before = await readFile(join(root, "README.md"), "utf8");
  try {
    await assert.rejects(() => publishTopSignalsRelease({
      root,
      draft,
      releaseUrl: "https://github.com/mbabby/physical-ai-news-cn/releases/tag/wrong-tag",
      publishedAt: "2026-09-10T13:05:00.000Z",
    }), /canonical|规范|Release URL/i);
    assert.equal(await readFile(join(root, "README.md"), "utf8"), before);
    await assert.rejects(() => access(join(root, "weekly", "top-signals", "latest.json")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an identical publish retry reuses the original timestamp and bytes", async () => {
  const draft = draftFixture();
  const root = await fixtureRoot(draft);
  const releaseUrl = `https://github.com/mbabby/physical-ai-news-cn/releases/tag/top-signals-${draft.week}`;
  const paths = [
    `weekly/top-signals/${draft.week}.json`,
    `weekly/top-signals/${draft.week}.md`,
    "weekly/top-signals/latest.json",
    "review/top-signals-publication-receipt.json",
    "README.md",
  ];
  try {
    const first = await publishTopSignalsRelease({ root, draft, releaseUrl, publishedAt: "2026-09-10T13:05:00.000Z" });
    const before = await Promise.all(paths.map((path) => readFile(join(root, path), "utf8")));
    const retry = await publishTopSignalsRelease({ root, draft, releaseUrl, publishedAt: "2026-09-10T13:10:00.000Z" });
    assert.deepEqual(retry, first);
    assert.equal(retry.publishedAt, "2026-09-10T13:05:00.000Z");
    assert.deepEqual(await Promise.all(paths.map((path) => readFile(join(root, path), "utf8"))), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a published week cannot be replaced with different canonical content", async () => {
  const draft = draftFixture();
  const root = await fixtureRoot(draft);
  const releaseUrl = `https://github.com/mbabby/physical-ai-news-cn/releases/tag/top-signals-${draft.week}`;
  try {
    await publishTopSignalsRelease({ root, draft, releaseUrl, publishedAt: "2026-09-10T13:05:00.000Z" });
    const before = await readFile(join(root, "weekly", "top-signals", `${draft.week}.json`), "utf8");
    const changed = structuredClone(draft);
    changed.signals[0]!.titleZh = "修改后的已发布标题";
    await assert.rejects(() => publishTopSignalsRelease({
      root,
      draft: changed,
      releaseUrl,
      publishedAt: "2026-09-10T13:10:00.000Z",
    }), /already published|已发布|replace|替换/i);
    assert.equal(await readFile(join(root, "weekly", "top-signals", `${draft.week}.json`), "utf8"), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("publish rolls back every public surface when one atomic swap fails", async () => {
  const draft = draftFixture();
  const root = await fixtureRoot(draft);
  const before = await readFile(join(root, "README.md"), "utf8");
  const transaction = new FileTransaction("top-signals-publication-failure", { failAfterSwaps: 3 });
  try {
    await assert.rejects(() => publishTopSignalsRelease({
      root,
      draft,
      releaseUrl: `https://github.com/mbabby/physical-ai-news-cn/releases/tag/top-signals-${draft.week}`,
      publishedAt: "2026-09-10T13:05:00.000Z",
      transaction,
    }), /事务|transaction|回滚/i);
    assert.equal(await readFile(join(root, "README.md"), "utf8"), before);
    for (const path of [
      `weekly/top-signals/${draft.week}.json`,
      `weekly/top-signals/${draft.week}.md`,
      "weekly/top-signals/latest.json",
      "review/top-signals-publication-receipt.json",
    ]) await assert.rejects(() => access(join(root, path)), undefined, path);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
