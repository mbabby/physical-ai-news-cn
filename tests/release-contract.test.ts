import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateCommunityEvidenceRelease, validateDecisionProductPublication, validatePublicationArtifacts } from "../src/runtime/validation.js";
import type {
  AcceptedEvidenceArtifact,
  CommunityTaskPublicArtifact,
  ContributionLedgerArtifact,
  EvidenceIssueSnapshot,
  EvidenceTaskLedgerArtifact,
  EvidenceTaskSeedArtifact,
} from "../src/community-evidence/contracts.js";
import { stableDecisionId, type DecisionProductArtifact } from "../src/decision-products/contracts.js";
import { buildDecisionFeedManifest, renderDecisionFeed } from "../src/decision-products/subscriptions.js";
import { formatDecisionProductReadme } from "../src/decision-products/markdown.js";
import type { DailyArchive, RunHistory, RunManifest } from "../src/types.js";
import type { WatchlistPublicView } from "../src/watchlist/public-view.js";
import type { BenchmarkResultLedger } from "../src/benchmark-result-ledger.js";
import type { LedgerField } from "../src/ledger-contracts.js";
import { generate } from "../src/main.js";
import { validateRelease } from "../src/validate-release.js";
import type { CompanyProfile, DigestResult, EventStore } from "../src/types.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const json = async <T>(path: string): Promise<T> => JSON.parse(await readFile(path, "utf8")) as T;
const GENERATED_AT = "2026-08-24T01:00:00Z";
const REPOSITORY_URL = "https://github.com/mbabby/physical-ai-news-cn";
const PAGES_URL = "https://mbabby.github.io/physical-ai-news-cn";
const FIXED_NOW = new Date("2026-08-23T08:00:00.000Z");
const FIXTURE_PATHS = [
  "README.md", "daily", "weekly", "sources", "review", "resources", "events", "experiments",
  "research", "routes", "metrics", "site/data", "site/feeds", "watchlist", "community",
];
const RELEASE_MUTATION_PATHS = [
  "events/index.json", "research/benchmark-result-ledger.json", "README.md",
  "review/decision-products-retention.json",
  "site/data/decision-products.json", "site/data/dashboard.json",
  "site/feeds/decision/manifest.json", "site/feeds/decision/all.xml",
  "site/feeds/decision/data-and-training.xml", "site/feeds/decision/vla-and-embodied-models.xml",
  "site/feeds/decision/world-models-and-spatial-intelligence.xml",
  "site/feeds/decision/embodiment-and-hardware.xml",
  "site/feeds/decision/deployment-and-commercialization.xml", "site/feeds/decision/watchlist.xml",
] as const;

function decisionArtifact(): DecisionProductArtifact {
  const signal = (eventId: string, titleZh: string): DecisionProductArtifact["topSignals"][number] => ({
    signalId: stableDecisionId("signal", eventId), eventId, entityId: "company-alpha", entityName: "Alpha Robotics",
    titleZh, factsZh: ["Alpha 发布了新型机器人。", "该产品已进入客户试点。"], kind: "产品发布", routes: ["本体与硬件"],
    occurredAt: "2026-08-23T01:00:00Z", verifiedAt: GENERATED_AT, changedThisWeek: true, evidenceState: "official",
    evidence: [{ evidenceId: `evidence-${eventId}`, url: `https://alpha.example/${eventId}`, source: "Alpha", grade: "A" }],
    impact: ["company", "product-deployment"], whyItMatters: "AI 研究判断：客户试点提高了产品验证强度。", rankReasons: ["本周发生实质变化"],
  });
  return {
    schemaVersion: 1, generatedAt: GENERATED_AT, periodStart: "2026-08-18",
    topSignals: [signal("event-alpha", "Alpha 发布新型机器人"), signal("event-beta", "Alpha 扩大机器人试点")],
    companyCards: [{
      cardId: stableDecisionId("company", "company-alpha"), companyId: "company-alpha", companyName: "Alpha Robotics", officialUrl: "https://alpha.example/",
      region: "美国", stage: "成长型", routes: ["本体与硬件"],
      capital: { status: "verified", summary: "已完成 A 轮融资。", evidence: [{ evidenceId: "evidence-capital", url: "https://alpha.example/funding", source: "Alpha", grade: "A" }] },
      validationStage: "客户试点",
      productDeployment: { status: "developing", summary: "客户试点正在推进。", evidence: [{ evidenceId: "evidence-product", url: "https://partner.example/pilot", source: "Partner", grade: "B" }] },
      recentChanges: [{ eventId: "event-alpha", title: "发布新型机器人", occurredAt: "2026-08-23T01:00:00Z", type: "产品发布" }],
      watchlist: { track: "forward-radar", lifecycle: "strengthening", whyNow: "AI 研究判断：近期新增客户试点。", nextValidationPoints: [{ text: "确认规模部署", dueAt: "2026-10-01" }] },
      unknownFields: [], updatedAt: GENERATED_AT,
    }],
    researchPassports: [{
      passportId: stableDecisionId("research", "paper-alpha"), paperId: "paper-alpha", titleZh: "一种机器人操作方法",
      factsZh: ["该方法面向机器人操作。", "论文报告了真实机器人试验。"], sourceUrl: "https://arxiv.org/abs/2608.00001",
      task: ["机器人操作"], embodiment: ["机械臂"], methods: ["视觉语言动作模型"],
      benchmark: { name: "LIBERO", metric: "成功率", result: "74.7%", baseline: "70.0%", delta: "+4.7pp", evidenceUrls: ["https://arxiv.org/abs/2608.00001"] },
      realRobotTrials: 20, assets: { code: "https://github.com/example/alpha", data: "unknown", weights: "unknown" },
      reproducibilityCost: { level: "medium", rationale: "需要一套机械臂。" }, authority: { openAlexWorkId: "W1", authors: ["Alice"], labs: ["Alpha Lab"], citedByCount: 3, checkedAt: GENERATED_AT },
      limitations: ["仅验证单一机械臂。"], gaps: ["缺少公开权重"], whyWorthAttention: "AI 研究判断：包含实机与精确基准证据。", rankReasons: ["包含真实机器人试验"],
    }],
    subscriptions: { generatedAt: GENERATED_AT, entries: [] },
  };
}

function decisionWatchlist(): WatchlistPublicView {
  return { week: "2026-W34", snapshotVersion: 1, methodologyVersion: "v1", lastSuccessfulAt: GENERATED_AT, companyIds: [], forwardRadar: [], validatedMomentum: [], changes: [] };
}

function verifiedField(value: string): LedgerField<string> {
  return { value, status: "verified", evidenceIds: ["paper-alpha:evidence"], evidenceUrls: ["https://arxiv.org/abs/2608.00001"], observedAt: GENERATED_AT, verifiedAt: GENERATED_AT };
}

function unknownField<T>(): LedgerField<T> {
  return { value: "unknown", status: "unknown", evidenceIds: [], evidenceUrls: [], observedAt: "unknown", verifiedAt: "unknown" };
}

function benchmarkLedger(): BenchmarkResultLedger {
  return {
    generatedAt: GENERATED_AT,
    entries: [{
      entryId: "benchmark-result-test", paperId: "paper-alpha", decisionCardPaperId: "paper-alpha", benchmarkKey: "LIBERO", arxivVersion: 1,
      sourceUrl: "https://arxiv.org/abs/2608.00001", gateCodes: [], corrections: [],
      fields: {
        benchmark: verifiedField("LIBERO"), metric: verifiedField("成功率"), result: verifiedField("74.7%"), baseline: verifiedField("70.0%"), delta: verifiedField("+4.7pp"),
        evaluationSetting: unknownField(), realRobotTrials: unknownField(), code: unknownField(), data: unknownField(), weights: unknownField(),
      },
    }],
  };
}

const emptyCollection = async (): Promise<DigestResult> => ({ articles: [], failures: [], sourceOutcomes: [] });

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function generatedReleaseFixture(): Promise<string> {
  const target = await mkdtemp(join(tmpdir(), "task7-release-contract-"));
  for (const path of FIXTURE_PATHS) await cp(join(root, path), join(target, path), { recursive: true });
  await rm(join(target, "site/data/decision-products.json"), { force: true });
  await rm(join(target, "watchlist", "current.json"), { force: true });
  await rm(join(target, "watchlist", "theses.json"), { force: true });
  await rm(join(target, "watchlist", "history"), { recursive: true, force: true });
  await rm(join(target, "review", "run-history.json"), { force: true });
  await mkdir(join(target, "watchlist", "history"), { recursive: true });

  const companies = await json<CompanyProfile[]>(join(target, "events", "companies.json"));
  const canonical = companies.filter((company) => company.entityType === "公司" && company.entityId && company.routes.length > 0).slice(0, 2);
  assert.equal(canonical.length, 2, "filesystem release fixture requires two canonical companies");
  companies.push({
    entityType: "公司", entityId: "aaa-release-retention", name: "Release Retention Robotics", region: "美国", stage: "成长公司",
    routes: ["本体与硬件"], thesis: "验证发布重建使用同一上一版输入。", officialUrl: "https://release-retention.example/", lastVerifiedAt: "2026-08-22T08:00:00.000Z",
  });
  await writeJson(join(target, "events", "companies.json"), companies);
  const store = await json<EventStore>(join(target, "events", "index.json"));
  store.updatedAt = FIXED_NOW.toISOString();
  store.events = canonical.map((company, index) => {
    const eventId = `task7-release-event-${index + 1}`;
    const occurredAt = `2026-08-${22 - index}T01:00:00.000Z`;
    return {
      id: eventId,
      title: `${company.name}发布新型机器人`,
      type: "产品发布" as const,
      entities: [company.name],
      primaryEntity: company.name,
      routes: [company.routes[0]!],
      status: "已确证" as const,
      firstSeenAt: occurredAt,
      lastUpdatedAt: FIXED_NOW.toISOString(),
      lastMaterialChangeAt: FIXED_NOW.toISOString(),
      lastVerifiedAt: FIXED_NOW.toISOString(),
      occurredAt,
      facts: [`${company.name}发布了新型机器人。`, `${company.name}公开了产品验证信息。`],
      openQuestions: [],
      timeline: [],
      evidence: [{
        link: new URL(`task7-release-${index + 1}`, company.officialUrl).href,
        source: `${company.name} 官方`,
        grade: "A" as const,
        publishedAt: occurredAt,
        supports: "产品发布",
      }],
    };
  });
  await writeJson(join(target, "events", "index.json"), store);

  const keys = ["LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL", "OPENALEX_API_KEY", "X_BEARER_TOKEN"] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  keys.forEach((key) => { delete process.env[key]; });
  try {
    await generate({ root: target, now: FIXED_NOW, collect: emptyCollection, collectX: emptyCollection });
    delete companies.at(-1)!.lastVerifiedAt;
    await writeJson(join(target, "events", "companies.json"), companies);
    await generate({ root: target, now: FIXED_NOW, collect: emptyCollection, collectX: emptyCollection });
  } finally {
    keys.forEach((key) => {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  }
  return target;
}

async function restoreReleaseFixture(rootPath: string, bytes: ReadonlyMap<string, string>): Promise<void> {
  for (const [path, content] of bytes) {
    await mkdir(dirname(join(rootPath, path)), { recursive: true });
    await writeFile(join(rootPath, path), content, "utf8");
  }
}

function decisionReleaseInput() {
  const artifact = decisionArtifact();
  const watchlist = decisionWatchlist();
  const manifest = buildDecisionFeedManifest(artifact);
  return {
    artifact, expectedArtifact: structuredClone(artifact),
    dashboard: {
      generatedAt: GENERATED_AT, decisionProducts: structuredClone(artifact),
      topSignals: artifact.topSignals.map(({ signalId }) => ({ signalId })),
      companyRadar: artifact.companyCards.map(({ cardId }) => ({ cardId })),
      research: artifact.researchPassports.map(({ passportId }) => ({ passportId })),
    },
    readme: formatDecisionProductReadme(artifact),
    feedManifest: manifest,
    feeds: Object.fromEntries(manifest.feeds.map((feed) => [feed.path, renderDecisionFeed(artifact, feed.route, { repositoryUrl: REPOSITORY_URL, pagesUrl: PAGES_URL, watchlist })])),
    expectedGeneratedAt: GENERATED_AT,
    companyEventOwners: new Map([["event-alpha", "company-alpha"], ["event-beta", "company-alpha"]]),
    benchmarkResultLedger: benchmarkLedger(),
    repositoryUrl: REPOSITORY_URL, pagesUrl: PAGES_URL, watchlist,
  };
}

test("decision release validation rejects adversarial drift on every public surface", () => {
  const mutations: Array<(input: ReturnType<typeof decisionReleaseInput>) => void> = [
    (input) => { input.dashboard.topSignals.reverse(); },
    (input) => { input.artifact.companyCards[0]!.capital.evidence = []; },
    (input) => { (input.artifact.researchPassports[0] as unknown as { candidateId: string }).candidateId = "candidate-hidden"; },
    (input) => { input.feeds["feeds/decision/all.xml"] = input.feeds["feeds/decision/all.xml"]!.replace("urn:physical-ai:signal:", "urn:forged:signal:"); },
    (input) => { input.readme = input.readme.replace(input.artifact.topSignals[0]!.signalId, input.artifact.topSignals[1]!.signalId); },
    (input) => { (input.artifact as unknown as { rawModelOutput: string }).rawModelOutput = "private"; },
    (input) => { input.companyEventOwners.set("event-alpha", "company-beta"); },
    (input) => { input.benchmarkResultLedger.entries[0]!.fields.result.evidenceUrls = []; },
    (input) => { input.dashboard.generatedAt = "2026-08-24T01:00:01Z"; },
  ];
  for (const mutate of mutations) {
    const input = decisionReleaseInput();
    mutate(input);
    assert.throws(() => validateDecisionProductPublication(input));
  }
});

test("filesystem release validation rebuilds canonical sources and rejects every staged-surface mutation", async () => {
  const fixture = await generatedReleaseFixture();
  try {
    const artifact = await json<DecisionProductArtifact>(join(fixture, "site/data/decision-products.json"));
    assert.equal(artifact.topSignals.length, 2);
    assert.equal(artifact.companyCards.length, 3);
    assert.ok(artifact.researchPassports.some((passport) => passport.benchmark.evidenceUrls.length > 0));
    await assert.doesNotReject(() => validateRelease(fixture));

    const retention = await json<{ previousArtifactSha256: string }>(join(fixture, "review/decision-products-retention.json"));
    const retentionHistoryPath = `review/decision-products-history/${retention.previousArtifactSha256}.json`;
    const original = new Map(await Promise.all([...RELEASE_MUTATION_PATHS, retentionHistoryPath].map(async (path) => [path, await readFile(join(fixture, path), "utf8")] as const)));
    const mutations: Array<{ name: string; mutate: (rootPath: string) => Promise<void> }> = [
      {
        name: "required Decision Product path",
        mutate: async (rootPath) => { await rm(join(rootPath, "site/data/decision-products.json")); },
      },
      {
        name: "raw Decision Product bytes",
        mutate: async (rootPath) => {
          const path = join(rootPath, "site/data/decision-products.json");
          await writeFile(path, `${await readFile(path, "utf8")}\n`, "utf8");
        },
      },
      {
        name: "raw retention receipt bytes",
        mutate: async (rootPath) => {
          const path = join(rootPath, "review/decision-products-retention.json");
          await writeFile(path, `${await readFile(path, "utf8")}\n`, "utf8");
        },
      },
      {
        name: "semantically valid forged retention digest",
        mutate: async (rootPath) => {
          const path = join(rootPath, "review/decision-products-retention.json");
          const receipt = await json<{ previousArtifactSha256: string }>(path);
          receipt.previousArtifactSha256 = "0".repeat(64);
          await writeJson(path, receipt);
        },
      },
      {
        name: "private prior publication history payload",
        mutate: async (rootPath) => {
          const path = join(rootPath, retentionHistoryPath);
          const previous = await json<DecisionProductArtifact & { rawModelOutput?: string }>(path);
          previous.rawModelOutput = "private";
          await writeJson(path, previous);
        },
      },
      {
        name: "canonical EventStore source",
        mutate: async (rootPath) => {
          const path = join(rootPath, "events/index.json");
          const store = await json<EventStore>(path);
          store.events[0]!.title = "规范来源已发生变化";
          await writeJson(path, store);
        },
      },
      {
        name: "dashboard identity order",
        mutate: async (rootPath) => {
          const path = join(rootPath, "site/data/dashboard.json");
          const dashboard = await json<{ topSignals: unknown[] }>(path);
          dashboard.topSignals.reverse();
          await writeJson(path, dashboard);
        },
      },
      {
        name: "dashboard generation date",
        mutate: async (rootPath) => {
          const path = join(rootPath, "site/data/dashboard.json");
          const dashboard = await json<{ generatedAt: string }>(path);
          dashboard.generatedAt = "2026-08-23T08:00:01.000Z";
          await writeJson(path, dashboard);
        },
      },
      {
        name: "README marker identity",
        mutate: async (rootPath) => {
          const path = join(rootPath, "README.md");
          const readme = await readFile(path, "utf8");
          await writeFile(path, readme.replace(artifact.topSignals[0]!.signalId, artifact.topSignals[1]!.signalId), "utf8");
        },
      },
      {
        name: "raw Feed manifest bytes",
        mutate: async (rootPath) => {
          const path = join(rootPath, "site/feeds/decision/manifest.json");
          await writeFile(path, `${await readFile(path, "utf8")}\n`, "utf8");
        },
      },
      {
        name: "required Feed path",
        mutate: async (rootPath) => { await rm(join(rootPath, "site/feeds/decision/all.xml")); },
      },
      {
        name: "Feed GUID",
        mutate: async (rootPath) => {
          const path = join(rootPath, "site/feeds/decision/all.xml");
          const feed = await readFile(path, "utf8");
          await writeFile(path, feed.replace("urn:physical-ai:signal:", "urn:forged:signal:"), "utf8");
        },
      },
      {
        name: "Feed item order",
        mutate: async (rootPath) => {
          const path = join(rootPath, "site/feeds/decision/all.xml");
          const feed = await readFile(path, "utf8");
          const items = [...feed.matchAll(/    <item>[\s\S]*?    <\/item>\n/g)].map((match) => match[0]);
          assert.equal(items.length, 2);
          await writeFile(path, feed.replace(`${items[0]}${items[1]}`, `${items[1]}${items[0]}`), "utf8");
        },
      },
      {
        name: "known Benchmark evidence",
        mutate: async (rootPath) => {
          const path = join(rootPath, "site/data/decision-products.json");
          const value = await json<DecisionProductArtifact>(path);
          const passport = value.researchPassports.find((item) => item.benchmark.evidenceUrls.length > 0)!;
          passport.benchmark.evidenceUrls = [];
          await writeJson(path, value);
        },
      },
      {
        name: "company event ownership source",
        mutate: async (rootPath) => {
          const path = join(rootPath, "events/index.json");
          const store = await json<EventStore>(path);
          store.events[0]!.primaryEntity = store.events[1]!.primaryEntity;
          store.events[0]!.entities = [...store.events[1]!.entities];
          await writeJson(path, store);
        },
      },
      {
        name: "private artifact boundary",
        mutate: async (rootPath) => {
          const path = join(rootPath, "site/data/decision-products.json");
          const value = await json<DecisionProductArtifact>(path) as DecisionProductArtifact & { rawModelOutput?: string };
          value.rawModelOutput = "private";
          await writeJson(path, value);
        },
      },
    ];

    for (const mutation of mutations) {
      await restoreReleaseFixture(fixture, original);
      await mutation.mutate(fixture);
      await assert.rejects(() => validateRelease(fixture), undefined, mutation.name);
    }
    await restoreReleaseFixture(fixture, original);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("checked-in publication artifacts satisfy the cross-file contract", async () => {
  const manifest = await json<RunManifest>(join(root, "review", "run-manifest.json"));
  const archive = await json<DailyArchive>(join(root, "daily", `${manifest.date}.json`));
  const history = await json<RunHistory>(join(root, "review", "run-history.json"));
  assert.doesNotThrow(() => validatePublicationArtifacts(archive, manifest, history));
});

test("daily workflow retains deadlines, serialization and release gates", async () => {
  const workflow = await readFile(join(root, ".github", "workflows", "daily-digest.yml"), "utf8");
  assert.match(workflow, /timeout-minutes:\s*22/);
  assert.match(workflow, /group:\s*daily-physical-ai-digest/);
  assert.match(workflow, /timeout --signal=TERM --kill-after=30s 15m/);
  assert.match(workflow, /pnpm run validate:release/);
  assert.match(workflow, /review\/pipeline-health\.json/);
  assert.match(workflow, /package-manager-cache:\s*false/);
  assert.match(workflow, /bash scripts\/stage-generated-publication\.sh/);
  assert.match(workflow, /### Watchlist/);
  assert.match(workflow, /select\(\.component == "Watchlist"\)/);
  assert.match(workflow, /watchlist\/current\.json/);
  assert.match(workflow, /\.forwardRadar \| length/);
  assert.match(workflow, /\.validatedMomentum \| length/);
  assert.doesNotMatch(workflow, /git add[^\n]*site\/data\/dashboard\.json/);
  assert.doesNotMatch(workflow, /watchlist-(?:seeds|drafts)\.json/);
});

test("generator status uses the generated manifest date across a Beijing midnight rollover", async () => {
  const workflow = await readFile(join(root, ".github", "workflows", "daily-digest.yml"), "utf8");
  const reportStep = workflow.split("- name: Report generator status")[1]?.split("- name: Commit updated digest")[0];
  assert.ok(reportStep, "report generator status step must exist");

  assert.match(reportStep, /digest_date="\$\(jq -er '\.date/);
  assert.match(reportStep, /digest_date="\$\(jq -er[^\n]*review\/run-manifest\.json\)"/);
  assert.doesNotMatch(reportStep, /digest_date="\$\(TZ=Asia\/Shanghai date \+%F\)"/);
});

test("watchlist preview remains review-only and is staged by the daily transaction", async () => {
  const [main, ...publicConsumers] = await Promise.all([
    readFile(join(root, "src", "main.ts"), "utf8"),
    readFile(join(root, "src", "site-data.ts"), "utf8"),
    readFile(join(root, "README.md"), "utf8"),
    readFile(join(root, "site", "app.js"), "utf8"),
    readFile(join(root, "site", "share-pages.js"), "utf8"),
    readFile(join(root, "site", "data", "dashboard.json"), "utf8"),
    readFile(join(root, "weekly", "shareable-summary.md"), "utf8"),
  ]);
  assert.match(main, /stageWatchlistPreview\(transaction, reviewDir/);
  assert.match(main, /statuses\.push\(watchlistPreview\.status\)/);
  for (const publicConsumer of publicConsumers) assert.doesNotMatch(publicConsumer, /watchlist-preview/);
});

test("release validation binds the watchlist JSON to Markdown and runtime receipts", async () => {
  const source = await readFile(join(root, "src", "validate-release.ts"), "utf8");
  assert.match(source, /readFile\(join\(root, "review", "watchlist-preview\.md"\)/);
  assert.match(source, /validateWatchlistPreviewRelease\(\{/);
  assert.match(source, /manifestServices:\s*manifest\.services/);
  assert.match(source, /archiveServices:\s*archive\.runtimeStatus/);
  assert.match(source, /join\(root, "watchlist", "current\.json"\)/);
  assert.match(source, /join\(root, "watchlist", "theses\.json"\)/);
  assert.match(source, /validateWatchlistRelease\(\{/);
  assert.match(source, /validateCurrentWatchlistHistoryFiles\(root, watchlistSnapshot\)/);
  assert.match(source, /dashboard/);
  assert.match(source, /readme/);
});

test("release validation strictly binds both evidence ledgers to canonical companies and research cards", async () => {
  const source = await readFile(join(root, "src", "validate-release.ts"), "utf8");
  assert.match(source, /join\(root, "events", "company-claim-ledger\.json"\)/);
  assert.match(source, /join\(root, "research", "benchmark-result-ledger\.json"\)/);
  assert.match(source, /join\(root, "review", "dual-ledger-metrics\.json"\)/);
  assert.match(source, /validateDualLedgerPublication\(\{/);
  assert.match(source, /buildDualLedgerMetrics\(/);
  assert.match(source, /dualLedgerMetrics/);
  const runtimeValidation = await readFile(join(root, "src", "runtime", "validation.ts"), "utf8");
  assert.match(runtimeValidation, /validateDualLedgerPublication/);
});

test("release validation reads the complete staged Watchlist public group from its canonical artifacts", async () => {
  const source = await readFile(join(root, "src", "validate-release.ts"), "utf8");

  for (const path of [
    ["site", "feeds", "manifest.json"],
    ["review", "watchlist-issue-seeds.json"],
    ["metrics", "community.json"],
    ["site", "data", "community.json"],
  ]) {
    assert.match(source, new RegExp(`join\\(root, ${path.map((part) => `"${part}"`).join(", ")}\\)`));
  }
  assert.match(source, /validateWatchlistFeedManifest\(/);
  assert.match(source, /validateWatchlistReviewIssueArtifact\(/);
  assert.match(source, /decodeWatchlistConfig\(/);
  assert.match(source, /communityMetricsBytes !== publicCommunityMetricsBytes/);
});

test("release validation reads and cross-validates the complete community evidence group", async () => {
  const source = await readFile(join(root, "src", "validate-release.ts"), "utf8");
  for (const path of [
    ["review", "evidence-task-seeds.json"],
    ["review", "evidence-issue-snapshot.json"],
    ["review", "evidence-task-ledger.json"],
    ["review", "accepted-evidence.json"],
    ["review", "accepted-evidence-revalidation.json"],
    ["community", "contributions.json"],
    ["site", "data", "community-tasks.json"],
  ]) assert.match(source, new RegExp(`join\\(root, ${path.map((part) => `"${part}"`).join(", ")}\\)`));
  assert.match(source, /validateCommunityEvidenceRelease\(\{/);
  assert.match(source, /canonicalDashboardFacts\(dashboard\)/);
  assert.match(source, /HEAD\^/);
});

test("checked-in bootstrap community evidence group is exact-valid at repository root", async () => {
  const [seeds, snapshot, ledger, accepted, contributions, publicTasks, communityMetrics, revalidation] = await Promise.all([
    json<EvidenceTaskSeedArtifact>(join(root, "review", "evidence-task-seeds.json")),
    json<EvidenceIssueSnapshot>(join(root, "review", "evidence-issue-snapshot.json")),
    json<EvidenceTaskLedgerArtifact>(join(root, "review", "evidence-task-ledger.json")),
    json<AcceptedEvidenceArtifact>(join(root, "review", "accepted-evidence.json")),
    json<ContributionLedgerArtifact>(join(root, "community", "contributions.json")),
    json<CommunityTaskPublicArtifact>(join(root, "site", "data", "community-tasks.json")),
    json<unknown>(join(root, "metrics", "community.json")),
    json<import("../src/community-evidence/revalidation.js").AcceptedEvidenceRevalidationArtifact>(join(root, "review", "accepted-evidence-revalidation.json")),
  ]);
  assert.doesNotThrow(() => validateCommunityEvidenceRelease({
    seeds, snapshot, ledger, accepted, contributions, publicTasks, communityMetrics, revalidation, canonicalPublicFacts: [],
  }));
  assert.doesNotMatch(JSON.stringify({ seeds, snapshot, ledger, accepted, contributions, publicTasks }),
    /candidateId|seedId|rawModelOutput|prompt|apiKey|token|secret|score|rank/i);
});

test("release validation rejects stale or forged Watchlist publication surfaces before a public release", async () => {
  const source = await readFile(join(root, "src", "validate-release.ts"), "utf8");

  assert.match(source, /buildCompanyFeed\(/);
  assert.match(source, /buildRouteFeed\(/);
  assert.match(source, /artifact\.week.*view\.week/);
  assert.match(source, /artifact\.snapshotVersion.*view\.snapshotVersion/);
  assert.match(source, /communityMetricsBytes !== publicCommunityMetricsBytes/);
});

test("daily generation promotes the current preview through one public transaction", async () => {
  const source = await readFile(join(root, "src", "main.ts"), "utf8");
  assert.match(source, /buildWatchlistSnapshot\(\{/);
  assert.match(source, /buildWatchlistPublicView\(\{/);
  assert.match(source, /mergeWatchlistThesisArtifact\(\{/);
  assert.match(source, /stageWatchlistRelease\(\{/);
  assert.doesNotMatch(source, /loadWatchlistPublicView\(root/);
});

test("Pages deployment follows a completed digest and checks out latest main", async () => {
  const workflow = await readFile(join(root, ".github", "workflows", "deploy-pages.yml"), "utf8");
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /workflows:\s*\["Daily physical AI digest"\]/);
  assert.match(workflow, /workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /ref:\s*main/);
});

test("independent watchdog checks freshness without write permissions", async () => {
  const workflow = await readFile(join(root, ".github", "workflows", "pipeline-health.yml"), "utf8");
  assert.match(workflow, /cron: "17 \*\/3 \* \* \*"/);
  assert.match(workflow, /contents:\s*read/);
  assert.doesNotMatch(workflow, /contents:\s*write/);
  assert.match(workflow, /pnpm run validate:health/);
  assert.match(workflow, /package-manager-cache:\s*false/);
});

test("weekly release publishes Top Signals through a release-first transaction", async () => {
  const workflow = await readFile(join(root, ".github", "workflows", "weekly-release.yml"), "utf8");
  const release = workflow.indexOf("gh release create");
  const publish = workflow.indexOf("pnpm top-signals:publish");
  const pull = workflow.indexOf("git pull --rebase origin main");
  const postRebasePrepare = workflow.indexOf("post-rebase", pull);
  const postRebaseValidate = workflow.indexOf("pnpm top-signals:validate", postRebasePrepare);
  const push = workflow.indexOf("git push origin HEAD:main");

  assert.ok(release >= 0 && publish > release && push > publish);
  assert.ok(pull > publish && postRebasePrepare > pull && postRebaseValidate > postRebasePrepare && push > postRebaseValidate);
  assert.match(workflow, /cron: "0 13 \* \* 4"/);
  assert.match(workflow, /contents:\s*write/);
  assert.match(workflow, /default:\s*"2026-W36"/);
  assert.match(workflow, /node-version:\s*24/);
  assert.match(workflow, /pnpm install --frozen-lockfile/);
  assert.match(workflow, /pnpm run check/);
  assert.match(workflow, /pnpm exec tsx --test tests\/top-signals-growth-workflow\.test\.ts/);
  assert.match(workflow, /pnpm top-signals:prepare -- --week "\$WEEK" --out "\$PREPARE_DIR"/);
  assert.match(workflow, /src\/top-signals-growth\/cli\.ts resolve/);
  assert.match(workflow, /if: steps\.week\.outputs\.run == 'true'/);
  assert.match(workflow, /content_sha=/);
  assert.match(workflow, /already_published=/);
  assert.match(workflow, /tag="top-signals-\$\{WEEK\}"/);
  assert.match(workflow, /gh release view "\$tag"/);
  assert.match(workflow, /gh release edit "\$tag" --title "\$title" --notes-file "\$notes" --latest/);
  assert.match(workflow, /gh release create "\$tag" --target main --title "\$title" --notes-file "\$notes" --latest/);
  assert.match(workflow, /gh release view "\$tag" --json url --jq '\.url'/);
  assert.match(workflow, /pnpm top-signals:publish -- --week "\$WEEK" --release-url "\$RELEASE_URL"/);
  assert.match(workflow, /pnpm top-signals:validate -- --week "\$WEEK"/);
  assert.match(workflow, /Post-rebase Top Signals content changed/);
  assert.match(workflow, /git add weekly\/top-signals review\/top-signals-publication-receipt\.json README\.md/);
  assert.match(workflow, /Release outcome/);
  assert.match(workflow, /README outcome/);
});

test("package scripts expose the three local Top Signals release commands", async () => {
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { scripts: Record<string, string> };
  assert.equal(packageJson.scripts["top-signals:prepare"], "tsx src/top-signals-growth/cli.ts prepare");
  assert.equal(packageJson.scripts["top-signals:publish"], "tsx src/top-signals-growth/cli.ts publish");
  assert.equal(packageJson.scripts["top-signals:validate"], "tsx src/top-signals-growth/cli.ts validate");
});
