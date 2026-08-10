import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSite = async (name: string) => readFile(new URL(`../site/${name}`, import.meta.url), "utf8");

test("homepage keeps data-engineering mount points while presenting one decision briefing", async () => {
  const html = await readSite("index.html");
  const requiredIds = [
    "briefing", "top-signals", "developing-signals", "capital", "industry", "research",
    "company-boards", "company-board-grid", "company-radar", "research-graph-grid", "routes-grid",
    "detail-drawer-root",
  ];
  for (const id of requiredIds) assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
  const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "homepage must not contain duplicate ids");
  assert.match(html, /未知字段保持未知/);
  assert.match(html, /不绘制推测性关联/);
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
