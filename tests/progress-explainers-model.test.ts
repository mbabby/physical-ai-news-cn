import assert from "node:assert/strict";
import test from "node:test";
import { buildProgressExplainers } from "../src/progress-explainers/materialize.js";
import { buildExplainerSources } from "../src/progress-explainers/canonical.js";
import type { CompanyProfile, EventRecord } from "../src/types.js";
import { HttpRequestError } from "../src/runtime/http.js";
import { CompatibleSummarizer } from "../src/summarize.js";
import { materializeResearchDecisionCard } from "../src/research-decision-card.js";
import type { ResearchRecord } from "../src/types.js";
import { DRAFT_SYSTEM, REVIEW_SYSTEM } from "../src/progress-explainers/draft.js";
import { approvedReview, draft, model, source } from "./helpers/progress-explainers.js";
import type { ExplainerSource } from "../src/progress-explainers/contracts.js";

test("orders and caps candidates before bounded draft and review calls", async () => {
  const sources = [4, 1, 3, 2].map((day) => source({ canonicalId: `event:${day}`, revision: `r${day}`, eventDate: `2026-09-0${day}`, materiallyChangedAt: `2026-09-0${day}T00:00:00Z` }));
  const outputs = Array.from({ length: 3 }, () => [draft(), approvedReview]).flat();
  const result = await buildProgressExplainers({ sources, now: new Date("2026-09-10T00:00:00Z"), model: model(outputs) });
  assert.deepEqual(result.artifact.cards.map((card) => card.canonicalId), ["event:4", "event:3", "event:2"]); assert.equal(result.report.requestsSucceeded, 6);
});

test("rejects comparison without a compatible canonical baseline", async () => {
  const result = await buildProgressExplainers({ sources: [source()], now: new Date("2026-09-10T00:00:00Z"), model: model([draft({ comparison: { beforeZh: "之前为 40%", afterZh: "之后为 60%", task: "抓取任务", conditions: "相同条件" }, fieldRefs: { ...draft().fieldRefs, "comparison.beforeZh": ["fact:trial"], "comparison.afterZh": ["fact:result"], "comparison.task": ["fact:trial"], "comparison.conditions": ["fact:trial"] } }), approvedReview]) });
  assert.deepEqual(result.artifact.cards, []); assert.equal(result.report.evidenceRejected, 1);
});

const company: CompanyProfile = { entityId: "dexlab", name: "DexLab", aliases: ["Dex Lab"], entityType: "实验室", region: "测试", routes: ["本体与硬件"], thesis: "测试", officialUrl: "https://lab.example" };
function event(overrides: Partial<EventRecord> = {}): EventRecord {
  return { id: "gripper", kind: "demonstration", title: "DexLab 抓取试验", type: "产品发布", entities: ["DexLab"], primaryEntity: "dexlab", routes: ["本体与硬件"], status: "已确证", occurredAt: "2026-09-08T00:00:00Z", firstSeenAt: "2026-09-08T00:00:00Z", lastEvidenceAt: "2026-09-08T08:00:00Z", lastMaterialChangeAt: "2026-09-08T08:00:00Z", lastUpdatedAt: "2026-09-08T08:00:00Z", lastVerifiedAt: "2026-09-08T09:00:00Z", facts: ["DexLab 完成机械手试验。", "机械手完成 9 次抓取。"], openQuestions: [], timeline: [{ date: "2026-09-08T08:00:00Z", summary: "机械手完成 9 次抓取。", evidenceLinks: ["https://lab.example/trial"] }], evidence: [{ link: "https://lab.example/trial", source: "DexLab", grade: "A", publishedAt: "2026-09-08T08:00:00Z", supports: "DexLab 完成机械手试验。" }], ...overrides };
}
const adapt = (events: EventRecord[], companies = [company]) => buildExplainerSources({ events, companies, researchRecords: [], researchDecisionCards: [], benchmarkResultLedger: { generatedAt: "2026-09-10T00:00:00Z", entries: [] } });

test("canonical adapter resolves exact aliases and preserves per-fact evidence relationships", () => {
  const sources = adapt([event({ primaryEntity: "Dex Lab" })]); assert.equal(sources.length, 1);
  assert.deepEqual(sources[0]!.facts.map(f => f.evidenceIds.length), [1, 1]); assert.deepEqual(sources[0]!.contexts, ["演示"]);
});

test("canonical adapter excludes discovery, withdrawn, conflicted and unsupported facts", () => {
  assert.deepEqual(adapt([event({ evidence: [{ ...event().evidence[0]!, source: "Google News", link: "https://news.google.com/item" }] })]), []);
  assert.deepEqual(adapt([event({ evidenceState: "conflicted" } as Partial<EventRecord>)]), []);
  assert.deepEqual(adapt([event({ evidence: [{ ...event().evidence[0]!, withdrawn: true } as EventRecord["evidence"][number]] })]), []);
  const source = adapt([event({ facts: ["没有证据关系的事实。"] })])[0]; assert.equal(source, undefined);
});

test("canonical adapter rejects ambiguous identities and malformed benchmark ledgers", () => {
  assert.deepEqual(adapt([event()], [company, { ...company, entityId: "other" }]), []);
  assert.throws(() => buildExplainerSources({ events: [], companies: [], researchRecords: [], researchDecisionCards: [], benchmarkResultLedger: { generatedAt: "bad", entries: [] } }));
});

test("canonical event dates remain explicitly unknown instead of using check clocks", () => {
  const [adapted] = adapt([event({ occurredAt: undefined, eventDate: undefined, lastEvidenceAt: undefined, lastMaterialChangeAt: undefined, lastUpdatedAt: undefined as never })]);
  assert.equal(adapted!.eventDate, "unknown"); assert.equal(adapted!.publishedAt, "unknown"); assert.equal(adapted!.materiallyChangedAt, "unknown");
});

test("classifies the typed transport timeout without depending on English text", async () => {
  const timeoutModel = { async completeJson() { throw new HttpRequestError("请求超时", "timeout", undefined, true); } };
  const result = await buildProgressExplainers({ sources: [source()], now: new Date("2026-09-10T00:00:00Z"), model: timeoutModel });
  assert.equal(result.report.timedOut, 1); assert.equal(result.report.failed, 0); assert.equal(result.artifact.status, "unavailable");
});

function research(overrides: Partial<ResearchRecord> = {}): ResearchRecord {
  const publishedAt = new Date("2026-09-08T00:00:00Z");
  return { id: "paper-gripper", article: { id: "paper-gripper", title: "Gripper trials on real robots", titleZh: "真实机器人机械手试验", summaryZh: "研究团队报告了机械手抓取试验。试验在真实机器人上完成。", link: "https://arxiv.org/abs/2609.00001v1", publishedAt, fetchedAt: publishedAt, source: "arXiv · cs.RO", sourceWeight: 10, excerpt: "We report real robot gripper trials.", kind: "研究与数据", tags: [], authors: ["Li Wei"], scholar: { provider: "OpenAlex", workId: "W123", citedByCount: 1, isRetracted: false, institutions: ["DexLab"], authors: [{ name: "Li Wei", institutions: ["DexLab"] }], checkedAt: "2026-09-09T00:00:00Z" } }, firstSeenAt: "2026-09-08T00:00:00Z", lastCheckedAt: "2026-09-09T00:00:00Z", arxivVersion: 1, factHash: "v1", status: "新论文", appearances: 1, evidenceTags: ["真实机器人"], authorityLabels: ["DexLab"], changes: [{ date: "2026-09-08T00:00:00Z", kind: "新收录", detail: "first" }], ...overrides };
}

test("adapts a real eligible research card with article-bound facts and excludes retraction", () => {
  const record = research(); const card = materializeResearchDecisionCard(record, { now: new Date("2026-09-10T00:00:00Z") });
  const input = { events: [], companies: [], researchRecords: [record], researchDecisionCards: [card], benchmarkResultLedger: { generatedAt: "2026-09-10T00:00:00Z", entries: [] } };
  const adapted = buildExplainerSources(input); assert.equal(adapted.length, 1); assert.deepEqual(adapted[0]!.facts.map(f => f.evidenceIds), [[adapted[0]!.evidence[0]!.evidenceId], [adapted[0]!.evidence[0]!.evidenceId]]);
  const withdrawn = research({ status: "已撤稿" }); assert.deepEqual(buildExplainerSources({ ...input, researchRecords: [withdrawn], researchDecisionCards: [materializeResearchDecisionCard(withdrawn, { now: new Date("2026-09-10T00:00:00Z") })] }), []);
});

test("research observation receipts never become material dates or change dependency revision and order", async () => {
  const now = new Date("2026-09-10T00:00:00Z");
  const adaptResearch = (record: ResearchRecord) => buildExplainerSources({ events: [], companies: [], researchRecords: [record], researchDecisionCards: [materializeResearchDecisionCard(record, { now })], benchmarkResultLedger: { generatedAt: now.toISOString(), entries: [] } })[0]!;
  const baseline = adaptResearch(research({ changes: [] }));
  assert.equal(baseline.materiallyChangedAt, "unknown");
  const peer = source({ canonicalId: "event:newer-publication", materiallyChangedAt: "unknown", eventDate: "2026-09-09", publishedAt: "2026-09-09T00:00:00Z" });
  for (const kind of ["新收录", "元数据更新", "版本更新"] as const) {
    const observed = adaptResearch(research({ firstSeenAt: now.toISOString(), lastCheckedAt: now.toISOString(), factHash: "metadata-only", changes: [{ date: now.toISOString(), kind, detail: "本轮观测记录，不是来源发布日期。" }] }));
    assert.equal(observed.materiallyChangedAt, "unknown");
    assert.equal(observed.revision, baseline.revision);
    const selected: string[] = [];
    await buildProgressExplainers({ sources: [observed, peer], now, model: { async completeJson(_system, input) { selected.push((input as { source: ExplainerSource }).source.canonicalId); return {}; } } });
    assert.deepEqual(selected, ["event:newer-publication", "research:paper-gripper"]);
  }
});

test("real version, fact and evidence changes invalidate research dependencies without publishing observation dates", () => {
  const now = new Date("2026-09-10T00:00:00Z");
  const adaptResearch = (record: ResearchRecord) => buildExplainerSources({ events: [], companies: [], researchRecords: [record], researchDecisionCards: [materializeResearchDecisionCard(record, { now })], benchmarkResultLedger: { generatedAt: now.toISOString(), entries: [] } })[0]!;
  const before = adaptResearch(research());
  for (const update of [
    { arxivVersion: 2 },
    { article: { ...research().article, link: "https://arxiv.org/abs/2609.00001v2" } },
    { article: { ...research().article, summaryZh: "研究团队报告了机械手抓取新任务的试验。试验在真实机器人上完成。" } },
  ]) {
    const after = adaptResearch(research({ ...update, changes: [{ date: now.toISOString(), kind: "版本更新", detail: "发现新版" }] }));
    assert.notEqual(after.revision, before.revision);
    assert.equal(after.materiallyChangedAt, "unknown");
  }
});

test("real CompatibleSummarizer preserves timeout classification through its bounded retry", async () => {
  const prior = globalThis.fetch;
  globalThis.fetch = async () => { throw new DOMException("测试超时", "TimeoutError"); };
  try {
    const summarizer = new CompatibleSummarizer({ apiKey: "test", baseUrl: "https://provider.invalid", model: "test" });
    const result = await buildProgressExplainers({ sources: [source()], now: new Date("2026-09-10T00:00:00Z"), model: summarizer });
    assert.equal(result.report.timedOut, 1);
    assert.equal(result.report.failed, 0);
    assert.equal(result.report.requestsSucceeded, 0);
    assert.equal(result.artifact.status, "unavailable");
  } finally { globalThis.fetch = prior; }
});

test("runs a real research source through grounding and semantic review", async () => {
  const record = research(); const card = materializeResearchDecisionCard(record, { now: new Date("2026-09-10T00:00:00Z") });
  const [canonical] = buildExplainerSources({ events: [], companies: [], researchRecords: [record], researchDecisionCards: [card], benchmarkResultLedger: { generatedAt: "2026-09-10T00:00:00Z", entries: [] } });
  const researchDraft = draft({ titleZh: "真实机器人机械手试验", factsZh: card.factsZh.value as [string, string], changeZh: "这次报告补充了真实机器人试验。", meaningZh: "这为判断机械手在真实机器人上的表现提供了可核对证据。", limitationsZh: ["报告没有覆盖其他机器人任务。"], contexts: ["作者报告"], fieldRefs: { titleZh: ["paper-gripper:fact:1"], "factsZh.0": ["paper-gripper:fact:1"], "factsZh.1": ["paper-gripper:fact:2"], changeZh: ["paper-gripper:fact:1"], meaningZh: ["paper-gripper:fact:2"], "limitationsZh.0": ["paper-gripper:fact:1"], "contexts.0": ["paper-gripper:fact:1"] } });
  const result = await buildProgressExplainers({ sources: [canonical!], now: new Date("2026-09-10T00:00:00Z"), model: model([researchDraft, approvedReview]) });
  assert.equal(result.artifact.cards[0]!.kind, "research"); assert.equal(result.report.requestsSucceeded, 2);
});

test("deduplicates real research versions and rejects duplicate decision cards", () => {
  const v1 = research(); const v2 = research({ arxivVersion: 2, factHash: "v2", article: { ...research().article, link: "https://arxiv.org/abs/2609.00001v2" } });
  const card = materializeResearchDecisionCard(v2, { now: new Date("2026-09-10T00:00:00Z") }); const common = { events: [], companies: [], researchRecords: [v1, v2], researchDecisionCards: [card], benchmarkResultLedger: { generatedAt: "2026-09-10T00:00:00Z", entries: [] } };
  assert.equal(buildExplainerSources(common)[0]!.evidence[0]!.url, v2.article.link);
  assert.throws(() => buildExplainerSources({ ...common, researchDecisionCards: [card, card] }), /duplicate research decision card/i);
});

test("structured transport carries complete draft and review schemas to the provider boundary", async () => {
  const calls: string[] = []; const prior = globalThis.fetch;
  const responses = [draft(), approvedReview];
  globalThis.fetch = async (_input, init) => { calls.push(String(init?.body)); return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(responses.shift()) } }] }), { status: 200 }); };
  let result;
  try { const summarizer = new CompatibleSummarizer({ apiKey: "test", baseUrl: "https://provider.example", model: "test" }); result = await buildProgressExplainers({ sources: [source()], now: new Date("2026-09-10T00:00:00Z"), model: summarizer }); }
  finally { globalThis.fetch = prior; }
  assert.equal(result.artifact.cards.length, 1); assert.equal(calls.length, 2); assert.match(calls[0]!, /response_format/); assert.match(calls[0]!, /titleZh/); assert.match(calls[1]!, /approved/);
  for (const field of ["titleZh", "factsZh", "changeZh", "meaningZh", "limitationsZh", "contexts", "fieldRefs"]) assert.match(DRAFT_SYSTEM, new RegExp(field));
  assert.match(DRAFT_SYSTEM, /恰好两句/); assert.match(DRAFT_SYSTEM, /不可信/); assert.match(DRAFT_SYSTEM, /不要.*对比|不得.*对比/);
  assert.match(REVIEW_SYSTEM, /approved/); assert.match(REVIEW_SYSTEM, /fields/); assert.match(REVIEW_SYSTEM, /factsZh\.0/);
});

test("collision-resistant identities distinguish slash from hyphen", async () => {
  const outputs = [draft(), approvedReview, draft(), approvedReview];
  const result = await buildProgressExplainers({ sources: [source({ canonicalId: "event:a/b", revision: "slash" }), source({ canonicalId: "event:a-b", revision: "hyphen" })], now: new Date("2026-09-10T00:00:00Z"), model: model(outputs) });
  assert.equal(result.artifact.cards.length, 2); assert.notEqual(result.artifact.cards[0]!.id, result.artifact.cards[1]!.id);
});
