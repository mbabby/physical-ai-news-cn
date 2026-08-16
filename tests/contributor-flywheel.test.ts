import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

test("evidence review documentation keeps acceptance separate from publication", async () => {
  const [guide, manual, contributors] = await Promise.all([
    readFile(join(root, "CONTRIBUTING.md"), "utf8"),
    readFile(join(root, "community", "evidence-review.md"), "utf8"),
    readFile(join(root, "CONTRIBUTORS.md"), "utf8"),
  ]);
  assert.match(guide, /accepted-evidence/);
  assert.match(guide, /不会自动发布内容/);
  assert.match(manual, /采纳与发布不是同一步/);
  assert.match(manual, /Google News、HN、X/);
  assert.match(contributors, /graphs\/contributors/);
  assert.match(contributors, /label%3Aaccepted-evidence/);
});

test("review issue materialization applies lifecycle labels and credits only manually accepted evidence", async () => {
  const workflow = await readFile(join(root, ".github", "workflows", "materialize-review-issues.yml"), "utf8");
  assert.match(workflow, /types: \[opened, labeled\]/);
  assert.match(workflow, /Put community submissions in the review layer/);
  assert.match(workflow, /--add-label "evidence-review" --add-label "needs-evidence"/);
  assert.match(workflow, /github\.event\.label\.name == 'accepted-evidence'/);
  assert.match(workflow, /--add-label "contributor-credited"/);
  assert.match(workflow, /不会把候选自动写入日报、公司档案或公开页面/);
  assert.doesNotMatch(workflow, /git (add|commit|push)/);
});

test("evidence issue templates request traceable facts instead of publication approval", async () => {
  const funding = await readFile(join(root, ".github", "ISSUE_TEMPLATE", "company-funding.yml"), "utf8");
  const deployment = await readFile(join(root, ".github", "ISSUE_TEMPLATE", "product-deployment.yml"), "utf8");
  const research = await readFile(join(root, ".github", "ISSUE_TEMPLATE", "research.yml"), "utf8");
  assert.match(funding, /原始证据链接/);
  assert.match(deployment, /验证阶段/);
  assert.match(research, /真实机器人、基准、开源/);
});
