import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

test("contribution center exposes task groups, safe metrics, evidence notice, and explicit empty state", async () => {
  const html = await readFile(join(root, "site", "contribute.html"), "utf8");
  assert.match(html, /data-view="contribute"/);
  assert.match(html, /id="community-task-groups"/);
  assert.match(html, /id="community-open-count"/);
  assert.match(html, /id="community-weekly-accepted"/);
  assert.match(html, /id="community-new-contributors"/);
  assert.match(html, /id="community-recent-contributions"/);
  assert.match(html, /当前没有达到公开任务门槛的缺口/);
  assert.match(html, /证据被采纳后仍需经过日报复核，不会自动进入公开事实。/);
  assert.doesNotMatch(html, /Top contributors|贡献者排名/i);
});

test("homepage uses the compact contribution module and public contribution-center route", async () => {
  const html = await readFile(join(root, "site", "index.html"), "utf8");
  assert.match(html, /帮助完善 5 条物理 AI 情报/);
  assert.match(html, /id="homepage-community-open-count"/);
  assert.match(html, /id="homepage-community-weekly-accepted"/);
  assert.match(html, /id="homepage-community-new-contributors"/);
  assert.match(html, /href="contribute\.html"/);
  assert.doesNotMatch(html, /review\/community-queue\.md/);
});

test("browser renderer preserves artifact order and stable IDs on both public surfaces", async () => {
  const app = await readFile(join(root, "site", "app.js"), "utf8");
  assert.match(app, /data-community-task-id=/);
  assert.match(app, /community-task-groups/);
  assert.match(app, /homepage-community-tasks/);
  assert.match(app, /预计 2 分钟/);
  assert.match(app, /证据门槛/);
  assert.doesNotMatch(app, /communityTasks\.sort|recentContributions\.sort/);
});
