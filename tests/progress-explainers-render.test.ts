import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { previousArtifact } from "./helpers/progress-explainers.js";

// Breaking order, escaping, fail-closed validation or clock separation must fail these tests.
const module = await import("../site/progress-explainers.js").catch(() => ({}));
const render = (value: unknown): string => {
  assert.equal(typeof module.renderProgressExplainers, "function", "public renderer must exist");
  return module.renderProgressExplainers(value);
};

test("renders the literal artifact order and identity without sorting or drafting", () => {
  const artifact = previousArtifact();
  artifact.cards.push({ ...artifact.cards[0]!, id: "explainer-alpha", canonicalId: "event:alpha", titleZh: "Alpha 的第二条进展" });
  const html = render(artifact);
  assert.deepEqual([...html.matchAll(/data-explainer-id="([^"]+)"/g)].map((m) => m[1]), ["explainer-event-gripper-trial", "explainer-alpha"]);
  assert.match(html, /DexLab 机械手抓取试验/);
  assert.match(html, /<ol[^>]*class="explainer-facts"[^>]*><li>DexLab 报告了覆盖 12 个物体的机械手试验。<\/li><li>机械手完成了其中 9 个物体的试验。<\/li><\/ol>/);
  assert.match(html, /<h4>事实<\/h4>/);
  assert.match(html, /<h4>变化<\/h4>/);
  assert.match(html, /<h4>解读<\/h4>/);
  assert.match(html, /<h4>局限<\/h4>/);
  assert.match(html, /这为判断机械手在指定任务中的表现提供了可核对证据。/);
  assert.match(html, /披露未说明其他物体或环境中的表现。/);
});

test("escapes narrative and source labels and never creates executable evidence links", () => {
  const artifact = previousArtifact();
  artifact.cards[0]!.titleZh = '<img src=x onerror="alert(1)">标题';
  artifact.cards[0]!.evidence[0]!.source = "<script>来源</script>";
  assert.match(render(artifact), /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;标题/);
  assert.doesNotMatch(render(artifact), /<img|<script/);
  for (const url of ["javascript:alert(1)", "data:text/html,hi", "/relative", "https://user:pass@example.com"]) {
    artifact.cards[0]!.evidence[0]!.url = url;
    assert.doesNotMatch(render(artifact), /data-explainer-id=/);
  }
});

test("never turns a missing or malformed artifact into candidate news", () => {
  for (const value of [null, {}, [], { ...previousArtifact(), cards: null }, { ...previousArtifact(), cards: [null] }, { ...previousArtifact(), status: "candidate" }]) {
    const html = render(value);
    assert.match(html, /暂不可用|加载失败/);
    assert.doesNotMatch(html, /data-explainer-id=|2026-|候选新闻/);
  }
  for (const mutate of [
    (a: any) => { a.cards[0].factsZh = ["只有一个事实"]; },
    (a: any) => { a.cards[0].eventDate = "2026-02-30"; },
    (a: any) => { a.cards.push(a.cards[0]); },
    (a: any) => { a.cards[0].privateScore = 99; },
    (a: any) => { a.cards[0].fieldRefs = {}; },
    (a: any) => { a.checkedAt = "invalid"; },
  ]) { const a = previousArtifact(); mutate(a); assert.doesNotMatch(render(a), /data-explainer-id=/); }
});

test("distinguishes all four states and separates check time from content update", () => {
  for (const [status, label] of [["updated", "有新解读"], ["no-new-content", "本轮无新内容"], ["constrained", "本轮受限"], ["unavailable", "暂不可用"]] as const) {
    const a = previousArtifact(); a.status = status;
    a.generatedAt = a.checkedAt = "2026-09-10T00:00:00.000Z";
    a.cards[0]!.checkedAt = a.checkedAt;
    const html = render(a);
    assert.match(html, new RegExp(label));
    assert.match(html, /最近检查[\s\S]*2026-09-10/);
    assert.match(html, /内容更新[\s\S]*2026-09-09/);
  }
  const html = render({ ...previousArtifact(), cards: [], lastContentUpdatedAt: null, status: "unavailable" });
  assert.match(html, /尚未生成/);
  assert.doesNotMatch(html, /data-explainer-id=/);
});

test("keeps historical and unknown provenance explicit with expandable evidence and background", () => {
  const a = previousArtifact();
  Object.assign(a.cards[0]!, { historical: true, eventDate: "2020-01-02", publishedAt: "unknown", materiallyChangedAt: "unknown", backgroundZh: "这是背景说明。" });
  a.cards[0]!.fieldRefs.backgroundZh = ["fact:trial"];
  const html = render(a);
  assert.match(html, /历史进展/);
  assert.match(html, /事件日期[\s\S]*2020-01-02/);
  assert.match(html, /披露日期[\s\S]*未知/);
  assert.match(html, /实质变化[\s\S]*未知/);
  assert.match(html, /<details[^>]*><summary>背景与原始证据<\/summary>/);
  assert.match(html, /这是背景说明。/);
  assert.match(html, /href="https:\/\/lab.example\/gripper"[^>]*>DexLab/);
  assert.doesNotMatch(html, /<details[^>]* open/);
});

test("homepage places one reader mount before a closed library and keeps valid navigation", async () => {
  const html = await readFile(new URL("../site/index.html", import.meta.url), "utf8");
  const nav = html.match(/<nav[^>]*>([\s\S]*?)<\/nav>/)![1]!;
  assert.deepEqual([...nav.matchAll(/href="([^"]+)"/g)].map((m) => m[1]), ["#briefing", "#library"]);
  assert.equal([...html.matchAll(/id="progress-explainers"/g)].length, 1);
  assert.ok(html.indexOf('id="progress-explainers"') < html.indexOf('id="library"'));
  assert.match(html, /<details id="library-archive"[^>]*>/);
  assert.doesNotMatch(html, /<details id="library-archive"[^>]*\bopen\b/);
  assert.ok(html.indexOf('id="library-archive"') < html.indexOf('id="top-signals"'));
});

test("explainer loading handles HTTP and JSON failures without inventing a checked time", async () => {
  assert.equal(typeof module.loadProgressExplainers, "function");
  const mount = { innerHTML: "" };
  await module.loadProgressExplainers(mount, async () => ({ ok: true, json: async () => previousArtifact() }));
  assert.match(mount.innerHTML, /DexLab/);
  for (const response of [{ ok: false }, { ok: true, json: async () => { throw Error("bad JSON"); } }]) {
    await module.loadProgressExplainers(mount, async () => response);
    assert.match(mount.innerHTML, /暂不可用/);
    assert.doesNotMatch(mount.innerHTML, /DexLab|2026-/);
  }
});

test("dashboard rendering cannot erase explainers and defers archive cards until disclosure opens", async () => {
  const source = (await readFile(new URL("../site/app.js", import.meta.url), "utf8"))
    .replace(/^import "\.\/decision-products-validator\.js";\s*/, "")
    .replace(/loadDashboard\(\)\.then\(render\);/, "globalThis.render = render;");
  let toggled: (() => void) | undefined;
  const mounts: any = { "progress-explainers": { innerHTML: render(previousArtifact()) }, "publication-status": { innerHTML: "" }, "library-archive": { open: false, addEventListener: (_: string, fn: () => void) => { toggled = fn; } }, "top-signals": { innerHTML: "not initialized" }, "developing-signals": { innerHTML: "" } };
  const context: any = { console, URL, Intl, Date, document: { getElementById: (id: string) => mounts[id], addEventListener() {}, body: { dataset: { view: "explained" }, classList: { add() {}, remove() {} } } }, window: { location: { href: "https://example.test/", protocol: "https:" }, addEventListener() {} }, navigator: {} };
  vm.runInNewContext(source, context);
  const original = mounts["progress-explainers"].innerHTML;
  context.render({ publicationHealth: { daily: { expectedDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date()), state: "current" }, degradedComponents: ["LLM", "OpenAlex", "ProgressExplainers"] } });
  assert.equal(mounts["progress-explainers"].innerHTML, original);
  assert.equal(mounts["top-signals"].innerHTML, "not initialized");
  assert.match(mounts["publication-status"].innerHTML, /LLM.*OpenAlex.*ProgressExplainers/);
  assert.equal(typeof toggled, "function");
  mounts["library-archive"].open = true; toggled!();
  assert.notEqual(mounts["top-signals"].innerHTML, "not initialized");
  context.render({});
  assert.equal(mounts["progress-explainers"].innerHTML, original);
});

test("legacy company and capital anchors open their library disclosures", async () => {
  const source = (await readFile(new URL("../site/app.js", import.meta.url), "utf8"))
    .replace(/^import "\.\/decision-products-validator\.js";\s*/, "")
    .replace(/loadDashboard\(\)\.then\(render\);/, "globalThis.reveal = typeof revealLibraryAnchor === 'function' ? revealLibraryAnchor : null;");
  const mounts: any = { "library-archive": { open: false }, "library-records": { open: false } };
  const context: any = { console, URL, Intl, Date, document: { getElementById: (id: string) => mounts[id], addEventListener() {}, body: { dataset: {}, classList: { add() {}, remove() {} } } }, window: { location: { href: "https://example.test/#capital", hash: "#capital" }, addEventListener() {} }, navigator: {} };
  vm.runInNewContext(source, context);
  assert.equal(typeof context.reveal, "function"); context.reveal();
  assert.equal(mounts["library-archive"].open, true);
  assert.equal(mounts["library-records"].open, true);
  mounts["library-archive"].open = false;
  context.window.location.href = "https://example.test/?watch=figure";
  context.reveal(); assert.equal(mounts["library-archive"].open, true);
});
