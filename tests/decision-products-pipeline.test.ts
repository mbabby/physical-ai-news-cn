import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { generate } from "../src/main.js";
import type { DecisionProductArtifact } from "../src/decision-products/contracts.js";
import { stableDecisionId } from "../src/decision-products/contracts.js";
import { formatDecisionProductReadme } from "../src/decision-products/markdown.js";
import { FileTransaction } from "../src/runtime/storage.js";
import type { DigestResult } from "../src/types.js";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXED_NOW = new Date("2026-08-23T08:00:00.000Z");
const FIXTURE_PATHS = [
  "README.md", "daily", "weekly", "sources", "review", "resources", "events",
  "research", "routes", "metrics", "site/data", "site/feeds", "watchlist",
];
const DECISION_PATHS = [
  "site/data/decision-products.json", "site/data/dashboard.json", "README.md",
  "site/feeds/decision/all.xml", "site/feeds/decision/data-and-training.xml",
  "site/feeds/decision/vla-and-embodied-models.xml",
  "site/feeds/decision/world-models-and-spatial-intelligence.xml",
  "site/feeds/decision/embodiment-and-hardware.xml",
  "site/feeds/decision/deployment-and-commercialization.xml",
  "site/feeds/decision/watchlist.xml", "site/feeds/decision/manifest.json",
];

const emptyCollection = async (): Promise<DigestResult> => ({ articles: [], failures: [], sourceOutcomes: [] });

async function fixedRepository(): Promise<string> {
  const target = await mkdtemp(join(tmpdir(), "decision-products-pipeline-"));
  for (const path of FIXTURE_PATHS) await cp(join(repositoryRoot, path), join(target, path), { recursive: true });
  await rm(join(target, "watchlist", "current.json"), { force: true });
  await rm(join(target, "watchlist", "theses.json"), { force: true });
  await rm(join(target, "watchlist", "history"), { recursive: true, force: true });
  await mkdir(join(target, "watchlist", "history"), { recursive: true });
  return target;
}

async function generateFixed(root: string, transaction?: FileTransaction) {
  const keys = ["LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL", "OPENALEX_API_KEY"] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  keys.forEach((key) => { delete process.env[key]; });
  try {
    return await generate({ root, now: FIXED_NOW, collect: emptyCollection, collectX: emptyCollection, transaction });
  } finally {
    keys.forEach((key) => {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  }
}

async function decisionProductBytes(root: string): Promise<Record<string, string>> {
  return Object.fromEntries(await Promise.all(DECISION_PATHS.map(async (path) => [path, await readFile(join(root, path), "utf8")] as const)));
}

test("one artifact drives JSON, dashboard, README and feeds without reorder", async () => {
  const root = await fixedRepository();
  try {
    await generateFixed(root);
    const artifact = JSON.parse(await readFile(join(root, "site/data/decision-products.json"), "utf8")) as DecisionProductArtifact;
    const dashboard = JSON.parse(await readFile(join(root, "site/data/dashboard.json"), "utf8")) as { decisionProducts: DecisionProductArtifact };
    const readme = await readFile(join(root, "README.md"), "utf8");
    assert.deepEqual(dashboard.decisionProducts, artifact);
    assert.deepEqual(dashboard.decisionProducts.topSignals.map((item) => item.signalId), artifact.topSignals.map((item) => item.signalId));
    assert.deepEqual((dashboard as unknown as { topSignals: Array<{ signalId: string }> }).topSignals.map((item) => item.signalId), artifact.topSignals.map((item) => item.signalId));
    assert.deepEqual((dashboard as unknown as { companyRadar: Array<{ cardId: string }> }).companyRadar.map((item) => item.cardId), artifact.companyCards.map((item) => item.cardId));
    assert.deepEqual((dashboard as unknown as { research: Array<{ passportId: string }> }).research.map((item) => item.passportId), artifact.researchPassports.map((item) => item.passportId));
    assert.deepEqual([...readme.matchAll(/<!-- decision-signal:([^ ]+) -->/g)].map((match) => match[1]), artifact.topSignals.map((item) => item.signalId));
    const allFeed = await readFile(join(root, "site/feeds/decision/all.xml"), "utf8");
    assert.deepEqual([...allFeed.matchAll(/urn:physical-ai:signal:([^<]+)/g)].map((match) => match[1]), artifact.topSignals.map((item) => item.signalId));

    const first = await decisionProductBytes(root);
    await generateFixed(root);
    assert.deepEqual(await decisionProductBytes(root), first);
    assert.equal((await readdir(join(root, "watchlist", "history"))).length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a decision feed swap failure rolls back all decision surfaces", async () => {
  const root = await fixedRepository();
  try {
    await generateFixed(root);
    const before = await decisionProductBytes(root);
    await assert.rejects(() => generateFixed(root, new FileTransaction("decision-failure", {
      failAfterPath: join(root, "site/feeds/decision/all.xml"),
    })), (error: unknown) => (error as { code?: string }).code === "transaction-swap-failure");
    assert.deepEqual(await decisionProductBytes(root), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("README normalizes adversarial evidence URLs before Markdown rendering", () => {
  const generatedAt = "2026-08-23T08:00:00.000Z";
  const url = "https://example.com/a) [spoof](https://evil.test";
  const artifact: DecisionProductArtifact = {
    schemaVersion: 1,
    generatedAt,
    periodStart: "2026-08-17",
    topSignals: [{
      signalId: stableDecisionId("signal", "event-alpha"), eventId: "event-alpha", entityId: "alpha", entityName: "Alpha Robotics",
      titleZh: "Alpha 发布机器人", factsZh: ["Alpha 发布了新机器人。", "该产品已进入公开验证。"], kind: "产品发布", routes: ["VLA 与具身模型"],
      occurredAt: generatedAt, verifiedAt: generatedAt, changedThisWeek: true, evidenceState: "official",
      evidence: [{ evidenceId: stableDecisionId("evidence", `event-alpha\n${url}`), url, source: "Alpha 官方", grade: "A" }],
      impact: ["company", "product-deployment"], whyItMatters: "AI 研究判断：该事件提供了公开验证。", rankReasons: ["官方一手证据"],
    }],
    companyCards: [], researchPassports: [], subscriptions: { generatedAt, entries: [] },
  };
  const rendered = formatDecisionProductReadme(artifact);
  assert.doesNotMatch(rendered, /\[spoof\]\(https:\/\/evil\.test\)/);
  assert.match(rendered, /https:\/\/example\.com\/a%29%20\[spoof\]%28https:\/\/evil\.test/);
});
