import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { decodeWatchlistConfig as decodeTypeScriptConfig } from "../src/watchlist/config.js";

const readSite = async (name: string) => readFile(new URL(`../site/${name}`, import.meta.url), "utf8");

test("homepage keeps data-engineering mount points while presenting one decision briefing", async () => {
  const html = await readSite("index.html");
  const requiredIds = [
    "briefing", "top-signals", "developing-signals", "capital", "industry", "research",
    "company-watchlist", "watchlist-config-controls", "watchlist-company-options", "watchlist-route-options", "watchlist-config-warning", "watchlist-copy-feedback", "watchlist-forward", "watchlist-momentum", "watchlist-changes",
    "company-boards", "company-board-grid", "company-radar", "research-graph-grid", "routes-grid",
    "detail-drawer-root",
  ];
  for (const id of requiredIds) assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
  const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "homepage must not contain duplicate ids");
  assert.match(html, /未知字段保持未知/);
  assert.match(html, /不绘制推测性关联/);
  assert.ok(html.indexOf('id="watchlist-forward"') < html.indexOf('id="company-boards"'), "watchlist mounts must precede legacy boards");
});

test("evidence UI supports safe fallback, deep-linked details and honest empty states", async () => {
  const [app, styles] = await Promise.all([readSite("app.js"), readSite("styles.css")]);
  assert.match(app, /evidence-status--/);
  assert.match(app, /detail-drawer-root/);
  assert.match(app, /data-signal-detail/);
  assert.match(app, /近 30 天没有满足公开证据门槛的资本事件/);
  assert.match(app, /产业关系尚未核验 · 不绘制连线/);
  assert.match(app, /样本不足 · 不展示精确分/);
  assert.match(styles, /\.drawer-panel/);
  assert.match(styles, /\.evidence-status--verified/);
  assert.match(styles, /body\.detail-open/);
  assert.match(styles, /min-height:44px/);
  assert.match(styles, /prefers-reduced-motion/);
});

type Mount = { hidden: boolean; innerHTML: string; textContent: string; value: string; addEventListener: () => void };

const mount = (): Mount => ({ hidden: false, innerHTML: "", textContent: "", value: "", addEventListener() {} });

async function loadAppCompanyRenderer() {
  const source = await readSite("app.js");
  const mounts: Record<string, Mount> = {
    "company-watchlist": mount(),
    "watchlist-config-controls": mount(),
    "watchlist-company-options": mount(),
    "watchlist-route-options": mount(),
    "watchlist-config-warning": mount(),
    "watchlist-copy-feedback": mount(),
    "watchlist-forward": mount(),
    "watchlist-momentum": mount(),
    "watchlist-changes": mount(),
    "company-boards": mount(),
    "company-board-grid": mount(),
  };
  const context = {
    console,
    URL,
    Intl,
    Date,
    document: { getElementById: (id: string) => mounts[id] ?? mount(), addEventListener() {}, body: { classList: { add() {}, remove() {} } } },
    navigator: { clipboard: { writeText: async () => {} } },
    window: { location: { href: "https://example.test/index.html", origin: "https://example.test", pathname: "/index.html", search: "" }, history: { pushState() {}, replaceState() {} }, addEventListener() {} },
  };
  const instrumented = source.replace(
    /loadDashboard\(\)\.then\(render\);\s*loadCommunity\(\)\.then\(renderCommunity\);\s*$/,
    "globalThis.__siteUi = { renderCompanySection, decodeWatchlistConfig, encodeWatchlistConfig, filterWatchlistCards, watchlistCatalog };",
  );
  vm.runInNewContext(instrumented, context);
  return { mounts, ...((context as typeof context & { __siteUi: {
    renderCompanySection: (data: unknown) => void;
    decodeWatchlistConfig: (value: unknown, catalog: unknown) => unknown;
    encodeWatchlistConfig: (config: unknown) => string;
    filterWatchlistCards: (cards: unknown[], config: unknown) => unknown[];
    watchlistCatalog: (watchlist: unknown) => unknown;
  } }).__siteUi) };
}

async function loadShareCompanyRenderer() {
  const source = await readSite("share-pages.js");
  const root = mount();
  const context = {
    console,
    URL,
    Date,
    document: { getElementById: () => root, body: { dataset: { view: "companies" } } },
    window: { location: { protocol: "https:", href: "https://example.test/companies.html" } },
  };
  const instrumented = source.replace(
    /loadDashboard\(\)\.then\([\s\S]*$/,
    "globalThis.__siteUi = { companies };",
  );
  vm.runInNewContext(instrumented, context);
  return { root, companies: (context as typeof context & { __siteUi: { companies: (data: unknown) => void } }).__siteUi.companies };
}

const publicWatchlist = {
  week: "2026-W34",
  snapshotVersion: 2,
  methodologyVersion: "method-v1",
  lastSuccessfulAt: "2026-08-17T01:00:00.000Z",
  companyIds: ["company-alpha", "company-beta"],
  forwardRadar: [{
    companyId: 'company-alpha\" onclick=\"alert(1)', companyName: "Alpha <Robotics>", thesisId: "thesis-alpha", thesisVersion: 1,
    track: "forward-radar", group: "continued-observation", lifecycle: "awaiting-validation", lifecycleLabel: "等待验证",
    routes: ["VLA 与具身模型"],
    whyNow: "一段很长的中文研究判断，用于确认内容不会被截断并且能够在窄屏内自然换行。", routeAndDependencies: "依赖后续部署验证。",
    nextValidationPoints: [{ text: "核验客户部署。", dueAt: "2026-10-01" }], falsifiers: [{ text: "公开部署被撤回。" }],
    evidenceLinks: [{ eventId: "event-alpha", title: "Alpha 发布产品", url: "javascript:alert(1)", source: "Alpha 官方", grade: "A" }],
    capital: { status: "evidence-insufficient", summary: "证据不足（不代表未融资）" }, score: 99, rank: 1,
  }, {
    companyId: "company-beta", companyName: "Beta Robotics", thesisId: "thesis-beta", thesisVersion: 1,
    track: "forward-radar", group: "priority-focus", lifecycle: "new", lifecycleLabel: "新进入", whyNow: "出现新的规范事实。",
    routes: ["部署与商业化"],
    routeAndDependencies: "依赖供应链。", nextValidationPoints: [{ text: "核验量产。", dueAt: "2026-09-01" }],
    falsifiers: [{ text: "项目终止。" }], evidenceLinks: [{ eventId: "event-beta", title: "Beta 发布产品", url: "https://beta.example/product", source: "Beta 官方", grade: "A" }],
    capital: { status: "verified", summary: "A 轮 · 金额未披露" }, score: 98, rank: 2,
  }],
  validatedMomentum: [],
  changes: [{ companyId: "company-beta", companyName: "Beta Robotics", change: "strengthened" }],
};

test("homepage renders the public watchlist without leaking private scores and orders priority focus first", async () => {
  const { mounts, renderCompanySection } = await loadAppCompanyRenderer();
  renderCompanySection({ watchlist: publicWatchlist, companyBoards: { momentum: { title: "旧榜", mode: "ranked", entries: [{ companyName: "Legacy", rank: 1, score: 100 }] } } });

  assert.equal(mounts["company-watchlist"].hidden, false);
  assert.equal(mounts["company-boards"].hidden, true);
  const html = Object.values(mounts).map((node) => node.innerHTML).join("\n");
  assert.ok(html.indexOf("重点关注") < html.indexOf("持续观察"));
  assert.match(html, /AI 研究判断/);
  assert.match(html, /为什么现在值得看/);
  assert.match(html, /下一验证点/);
  assert.match(html, /验证期限.*2026-09-01/);
  assert.match(html, /反证条件/);
  assert.match(html, /Beta Robotics/);
  assert.match(html, /判断强化/);
  assert.match(html, /最后成功快照.*2026-W34.*v2.*2026-08-17/);
  assert.match(html, /aria-label="打开 Beta Robotics 证据：Beta 发布产品（Beta 官方，A级）"/);
  assert.match(html, /href="https:\/\/beta\.example\/product"/);
  assert.match(html, /data-company-id="company-alpha&quot; onclick=&quot;alert\(1\)"/);
  assert.match(html, /href="#"/);
  assert.doesNotMatch(html, /综合分|#1|#2|99|98|score|rank|Legacy/);
});

test("homepage distinguishes absent, malformed and intentionally empty watchlists", async () => {
  const absent = await loadAppCompanyRenderer();
  absent.renderCompanySection({ companyBoards: { momentum: { title: "旧榜仍可用", mode: "watchlist", entries: [] } } });
  assert.equal(absent.mounts["company-watchlist"].hidden, true);
  assert.equal(absent.mounts["company-boards"].hidden, false);
  assert.match(absent.mounts["company-board-grid"].innerHTML, /旧榜仍可用/);

  const malformed = await loadAppCompanyRenderer();
  malformed.renderCompanySection({ watchlist: {}, companyBoards: { momentum: { title: "不应混入", entries: [] } } });
  assert.equal(malformed.mounts["company-watchlist"].hidden, false);
  assert.equal(malformed.mounts["company-boards"].hidden, true);
  assert.match(malformed.mounts["watchlist-forward"].innerHTML, /Watchlist 数据未通过公开契约校验/);
  assert.doesNotMatch(malformed.mounts["watchlist-forward"].innerHTML, /当前没有达到公开门槛/);

  const subtlyMalformed = await loadAppCompanyRenderer();
  subtlyMalformed.renderCompanySection({ watchlist: { ...publicWatchlist, snapshotVersion: "2", forwardRadar: [{ companyId: "company-alpha" }] } });
  assert.match(subtlyMalformed.mounts["watchlist-forward"].innerHTML, /Watchlist 数据未通过公开契约校验/);
  assert.doesNotMatch(subtlyMalformed.mounts["watchlist-forward"].innerHTML, /待识别公司/);

  const missingRoutes = await loadAppCompanyRenderer();
  missingRoutes.renderCompanySection({ watchlist: { ...publicWatchlist, forwardRadar: [{ ...publicWatchlist.forwardRadar[0], routes: [] }] } });
  assert.match(missingRoutes.mounts["watchlist-forward"].innerHTML, /Watchlist 数据未通过公开契约校验/);

  const empty = await loadAppCompanyRenderer();
  empty.renderCompanySection({ watchlist: { ...publicWatchlist, companyIds: [], forwardRadar: [], validatedMomentum: [], changes: [] } });
  assert.equal(empty.mounts["company-watchlist"].hidden, false);
  assert.match(empty.mounts["watchlist-forward"].innerHTML, /2026-W34.*最后成功快照中，前瞻雷达暂无公开公司/);
  assert.match(empty.mounts["watchlist-changes"].innerHTML, /本周没有公开的名单变化/);
});

test("company share page places watchlist and changes before score-free legacy dossiers", async () => {
  const { root, companies } = await loadShareCompanyRenderer();
  companies({
    watchlist: publicWatchlist,
    companyRadar: [{ name: "Legacy dossier", momentumScore: 93, recentSignals: 4, officialUrl: "https://legacy.example", thesis: "保留档案。" }],
  });
  assert.ok(root.innerHTML.indexOf("公司 Watchlist") < root.innerHTML.indexOf("公司档案"));
  assert.ok(root.innerHTML.indexOf("本周变化") < root.innerHTML.indexOf("公司档案"));
  assert.match(root.innerHTML, /AI 研究判断/);
  assert.match(root.innerHTML, /Legacy dossier/);
  assert.doesNotMatch(root.innerHTML, /93\/100|综合分|#1|score|rank/);

  companies({ companyRadar: [{ name: "Legacy fallback", momentumScore: 93, recentSignals: 4 }] });
  assert.match(root.innerHTML, /Legacy fallback/);
  assert.match(root.innerHTML, /93\/100/);
  assert.doesNotMatch(root.innerHTML, /公司 Watchlist|本周变化/);
});

test("watchlist styles preserve focus, long Chinese copy and a single-column 390px layout", async () => {
  const styles = await readSite("styles.css");
  assert.match(styles, /\.watchlist-card[^{]*\{[^}]*overflow-wrap:anywhere/);
  assert.match(styles, /\.watchlist-evidence a[^{]*\{[^}]*min-height:44px/);
  assert.match(styles, /\.watchlist-evidence a:focus-visible/);
  assert.match(styles, /\.watchlist-config-controls/);
  assert.match(styles, /\.watchlist-config-controls button:focus-visible/);
  assert.match(styles, /\.watchlist-option-grid input/);
  assert.match(styles, /\.watchlist-config-actions button[^{]*\{[^}]*min-height:44px/);
  assert.match(styles, /@media\(max-width:520px\)[\s\S]*\.watchlist-track-grid[^{]*\{[^}]*grid-template-columns:1fr/);
});

test("shareable Watchlist controls filter the current snapshot and mirror TypeScript config decoding", async () => {
  const site = await loadAppCompanyRenderer();
  site.renderCompanySection({ watchlist: publicWatchlist });

  assert.match(site.mounts["watchlist-company-options"].innerHTML, /当前公司/);
  assert.match(site.mounts["watchlist-route-options"].innerHTML, /固定技术路线/);
  const html = await readSite("index.html");
  assert.match(html, /重置筛选/);
  assert.match(html, /复制分享链接/);
  assert.match(site.mounts["watchlist-company-options"].innerHTML, /company-alpha/);
  assert.match(site.mounts["watchlist-route-options"].innerHTML, /vla-and-embodied-models/);

  const catalog = site.watchlistCatalog(publicWatchlist) as { companyIds: string[]; routes: string[] };
  for (const query of [
    "watch=company-alpha,company-exited&routes=vla-and-embodied-models",
    "wat%ZZch=company-alpha",
    "routes=unapproved-route",
    "watch=%3Cscript%3Ealert(1)%3C%2Fscript%3E",
  ]) assert.deepEqual(JSON.parse(JSON.stringify(site.decodeWatchlistConfig(query, catalog))), decodeTypeScriptConfig(query, catalog), query);
  assert.equal(site.encodeWatchlistConfig({ companyIds: ["company-beta", "company-alpha"], routes: [] }), "watch=company-alpha,company-beta");

  const cards = [...publicWatchlist.forwardRadar, ...publicWatchlist.validatedMomentum];
  const filtered = site.filterWatchlistCards(cards, { companyIds: ["company-beta"], routes: ["vla-and-embodied-models"] }) as Array<{ companyId: string }>;
  assert.deepEqual(filtered.map((card) => card.companyId), ['company-alpha" onclick="alert(1)', "company-beta"]);
});
