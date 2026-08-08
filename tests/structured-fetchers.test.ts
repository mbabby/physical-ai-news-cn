import assert from "node:assert/strict";
import test from "node:test";
import { parseSitemap, parseWebPage } from "../src/fetchers/structured.js";
import type { SitemapSourceConfig, WebPageSourceConfig } from "../src/types.js";

const pageSource: WebPageSourceConfig = {
  id: "official-example-news", type: "webpage", name: "Example News", url: "https://example.com/news",
  linkPattern: "/news/", weight: 10, keywords: ["robot"], tier: "官方公司与实验室",
  status: "观察", publicationPolicy: "可作为一手证据",
};

test("webpage adapter publishes only dated matching news links", () => {
  const html = `
    <article><time>2026-08-07</time><a href="/news/robot-launch">Robot launch reaches factory deployment</a></article>
    <article><a href="/news/undated">Undated robot archive item</a></article>
    <a href="/about">About this robotics company</a>`;
  const items = parseWebPage(html, pageSource, new Date("2026-08-08T00:00:00Z"));
  assert.equal(items.length, 1);
  assert.equal(items[0].link, "https://example.com/news/robot-launch");
  assert.equal(items[0].publishedAt.toISOString().slice(0, 10), "2026-08-07");
});

test("sitemap adapter requires lastmod and keeps only matching URLs", () => {
  const source: SitemapSourceConfig = { ...pageSource, type: "sitemap", linkPattern: "/updates/" };
  const xml = `<urlset>
    <url><loc>https://example.com/updates/factory-robot</loc><lastmod>2026-08-07T12:00:00Z</lastmod></url>
    <url><loc>https://example.com/updates/undated</loc></url>
    <url><loc>https://example.com/about</loc><lastmod>2026-08-07</lastmod></url>
  </urlset>`;
  const items = parseSitemap(xml, source, new Date("2026-08-08T00:00:00Z"));
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "factory robot");
});
