import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

test("weekly evidence automation delegates its five-Issue WIP lifecycle to the pure planner", async () => {
  const workflow = await readFile(join(root, ".github", "workflows", "materialize-review-issues.yml"), "utf8");

  assert.match(workflow, /schedule:/);
  assert.match(workflow, /cron: ['"]30 1 \* \* 1['"]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /dry_run/);
  assert.match(workflow, /actions\/checkout@v5/);
  assert.match(workflow, /pnpm install --frozen-lockfile/);
  assert.match(workflow, /gh api --paginate/);
  assert.match(workflow, /\$RUNNER_TEMP/);
  assert.match(workflow, /review\/evidence-task-seeds\.json/);
  assert.match(workflow, /review\/evidence-task-ledger\.json/);
  assert.match(workflow, /src\/community-evidence\/plan-issue-actions\.ts/);
  assert.match(workflow, /--wip-limit 5/);
  assert.match(workflow, /two-minute-task/);
  assert.match(workflow, /evidence-task-company-funding/);
  assert.match(workflow, /evidence-task-product-deployment/);
  assert.match(workflow, /evidence-task-research-metadata/);
});

test("weekly evidence automation previews or idempotently applies only planner Issue actions", async () => {
  const workflow = await readFile(join(root, ".github", "workflows", "materialize-review-issues.yml"), "utf8");

  assert.match(workflow, /create\)/);
  assert.match(workflow, /mark-stale\)/);
  assert.match(workflow, /close\)/);
  assert.match(workflow, /gh issue create/);
  assert.match(workflow, /--add-label "stale"/);
  assert.match(workflow, /gh issue close/);
  assert.match(workflow, /DRY_RUN.*true/s);
  assert.match(workflow, /jq[\s\S]*\.actions/);
  assert.match(workflow, /accepted-evidence/);
  assert.match(workflow, /不会.*自动.*公开|不会.*自动.*发布/);

  assert.doesNotMatch(workflow, /git\s+(?:add|commit|push)\b/);
  assert.doesNotMatch(workflow, /(?:>|>>|tee|cp|mv|install|sed\s+-i)[^\n]*(?:events\/|company-profiles|research-cards|README|site\/data)/i);
  assert.doesNotMatch(workflow, /review\/watchlist-issue-seeds\.json/);
});
