import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MISSING_FRESHNESS_SELECTOR = 'type == "object" and .dailyPublicationFreshness.state == "missing"';

function job(workflow: string, id: string): string {
  const start = workflow.indexOf(`  ${id}:\n`);
  assert.notEqual(start, -1, `workflow must define the ${id} job`);
  const remaining = workflow.slice(start);
  const next = remaining.slice(1).search(/\n  [A-Za-z0-9_-]+:\n/);
  return next === -1 ? remaining : remaining.slice(0, next + 1);
}

test("pipeline health recovery dispatches only missing 09:25 Shanghai digests", async () => {
  const workflow = await readFile(join(root, ".github", "workflows", "pipeline-health.yml"), "utf8");
  const recovery = job(workflow, "recover_missing_daily");
  const globalPermissions = workflow.split("\njobs:")[0]!;

  assert.match(workflow, /cron:\s*["']25 1 \* \* \*["']/);
  assert.match(globalPermissions, /contents:\s*read/);
  assert.doesNotMatch(globalPermissions, /actions:\s*write/);
  assert.match(recovery, /permissions:\s*\n\s*contents:\s*read\s*\n\s*actions:\s*write/);
  assert.doesNotMatch(workflow, /contents:\s*write/);
  assert.match(recovery, /github\.event\.schedule\s*==\s*['"]25 1 \* \* \*['"]/);
  assert.match(recovery, /pnpm run validate:health/);
  assert.match(recovery, /jq -e\s+['"]type == "object" and \.dailyPublicationFreshness\.state == "missing"['"]/);
  assert.match(recovery, /gh run list\s+--workflow\s+["']Daily physical AI digest["']/);
  assert.match(recovery, /--status\s+in_progress/);
  assert.match(recovery, /--status\s+queued/);
  assert.match(recovery, /gh workflow run\s+["']Daily physical AI digest["']\s+--ref\s+main\s+-f\s+recovery=true/);
  assert.equal((recovery.match(/gh workflow run/g) ?? []).length, 1, "recovery may dispatch once per watchdog run");
  assert.ok(recovery.indexOf("dailyPublicationFreshness.state") < recovery.indexOf("gh workflow run"), "freshness must be checked before dispatch");
  assert.match(recovery, /GITHUB_STEP_SUMMARY/);
  assert.doesNotMatch(recovery, /git\s+(?:add|commit|push)\b/);
});

test("recovery freshness selector fail-closes for absent or empty health JSON", () => {
  const matchesMissing = (input: string): boolean => spawnSync("jq", ["-e", MISSING_FRESHNESS_SELECTOR], {
    input,
    encoding: "utf8",
  }).status === 0;

  for (const healthJson of ["", "{}", '{"dailyPublicationFreshness": {}}', '{"dailyPublicationFreshness": {"state": "current"}}']) {
    assert.equal(matchesMissing(healthJson), false, `health JSON must not dispatch recovery: ${healthJson || "<empty>"}`);
  }
  assert.equal(matchesMissing('{"dailyPublicationFreshness": {"state": "missing"}}'), true);
});

test("daily digest recovery is receipt-aware while force remains manual-only", async () => {
  const workflow = await readFile(join(root, ".github", "workflows", "daily-digest.yml"), "utf8");
  const decision = workflow.split("- name: Decide whether the fallback run is needed")[1]?.split("- uses: actions/setup-node@v5")[0];

  assert.match(workflow, /workflow_dispatch:\s*\n\s*inputs:[\s\S]*?\n\s*recovery:/);
  assert.match(workflow, /recovery:[\s\S]*?type:\s*boolean[\s\S]*?default:\s*false/);
  assert.match(workflow, /force:[\s\S]*?type:\s*boolean[\s\S]*?default:\s*false/);
  assert.ok(decision, "daily workflow must retain its pre-generation decision step");
  assert.match(decision, /inputs\.recovery/);
  assert.match(decision, /review\/run-manifest\.json/);
  assert.match(decision, /\.date\s*==\s*\$digest_date/);
  assert.match(decision, /\.status\s*!=\s*["']failed["']/);
  assert.match(decision, /publicIndustryItems/);
  assert.match(decision, /publicResearchItems/);
  assert.match(decision, /run=false/);
  assert.match(decision, /inputs\.force/);
  assert.doesNotMatch(decision, /git\s+(?:add|commit|push)\b/);
});
