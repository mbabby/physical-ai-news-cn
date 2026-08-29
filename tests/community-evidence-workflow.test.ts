import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { assertEvidenceIssueSnapshot } from "../src/community-evidence/contracts.js";

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
  assert.match(workflow, /--wip-limit "\$REQUESTED_LIMIT"/);
  assert.doesNotMatch(workflow, /\.actions\[\].*\[:\s*\$limit\]/s);
  assert.match(workflow, /two-minute-task/);
  assert.match(workflow, /evidence-task-company-funding/);
  assert.match(workflow, /evidence-task-product-deployment/);
  assert.match(workflow, /evidence-task-research-metadata/);
  for (const label of [
    "evidence-task",
    "two-minute-task",
    "evidence-task-company-funding",
    "evidence-task-product-deployment",
    "evidence-task-research-metadata",
    "stale",
    "accepted-evidence",
    "rejected-evidence",
    "canonical-promoted",
    "source-withdrawn",
  ]) {
    assert.match(workflow, new RegExp(`gh label create ${label} .* --force`));
  }
});

test("Issue snapshot export aborts on malformed, duplicate, or conflicting task markers", async () => {
  const workflow = await readFile(join(root, ".github", "workflows", "materialize-review-issues.yml"), "utf8");
  const filter = /jq -s --arg fetchedAt "\$NOW" --arg repo "\$REPO" '\n([\s\S]*?)\n\s*' "\$ENRICHED_ISSUES"/.exec(workflow)?.[1];
  assert.ok(filter, "workflow Issue snapshot JQ filter must be extractable");

  const validId = "evidence-task-0123456789abcdef01234567";
  const conflictingId = "evidence-task-fedcba987654321001234567";
  const baseIssue = {
    number: 41,
    state: "open",
    labels: [{ name: "evidence-task" }, { name: "two-minute-task" }],
    user: { login: "maintainer" },
    author_association: "MEMBER",
    created_at: "2026-08-24T00:00:00Z",
    updated_at: "2026-08-24T01:00:00Z",
    closed_at: null,
    comments: [],
  };
  const bodies = [
    `<!-- evidence-task-id:not-a-task -->\n<!-- evidence-task-version:1 -->`,
    `<!-- evidence-task-id:${validId} -->\n<!-- evidence-task-id:${validId} -->\n<!-- evidence-task-version:1 -->`,
    `<!-- evidence-task-id:${validId} -->\n<!-- evidence-task-id:${conflictingId} -->\n<!-- evidence-task-version:1 -->`,
    `<!-- evidence-task-id:${validId} -->\n<!-- evidence-task-version:1 -->\n<!-- evidence-task-version:2 -->`,
  ];

  for (const body of bodies) {
    const result = spawnSync("jq", ["-s", "--arg", "fetchedAt", "2026-08-25T00:00:00Z", "--arg", "repo", "acme/repo", filter], {
      input: `${JSON.stringify({ ...baseIssue, body })}\n`,
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0, body);
    assert.match(result.stderr, /malformed or duplicate task marker/i);
  }

  const validBot = spawnSync("jq", ["-s", "--arg", "fetchedAt", "2026-08-25T00:00:00Z", "--arg", "repo", "acme/repo", filter], {
    input: `${JSON.stringify({
      ...baseIssue,
      body: `<!-- evidence-task-id:${validId} -->\n<!-- evidence-task-version:1 -->`,
      user: { login: "github-actions[bot]" },
    })}\n`,
    encoding: "utf8",
  });
  assert.equal(validBot.status, 0, validBot.stderr);
  assert.doesNotThrow(() => assertEvidenceIssueSnapshot(JSON.parse(validBot.stdout)));

  const ordinaryComment = spawnSync("jq", ["-s", "--arg", "fetchedAt", "2026-08-25T00:00:00Z", "--arg", "repo", "acme/repo", filter], {
    input: `${JSON.stringify({
      ...baseIssue,
      body: `<!-- evidence-task-id:${validId} -->\n<!-- evidence-task-version:1 -->`,
      updated_at: "2026-08-24T02:00:00Z",
      comments: [{
        body: "Ordinary reply https://evidence.example/human-proof",
        user: { login: "helper" },
        author_association: "NONE",
        created_at: "2026-08-24T01:30:00Z",
        updated_at: "2026-08-24T01:30:00Z",
      }],
    })}\n`,
    encoding: "utf8",
  });
  assert.equal(ordinaryComment.status, 0, ordinaryComment.stderr);
  const ordinarySnapshot = JSON.parse(ordinaryComment.stdout);
  assert.deepEqual(ordinarySnapshot.issues[0]?.submittedEvidence, [{
    contributor: "helper",
    evidenceUrl: "https://evidence.example/human-proof",
    submittedAt: "2026-08-24T01:30:00Z",
  }]);
  assert.doesNotThrow(() => assertEvidenceIssueSnapshot(ordinarySnapshot));
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
  assert.match(workflow, /concurrency:/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /new URL/);
  assert.match(workflow, /url\.hash = ""/);

  assert.doesNotMatch(workflow, /git\s+(?:add|commit|push)\b/);
  assert.doesNotMatch(workflow, /(?:>|>>|tee|cp|mv|install|sed\s+-i)[^\n]*(?:events\/|company-profiles|research-cards|README|site\/data)/i);
  assert.doesNotMatch(workflow, /review\/watchlist-issue-seeds\.json/);
});

test("daily summary exposes credential-free accepted-evidence revalidation status", async () => {
  const workflow = await readFile(join(root, ".github", "workflows", "daily-digest.yml"), "utf8");
  assert.match(workflow, /EvidenceRevalidation/);
  assert.match(workflow, /社区证据/);
  assert.doesNotMatch(workflow, /echo .*GITHUB_TOKEN/);
});
