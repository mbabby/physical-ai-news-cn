import assert from "node:assert/strict";
import test from "node:test";
import { formatResourcePage } from "../src/resource-radar.js";
import type { Article } from "../src/types.js";

const catalog = { models: [{ name: "Core VLA", link: "https://example.com/core", description: "核心模型。", group: "通用模型", rank: 100 }], datasets: [], tools: [] };
const article: Article = { id: "release", title: "LeRobot v1.0 release", link: "https://github.com/huggingface/lerobot/releases/tag/v1", publishedAt: new Date("2026-08-02"), fetchedAt: new Date(), source: "GitHub Releases", sourceWeight: 10, excerpt: "Robotics open source release for VLA training.", kind: "开源项目", tags: [] };

test("keeps curated core resources separate from ranked recent updates", () => {
  const page = formatResourcePage("models", catalog, [article], new Date("2026-08-02T12:00:00Z"));
  assert.match(page, /通用模型/);
  assert.match(page, /近期已验证更新（自动）/);
  assert.match(page, /LeRobot v1\.0 release/);
  assert.match(page, /排序与收录/);
});
