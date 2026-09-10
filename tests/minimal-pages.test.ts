import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// Exercise the shipped page mounts and bootstrap modules, not a second test template.
// A missing mount, broken module URL, or fabricated recovery claim fails this boundary.
for (const [page, target, expected] of [
  ["index", "progress-explainers", /解读暂不可用/],
  ["companies", "share-content", /数据暂时不可用/],
  ["research", "share-content", /数据暂时不可用/],
  ["weekly", "share-content", /数据暂时不可用/],
  ["watchlist-changes", "share-content", /数据暂时不可用/],
  ["core-coverage", "core-coverage-root", /不可用|读取失败/],
  ["contribute", "community-task-groups", /当前没有/],
  ["subscribe", "subscription-watchlist-link", /index\.html/],
] as const) {
  test(`${page}: actual bootstrap handles unavailable data without inventing a recovery date`, async () => {
    const html = await readFile(new URL(`../site/${page}.html`, import.meta.url), "utf8");
    const mounts: Record<string, any> = Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => [m[1], {
      innerHTML: "", textContent: "", value: "", href: "", hidden: false, open: false,
      addEventListener() {}, querySelectorAll() { return []; }, querySelector() { return null; },
    }]));
    const location = new URL(`https://example.test/${page}.html`);
    const context = vm.createContext({
      URL, URLSearchParams, Date, Intl, Error,
      console: { ...console, warn() {} }, navigator: {},
      fetch: async () => ({ ok: false, status: 503 }),
      document: { getElementById: (id: string) => mounts[id] ?? null, querySelector: (id: string) => mounts[id.slice(1)] ?? null,
        addEventListener() {}, body: { dataset: { view: html.match(/data-view="([^"]+)"/)![1] }, classList: { add() {}, remove() {} } } },
      window: { location, history: { replaceState() {} }, addEventListener() {} },
    });
    vm.runInContext(await readFile(new URL("../site/decision-products-validator.js", import.meta.url), "utf8"), context);
    for (const script of html.matchAll(/<script type="module" src="([^"]+)"/g)) {
      const source = await readFile(new URL(`../site/${script[1]!.split("?")[0]}`, import.meta.url), "utf8");
      vm.runInContext(`(function(){${source.replace(/^import[^\n]+\n/gm, "").replace(/^export /gm, "")}\n})();`, context);
    }
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(mounts[target], `missing actual mount ${target}`);
    const output = mounts[target].innerHTML || mounts[target].href;
    assert.match(output, expected);
    assert.doesNotMatch(output, /线上页面会在下一次日报成功后自动恢复|生成于\s*2026-/);
  });
}
