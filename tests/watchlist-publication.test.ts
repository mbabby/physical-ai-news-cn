import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildDashboard } from "../src/site-data.js";
import type { CompanyProfile, EventRecord } from "../src/types.js";
import type { CompanyThesis, CompanyThesisArtifact, WatchlistSnapshot } from "../src/watchlist/contracts.js";
import { formatWatchlistReadme } from "../src/watchlist/markdown.js";
import { loadWatchlistPublicView } from "../src/watchlist/publication.js";
import type { WatchlistPublicView } from "../src/watchlist/public-view.js";

const GENERATED_AT = "2026-08-17T01:00:00.000Z";

const companies: CompanyProfile[] = [
  { entityId: "company-zeta", entityType: "公司", name: "Zeta Robotics", region: "美国", routes: ["VLA 与具身模型"], thesis: "test", officialUrl: "https://zeta.example" },
  { entityId: "company-alpha", entityType: "公司", name: "Alpha Robotics", region: "美国", routes: ["部署与商业化"], thesis: "test", officialUrl: "https://alpha.example" },
];

function event(companyId: string, companyName: string): EventRecord {
  return {
    id: `event-${companyId}`,
    title: `${companyName} 发布规范进展`,
    type: "产品发布",
    entities: [companyName],
    primaryEntity: companyName,
    routes: ["部署与商业化"],
    status: "已确证",
    occurredAt: "2026-08-16T00:00:00.000Z",
    eventDate: "2026-08-16",
    firstSeenAt: "2026-08-16T00:00:00.000Z",
    lastUpdatedAt: "2026-08-16T00:00:00.000Z",
    lastMaterialChangeAt: "2026-08-16T00:00:00.000Z",
    lastVerifiedAt: "2026-08-16T00:30:00.000Z",
    facts: [`${companyName} 发布规范进展`],
    openQuestions: [],
    timeline: [],
    productDeployment: { product: "Atlas-X", customers: [], deployment: "公开发布" },
    evidence: [{
      link: `https://${companyId}.example/release`,
      source: companyName,
      grade: "A",
      publishedAt: "2026-08-16T00:00:00.000Z",
      supports: `${companyName} 发布规范进展`,
    }],
  };
}

const events = [event("company-zeta", "Zeta Robotics"), event("company-alpha", "Alpha Robotics")];

function thesis(companyId: string, track: CompanyThesis["track"], lifecycle: CompanyThesis["lifecycle"]): CompanyThesis {
  return {
    thesisId: `thesis-${companyId}`,
    companyId,
    track,
    lifecycle,
    thesisVersion: 1,
    whyNow: `AI 研究判断：${companyId} 出现新的规范事实。`,
    routeAndDependencies: "AI 研究判断：依赖后续真实部署验证。",
    nextValidationPoints: [{ text: "核验后续规范事实。", dueAt: "2026-10-01" }],
    falsifiers: [{ text: "规范事实被撤回。" }],
    factReferenceIds: [`event-${companyId}`],
    verifiedSensitiveBindings: [],
    inferenceLabels: ["AI 研究判断"],
    confidence: "medium",
    generatedAt: "2026-08-16T01:00:00.000Z",
    expiresAt: "2026-10-15T01:00:00.000Z",
    modelVersion: "model-v1",
    promptVersion: "prompt-v1",
    methodologyVersion: "method-v1",
  };
}

const snapshot: WatchlistSnapshot = {
  week: "2026-W34",
  snapshotVersion: 2,
  methodologyVersion: "method-v1",
  generatedAt: GENERATED_AT,
  forwardRadar: [{ companyId: "company-zeta", thesisId: "thesis-company-zeta", thesisVersion: 1, group: "continued-observation" }],
  validatedMomentum: [{ companyId: "company-alpha", thesisId: "thesis-company-alpha", thesisVersion: 1, group: "priority-focus" }],
  changesSinceLastWeek: [],
};

const thesisArtifact: CompanyThesisArtifact = {
  schemaVersion: 1,
  generatedAt: GENERATED_AT,
  theses: [thesis("company-zeta", "forward-radar", "awaiting-validation"), thesis("company-alpha", "validated-momentum", "strengthening")],
};

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "watchlist-publication-"));
  await mkdir(join(root, "watchlist"));
  await Promise.all([
    writeFile(join(root, "watchlist", "current.json"), JSON.stringify(snapshot)),
    writeFile(join(root, "watchlist", "theses.json"), JSON.stringify(thesisArtifact)),
  ]);
  return root;
}

async function fixtureView(): Promise<WatchlistPublicView> {
  const root = await fixtureRoot();
  try {
    const view = await loadWatchlistPublicView(root, companies, events);
    assert.ok(view);
    return view;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function companyIdsFromReadme(markdown: string): string[] {
  return [...markdown.matchAll(/companies\.html#([^\s)]+)/g)].map((match) => decodeURIComponent(match[1]!)).sort();
}

test("loaded public artifacts feed one README and dashboard snapshot identity and company set", async () => {
  const view = await fixtureView();
  const dashboard = buildDashboard({ updatedAt: view.lastSuccessfulAt, events: [] }, [], [], new Date(view.lastSuccessfulAt), { watchlist: view });
  const serialized = JSON.parse(JSON.stringify(dashboard)) as ReturnType<typeof buildDashboard>;
  const markdown = formatWatchlistReadme(view);
  const identity = /观察名单快照：(\d{4}-W\d{2}) · v(\d+)/.exec(markdown);

  assert.strictEqual(dashboard.watchlist, view);
  assert.ok(identity);
  assert.equal(identity[1], serialized.watchlist!.week);
  assert.equal(Number(identity[2]), serialized.watchlist!.snapshotVersion);
  assert.deepEqual(companyIdsFromReadme(markdown), [...serialized.watchlist!.companyIds].sort());
  assert.doesNotMatch(JSON.stringify(serialized.watchlist), /"(?:internalScore|selectionScore|momentumScore|score|rank)"/i);
  assert.doesNotMatch(markdown, /score|rank|分数|排名/i);
});

test("public artifact loading preserves legacy absence and fails closed on partial or invalid state", async () => {
  const root = await mkdtemp(join(tmpdir(), "watchlist-publication-boundary-"));
  const watchlistDir = join(root, "watchlist");
  await mkdir(watchlistDir);
  try {
    assert.equal(await loadWatchlistPublicView(root, companies, events), undefined);

    await writeFile(join(watchlistDir, "current.json"), JSON.stringify(snapshot));
    await assert.rejects(() => loadWatchlistPublicView(root, companies, events), /不完整/);
    await rm(join(watchlistDir, "current.json"));

    await writeFile(join(watchlistDir, "theses.json"), JSON.stringify(thesisArtifact));
    await assert.rejects(() => loadWatchlistPublicView(root, companies, events), /不完整/);

    await writeFile(join(watchlistDir, "current.json"), "{broken");
    await assert.rejects(() => loadWatchlistPublicView(root, companies, events), /已损坏/);

    await writeFile(join(watchlistDir, "current.json"), JSON.stringify(snapshot));
    await writeFile(join(watchlistDir, "theses.json"), JSON.stringify({ ...thesisArtifact, schemaVersion: 2 }));
    await assert.rejects(() => loadWatchlistPublicView(root, companies, events), /结构不合法/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("README watchlist is compact and omits full-card details", async () => {
  const markdown = formatWatchlistReadme(await fixtureView());

  assert.match(markdown, /前瞻雷达/);
  assert.match(markdown, /验证动量/);
  assert.match(markdown, /为什么现在值得看/);
  assert.match(markdown, /等待验证/);
  assert.match(markdown, /持续强化/);
  assert.doesNotMatch(markdown, /score|rank|分数|排名|下一验证点|反证条件|证据链接|依赖后续真实部署|规范事实被撤回|证据不足|https:\/\/company-/i);
});

test("README company fragments encode every Markdown-sensitive character", async () => {
  const view = await fixtureView();
  const companyId = "company-alpha)('!*";
  const markdown = formatWatchlistReadme({
    ...view,
    companyIds: [companyId],
    forwardRadar: [{ ...view.forwardRadar[0]!, companyId }],
    validatedMomentum: [],
  });

  assert.match(markdown, /#company-alpha%29%28%27%21%2A\)/);
});
