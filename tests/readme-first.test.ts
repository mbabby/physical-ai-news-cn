import assert from "node:assert/strict";
import test from "node:test";
import { previousArtifact } from "./helpers/progress-explainers.js";
import { renderProgressExplainersMarkdown, replaceProgressExplainersReadme } from "../src/progress-explainers/markdown.js";
import { formatWatchlistReadme } from "../src/watchlist/markdown.js";
import { buildCoreCoverageArtifact } from "../src/core-coverage/materialize.js";
import { formatCoreCoverageReadme } from "../src/core-coverage/render.js";
import { fixture, company } from "./core-coverage-fixtures.js";
import type { WatchlistPublicView } from "../src/watchlist/public-view.js";

test("explainer keeps reading inline and all supporting context in one disclosure", () => {
  const artifact = previousArtifact();
  Object.assign(artifact.cards[0]!, { backgroundZh: "机械手用于抓取。", historical: true, eventDate: "unknown", comparison: { beforeZh: "此前条件", afterZh: "本次条件", task: "抓取任务", conditions: "同一物体" } });
  const text = renderProgressExplainersMarkdown(artifact);
  assert.ok(text.includes("DexLab 报告了覆盖 12 个物体的机械手试验。 机械手完成了其中 9 个物体的试验。 这次披露补充了真实机器人试验结果。"));
  assert.match(text, /<summary>背景与证据<\/summary>/);
  assert.ok(text.indexOf(artifact.cards[0]!.meaningZh) < text.indexOf("<details>"));
  const details = text.slice(text.indexOf("<summary>背景与证据</summary>"));
  for (const value of ["机械手用于抓取。", "此前条件", "本次条件", "抓取任务", "同一物体", "真实机器人", "事件日期：未知", "2026-09-08T08:00:00Z", "https://lab.example/gripper"]) assert.ok(details.includes(value), value);
  assert.match(text, /（历史）/);
  assert.match(details, /卡片检查：2026-09-09T00:00:00.000Z/);
});

test("untrusted Markdown stays literal and evidence labels cannot introduce links", () => {
  const artifact = previousArtifact();
  artifact.cards[0]!.titleZh = "<script> **粗体** [伪链接](https://bad.example)";
  artifact.cards[0]!.evidence[0]!.source = "证据](https://bad.example) [";
  const text = renderProgressExplainersMarkdown(artifact);
  assert.ok(text.includes("&lt;script&gt; \\*\\*粗体\\*\\* \\[伪链接\\]"));
  assert.ok(text.includes("[证据\\](https://bad.example) \\[]"));
  assert.doesNotMatch(text, /<script>/);
});

test("states preserve content/check clocks and marker replacement remains idempotent", () => {
  const artifact = previousArtifact();
  const template = "before\n<!-- PROGRESS_EXPLAINERS:START -->old<!-- PROGRESS_EXPLAINERS:END -->\nafter";
  for (const [status, label] of [["updated", "有新解读"], ["no-new-content", "本轮无新内容"], ["constrained", "本轮受限"], ["unavailable", "暂不可用"]] as const) {
    artifact.status = status;
    artifact.checkedAt = "2026-09-10T00:00:00.000Z";
    const once = replaceProgressExplainersReadme(template, artifact);
    assert.ok(once.includes(label));
    assert.match(once, /内容更新：2026-09-09T00:00:00.000Z/);
    assert.match(once, /最近检查：2026-09-10T00:00:00.000Z/);
    assert.equal(replaceProgressExplainersReadme(once, artifact), once);
  }
  artifact.cards = []; artifact.lastContentUpdatedAt = null;
  assert.match(renderProgressExplainersMarkdown(artifact), /尚未生成/);
});

test("watchlist includes public reasoning, capital boundaries and evidence without a Pages dependency", () => {
  const text = formatWatchlistReadme({ week: "2026-W37", snapshotVersion: 1, methodologyVersion: "v1", lastSuccessfulAt: "2026-09-09T00:00:00.000Z", companyIds: ["alpha"], changes: [], validatedMomentum: [], forwardRadar: [{ companyId: "alpha", companyName: "Alpha", thesisId: "thesis-alpha", thesisVersion: 1, track: "forward-radar", group: "priority-focus", lifecycle: "new", lifecycleLabel: "新进入", routes: ["本体与硬件"], whyNow: "公开试验提供进展。", routeAndDependencies: "依赖抓取验证。", nextValidationPoints: [{ text: "复核物体覆盖。", dueAt: "2026-10-01T00:00:00.000Z" }], falsifiers: [{ text: "原始试验被撤回。" }], capital: { status: "evidence-insufficient", summary: "现有证据不足以得出结论" }, evidenceLinks: [{ eventId: "event-alpha", title: "Alpha 试验", source: "Alpha 官方", grade: "A", url: "https://alpha.example/trial" }] }] });
  for (const value of ["依赖抓取验证。", "复核物体覆盖。", "2026-10-01", "原始试验被撤回。", "现有证据不足以得出结论", "https://alpha.example/trial", "本体与硬件"]) assert.ok(text.includes(value), value);
  assert.doesNotMatch(text, /companies\.html|thesis-alpha|privatePrompt/);
});

test("complete company Brief renders verified fields and evidence inline, preserving gaps", () => {
  const input = fixture();
  input.companies = Array.from({ length: 30 }, (_, i) => i ? { ...company, entityId: `subject-${i}`, name: `Subject ${i}`, profileEvidence: [] } : company);
  input.coverage.members = input.companies.map((c, i) => ({ companyId: c.entityId!, coverageRegion: i < 12 ? "china" : i < 24 ? "north-america" : "other", tier: i < 22 ? "commercial" : i < 27 ? "platform" : "strategic", ownerRole: "maintainer", reasonZh: "研究覆盖" }));
  const artifact = buildCoreCoverageArtifact(input);
  const text = formatCoreCoverageReadme(artifact);
  for (const value of ["Robot One", "工厂测试", "https://alpha.example/deployment", "https://alpha.example/about", "2026-08-20", "2026-08-21"]) assert.ok(text.includes(value), value);
  for (const gap of artifact.briefs[0]!.gapsZh) assert.ok(text.includes(gap));
  assert.doesNotMatch(text, /全球领先|privatePrompt|查看 Brief/);
});

const destinationCases = [
  { url: "https://example.test/>)[伪造证据](https://evil.example)<!--", destination: "<https://example.test/%3E)[伪造证据](https://evil.example)%3C!-->" },
  { url: "https://example.test/\\>\r\n[伪造证据](https://evil.example)<", destination: "<https://example.test/%5C%3E%0D%0A[伪造证据](https://evil.example)%3C>" },
  { url: "https://example.test/paper_(v2)?a=1&b=%E4%B8%AD#results", destination: "<https://example.test/paper_(v2)?a=1&b=%E4%B8%AD#results>" },
];

for (const { url, destination } of destinationCases) {
  test(`explainer serializes evidence destination without mutating its URL: ${JSON.stringify(url)}`, () => {
    const artifact = previousArtifact();
    artifact.cards[0]!.evidence[0]!.url = url;
    const before = JSON.stringify(artifact);
    assert.ok(renderProgressExplainersMarkdown(artifact).includes(`[DexLab](${destination})`));
    assert.equal(JSON.stringify(artifact), before);
  });

  test(`Watchlist serializes evidence destination without mutating its URL: ${JSON.stringify(url)}`, () => {
    const view: WatchlistPublicView = { week: "2026-W37", snapshotVersion: 1, methodologyVersion: "v1", lastSuccessfulAt: "2026-09-09T00:00:00.000Z", companyIds: ["alpha"], changes: [], validatedMomentum: [], forwardRadar: [{ companyId: "alpha", companyName: "Alpha", thesisId: "thesis-alpha", thesisVersion: 1, track: "forward-radar", group: "priority-focus", lifecycle: "new", lifecycleLabel: "新进入", routes: [], whyNow: "AI 研究判断：公开试验。", routeAndDependencies: "AI 研究判断：等待验证。", nextValidationPoints: [], falsifiers: [], capital: { status: "evidence-insufficient", summary: "证据不足" }, evidenceLinks: [{ eventId: "event-alpha", title: "试验", source: "官方", grade: "A", url }] }] };
    const before = JSON.stringify(view);
    assert.ok(formatWatchlistReadme(view).includes(`[试验 · 官方](${destination})`));
    assert.equal(JSON.stringify(view), before);
  });

  test(`Core serializes identity and field destinations without mutating URLs: ${JSON.stringify(url)}`, () => {
    const input = fixture();
    input.companies = Array.from({ length: 30 }, (_, i) => i ? { ...company, entityId: `subject-${i}`, name: `Subject ${i}`, profileEvidence: [] } : company);
    input.coverage.members = input.companies.map((c, i) => ({ companyId: c.entityId!, coverageRegion: i < 12 ? "china" : i < 24 ? "north-america" : "other", tier: i < 22 ? "commercial" : i < 27 ? "platform" : "strategic", ownerRole: "maintainer", reasonZh: "研究覆盖" }));
    const artifact = structuredClone(buildCoreCoverageArtifact(input));
    artifact.briefs[0]!.identityEvidence[0]!.link = url;
    artifact.briefs[0]!.knownFacts[0]!.fields.product!.evidenceUrls = [url];
    const before = JSON.stringify(artifact);
    const text = formatCoreCoverageReadme(artifact);
    assert.ok(text.includes(`[Alpha](${destination})`));
    assert.ok(text.includes(`[直接证据](${destination})`));
    assert.equal(JSON.stringify(artifact), before);
  });
}
