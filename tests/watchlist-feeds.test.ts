import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileTransaction } from "../src/runtime/storage.js";
import { buildCompanyFeed, buildRouteFeed, stageWatchlistFeeds } from "../src/watchlist/feeds.js";
import type { WatchlistPublicView } from "../src/watchlist/public-view.js";

const BASE_URL = "https://example.test/physical-ai-news-cn";

function view(overrides: Partial<WatchlistPublicView> = {}): WatchlistPublicView {
  const alpha: WatchlistPublicView["forwardRadar"][number] = {
    companyId: "company-alpha",
    companyName: "Alpha <Robotics> & Co.",
    thesisId: "thesis-alpha",
    thesisVersion: 2,
    track: "forward-radar",
    group: "priority-focus",
    lifecycle: "strengthening",
    lifecycleLabel: "持续强化",
    routes: ["VLA 与具身模型", "数据与训练"],
    whyNow: "AI 研究判断：<训练> & 部署证据正在积累。",
    routeAndDependencies: "AI 研究判断：依赖 > 规模验证。",
    nextValidationPoints: [{ text: "核验客户部署。", dueAt: "2026-10-01" }],
    falsifiers: [{ text: "规范事实被撤回。" }],
    evidenceLinks: [{ eventId: "event-alpha", title: "Alpha 发布 <Atlas>", url: "https://alpha.example/atlas?x=1&y=2", source: "Alpha & 官方", grade: "A" }],
    capital: { status: "evidence-insufficient", summary: "证据不足（不代表未融资）" },
  };
  const beta: WatchlistPublicView["validatedMomentum"][number] = {
    ...alpha,
    companyId: "company-beta",
    companyName: "Beta Robotics",
    thesisId: "thesis-beta",
    thesisVersion: 1,
    track: "validated-momentum",
    routes: ["部署与商业化"],
    evidenceLinks: [{ eventId: "event-beta", title: "Beta 部署", url: "https://beta.example/deploy", source: "Beta 官方", grade: "B" }],
  };
  return {
    week: "2026-W34",
    snapshotVersion: 3,
    methodologyVersion: "method-v1",
    lastSuccessfulAt: "2026-08-17T01:00:00.000Z",
    companyIds: ["company-alpha", "company-beta"],
    forwardRadar: [alpha],
    validatedMomentum: [beta],
    changes: [
      { companyId: "company-alpha", companyName: "Alpha <Robotics> & Co.", change: "strengthened" },
      { companyId: "company-exited", companyName: "Exited Robotics", change: "exited" },
    ],
    ...overrides,
  };
}

function rssLinks(xml: string): string[] {
  return [...xml.matchAll(/<link>([^<]+)<\/link>/g)].map((match) => match[1]!);
}

test("company feeds emit escaped RSS with stable thesis and change identities", () => {
  const feed = buildCompanyFeed(view(), "company-alpha", BASE_URL);

  assert.match(feed, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<rss version="2\.0">/);
  assert.match(feed, /观察名单快照：2026-W34 · v3/);
  assert.match(feed, /Alpha &lt;Robotics&gt; &amp; Co\./);
  assert.match(feed, /AI 研究判断：&lt;训练&gt; &amp; 部署证据正在积累。/);
  assert.match(feed, /https:\/\/alpha\.example\/atlas\?x=1&amp;y=2/);
  assert.match(feed, /urn:physical-ai-watchlist:thesis:thesis-alpha:v2/);
  assert.match(feed, /urn:physical-ai-watchlist:change:2026-W34:v3:company-alpha:strengthened/);
  assert.doesNotMatch(feed, /<Robotics>|<训练>|candidate|score|rank|内部诊断/);
  for (const link of rssLinks(feed)) assert.match(link, /^https:\/\//);
  assert.equal(feed, buildCompanyFeed(view(), "company-alpha", BASE_URL));
});

test("route feeds use canonical membership and stable code-unit ordering", () => {
  const zeta: WatchlistPublicView["forwardRadar"][number] = {
    ...view().forwardRadar[0]!,
    companyId: "company-zeta",
    companyName: "Zeta Robotics",
    thesisId: "thesis-zeta",
    thesisVersion: 1,
  };
  const unordered = view({
    companyIds: ["company-zeta", "company-alpha", "company-beta"],
    forwardRadar: [zeta, view().forwardRadar[0]!],
  });
  const feed = buildRouteFeed(unordered, "VLA 与具身模型", BASE_URL);

  assert.match(feed, /数据与训练|VLA 与具身模型/);
  assert.match(feed, /urn:physical-ai-watchlist:thesis:thesis-alpha:v2/);
  assert.ok(feed.indexOf("thesis-alpha") < feed.indexOf("thesis-zeta"));
  assert.doesNotMatch(feed, /thesis-beta/);
  assert.equal(feed, buildRouteFeed(structuredClone(unordered), "VLA 与具身模型", BASE_URL));
});

test("feeds reject unsafe URL inputs and malformed public state", () => {
  assert.throws(() => buildCompanyFeed(view(), "company-alpha", "http://example.test"), /HTTPS/);
  assert.throws(() => buildCompanyFeed(view({ forwardRadar: [{ ...view().forwardRadar[0]!, evidenceLinks: [{ ...view().forwardRadar[0]!.evidenceLinks[0]!, url: "http://alpha.example" }] }] }), "company-alpha", BASE_URL), /证据链接/);
  assert.throws(() => buildCompanyFeed({ ...view(), forwardRadar: [{ ...view().forwardRadar[0]!, candidateId: "candidate-secret" }] } as unknown as WatchlistPublicView, "company-alpha", BASE_URL), /公开视图/);
  assert.throws(() => buildCompanyFeed(view({ forwardRadar: [{ ...view().forwardRadar[0]!, thesisId: "candidate-03950aa949fb" }] }), "company-alpha", BASE_URL), /候选标识/);
  assert.throws(() => buildCompanyFeed(view({ forwardRadar: [{ ...view().forwardRadar[0]!, whyNow: "AI 研究判断：score 99。" }] }), "company-alpha", BASE_URL), /私有诊断/);
  assert.throws(() => buildCompanyFeed(view({ forwardRadar: [{ ...view().forwardRadar[0]!, whyNow: `AI 研究判断：${String.fromCodePoint(0xFFFE)}` }] }), "company-alpha", BASE_URL), /XML/);
});

test("stages the authoritative company and five-route feed manifest through one transaction", async () => {
  const root = await mkdtemp(join(tmpdir(), "watchlist-feeds-"));
  try {
    const transaction = new FileTransaction("watchlist-feeds");
    stageWatchlistFeeds({ transaction, root, view: view(), baseUrl: BASE_URL });
    assert.equal(transaction.size, 9);
    await transaction.commit();

    const manifest = JSON.parse(await readFile(join(root, "site", "feeds", "manifest.json"), "utf8"));
    assert.deepEqual(manifest, {
      schemaVersion: 1,
      snapshotWeek: "2026-W34",
      snapshotVersion: 3,
      companyFeedIds: ["company-alpha", "company-beta", "company-exited"],
      companyFeeds: [
        { companyId: "company-alpha", path: "feeds/companies/company-alpha.xml" },
        { companyId: "company-beta", path: "feeds/companies/company-beta.xml" },
        { companyId: "company-exited", path: "feeds/companies/company-exited.xml" },
      ],
      routeFeeds: [
        { route: "数据与训练", slug: "data-and-training", path: "feeds/routes/data-and-training.xml" },
        { route: "VLA 与具身模型", slug: "vla-and-embodied-models", path: "feeds/routes/vla-and-embodied-models.xml" },
        { route: "世界模型与空间智能", slug: "world-models-and-spatial-intelligence", path: "feeds/routes/world-models-and-spatial-intelligence.xml" },
        { route: "本体与硬件", slug: "embodiment-and-hardware", path: "feeds/routes/embodiment-and-hardware.xml" },
        { route: "部署与商业化", slug: "deployment-and-commercialization", path: "feeds/routes/deployment-and-commercialization.xml" },
      ],
    });
    assert.match(await readFile(join(root, "site", "feeds", "companies", "company-exited.xml"), "utf8"), /已退出/);
    assert.match(await readFile(join(root, "site", "feeds", "routes", "world-models-and-spatial-intelligence.xml"), "utf8"), /暂无公开公司/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
