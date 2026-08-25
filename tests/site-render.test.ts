import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";

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

type Mount = { innerHTML: string; textContent: string };

async function renderCommunityTasks(ids: string[]) {
  const source = (await readFile(join(root, "site", "app.js"), "utf8"))
    .replace(/^import "\.\/decision-products-validator\.js";\s*/, "")
    .replace(
      /loadDashboard\(\)\.then\(render\);\s*loadCommunity\(\)\.then\(renderCommunity\);\s*$/,
      "globalThis.__communityUi = { renderCommunityEvidence };",
    );
  const mounts = Object.fromEntries(ids.map((id) => [id, { innerHTML: "", textContent: "" }])) as Record<string, Mount>;
  const context = {
    console, URL, Intl, Date,
    document: {
      getElementById: (id: string) => mounts[id] ?? null,
      addEventListener() {},
      body: { dataset: {}, classList: { add() {}, remove() {} } },
    },
    navigator: {},
    window: {
      location: { href: "https://example.test/index.html", protocol: "https:" },
      addEventListener() {},
    },
  };
  vm.runInNewContext(source, context);
  return {
    mounts,
    render: (context as typeof context & { __communityUi: { renderCommunityEvidence: (publication: unknown, artifact: unknown) => void } }).__communityUi.renderCommunityEvidence,
  };
}

const renderedTasks = [
  { id: "task-zeta", category: "company-funding", subject: { name: "Zeta", url: "https://zeta.example/" }, targetField: "funding.amount", contextZh: "融资金额待原始公告确认。", issueNumber: 41, issueUrl: "https://github.com/acme/repo/issues/41" },
  { id: "task-alpha", category: "product-deployment", subject: { name: "Alpha", url: "https://alpha.example/" }, targetField: "deployment.customer", contextZh: "部署客户待原始公告确认。", issueNumber: 42, issueUrl: "https://github.com/acme/repo/issues/42" },
  { id: "task-middle", category: "research-metadata", subject: { name: "Middle", url: "https://middle.example/" }, targetField: "research.codeUrl", contextZh: "代码仓库待论文项目页确认。", issueNumber: 43, issueUrl: "https://github.com/acme/repo/issues/43" },
];

function orderedMatches(html: string, pattern: RegExp): string[] {
  return [...html.matchAll(pattern)].map((match) => match[1]!);
}

test("browser renderer preserves artifact order and stable IDs on homepage and contribution center", async () => {
  const expectedIds = renderedTasks.map((task) => task.id);
  const homepage = await renderCommunityTasks(["homepage-community-tasks"]);
  homepage.render({ metrics: {}, recentContributions: [] }, { tasks: renderedTasks });
  const homepageHtml = homepage.mounts["homepage-community-tasks"]!.innerHTML;
  assert.deepEqual(orderedMatches(homepageHtml, /data-community-task-id="([^"]+)"/g), expectedIds);
  assert.deepEqual(orderedMatches(homepageHtml, /id="community-task-([^"]+)"/g), expectedIds);

  const center = await renderCommunityTasks(["community-task-groups"]);
  center.render({ metrics: {}, recentContributions: [] }, { tasks: renderedTasks });
  const centerHtml = center.mounts["community-task-groups"]!.innerHTML;
  assert.deepEqual(orderedMatches(centerHtml, /data-community-task-id="([^"]+)"/g), expectedIds);
  assert.deepEqual(orderedMatches(centerHtml, /id="community-task-([^"]+)"/g), expectedIds);
  assert.deepEqual(orderedMatches(centerHtml, /id="community-category-([^"]+)"/g), ["company-funding", "product-deployment", "research-metadata"]);

  homepage.render({ metrics: {}, recentContributions: [] }, { tasks: [] });
  center.render({ metrics: {}, recentContributions: [] }, { tasks: [] });
  assert.equal(homepage.mounts["homepage-community-tasks"]!.innerHTML, '<p class="empty">当前没有达到公开任务门槛的缺口</p>');
  assert.equal(center.mounts["community-task-groups"]!.innerHTML, '<p class="empty">当前没有达到公开任务门槛的缺口</p>');
});

test("browser renderer source retains the expected task affordances without adding a client sort", async () => {
  const app = await readFile(join(root, "site", "app.js"), "utf8");
  assert.match(app, /data-community-task-id=/);
  assert.match(app, /community-task-groups/);
  assert.match(app, /homepage-community-tasks/);
  assert.match(app, /预计 2 分钟/);
  assert.match(app, /证据门槛/);
  assert.doesNotMatch(app, /communityTasks\.sort|recentContributions\.sort/);
});
