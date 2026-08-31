import assert from "node:assert/strict";
import test from "node:test";
import { stableDecisionId } from "../src/decision-products/contracts.js";
import type { TopSignalsDraft } from "../src/top-signals-growth/contracts.js";
import {
  renderTopSignalsArchive,
  renderTopSignalsReadme,
  renderTopSignalsRelease,
} from "../src/top-signals-growth/render.js";

const RELEASE_URL = "https://github.com/mbabby/physical-ai-news-cn/releases/tag/top-signals-2026-W36";

function draftFixture(): TopSignalsDraft {
  return {
    schemaVersion: 1,
    experimentId: "github-top-signals-2026-08",
    week: "2026-W36",
    generatedAt: "2026-09-03T10:00:00.000Z",
    periodStart: "2026-08-31",
    periodEnd: "2026-09-06",
    signals: Array.from({ length: 4 }, (_, index) => {
      const eventId = `event-${index + 1}`;
      const firstUrl = `https://alpha.example/news/${index + 1}`;
      const secondUrl = `https://media.example/news/${index + 1}`;
      return {
        signalId: stableDecisionId("signal", eventId),
        eventId,
        entityId: `company-${index + 1}`,
        entityName: `Alpha *Robotics* ${index + 1}`,
        titleZh: `Alpha [机器人] 发布进展 ${index + 1}`,
        factsZh: [`Alpha Robotics 发布进展 ${index + 1}。`, `该进展已获得公开证据支持 ${index + 1}。`],
        kind: "投融资" as const,
        routes: ["本体与硬件" as const],
        occurredAt: "2026-09-02T02:00:00.000Z",
        verifiedAt: "2026-09-03T01:00:00.000Z",
        changedThisWeek: true,
        evidenceState: "official" as const,
        evidence: [
          { evidenceId: stableDecisionId("evidence", `${eventId}\n${firstUrl}`), url: firstUrl, source: "Alpha Robotics", grade: "A" as const },
          { evidenceId: stableDecisionId("evidence", `${eventId}\n${secondUrl}`), url: secondUrl, source: "Independent Media", grade: "B" as const },
        ],
        impact: ["company" as const, "capital" as const],
        whyItMatters: "AI 研究判断：该事件为相关公司与技术路线带来新的资本信号。",
        rankReasons: ["本周发生实质变化", "官方一手证据", "资本事件"],
        nextValidationPoint: "核验资金到账与研发计划进展。",
        scoreBreakdown: { industryCapitalImpact: 5, evidenceQuality: 5, recency: 5, informationGain: 4, strategicRelevance: 4, total: 23 },
      };
    }),
  };
}

function extractSignalIds(markdown: string): string[] {
  return [...markdown.matchAll(/<!-- top-signal:([^ ]+) -->/g)].map((match) => match[1]!);
}

test("Release and README preserve canonical order", () => {
  const draft = draftFixture();

  assert.deepEqual(extractSignalIds(renderTopSignalsRelease(draft)), draft.signals.map((item) => item.signalId));
  assert.deepEqual(extractSignalIds(renderTopSignalsReadme(draft, RELEASE_URL)), draft.signals.slice(0, 3).map((item) => item.signalId));
});

test("renderers escape text and include required facts and evidence links", () => {
  const draft = draftFixture();
  const release = renderTopSignalsRelease(draft);
  const readme = renderTopSignalsReadme(draft, RELEASE_URL);

  assert.ok(release.includes("Alpha \\[机器人\\] 发布进展 1"));
  assert.ok(release.includes("Alpha \\*Robotics\\* 1"));
  for (const signal of draft.signals) {
    assert.match(release, new RegExp(`事件日期：${signal.occurredAt}`));
    assert.match(release, new RegExp(`核验日期：${signal.verifiedAt}`));
    assert.match(release, new RegExp(`为什么重要：${signal.whyItMatters}`));
    assert.match(release, new RegExp(`下一验证点：${signal.nextValidationPoint}`));
    for (const evidence of signal.evidence) assert.match(release, new RegExp(evidence.url.replace(/[.?]/g, "\\$&")));
  }
  assert.match(readme, new RegExp(RELEASE_URL.replace(/[.?]/g, "\\$&")));
});

test("archive preserves the draft data with its published release identity", () => {
  const draft = draftFixture();
  const archive = renderTopSignalsArchive(draft, RELEASE_URL, "2026-09-04T10:00:00.000Z");

  assert.equal(archive.releaseUrl, RELEASE_URL);
  assert.equal(archive.publishedAt, "2026-09-04T10:00:00.000Z");
  assert.deepEqual(archive.signals, draft.signals);
});
