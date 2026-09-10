import assert from "node:assert/strict";
import test from "node:test";
import { buildProgressExplainers } from "../src/progress-explainers/materialize.js";
import { buildExplainerSources } from "../src/progress-explainers/canonical.js";
import type { CompanyProfile, EventRecord } from "../src/types.js";
import { HttpRequestError } from "../src/runtime/http.js";
import { approvedReview, draft, model, source } from "./helpers/progress-explainers.js";

test("orders and caps candidates before bounded draft and review calls", async () => {
  const sources = [4, 1, 3, 2].map((day) => source({ canonicalId: `event:${day}`, revision: `r${day}`, eventDate: `2026-09-0${day}`, materiallyChangedAt: `2026-09-0${day}T00:00:00Z` }));
  const outputs = Array.from({ length: 3 }, () => [draft(), approvedReview]).flat();
  const result = await buildProgressExplainers({ sources, now: new Date("2026-09-10T00:00:00Z"), model: model(outputs) });
  assert.deepEqual(result.artifact.cards.map((card) => card.canonicalId), ["event:4", "event:3", "event:2"]); assert.equal(result.report.requestsSucceeded, 6);
});

test("rejects comparison without a compatible canonical baseline", async () => {
  const result = await buildProgressExplainers({ sources: [source()], now: new Date("2026-09-10T00:00:00Z"), model: model([draft({ comparison: { beforeZh: "40%", afterZh: "60%", task: "抓取", conditions: "相同" }, fieldRefs: { ...draft().fieldRefs, "comparison.beforeZh": ["fact:trial"], "comparison.afterZh": ["fact:result"], "comparison.task": ["fact:trial"], "comparison.conditions": ["fact:trial"] } }), approvedReview]) });
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

test("classifies the typed transport timeout without depending on English text", async () => {
  const timeoutModel = { async completeJson() { throw new HttpRequestError("请求超时", "timeout", undefined, true); } };
  const result = await buildProgressExplainers({ sources: [source()], now: new Date("2026-09-10T00:00:00Z"), model: timeoutModel });
  assert.equal(result.report.timedOut, 1); assert.equal(result.report.failed, 0); assert.equal(result.artifact.status, "unavailable");
});
