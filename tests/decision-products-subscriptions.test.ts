import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { stableDecisionId, type DecisionProductArtifact } from "../src/decision-products/contracts.js";
import { buildSubscriptionCatalog, renderDecisionFeed, stageDecisionFeeds } from "../src/decision-products/subscriptions.js";
import { FileTransaction } from "../src/runtime/storage.js";
import type { WatchlistPublicView } from "../src/watchlist/public-view.js";

const REPO = "https://github.com/mbabby/physical-ai-news-cn";
const PAGES = "https://mbabby.github.io/physical-ai-news-cn";

function artifact(): DecisionProductArtifact {
  return {
    schemaVersion: 1,
    generatedAt: "2026-08-24T01:00:00Z",
    periodStart: "2026-08-18",
    topSignals: [
      {
        signalId: stableDecisionId("signal", "event-alpha"),
        eventId: "event-alpha",
        entityId: "company-alpha",
        entityName: "Alpha & Co.",
        titleZh: "Alpha 发布 <Atlas> 机器人",
        factsZh: ["Alpha 发布了新型机器人。", "该产品已进入客户试点。"],
        kind: "产品发布",
        routes: ["本体与硬件", "部署与商业化"],
        occurredAt: "2026-08-23T01:00:00Z",
        verifiedAt: "2026-08-24T01:00:00Z",
        changedThisWeek: true,
        evidenceState: "official",
        evidence: [{ evidenceId: "evidence-alpha", url: "https://alpha.example/news?x=1&y=2", source: "Alpha", grade: "A" }],
        impact: ["company", "product-deployment"],
        whyItMatters: "AI 研究判断：客户试点提高了产品验证强度。",
        rankReasons: ["本周发生实质变化"],
      },
      {
        signalId: stableDecisionId("signal", "event-beta"),
        eventId: "event-beta",
        entityId: "company-beta",
        entityName: "Beta Robotics",
        titleZh: "Beta 发布训练数据集",
        factsZh: ["Beta 发布了机器人训练数据集。", "该数据集提供了公开下载地址。"],
        kind: "研究与数据",
        routes: ["数据与训练"],
        occurredAt: "2026-08-22T01:00:00Z",
        verifiedAt: "2026-08-24T01:00:00Z",
        changedThisWeek: true,
        evidenceState: "official",
        evidence: [{ evidenceId: "evidence-beta", url: "https://beta.example/data", source: "Beta", grade: "A" }],
        impact: ["research"],
        whyItMatters: "AI 研究判断：公开数据有助于复现实验。",
        rankReasons: ["本周发生实质变化"],
      },
    ],
    companyCards: [],
    researchPassports: [],
    subscriptions: { generatedAt: "2026-08-24T01:00:00Z", entries: [] },
  };
}

function watchlist(): WatchlistPublicView {
  return {
    week: "2026-W34",
    snapshotVersion: 3,
    methodologyVersion: "method-v1",
    lastSuccessfulAt: "2026-08-24T01:00:00.000Z",
    companyIds: ["company-alpha"],
    forwardRadar: [{
      companyId: "company-alpha",
      companyName: "Alpha <Robotics> & Co.",
      thesisId: "thesis-alpha",
      thesisVersion: 2,
      track: "forward-radar",
      group: "priority-focus",
      lifecycle: "strengthening",
      lifecycleLabel: "持续强化",
      routes: ["部署与商业化"],
      whyNow: "AI 研究判断：部署证据正在积累。",
      routeAndDependencies: "AI 研究判断：依赖规模验证。",
      nextValidationPoints: [{ text: "核验客户部署。", dueAt: "2026-10-01" }],
      falsifiers: [{ text: "规范事实被撤回。" }],
      evidenceLinks: [{ eventId: "event-alpha", title: "Alpha 发布 Atlas", url: "https://alpha.example/atlas", source: "Alpha 官方", grade: "A" }],
      capital: { status: "evidence-insufficient", summary: "证据不足（不代表未融资）" },
    }],
    validatedMomentum: [],
    changes: [
      { companyId: "company-alpha", companyName: "Alpha <Robotics> & Co.", change: "strengthened" },
      { companyId: "company-exited", companyName: "Exited & Co.", change: "exited" },
    ],
  };
}

const OPTIONS = { repositoryUrl: REPO, pagesUrl: PAGES, watchlist: watchlist() };

test("subscription catalog exposes global, five route, watchlist and GitHub entries", () => {
  const catalog = buildSubscriptionCatalog(artifact(), { repositoryUrl: `${REPO}///`, pagesUrl: `${PAGES}///` });
  assert.deepEqual(catalog.entries.map((entry) => entry.subscriptionId), [
    "github-watch", "github-releases", "feed-all", "feed-data-and-training", "feed-vla-and-embodied-models",
    "feed-world-models-and-spatial-intelligence", "feed-embodiment-and-hardware", "feed-deployment-and-commercialization", "feed-watchlist",
  ]);
  assert.deepEqual(catalog.entries.map((entry) => entry.url), [
    `${REPO}/subscription`, `${REPO}/releases`, `${PAGES}/feeds/decision/all.xml`, `${PAGES}/feeds/decision/data-and-training.xml`,
    `${PAGES}/feeds/decision/vla-and-embodied-models.xml`, `${PAGES}/feeds/decision/world-models-and-spatial-intelligence.xml`,
    `${PAGES}/feeds/decision/embodiment-and-hardware.xml`, `${PAGES}/feeds/decision/deployment-and-commercialization.xml`, `${PAGES}/feeds/decision/watchlist.xml`,
  ]);
  assert.equal(catalog.generatedAt, artifact().generatedAt);
});

test("feed bytes, input order and GUIDs are stable for fixed decision products", () => {
  const all = renderDecisionFeed(artifact(), "all", OPTIONS);
  assert.equal(all, renderDecisionFeed(structuredClone(artifact()), "all", { ...OPTIONS, watchlist: structuredClone(watchlist()) }));
  assert.match(all, new RegExp(`urn:physical-ai:signal:${artifact().topSignals[0]!.signalId}`));
  assert.ok(all.indexOf("event-alpha") < all.indexOf("event-beta"), "feed must preserve the materialized Top Signal order");
  assert.match(all, /Alpha 发布 &lt;Atlas&gt; 机器人/);
  assert.match(all, /Alpha &amp; Co\./);
  assert.match(all, /\?signal=decision-signal-[^<]+&amp;source=rss/);

  const route = renderDecisionFeed(artifact(), "部署与商业化", OPTIONS);
  assert.match(route, new RegExp(`urn:physical-ai:route:deployment-and-commercialization:${artifact().topSignals[0]!.signalId}`));
  assert.doesNotMatch(route, /event-beta/);

  const changes = renderDecisionFeed(artifact(), "watchlist", OPTIONS);
  assert.match(changes, /urn:physical-ai:watchlist:2026-W34:v3:company-alpha:strengthened/);
  assert.match(changes, /urn:physical-ai:watchlist:2026-W34:v3:company-exited:exited/);
  assert.ok(changes.indexOf("company-alpha") < changes.indexOf("company-exited"), "feed must preserve public Watchlist change order");
  assert.match(changes, /Alpha &lt;Robotics&gt; &amp; Co\./);
});

test("staging emits the canonical seven feeds and deterministic manifest through one transaction", async () => {
  const root = await mkdtemp(join(tmpdir(), "decision-feeds-"));
  try {
    const transaction = new FileTransaction("decision-feeds");
    stageDecisionFeeds({ root, transaction, artifact: artifact(), ...OPTIONS });
    assert.equal(transaction.size, 8);
    await transaction.commit();

    const manifestBytes = await readFile(join(root, "site", "feeds", "decision", "manifest.json"), "utf8");
    const manifest = JSON.parse(manifestBytes);
    assert.deepEqual(manifest, {
      schemaVersion: 1,
      generatedAt: "2026-08-24T01:00:00Z",
      feeds: [
        { subscriptionId: "feed-all", route: "all", path: "feeds/decision/all.xml" },
        { subscriptionId: "feed-data-and-training", route: "数据与训练", path: "feeds/decision/data-and-training.xml" },
        { subscriptionId: "feed-vla-and-embodied-models", route: "VLA 与具身模型", path: "feeds/decision/vla-and-embodied-models.xml" },
        { subscriptionId: "feed-world-models-and-spatial-intelligence", route: "世界模型与空间智能", path: "feeds/decision/world-models-and-spatial-intelligence.xml" },
        { subscriptionId: "feed-embodiment-and-hardware", route: "本体与硬件", path: "feeds/decision/embodiment-and-hardware.xml" },
        { subscriptionId: "feed-deployment-and-commercialization", route: "部署与商业化", path: "feeds/decision/deployment-and-commercialization.xml" },
        { subscriptionId: "feed-watchlist", route: "watchlist", path: "feeds/decision/watchlist.xml" },
      ],
    });
    assert.equal(manifestBytes, `${JSON.stringify(manifest, null, 2)}\n`);
    for (const feed of manifest.feeds) await readFile(join(root, "site", feed.path), "utf8");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid URLs, filters, XML and Watchlist input fail before staging", () => {
  assert.throws(() => buildSubscriptionCatalog(artifact(), { repositoryUrl: "javascript:alert(1)", pagesUrl: PAGES }), /HTTPS/);
  assert.throws(() => renderDecisionFeed(artifact(), "未批准路线" as "all", OPTIONS), /路线/);
  const malformed = structuredClone(watchlist()) as WatchlistPublicView & { secret?: string };
  malformed.secret = "private";
  assert.throws(() => renderDecisionFeed(artifact(), "watchlist", { ...OPTIONS, watchlist: malformed }), /Watchlist/);
  const noncanonicalId = structuredClone(watchlist());
  noncanonicalId.companyIds[0] = "company:alpha";
  noncanonicalId.forwardRadar[0]!.companyId = "company:alpha";
  noncanonicalId.changes[0]!.companyId = "company:alpha";
  assert.throws(() => renderDecisionFeed(artifact(), "watchlist", { ...OPTIONS, watchlist: noncanonicalId }), /标识/);
  const invalidXml = artifact();
  invalidXml.topSignals[0]!.titleZh += String.fromCodePoint(0xFFFE);
  assert.throws(() => renderDecisionFeed(invalidXml, "all", OPTIONS), /XML/);

  const staged: string[] = [];
  assert.throws(() => stageDecisionFeeds({
    root: "/tmp/decision-feed-invalid",
    transaction: { stage(path: string) { staged.push(path); } },
    artifact: artifact(),
    repositoryUrl: REPO,
    pagesUrl: "https://example.test/path?noncanonical=1",
    watchlist: watchlist(),
  }), /HTTPS/);
  assert.deepEqual(staged, []);
});
