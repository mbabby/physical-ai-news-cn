import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validatePublicationArtifacts } from "../src/runtime/validation.js";
import type { DailyArchive, RunHistory, RunManifest } from "../src/types.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const json = async <T>(path: string): Promise<T> => JSON.parse(await readFile(path, "utf8")) as T;

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
