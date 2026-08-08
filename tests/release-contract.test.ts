import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validatePublicationArtifacts } from "../src/runtime/validation.js";
import type { DailyArchive, RunHistory, RunManifest } from "../src/types.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const json = async <T>(path: string): Promise<T> => JSON.parse(await readFile(path, "utf8")) as T;

test("checked-in publication artifacts satisfy the cross-file contract", async () => {
  const manifest = await json<RunManifest>(join(root, "review", "run-manifest.json"));
  const archive = await json<DailyArchive>(join(root, "daily", `${manifest.date}.json`));
  const history = await json<RunHistory>(join(root, "review", "run-history.json"));
  assert.doesNotThrow(() => validatePublicationArtifacts(archive, manifest, history));
});

test("daily workflow retains deadlines, serialization and release gates", async () => {
  const workflow = await readFile(join(root, ".github", "workflows", "daily-digest.yml"), "utf8");
  assert.match(workflow, /timeout-minutes:\s*22/);
  assert.match(workflow, /group:\s*daily-physical-ai-digest/);
  assert.match(workflow, /timeout --signal=TERM --kill-after=30s 15m/);
  assert.match(workflow, /pnpm run validate:release/);
  assert.match(workflow, /review\/pipeline-health\.json/);
});

test("independent watchdog checks freshness without write permissions", async () => {
  const workflow = await readFile(join(root, ".github", "workflows", "pipeline-health.yml"), "utf8");
  assert.match(workflow, /cron: "17 \*\/3 \* \* \*"/);
  assert.match(workflow, /contents:\s*read/);
  assert.doesNotMatch(workflow, /contents:\s*write/);
  assert.match(workflow, /pnpm run validate:health/);
});
