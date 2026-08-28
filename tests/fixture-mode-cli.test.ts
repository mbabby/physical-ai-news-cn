import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseCliOptions, runFixtureGeneration } from "../src/main.js";
import { FileTransaction } from "../src/runtime/storage.js";
import type { DailyArchive, RunManifest } from "../src/types.js";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_PATHS = [
  "README.md", "daily", "weekly", "sources", "review", "resources", "events", "research", "routes",
  "metrics", "site/data", "site/feeds", "watchlist", "community",
];
const COMMUNITY_PATHS = [
  "review/evidence-task-seeds.json", "review/evidence-issue-snapshot.json", "review/evidence-task-ledger.json",
  "review/accepted-evidence.json", "community/contributions.json", "site/data/community-tasks.json",
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
    const child = spawn(process.execPath, ["--import", "tsx", "src/main.ts", "--", "--fixture-mode", "--fixture-root", root], {
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

test("parses pnpm's separator and scopes fixture root to fixture mode", () => {
  assert.deepEqual(parseCliOptions(["--", "--fixture-mode", "--fixture-root", "/tmp/physical-ai-fixture"]), {
    fixtureMode: true,
    fixtureRoot: "/tmp/physical-ai-fixture",
  });
  assert.deepEqual(parseCliOptions(["--hours", "48"]), { fixtureMode: false, fixtureRoot: undefined });
  assert.throws(() => parseCliOptions(["--fixture-root", "/tmp/not-allowed"]), /fixture-mode/);
});

test("fixture CLI is offline, fixed-clock, transactional, and byte-stable across two runs", async () => {
  const root = await mkdtemp(join(tmpdir(), "physical-ai-fixture-cli-"));
  try {
    await fixtureCopy(root);
    const firstRun = await runFixtureCli(root);
    const first = await bytes(root);
    const secondRun = await runFixtureCli(root);
    const second = await bytes(root);
    const changedPaths = [...new Set([...Object.keys(first), ...Object.keys(second)])]
      .filter((path) => first[path] !== second[path]);
    assert.deepEqual(changedPaths, [], `fixture rerun changed: ${changedPaths.join(", ")}`);
    assert.equal(firstRun.stderr, "");
    assert.equal(secondRun.stderr, "");

    const manifest = JSON.parse(first["review/run-manifest.json"]!) as RunManifest;
    const archive = JSON.parse(first[`daily/${manifest.date}.json`]!) as DailyArchive;
    assert.equal(manifest.startedAt, "2026-08-24T08:05:05.893Z");
    assert.equal(manifest.finishedAt, manifest.startedAt);
    assert.deepEqual(archive.sourceOutcomes, []);
    assert.deepEqual(manifest.services.filter((item) => item.component === "LLM" || item.component === "OpenAlex")
      .map((item) => [item.component, item.status, item.attempted]), [["LLM", "未配置", 0], ["OpenAlex", "未配置", 0]]);
    assert.deepEqual(manifest.services.find((item) => item.component === "GitHub")
      && [manifest.services.find((item) => item.component === "GitHub")!.status,
        manifest.services.find((item) => item.component === "GitHub")!.attempted], ["成功", 1]);
    for (const path of COMMUNITY_PATHS) assert.ok(first[path], `${path} must be staged by the real transaction`);
    assert.match(firstRun.stdout, /完成/);
  } finally {
    await rm(root, { recursive: true, force: true });
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

test("fixture runner rejects an unrecognized root before creating publication paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "physical-ai-unsafe-root-"));
  try {
    await assert.rejects(() => runFixtureGeneration(root), /fixture root|夹具根目录/i);
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
