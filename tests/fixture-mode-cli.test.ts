import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseCliOptions, runFixtureGeneration } from "../src/main.js";
import { FileTransaction } from "../src/runtime/storage.js";
import type { DailyArchive, RunManifest } from "../src/types.js";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_PATHS = [
  "README.md", "daily", "weekly", "sources", "review", "resources", "events", "experiments", "research", "routes",
  "metrics", "site/data", "site/feeds", "watchlist", "community",
];
const COMMUNITY_PATHS = [
  "review/evidence-task-seeds.json", "review/evidence-issue-snapshot.json", "review/evidence-task-ledger.json",
  "review/accepted-evidence.json", "review/accepted-evidence-revalidation.json", "community/contributions.json", "site/data/community-tasks.json",
];

async function fixtureCopy(target: string): Promise<void> {
  await mkdir(target, { recursive: true });
  for (const path of FIXTURE_PATHS) {
    try { await cp(join(repositoryRoot, path), join(target, path), { recursive: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  await Promise.all(COMMUNITY_PATHS.map((path) => rm(join(target, path), { force: true })));
}

async function bytes(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const visit = async (path: string): Promise<void> => {
    for (const name of (await readdir(path)).sort()) {
      const child = join(path, name);
      const details = await stat(child);
      if (details.isDirectory()) await visit(child);
      else result[relative(root, child)] = await readFile(child, "utf8");
    }
  };
  await visit(root);
  return result;
}

async function runFixtureCli(root: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/main.ts", "--", "--fixture", "--output-root", root], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        LLM_API_KEY: "must-not-be-used",
        LLM_BASE_URL: "https://fixture-network.invalid/v1",
        LLM_MODEL: "must-not-be-used",
        OPENALEX_API_KEY: "must-not-be-used",
        GITHUB_TOKEN: "must-not-be-used",
        GITHUB_REPOSITORY: "attacker/repository",
        X_BEARER_TOKEN: "must-not-be-used",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`fixture CLI exited ${code}: ${stderr || stdout}`)));
  });
}

test("parses documented fixture flags and scopes output root to fixture mode", () => {
  assert.deepEqual(parseCliOptions(["--", "--fixture", "--output-root", "/tmp/physical-ai-fixture"]), {
    fixtureMode: true,
    fixtureRoot: "/tmp/physical-ai-fixture",
  });
  assert.deepEqual(parseCliOptions(["--fixture-mode", "--fixture-root", "/tmp/physical-ai-fixture"]), {
    fixtureMode: true,
    fixtureRoot: "/tmp/physical-ai-fixture",
  });
  assert.deepEqual(parseCliOptions(["--hours", "48"]), { fixtureMode: false, fixtureRoot: undefined });
  assert.throws(() => parseCliOptions(["--output-root", "/tmp/not-allowed"]), /fixture/);
  assert.throws(() => parseCliOptions(["--fixture", "--output-root", ""]), /output-root requires a path/);
  assert.throws(() => parseCliOptions(["--fixture", "--output-root", "   "]), /output-root requires a path/);
  assert.throws(() => parseCliOptions(["--fixture", "--output-root", "--hours"]), /output-root requires a path/);
});

test("fixture CLI is offline, fixed-clock, transactional, byte-stable, and leaves its worktree unchanged", async () => {
  const firstRoot = await mkdtemp(join(tmpdir(), "physical-ai-fixture-cli-first-"));
  const secondRoot = await mkdtemp(join(tmpdir(), "physical-ai-fixture-cli-second-"));
  const repositoryBefore = await mkdtemp(join(tmpdir(), "physical-ai-fixture-before-"));
  const repositoryAfter = await mkdtemp(join(tmpdir(), "physical-ai-fixture-after-"));
  try {
    await fixtureCopy(repositoryBefore);
    const firstRun = await runFixtureCli(firstRoot);
    const first = await bytes(firstRoot);
    const secondRun = await runFixtureCli(secondRoot);
    const second = await bytes(secondRoot);
    const changedPaths = [...new Set([...Object.keys(first), ...Object.keys(second)])]
      .filter((path) => first[path] !== second[path]);
    assert.deepEqual(changedPaths, [], `fixture roots differ: ${changedPaths.join(", ")}`);
    assert.equal(firstRun.stderr, "");
    assert.equal(secondRun.stderr, "");

    const manifest = JSON.parse(first["review/run-manifest.json"]!) as RunManifest;
    const history = JSON.parse(first["review/run-history.json"]!) as { runs: RunManifest[] };
    const archive = JSON.parse(first[`daily/${manifest.date}.json`]!) as DailyArchive;
    assert.equal(manifest.startedAt, "2026-08-24T08:05:05.893Z");
    assert.equal(manifest.finishedAt, manifest.startedAt);
    assert.deepEqual(history.runs.find((run) => run.runId === manifest.runId), manifest);
    assert.deepEqual(archive.sourceOutcomes, []);
    assert.deepEqual(manifest.services.filter((item) => item.component === "LLM" || item.component === "OpenAlex")
      .map((item) => [item.component, item.status, item.attempted]), [["LLM", "未配置", 0], ["OpenAlex", "未配置", 0]]);
    assert.deepEqual(manifest.services.find((item) => item.component === "GitHub")
      && [manifest.services.find((item) => item.component === "GitHub")!.status,
        manifest.services.find((item) => item.component === "GitHub")!.attempted], ["成功", 1]);
    assert.deepEqual(manifest.services.find((item) => item.component === "EvidenceRevalidation")
      && [manifest.services.find((item) => item.component === "EvidenceRevalidation")!.status,
        manifest.services.find((item) => item.component === "EvidenceRevalidation")!.attempted], ["成功", 0]);
    for (const path of COMMUNITY_PATHS) assert.ok(first[path], `${path} must be staged by the real transaction`);
    const firstDraft = await readFile(join(firstRoot, "review", "top-signals-drafts", "2026-W36.json"), "utf8");
    const secondDraft = await readFile(join(secondRoot, "review", "top-signals-drafts", "2026-W36.json"), "utf8");
    assert.ok(firstDraft.length > 0, "fixture must stage the W36 Top Signals draft");
    assert.equal(secondDraft, firstDraft, "two fixture roots must stage identical Top Signals drafts");
    assert.match(firstRun.stdout, /完成/);
    await fixtureCopy(repositoryAfter);
    assert.deepEqual(await bytes(repositoryAfter), await bytes(repositoryBefore));
  } finally {
    await Promise.all([firstRoot, secondRoot, repositoryBefore, repositoryAfter].map((path) => rm(path, { recursive: true, force: true })));
  }
});

test("fixture runner restores every pre-run byte after an injected transaction failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "physical-ai-fixture-runner-"));
  try {
    await fixtureCopy(root);
    const before = await bytes(root);
    await assert.rejects(() => runFixtureGeneration(root, new FileTransaction("fixture-rollback", { failAfterSwaps: 1 })), /transaction|事务|failed/i);
    assert.deepEqual(await bytes(root), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fixture runner isolates an existing immutable Watchlist identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "physical-ai-fixture-watchlist-"));
  try {
    await fixtureCopy(root);
    const historyPath = join(root, "watchlist", "history", "2026-W35-v1.json");
    await mkdir(dirname(historyPath), { recursive: true });
    await writeFile(historyPath, '{"sentinel":"must-not-enter-fixture-generation"}\n', "utf8");
    await runFixtureGeneration(root);
    const generated = JSON.parse(await readFile(historyPath, "utf8")) as { week?: string; snapshotVersion?: number; sentinel?: string };
    assert.equal(generated.week, "2026-W35");
    assert.equal(generated.snapshotVersion, 1);
    assert.equal(generated.sentinel, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fixture runner rejects an unrecognized root before creating publication paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "physical-ai-unsafe-root-"));
  try {
    await assert.rejects(() => runFixtureGeneration(root), /fixture root|夹具根目录/i);
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fixture CLI rejects an unrecognized output root before acquiring a lock", async () => {
  const parent = await mkdtemp(join(tmpdir(), "physical-ai-unsafe-cli-root-"));
  const root = join(parent, "unrecognized");
  try {
    await assert.rejects(() => runFixtureCli(root), /generation-failed/);
    await assert.rejects(stat(root), { code: "ENOENT" });
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
