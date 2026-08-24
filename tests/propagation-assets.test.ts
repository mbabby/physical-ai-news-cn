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
  assert.match(readme, /PROJECT_STATUS_START/);
  assert.match(readme, /Daily digest/);
  assert.match(readme, /Weekly brief/);
  assert.match(readme, /行业入口/);
  assert.match(readme, /releases\/latest/);
  assert.doesNotMatch(readme, /weekly\/\d{4}-W\d{2}-report\.md/);
  assert.doesNotMatch(readme, /全覆盖|实时数据库|权威认证/);
  const watchlistStart = readme.indexOf("<!-- WATCHLIST_START -->");
  const watchlistEnd = readme.indexOf("<!-- WATCHLIST_END -->");
  const companyRadarStart = readme.indexOf("<!-- COMPANY_RADAR_START -->");
  assert.ok(watchlistStart > readme.indexOf("## 公司与资本地图"));
  assert.ok(watchlistEnd > watchlistStart);
  assert.ok(companyRadarStart > watchlistEnd);
});

test("public Markdown surfaces contain no failed-summary placeholders", async () => {
  const files = [
    "README.md", "daily/2026-08-01.md", "daily/2026-08-02.md", "daily/2026-08-03.md",
    "daily/2026-08-04.md", "daily/2026-08-05.md", "daily/2026-08-06.md",
    "resources/models-and-open-source.md", "resources/datasets-and-benchmarks.md", "resources/simulation-and-tools.md",
    "site/data/dashboard.json",
  ];
  const content = (await Promise.all(files.map((file) => readFile(join(root, file), "utf8")))).join("\n");
  assert.doesNotMatch(content, /暂无中文简介|中文简介暂未生成|暂未生成中文摘要|暂无原文摘要|原文摘要[:：]|请阅读原文/);
  assert.doesNotMatch(content, /十大(?:机器人)?(?:新闻|热门报道).*盘点|榜单生意链/);
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
    access(join(root, "site", "weekly.html")),
    access(join(root, "site", "companies.html")),
    access(join(root, "site", "research.html")),
    access(join(root, ".github", "workflows", "weekly-release.yml")),
  ]);
  const english = await readFile(join(root, "README.en.md"), "utf8");
  assert.match(english, /source-traceable Chinese intelligence/i);
  assert.match(english, /discovery leads/i);
  assert.match(english, /Weekly Physical AI Top Signals/);
  assert.match(english, /Releases only/);
  assert.match(english, /releases\/latest/);
});

test("standalone share pages expose the three flagship product views", async () => {
  const [home, weekly, companies, research, app] = await Promise.all([
    readFile(join(root, "site", "index.html"), "utf8"),
    readFile(join(root, "site", "weekly.html"), "utf8"),
    readFile(join(root, "site", "companies.html"), "utf8"),
    readFile(join(root, "site", "research.html"), "utf8"),
    readFile(join(root, "site", "share-pages.js"), "utf8"),
  ]);
  assert.match(home, /已确认进展/);
  assert.match(home, /正在发生/);
  assert.match(home, /公司 × 路线 × 资本动量/);
  assert.match(home, /从论文走向产业/);
  assert.match(weekly, /Top Signals/);
  assert.match(companies, /资本动量/);
  assert.match(research, /Research → Industry/);
  assert.match(app, /证据不足（不代表未融资）/);
  for (const html of [home, weekly, companies, research]) assert.match(html, /subscribe\.html/);
});

test("README reserves a canonical decision signal marker section", async () => {
  const readme = await readFile(join(root, "README.md"), "utf8");
  assert.match(readme, /<!-- DECISION_SIGNALS_START -->[\s\S]*<!-- DECISION_SIGNALS_END -->/);
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

test("facts and development policy document the dual-ledger correction contract", async () => {
  const policy = await readFile(join(root, "FACTS_POLICY.md"), "utf8");
  const standards = await readFile(join(root, "docs", "DEVELOPMENT_STANDARDS.md"), "utf8");
  const combined = `${policy}\n${standards}`;
  assert.match(combined, /Company Claim Ledger/);
  assert.match(combined, /Benchmark Result Ledger/);
  for (const status of ["verified", "developing", "conflicted", "unknown"]) assert.match(combined, new RegExp(`\\b${status}\\b`));
  assert.match(combined, /unknown[^\n]*(?:不代表|不是)[^\n]*(?:没有|不存在|未融资)/i);
  assert.match(combined, /Benchmark Result Ledger[^\n]*(?:不构成|不是)[^\n]*(?:排名|榜单)/i);
});
