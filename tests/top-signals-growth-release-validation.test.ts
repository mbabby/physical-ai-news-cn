import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { replacePublishedTopSignalsReadme } from "../src/decision-products/markdown.js";
import { stableDecisionId, type DecisionProductArtifact } from "../src/decision-products/contracts.js";
import { type GrowthExperimentConfig, type TopSignalsDraft } from "../src/top-signals-growth/contracts.js";
import { evaluateTopSignalsGate } from "../src/top-signals-growth/gate.js";
import {
  validatePublishedTopSignals,
  validateTopSignalsPublication,
} from "../src/top-signals-growth/publish.js";
import { renderTopSignalsArchive, renderTopSignalsRelease } from "../src/top-signals-growth/render.js";

const CONFIG: GrowthExperimentConfig = {
  schemaVersion: 1,
  experimentId: "github-top-signals-2026-08",
  startDate: "2026-08-31",
  endDate: "2026-09-13",
  manualWeek: "2026-W36",
  automaticWeek: "2026-W37",
  baselineStars: 1,
  targetStars: 11,
  targetExternalAuthors: 3,
  minSignals: 3,
  maxSignals: 5,
  maxSignalsPerEntity: 2,
  maxSignalsPerKind: 3,
  channels: ["github-release", "readme", "github-value-contribution"],
};

const RELEASE_URL = "https://github.com/mbabby/physical-ai-news-cn/releases/tag/top-signals-2026-W37";
const README_TEMPLATE = "before\n<!-- DECISION_SIGNALS_START -->\n\nold\n\n<!-- DECISION_SIGNALS_END -->\nafter\n";

function draftFixture(): TopSignalsDraft {
  return {
    schemaVersion: 1,
    experimentId: CONFIG.experimentId,
    week: CONFIG.automaticWeek,
    generatedAt: "2026-09-10T10:00:00.000Z",
    periodStart: "2026-09-07",
    periodEnd: "2026-09-13",
    signals: Array.from({ length: 3 }, (_, index) => {
      const eventId = `release-event-${index + 1}`;
      const url = `https://alpha.example/releases/${index + 1}`;
      return {
        signalId: stableDecisionId("signal", eventId),
        eventId,
        entityId: `company-${index + 1}`,
        entityName: `Alpha Robotics ${index + 1}`,
        titleZh: `Alpha Robotics ${index + 1} 完成产品部署`,
        factsZh: [`Alpha Robotics ${index + 1} 完成产品部署。`, `该部署已由官方证据确认 ${index + 1}。`],
        kind: "部署案例" as const,
        routes: ["部署与商业化" as const],
        occurredAt: `2026-09-0${7 + index}T02:00:00.000Z`,
        verifiedAt: "2026-09-10T09:00:00.000Z",
        changedThisWeek: true,
        evidenceState: "official" as const,
        evidence: [{ evidenceId: stableDecisionId("evidence", `${eventId}\n${url}`), url, source: "Alpha Robotics", grade: "A" as const }],
        impact: ["company" as const, "product-deployment" as const],
        whyItMatters: "AI 研究判断：该部署为商业化进展提供了可复核信号。",
        rankReasons: ["本周发生实质变化", "官方一手证据"],
        nextValidationPoint: "继续核验部署数量、付费客户与运行周期。",
        scoreBreakdown: { industryCapitalImpact: 28, evidenceQuality: 25, recency: 16, informationGain: 15, strategicRelevance: 10, total: 94 },
      };
    }),
  };
}

function decisionProducts(draft: TopSignalsDraft): DecisionProductArtifact {
  return {
    schemaVersion: 1,
    generatedAt: draft.generatedAt,
    periodStart: draft.periodStart,
    topSignals: draft.signals.map(({ nextValidationPoint: _next, scoreBreakdown: _score, ...signal }) => signal),
    companyCards: [],
    researchPassports: [],
    subscriptions: { generatedAt: draft.generatedAt, entries: [] },
  };
}

function releaseFixture() {
  const draft = draftFixture();
  const gate = evaluateTopSignalsGate({ draft, config: CONFIG });
  const published = renderTopSignalsArchive(draft, RELEASE_URL, "2026-09-10T13:05:00.000Z");
  return {
    draft,
    gate,
    published,
    latest: structuredClone(published),
    markdown: `${renderTopSignalsRelease(draft)}\n`,
    readme: replacePublishedTopSignalsReadme(README_TEMPLATE, published),
    decisionProducts: decisionProducts(draft),
  };
}

test("strict rebuild validation rejects drift across every Top Signals public surface", () => {
  assert.doesNotThrow(() => validatePublishedTopSignals(releaseFixture()));

  const mutations: Array<{ name: string; mutate: (input: ReturnType<typeof releaseFixture>) => void }> = [
    { name: "title", mutate: (input) => { input.published.signals[0]!.titleZh = "伪造标题"; } },
    { name: "order", mutate: (input) => { input.published.signals.reverse(); } },
    { name: "event date", mutate: (input) => { input.published.signals[0]!.occurredAt = "2026-09-01T02:00:00.000Z"; } },
    { name: "evidence URL", mutate: (input) => { input.published.signals[0]!.evidence[0]!.url = "https://forged.example/evidence"; } },
    { name: "hash", mutate: (input) => { input.latest.contentSha256 = "0".repeat(64); } },
    { name: "Release URL", mutate: (input) => { input.published.releaseUrl = `${RELEASE_URL}-forged`; } },
    { name: "README link", mutate: (input) => { input.readme = input.readme.replace(RELEASE_URL, `${RELEASE_URL}-forged`); } },
    { name: "Markdown", mutate: (input) => { input.markdown = input.markdown.replace("事件日期", "错误日期"); } },
    { name: "gate", mutate: (input) => { input.gate.status = "blocked"; input.gate.reasons = ["forged"]; } },
    { name: "gate mode", mutate: (input) => { input.gate.mode = "manual"; } },
    { name: "gate extra key", mutate: (input) => { (input.gate as unknown as Record<string, unknown>).reviewScore = 99; } },
  ];

  for (const mutation of mutations) {
    const forged = releaseFixture();
    mutation.mutate(forged);
    assert.throws(() => validatePublishedTopSignals(forged), undefined, mutation.name);
  }
});

test("a fully rebuilt draft still fails when its evidence is absent from the current Decision Product", () => {
  const input = releaseFixture();
  const forgedDraft = structuredClone(input.draft);
  forgedDraft.signals[0]!.evidence[0]!.url = "https://forged.example/rebuilt-evidence";
  forgedDraft.signals[0]!.evidence[0]!.evidenceId = stableDecisionId(
    "evidence",
    `${forgedDraft.signals[0]!.eventId}\n${forgedDraft.signals[0]!.evidence[0]!.url}`,
  );
  input.draft = forgedDraft;
  input.gate = evaluateTopSignalsGate({ draft: forgedDraft, config: CONFIG });
  input.published = renderTopSignalsArchive(forgedDraft, RELEASE_URL, input.published.publishedAt);
  input.latest = structuredClone(input.published);
  input.markdown = `${renderTopSignalsRelease(forgedDraft)}\n`;
  input.readme = replacePublishedTopSignalsReadme(README_TEMPLATE, input.published);

  assert.throws(() => validatePublishedTopSignals(input), /Decision Product|evidence|证据/i);
});

test("public Top Signals JSON omits Review clocks, ranking reasons, and private score breakdowns", () => {
  const input = releaseFixture();
  const serialized = JSON.stringify(input.published);
  assert.doesNotMatch(serialized, /generatedAt|rankReasons|scoreBreakdown|changedThisWeek/);

  for (const key of ["generatedAt", "rankReasons", "scoreBreakdown", "rawModelOutput"]) {
    const forged = releaseFixture();
    (forged.published.signals[0] as unknown as Record<string, unknown>)[key] = key === "scoreBreakdown" ? { total: 99 } : "private";
    assert.throws(() => validatePublishedTopSignals(forged), undefined, key);
  }
});

test("top-signals validation accepts a strict Review draft when no Latest publication exists", async () => {
  const draft = draftFixture();
  const root = await mkdtemp(join(tmpdir(), "top-signals-review-only-"));
  try {
    await Promise.all([
      mkdir(join(root, "experiments"), { recursive: true }),
      mkdir(join(root, "review", "top-signals-drafts"), { recursive: true }),
      mkdir(join(root, "site", "data"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(root, "experiments", "top-signals-growth.json"), `${JSON.stringify(CONFIG, null, 2)}\n`),
      writeFile(join(root, "review", "top-signals-drafts", `${draft.week}.json`), `${JSON.stringify(draft, null, 2)}\n`),
      writeFile(join(root, "site", "data", "decision-products.json"), `${JSON.stringify(decisionProducts(draft), null, 2)}\n`),
      writeFile(join(root, "README.md"), README_TEMPLATE),
    ]);

    await assert.doesNotReject(() => validateTopSignalsPublication(root, draft.week));

    const path = join(root, "review", "top-signals-drafts", `${draft.week}.json`);
    const forged = JSON.parse(await readFile(path, "utf8")) as TopSignalsDraft;
    forged.signals[0]!.titleZh = "Review 草稿伪造标题";
    await writeFile(path, `${JSON.stringify(forged, null, 2)}\n`);
    await assert.rejects(() => validateTopSignalsPublication(root, draft.week), /Decision Product|canonical|规范/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
