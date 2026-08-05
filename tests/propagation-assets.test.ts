import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { join } from "node:path";

const root = process.cwd();

test("README has shareable core entry points and a consistent evidence promise", async () => {
  const readme = await readFile(join(root, "README.md"), "utf8");
  assert.match(readme, /公司与资本地图/);
  assert.match(readme, /物理 AI 竞争路线图/);
  assert.match(readme, /里程碑论文/);
  assert.match(readme, /线索不等于事实/);
  assert.match(readme, /README\.en\.md/);
  assert.doesNotMatch(readme, /全覆盖|实时数据库|权威认证/);
});

test("English overview and every README share target are present", async () => {
  await Promise.all([
    access(join(root, "README.en.md")),
    access(join(root, "resources", "companies.md")),
    access(join(root, "resources", "industry-landscape-and-tech-routes.md")),
    access(join(root, "resources", "milestone-papers.md")),
    access(join(root, "weekly", "shareable-summary.md")),
    access(join(root, "weekly", "2026-W32-report.md")),
    access(join(root, "metrics", "weekly.json")),
    access(join(root, "review", "community-queue.md")),
    access(join(root, "posts", "2026-08-project-update.md")),
  ]);
  const english = await readFile(join(root, "README.en.md"), "utf8");
  assert.match(english, /source-traceable Chinese intelligence/i);
  assert.match(english, /discovery leads/i);
});

test("weekly reporting assets explain their public and review boundaries", async () => {
  const [report, queue, metrics] = await Promise.all([
    readFile(join(root, "weekly", "2026-W32-report.md"), "utf8"),
    readFile(join(root, "review", "community-queue.md"), "utf8"),
    readFile(join(root, "metrics", "weekly.json"), "utf8"),
  ]);
  assert.match(report, /A\/B 级非线索证据/);
  assert.match(queue, /待核验候选/);
  assert.match(metrics, /未配置/);
});
