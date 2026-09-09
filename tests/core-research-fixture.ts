import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { updateResearchRegistry } from "../src/research-registry.js";
import { shanghaiDailyDate } from "../src/runtime/daily-date.js";
import type { Article, DailyArchive } from "../src/types.js";

const PAPER_ID = "arxiv:2609.00001";

/** Only for an isolated temporary Core test checkout. Keep a real, complete
 * research publication instead of inheriting the repository's moving pool. */
export async function seedCoreResearchFixture(root: string): Promise<void> {
  const checkedAt = "2026-09-05T02:00:00.000Z";
  const article: Article = {
    id: PAPER_ID,
    title: "A Reproducible Real-Robot Manipulation Benchmark",
    titleZh: "面向真实机器人的可复现操作基准",
    summaryZh: "论文在真实机器人上建立操作基准，并报告相对基线的成功率提升。作者同时公开评测协议与代码，便于独立复现。",
    link: "https://arxiv.org/abs/2609.00001v1",
    publishedAt: new Date("2026-09-05T00:00:00.000Z"),
    fetchedAt: new Date("2026-09-05T01:00:00.000Z"),
    source: "arXiv · Robotics", sourceWeight: 9,
    excerpt: "We evaluate a real robot manipulation benchmark against a baseline. Code available at https://github.com/example/core-fixture-robot-benchmark.",
    kind: "研究与数据", tags: ["研究", "robot"], authors: ["Fixture Researcher"],
    scholar: {
      provider: "OpenAlex", workId: "https://openalex.org/W7200000001", citedByCount: 12, isRetracted: false,
      institutions: ["Tsinghua University"],
      authors: [{ name: "Fixture Researcher", totalCitations: 320, hIndex: 8, institutions: ["Tsinghua University"] }],
      checkedAt,
    },
  };
  await rm(join(root, "daily"), { recursive: true, force: true });
  await mkdir(join(root, "daily"), { recursive: true });
  await mkdir(join(root, "research"), { recursive: true });
  const archive: DailyArchive = { date: "2026-09-05", articles: [article], candidates: [], sourceOutcomes: [], runtimeStatus: [] };
  await writeFile(join(root, "daily/2026-09-05.json"), JSON.stringify(archive));
  await writeFile(join(root, "research/registry.json"), JSON.stringify(updateResearchRegistry(undefined, [article], new Date(checkedAt))));
}

/** Assert exact non-empty public research after generation, not just that an
 * empty pool happened to bypass the publication-regression gate. */
export async function assertCoreResearchPublished(root: string, now: Date): Promise<void> {
  const archive: DailyArchive = JSON.parse(await readFile(join(root, `daily/${shanghaiDailyDate(now)}.json`), "utf8"));
  assert.deepEqual(archive.articles.filter((article) => article.kind === "研究与数据").map((article) => article.id), [PAPER_ID]);
  const manifest = JSON.parse(await readFile(join(root, "review/run-manifest.json"), "utf8"));
  assert.equal(manifest.quality.publicResearchItems, 1);
}
