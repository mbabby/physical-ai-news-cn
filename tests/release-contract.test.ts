import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validatePublicationArtifacts } from "../src/runtime/validation.js";
import { validateDecisionProductPublication } from "../src/runtime/validation.js";
import { stableDecisionId, type DecisionProductArtifact } from "../src/decision-products/contracts.js";
import { buildDecisionFeedManifest, renderDecisionFeed } from "../src/decision-products/subscriptions.js";
import { formatDecisionProductReadme } from "../src/decision-products/markdown.js";
import type { DailyArchive, RunHistory, RunManifest } from "../src/types.js";
import type { WatchlistPublicView } from "../src/watchlist/public-view.js";
import type { BenchmarkResultLedger } from "../src/benchmark-result-ledger.js";
import type { LedgerField } from "../src/ledger-contracts.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const json = async <T>(path: string): Promise<T> => JSON.parse(await readFile(path, "utf8")) as T;
const GENERATED_AT = "2026-08-24T01:00:00Z";
const REPOSITORY_URL = "https://github.com/mbabby/physical-ai-news-cn";
const PAGES_URL = "https://mbabby.github.io/physical-ai-news-cn";

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
      reproducibilityCost: { level: "medium", rationale: "需要一套机械臂。" }, authority: { authors: ["Alice"], labs: ["Alpha Lab"], citedByCount: 3, checkedAt: GENERATED_AT },
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

test("weekly release publishes a stable evidence-backed brief", async () => {
  const workflow = await readFile(join(root, ".github", "workflows", "weekly-release.yml"), "utf8");
  assert.match(workflow, /cron: "0 13 \* \* 0"/);
  assert.match(workflow, /contents:\s*write/);
  assert.match(workflow, /description: "Optional ISO week to publish \(YYYY-Www\); must match watchlist\/current\.json"/);
  assert.match(workflow, /jq -er '\.week' watchlist\/current\.json/);
  assert.match(workflow, /jq -er '\.snapshotVersion' watchlist\/current\.json/);
  assert.match(workflow, /watchlist\/history\/\$\{week\}-v\$\{snapshot_version\}\.json/);
  assert.match(workflow, /cmp -s watchlist\/current\.json "\$snapshot"/);
  assert.match(workflow, /\^\[0-9\]\{4\}-W\(0\[1-9\]\|\[1-4\]\[0-9\]\|5\[0-3\]\)\$/);
  assert.match(workflow, /weekly\/\$\{week\}-report\.md/);
  assert.match(workflow, /brief-\$\{WEEK\}-v\$\{SNAPSHOT_VERSION\}/);
  assert.match(workflow, /Watchlist snapshot.*\$\{WEEK\}.*v\$\{SNAPSHOT_VERSION\}/);
  assert.match(workflow, /gh release view "\$tag"/);
  assert.match(workflow, /gh release edit "\$tag" --title "\$title" --notes-file "\$notes" --latest/);
  assert.match(workflow, /gh release create "\$tag" --target main --title "\$title" --notes-file "\$notes" --latest/);
  assert.doesNotMatch(workflow, /date \+%G-W%V/);
  assert.doesNotMatch(workflow, /find weekly/);
});
