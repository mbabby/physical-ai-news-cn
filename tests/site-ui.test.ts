import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { decodeWatchlistConfig as decodeTypeScriptConfig } from "../src/watchlist/config.js";
import { stableDecisionId } from "../src/decision-products/contracts.js";

const readSite = async (name: string) => readFile(new URL(`../site/${name}`, import.meta.url), "utf8");
const shanghaiDate = (value = new Date()) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(value).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};

test("homepage keeps data-engineering mount points while presenting one decision briefing", async () => {
  const html = await readSite("index.html");
  const requiredIds = [
    "briefing", "top-signals", "developing-signals", "capital", "industry", "research",
    "publication-status",
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

test("homepage renders current and missing publication status from safe health fields", async () => {
  const current = await loadAppCompanyRenderer();
  current.render({
    generatedAt: "2026-08-02T01:30:00.000Z", stats: {}, routes: [],
    publicationHealth: {
      daily: { expectedDate: shanghaiDate(), latestPublishedDate: shanghaiDate(), state: "current", publicationDue: false },
      publicIndustryItems: 2, publicResearchItems: 3, candidateBacklog: 4, degradedComponents: [],
    },
  });
  assert.match(current.mounts["publication-status"].innerHTML, /今日日报已生成/);
  assert.match(current.mounts["publication-status"].innerHTML, /产业 2.*研究 3.*候选待补证 4/);

  const missing = await loadAppCompanyRenderer();
  missing.render({
    generatedAt: "2026-08-02T02:00:00.000Z", stats: {}, routes: [],
    publicationHealth: {
      daily: { expectedDate: shanghaiDate(), state: "missing", publicationDue: true },
      publicIndustryItems: 0, publicResearchItems: 0, candidateBacklog: 5, degradedComponents: ["LLM"],
    },
  });
  assert.match(missing.mounts["publication-status"].innerHTML, /日报延迟.*自动恢复/);
  assert.match(missing.mounts["publication-status"].innerHTML, /服务降级：LLM/);
});

test("homepage keeps empty top signals honest when public health is absent or malformed", async () => {
  const site = await loadAppCompanyRenderer();
  site.render({ stats: {}, routes: [], publicationHealth: { daily: { expectedDate: "2026-02-30", latestPublishedDate: "2026-99-99", state: "current", publicationDue: false } } });
  assert.match(site.mounts["publication-status"].innerHTML, /日报状态待确认/);
  assert.match(site.mounts["top-signals"].innerHTML, /当前没有满足公开门槛的产业信号/);
  assert.match(site.mounts["top-signals"].innerHTML, /主体确认、第二独立来源或完整中文事实简介/);
  assert.match(site.mounts["top-signals"].innerHTML, /不会进入首页/);
});

test("homepage fails closed for a valid but future publication date", async () => {
  const site = await loadAppCompanyRenderer();
  site.render({
    stats: {}, routes: [],
    publicationHealth: {
      daily: { expectedDate: shanghaiDate(new Date(Date.now() + 2 * 86_400_000)), state: "pending", publicationDue: false },
      publicIndustryItems: 0, publicResearchItems: 0, candidateBacklog: 0, degradedComponents: [],
    },
  });
  assert.match(site.mounts["publication-status"].innerHTML, /日报状态待确认/);
  assert.doesNotMatch(site.mounts["publication-status"].innerHTML, /等待当日日报/);
});

test("subscription center is static, privacy preserving and links every subscription route", async () => {
  const html = await readSite("subscribe.html");
  assert.match(html, /data-view=["']subscribe["']/);
  assert.match(html, /每日检查/);
  assert.match(html, /A 级|B\+B/);
  assert.doesNotMatch(html, /<form\b/i);
  assert.doesNotMatch(html, /<input[^>]+type=["']email["']/i);
  assert.doesNotMatch(html, /<(?:script|img|iframe)[^>]+(?:src|href)=["']https?:/i);
  assert.doesNotMatch(html, /analytics|gtag|googletagmanager|segment\.com|plausible|localStorage|sessionStorage|document\.cookie/i);
  for (const target of [
    "https://github.com/mbabby/physical-ai-news-cn/subscription",
    "https://github.com/mbabby/physical-ai-news-cn/releases",
    "feeds/decision/all.xml",
    "feeds/decision/data-and-training.xml",
    "feeds/decision/vla-and-embodied-models.xml",
    "feeds/decision/world-models-and-spatial-intelligence.xml",
    "feeds/decision/embodiment-and-hardware.xml",
    "feeds/decision/deployment-and-commercialization.xml",
    "feeds/decision/watchlist.xml",
  ]) assert.match(html, new RegExp(`href=["']${target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`), target);
  assert.match(html, /id=["']subscription-watchlist-link["']/);
  assert.match(html, /data-subscription-route/);
  assert.match(html, /<script type=["']module["'] src=["']app\.js["']><\/script>/);
});

test("subscription route choices use the shared encoder and persist only in the URL", async () => {
  const source = (await readSite("app.js")).replace(/^import "\.\/decision-products-validator\.js";\s*/, "");
  const inputs = [
    { value: "data-and-training", checked: false },
    { value: "deployment-and-commercialization", checked: false },
  ];
  let onChange = () => {};
  const controls = {
    querySelectorAll(selector: string) { return selector.includes(":checked") ? inputs.filter((input) => input.checked) : inputs; },
    addEventListener(name: string, listener: () => void) { if (name === "change") onChange = listener; },
  };
  const link = { href: "index.html#company-watchlist" };
  const warning = { textContent: "" };
  const replaced: string[] = [];
  const context = {
    console,
    URL,
    Intl,
    Date,
    document: {
      getElementById: (id: string) => ({
        "subscription-watchlist-controls": controls,
        "subscription-watchlist-link": link,
        "subscription-watchlist-warning": warning,
      } as Record<string, unknown>)[id] ?? null,
      body: { dataset: { view: "subscribe" }, classList: { add() {}, remove() {} } },
      addEventListener() {},
    },
    navigator: {},
    window: {
      location: { href: "https://example.test/subscribe.html?routes=deployment-and-commercialization", origin: "https://example.test", pathname: "/subscribe.html", search: "?routes=deployment-and-commercialization", protocol: "https:" },
      history: { replaceState(_state: unknown, _title: string, url: string) { replaced.push(url); } },
      addEventListener() {},
    },
  };
  vm.runInNewContext(source, context);
  await Promise.resolve();
  assert.equal(inputs[1]!.checked, true);
  assert.equal(link.href, "index.html?routes=deployment-and-commercialization#company-watchlist");
  assert.equal(replaced.at(-1), "/subscribe.html?routes=deployment-and-commercialization");

  inputs[0]!.checked = true;
  onChange();
  assert.equal(link.href, "index.html?routes=data-and-training,deployment-and-commercialization#company-watchlist");
  assert.equal(replaced.at(-1), "/subscribe.html?routes=data-and-training,deployment-and-commercialization");
});

type Mount = { hidden: boolean; innerHTML: string; textContent: string; value: string; addEventListener: () => void };

const mount = (): Mount => ({ hidden: false, innerHTML: "", textContent: "", value: "", addEventListener() {} });

async function loadAppCompanyRenderer() {
  const [validator, source] = await Promise.all([readSite("decision-products-validator.js"), readSite("app.js")]);
  const mounts: Record<string, Mount> = {
    "publication-status": mount(),
    "top-signals": mount(),
    "developing-signals": mount(),
    "company-radar": mount(),
    "research": mount(),
    "research-graph-grid": mount(),
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
  const instrumented = source.replace(/^import "\.\/decision-products-validator\.js";\s*/, "").replace(
    /loadDashboard\(\)\.then\(render\);\s*loadCommunity\(\)\.then\(renderCommunity\);\s*$/,
    "globalThis.__siteUi = { render, renderCompanySection, decodeWatchlistConfig, encodeWatchlistConfig, filterWatchlistCards, watchlistCatalog };",
  );
  vm.runInNewContext(validator, context);
  vm.runInNewContext(instrumented, context);
  return { mounts, ...((context as typeof context & { __siteUi: {
    render: (data: unknown) => void;
    renderCompanySection: (data: unknown) => void;
    decodeWatchlistConfig: (value: unknown, catalog: unknown) => unknown;
    encodeWatchlistConfig: (config: unknown) => string;
    filterWatchlistCards: (cards: unknown[], config: unknown) => unknown[];
    watchlistCatalog: (watchlist: unknown) => unknown;
  } }).__siteUi) };
}

async function loadShareCompanyRenderer() {
  const [validator, source] = await Promise.all([readSite("decision-products-validator.js"), readSite("share-pages.js")]);
  const root = mount();
  const context = {
    console,
    URL,
    Date,
    document: { getElementById: () => root, body: { dataset: { view: "companies" } } },
    window: { location: { protocol: "https:", href: "https://example.test/companies.html" } },
  };
  const instrumented = source.replace(/^import "\.\/decision-products-validator\.js";\s*/, "").replace(
    /const views = \{ weekly, companies, research \};[\s\S]*$/,
    "globalThis.__siteUi = { companies };",
  );
  vm.runInNewContext(validator, context);
  vm.runInNewContext(instrumented, context);
  return { root, companies: (context as typeof context & { __siteUi: { companies: (data: unknown) => void } }).__siteUi.companies };
}

async function loadChangePageRenderer() {
  const source = (await readSite("share-pages.js")).replace(/^import "\.\/decision-products-validator\.js";\s*/, "");
  const root = mount();
  const context = {
    console,
    URL,
    Date,
    document: { getElementById: () => root, body: { dataset: { view: "changes" } } },
    window: { location: { protocol: "https:", href: "https://example.test/watchlist-changes.html" } },
  };
  const instrumented = source.replace(
    /const views = \{ weekly, companies, research \};[\s\S]*$/,
    "globalThis.__siteUi = { changes };",
  );
  vm.runInNewContext(instrumented, context);
  return { root, changes: (context as typeof context & { __siteUi: { changes: (data: unknown) => void } }).__siteUi.changes };
}

const publicWatchlist = {
  week: "2026-W34",
  snapshotVersion: 2,
  methodologyVersion: "method-v1",
  lastSuccessfulAt: "2026-08-17T01:00:00.000Z",
  companyIds: ["company-alpha", "company-beta"],
  forwardRadar: [{
    companyId: "company-alpha", companyName: "Alpha <Robotics>", thesisId: "thesis-alpha", thesisVersion: 1,
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
  assert.match(html, /data-company-id="company-alpha"/);
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

test("homepage fails closed unless companyIds exactly match the ordered current Watchlist cards", async () => {
  for (const companyIds of [
    ["company-alpha", "company-beta", "company-stale"],
    ["company-alpha"],
    ["company-alpha", "company-alpha", "company-beta"],
    ["company-beta", "company-alpha"],
  ]) {
    const site = await loadAppCompanyRenderer();
    site.renderCompanySection({ watchlist: { ...publicWatchlist, companyIds } });
    assert.match(site.mounts["watchlist-forward"].innerHTML, /Watchlist 数据未通过公开契约校验/, companyIds.join(","));
    assert.doesNotMatch(site.mounts["watchlist-forward"].innerHTML, /Alpha Robotics|Beta Robotics|company-stale/, companyIds.join(","));
  }
});

const emptyDecisionArtifact = (companyCards: unknown[] = []) => ({
  schemaVersion: 1,
  generatedAt: "2026-08-17T01:00:00.000Z",
  periodStart: "2026-08-11",
  topSignals: [],
  companyCards,
  researchPassports: [],
  subscriptions: { generatedAt: "2026-08-17T01:00:00.000Z", entries: [] },
});

const decisionCompanyCard = (extra: Record<string, unknown> = {}) => ({
  cardId: stableDecisionId("company", "alpha"),
  companyId: "alpha",
  companyName: "Alpha Robotics",
  officialUrl: "https://alpha.example/",
  region: "中国",
  stage: "成长",
  routes: ["VLA 与具身模型"],
  capital: { status: "unknown", summary: "证据不足（不代表未融资）", evidence: [] },
  validationStage: "实机验证",
  productDeployment: { status: "unknown", summary: "证据不足（不代表没有产品或部署进展）", evidence: [] },
  recentChanges: [],
  watchlist: { track: "unknown", lifecycle: "unknown", whyNow: "unknown", nextValidationPoints: [] },
  unknownFields: ["capital.amount"],
  updatedAt: "2026-08-01T00:00:00.000Z",
  ...extra,
});

const decisionPassport = () => ({
  passportId: stableDecisionId("research", "paper-alpha"), paperId: "paper-alpha", titleZh: "Alpha 机器人策略研究",
  factsZh: ["论文评测了机器人策略。", "论文报告了公开基准。"], sourceUrl: "https://papers.example/alpha",
  task: ["操作"], embodiment: ["真实机器人"], methods: "unknown",
  benchmark: { name: "unknown", metric: "unknown", result: "unknown", baseline: "unknown", delta: "unknown", evidenceUrls: [] },
  realRobotTrials: "unknown", assets: { code: "unknown", data: "unknown", weights: "unknown" },
  reproducibilityCost: { level: "unknown", rationale: "unknown" }, authority: { openAlexWorkId: "W1", authors: [], labs: [], citedByCount: "unknown", checkedAt: "unknown" },
  limitations: "unknown", gaps: [], whyWorthAttention: "该论文具备完整公开事实。", rankReasons: ["OpenAlex 元数据已核验"],
});

const decisionSubscription = () => ({
  subscriptionId: "feed-all", label: "全部信号", description: "公开信号。", cadence: "weekly", format: "rss",
  url: "https://example.test/feed.xml", route: "all",
});

const decisionSignal = () => ({
  signalId: stableDecisionId("signal", "event-alpha"), eventId: "event-alpha", entityId: "alpha", entityName: "Alpha Robotics",
  titleZh: "Alpha 发布机器人", factsZh: ["Alpha 发布了新机器人。", "该产品已进入公开验证。"], kind: "产品发布",
  routes: ["VLA 与具身模型"], occurredAt: "2026-08-16T01:00:00.000Z", verifiedAt: "2026-08-17T01:00:00.000Z",
  changedThisWeek: true, evidenceState: "official",
  evidence: [{ evidenceId: "evidence-alpha", url: "https://alpha.example/release", source: "Alpha 官方", grade: "A" }],
  impact: ["company", "product-deployment"], whyItMatters: "AI 研究判断：该事件提供了公开验证。", rankReasons: ["官方一手证据"],
});

const completeDecisionArtifact = () => ({
  ...emptyDecisionArtifact([decisionCompanyCard()]),
  topSignals: [decisionSignal()],
  researchPassports: [decisionPassport()],
  subscriptions: { generatedAt: "2026-08-17T01:00:00.000Z", entries: [decisionSubscription()] },
});

test("homepage keeps decision company cards and fails closed on undeclared private fields", async () => {
  const valid = await loadAppCompanyRenderer();
  valid.render({ decisionProducts: emptyDecisionArtifact([decisionCompanyCard()]), stats: {}, routes: [] });
  assert.match(valid.mounts["company-radar"].innerHTML, /Alpha Robotics/);
  assert.match(valid.mounts["company-radar"].innerHTML, /字段与证据/);
  assert.doesNotMatch(valid.mounts["company-radar"].innerHTML, /待识别公司/);

  const invalid = await loadAppCompanyRenderer();
  invalid.render({ decisionProducts: emptyDecisionArtifact([decisionCompanyCard({ selectionScore: 99 })]), stats: {}, routes: [] });
  assert.match(invalid.mounts["top-signals"].innerHTML, /未通过公开契约校验/);
  assert.doesNotMatch(invalid.mounts["company-radar"].innerHTML, /Alpha Robotics|99/);
});

test("both product renderers fail closed for every malformed nested decision boundary", async () => {
  const mutations: Array<[string, (artifact: any) => void]> = [
    ["periodStart", (value) => { value.periodStart = "not-a-date"; }],
    ["offset generatedAt", (value) => { value.generatedAt = "2026-08-17T09:00:00+08:00"; }],
    ["offset updatedAt", (value) => { value.companyCards[0].updatedAt = "2026-08-01T08:00:00+08:00"; }],
    ["numeric route", (value) => { value.companyCards[0].routes = [42]; }],
    ["validation stage", (value) => { value.companyCards[0].validationStage = "已量产"; }],
    ["capital extra", (value) => { value.companyCards[0].capital.undeclared = true; }],
    ["product extra", (value) => { value.companyCards[0].productDeployment.undeclared = true; }],
    ["watchlist extra", (value) => { value.companyCards[0].watchlist.undeclared = true; }],
    ["passport benchmark extra", (value) => { value.researchPassports[0].benchmark.undeclared = true; }],
    ["passport assets extra", (value) => { value.researchPassports[0].assets.undeclared = true; }],
    ["passport authority extra", (value) => { value.researchPassports[0].authority.undeclared = true; }],
    ["subscription extra", (value) => { value.subscriptions.entries[0].undeclared = true; }],
    ["recentChanges type", (value) => { value.companyCards[0].recentChanges = {}; }],
    ["validation points type", (value) => { value.companyCards[0].watchlist.nextValidationPoints = {}; }],
    ["passport gaps type", (value) => { value.researchPassports[0].gaps = "unknown"; }],
    ["subscriptions type", (value) => { value.subscriptions.entries = {}; }],
    ["missing collection", (value) => { delete value.companyCards; }],
    ["signal identity", (value) => { value.topSignals[0].signalId = stableDecisionId("signal", "event-other"); }],
    ["signal kind", (value) => { value.topSignals[0].kind = "传闻"; }],
    ["signal facts", (value) => { value.topSignals[0].factsZh = ["不完整"]; }],
    ["signal timestamp", (value) => { value.topSignals[0].occurredAt = "2026-08-16T09:00:00+08:00"; }],
    ["signal boolean", (value) => { value.topSignals[0].changedThisWeek = 1; }],
    ["signal evidence state", (value) => { value.topSignals[0].evidenceState = "verified"; }],
    ["signal evidence extra", (value) => { value.topSignals[0].evidence[0].undeclared = true; }],
    ["signal evidence URL", (value) => { value.topSignals[0].evidence[0].url = "javascript:alert(1)"; }],
    ["signal evidence grade", (value) => { value.topSignals[0].evidence[0].grade = "C"; }],
    ["signal impact", (value) => { value.topSignals[0].impact = ["rumor"]; }],
    ["company identity", (value) => { value.companyCards[0].cardId = stableDecisionId("company", "other"); }],
    ["fact status", (value) => { value.companyCards[0].capital.status = "absent"; }],
    ["fact evidence type", (value) => { value.companyCards[0].productDeployment.evidence = {}; }],
    ["change extra", (value) => { value.companyCards[0].recentChanges = [{ eventId: "event-change", title: "变化", occurredAt: "2026-08-16T01:00:00.000Z", type: "产品发布", undeclared: true }]; }],
    ["watchlist track", (value) => { value.companyCards[0].watchlist.track = "private"; }],
    ["watchlist date", (value) => { value.companyCards[0].watchlist.nextValidationPoints = [{ text: "核验部署。", dueAt: "2026-02-30" }]; }],
    ["unknown fields", (value) => { value.companyCards[0].unknownFields = [42]; }],
    ["passport identity", (value) => { value.researchPassports[0].passportId = stableDecisionId("research", "paper-other"); }],
    ["passport source URL", (value) => { value.researchPassports[0].sourceUrl = "/relative"; }],
    ["passport task type", (value) => { value.researchPassports[0].task = [42]; }],
    ["passport benchmark evidence", (value) => { value.researchPassports[0].benchmark.name = "LIBERO"; }],
    ["passport trials", (value) => { value.researchPassports[0].realRobotTrials = -1; }],
    ["passport asset URL", (value) => { value.researchPassports[0].assets.code = "javascript:alert(1)"; }],
    ["passport cost", (value) => { value.researchPassports[0].reproducibilityCost = { level: "low", rationale: "unknown" }; }],
    ["passport authority count", (value) => { value.researchPassports[0].authority.citedByCount = -1; }],
    ["passport authority timestamp", (value) => { value.researchPassports[0].authority.checkedAt = "2026-08-17T09:00:00+08:00"; }],
    ["passport OpenAlex identity", (value) => { value.researchPassports[0].authority.openAlexWorkId = "https://example.com/W1"; }],
    ["passport limitations", (value) => { value.researchPassports[0].limitations = []; }],
    ["subscription id", (value) => { value.subscriptions.entries[0].subscriptionId = " feed-all "; }],
    ["subscription cadence", (value) => { value.subscriptions.entries[0].cadence = "monthly"; }],
    ["subscription format", (value) => { value.subscriptions.entries[0].format = "email"; }],
    ["subscription URL", (value) => { value.subscriptions.entries[0].url = "mailto:test@example.com"; }],
    ["subscription route", (value) => { value.subscriptions.entries[0].route = "private-route"; }],
    ["candidate boundary", (value) => { value.companyCards[0].watchlist.whyNow = "candidate-secret"; }],
    ["private key boundary", (value) => { value.researchPassports[0].rawModelOutput = "secret"; }],
    ["private narrative", (value) => { value.topSignals[0].rankReasons = ["internal score 99"]; }],
  ];
  for (const [label, mutate] of mutations) {
    const artifact = completeDecisionArtifact();
    mutate(artifact);
    const app = await loadAppCompanyRenderer();
    assert.doesNotThrow(() => app.render({ decisionProducts: artifact, stats: {}, routes: [] }), label);
    assert.match(app.mounts["top-signals"].innerHTML, /未通过公开契约校验/, label);
    const share = await loadShareCompanyRenderer();
    assert.doesNotThrow(() => share.companies({ decisionProducts: artifact }), label);
    assert.match(share.root.innerHTML, /未通过公开契约校验/, label);
  }
});

test("browser stable IDs match Node UTF-8 replacement for lone surrogates", async () => {
  const artifact = completeDecisionArtifact();
  artifact.topSignals[0].eventId = "event-\ud800";
  artifact.topSignals[0].signalId = stableDecisionId("signal", artifact.topSignals[0].eventId);
  const app = await loadAppCompanyRenderer();
  app.render({ decisionProducts: artifact, stats: {}, routes: [] });
  assert.doesNotMatch(app.mounts["top-signals"].innerHTML, /未通过公开契约校验/);
  assert.match(app.mounts["top-signals"].innerHTML, /Alpha 发布机器人/);
  const share = await loadShareCompanyRenderer();
  share.companies({ decisionProducts: artifact });
  assert.doesNotMatch(share.root.innerHTML, /未通过公开契约校验/);
  assert.match(share.root.innerHTML, /Alpha Robotics/);
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

test("period-change page renders only validated public deltas with snapshot identities", async () => {
  const html = await readSite("watchlist-changes.html");
  assert.match(html, /data-view="changes"/);
  assert.match(html, /share-pages\.js/);

  const { root, changes } = await loadChangePageRenderer();
  changes({
    schemaVersion: 1,
    current: { week: "2026-W34", snapshotVersion: 2, generatedAt: "2026-08-17T01:00:00.000Z" },
    baseline: { week: "2026-W34", snapshotVersion: 1, generatedAt: "2026-08-16T01:00:00.000Z" },
    emptyBaseline: false,
    changes: [{
      companyId: "company-alpha", companyName: "Alpha Robotics", kind: "correction",
      whatChanged: "Alpha Robotics：公开判断修正。", why: "AI 研究判断：修正后的规范事实。",
      evidenceLinks: [{ eventId: "event-alpha", title: "Alpha 官方发布", url: "https://alpha.example/release", source: "Alpha 官方", grade: "A" }],
    }],
  });
  assert.match(root.innerHTML, /2026-W34 · v2/);
  assert.match(root.innerHTML, /基线：2026-W34 · v1/);
  assert.match(root.innerHTML, /公开判断修正/);
  assert.match(root.innerHTML, /https:\/\/alpha\.example\/release/);
  assert.doesNotMatch(root.innerHTML, /score|rank|综合分/);

  changes({});
  assert.match(root.innerHTML, /变化数据未通过公开契约校验/);

  changes({
    schemaVersion: 1,
    current: { week: "2026-W34", snapshotVersion: 2, generatedAt: "2026-08-17T01:00:00.000Z" },
    baseline: { week: "2026-W34", snapshotVersion: 1, generatedAt: "2026-08-16T01:00:00.000Z" },
    emptyBaseline: false,
    changes: [{ companyId: "company-alpha", companyName: "Alpha Robotics", kind: "correction", whatChanged: "分数变化。", why: "internal score changed", evidenceLinks: [{ eventId: "event-alpha", title: "Alpha 官方发布", url: "https://alpha.example/release", source: "Alpha 官方", grade: "A" }] }],
  });
  assert.match(root.innerHTML, /变化数据未通过公开契约校验/);
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
  assert.deepEqual(filtered.map((card) => card.companyId), ["company-alpha", "company-beta"]);
});
