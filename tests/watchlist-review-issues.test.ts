import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildWatchlistReviewIssueSeeds,
  stageWatchlistReviewIssueSeeds,
  validateWatchlistReviewIssueArtifact,
} from "../src/project-insights.js";
import { FileTransaction } from "../src/runtime/storage.js";
import type { WatchlistPublicCard, WatchlistPublicView } from "../src/watchlist/public-view.js";

const root = process.cwd();

function card(overrides: Partial<WatchlistPublicCard> = {}): WatchlistPublicCard {
  return {
    companyId: "nova-robotics",
    companyName: "Nova Robotics",
    thesisId: "thesis-nova",
    thesisVersion: 2,
    track: "forward-radar",
    group: "priority-focus",
    lifecycle: "awaiting-validation",
    lifecycleLabel: "等待验证",
    routes: ["本体与硬件"],
    whyNow: "AI 研究判断：具身控制能力正在进入部署验证期。",
    routeAndDependencies: "AI 研究判断：依赖高质量操作数据与执行器可靠性。",
    nextValidationPoints: [{ text: "公开部署结果", dueAt: "2026-09-01" }],
    falsifiers: [{ text: "部署验证未达到预期" }],
    evidenceLinks: [{ eventId: "event-nova", title: "Nova 官方公告", url: "https://nova.example/announcement", source: "Nova", grade: "A" }],
    capital: { status: "verified", summary: "已由公开规范证据确认" },
    ...overrides,
  };
}

function view(cards: WatchlistPublicCard[]): WatchlistPublicView {
  const forwardRadar = cards.filter((item) => item.track === "forward-radar");
  const validatedMomentum = cards.filter((item) => item.track === "validated-momentum");
  return {
    week: "2026-W33",
    snapshotVersion: 4,
    methodologyVersion: "v1",
    lastSuccessfulAt: "2026-08-16T00:00:00.000Z",
    companyIds: cards.map((item) => item.companyId),
    forwardRadar,
    validatedMomentum,
    changes: [],
  };
}

test("builds deterministic public-only Watchlist evidence and correction seeds", () => {
  const evidence = card({
    capital: { status: "evidence-insufficient", summary: "证据不足（不代表未融资）" },
  });
  const correction = card({
    companyId: "atlas-robotics",
    companyName: "Atlas Robotics",
    thesisId: "thesis-atlas",
    lifecycle: "downgraded",
    lifecycleLabel: "判断降级",
    evidenceLinks: [{ eventId: "event-atlas", title: "Atlas 官方公告", url: "https://atlas.example/update", source: "Atlas", grade: "B" }],
  });
  const artifact = buildWatchlistReviewIssueSeeds(view([evidence, correction]));

  assert.deepEqual(artifact.seeds.map((seed) => seed.kind), ["correction", "evidence", "evidence"]);
  assert.equal(artifact.schemaVersion, 1);
  assert.equal(artifact.week, "2026-W33");
  assert.equal(artifact.snapshotVersion, 4);
  assert.ok(artifact.seeds.every((seed) => seed.snapshotWeek === artifact.week && seed.snapshotVersion === artifact.snapshotVersion));
  assert.ok(artifact.seeds.every((seed) => seed.evidenceUrls.every((url) => /^https:\/\//.test(url))));
  assert.ok(artifact.seeds.every((seed) => seed.issueBody.includes(`watchlist-review-seed:${seed.id}`)));
  assert.deepEqual(artifact.seeds[0]!.labels, ["evidence-review", "correction"]);
  assert.deepEqual(artifact.seeds[1]!.labels, ["evidence-review", "needs-evidence"]);
  assert.deepEqual(artifact.seeds[2]!.labels, ["evidence-review", "needs-evidence"]);
  assert.match(artifact.seeds[0]!.reviewTarget, /当前公开判断/);
  assert.match(artifact.seeds[2]!.reviewTarget, /资本/);
  assert.match(artifact.seeds[2]!.publicContext, /证据不足/);
  assert.doesNotMatch(JSON.stringify(artifact), /score|rank|候选(?:ID|标识)/i);
  assert.equal(JSON.stringify(buildWatchlistReviewIssueSeeds(view([evidence, correction]))), JSON.stringify(artifact));
});

test("rejects malformed or duplicate sanitized Watchlist Issue seeds", () => {
  const artifact = buildWatchlistReviewIssueSeeds(view([card()]));
  assert.equal(validateWatchlistReviewIssueArtifact(artifact), true);
  assert.equal(validateWatchlistReviewIssueArtifact({ ...artifact, seeds: [...artifact.seeds, artifact.seeds[0]] }), false);
  assert.equal(validateWatchlistReviewIssueArtifact({ ...artifact, seeds: [{ ...artifact.seeds[0]!, snapshotVersion: 99 }] }), false);
  assert.equal(validateWatchlistReviewIssueArtifact({ ...artifact, seeds: [{ ...artifact.seeds[0]!, issueBody: `visible watchlist-review-seed:${artifact.seeds[0]!.id}` }] }), false);
  assert.throws(() => buildWatchlistReviewIssueSeeds(view([card({ whyNow: "candidate-secret" })])), /候选标识/);
  assert.throws(() => buildWatchlistReviewIssueSeeds(view([card({ whyNow: "internalScore=97" })])), /私有诊断/);
});

test("stages the sanitized Issue artifact atomically with a Watchlist snapshot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "watchlist-issue-seeds-"));
  const snapshotPath = join(directory, "watchlist", "current.json");
  const seedsPath = join(directory, "review", "watchlist-issue-seeds.json");
  try {
    await mkdir(join(directory, "watchlist"), { recursive: true });
    await writeFile(snapshotPath, "old snapshot\n", "utf8");
    await mkdir(join(directory, "review"), { recursive: true });
    await writeFile(seedsPath, "old seeds\n", "utf8");
    const transaction = new FileTransaction("watchlist-issue-seeds-rollback", { failAfterSwaps: 1 });
    transaction.stage(snapshotPath, "new snapshot\n");
    stageWatchlistReviewIssueSeeds({ transaction, root: directory, view: view([card()]) });
    await assert.rejects(() => transaction.commit(), /已回滚/);
    assert.equal(await readFile(snapshotPath, "utf8"), "old snapshot\n");
    assert.equal(await readFile(seedsPath, "utf8"), "old seeds\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("public Watchlist templates and automation do not materialize private issue seeds", async () => {
  const [evidenceTemplate, correctionTemplate, workflow] = await Promise.all([
    readFile(join(root, ".github", "ISSUE_TEMPLATE", "watchlist-evidence.yml"), "utf8"),
    readFile(join(root, ".github", "ISSUE_TEMPLATE", "watchlist-correction.yml"), "utf8"),
    readFile(join(root, ".github", "workflows", "materialize-review-issues.yml"), "utf8"),
  ]);
  for (const template of [evidenceTemplate, correctionTemplate]) {
    assert.match(template, /原始.*URL/);
    assert.match(template, /受影响.*事实/);
    assert.match(template, /规范.*公司.*ID/);
    assert.match(template, /事件日期/);
    assert.match(template, /说明/);
    assert.match(template, /公开.*review.*不会自动发布/i);
  }
  assert.match(workflow, /review\/watchlist-issue-seeds\.json/);
  assert.doesNotMatch(workflow, /review\/issue-seeds\.json/);
  assert.match(workflow, /\[\[ "\$LIMIT" =~ \^\[0-9\]\+\$ \]\]/);
  assert.match(workflow, /jq -e/);
  assert.match(workflow, /\^watchlist-\(evidence\|correction\)-\[0-9a-f\]\{20\}\$/);
  assert.match(workflow, /\$sort_keys\[\. - 1\] <= \$sort_keys\[\.\]/);
  assert.match(workflow, /--label "evidence-review" --label "\$kind_label"/);
  assert.match(workflow, /correction\) kind_label="correction"/);
  assert.match(workflow, /requires canonical promotion in a later generation/i);
  assert.doesNotMatch(workflow, /git (add|commit|push)/);
});
