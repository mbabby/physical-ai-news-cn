import assert from "node:assert/strict";
import test from "node:test";
import { validateTopSignalSource } from "../src/decision-products/contracts.js";
import { buildDecisionTopSignals } from "../src/decision-products/top-signals.js";
import type { EvidenceState, PublicFactEvidence } from "../src/facts-contract.js";
import type { ArticleKind, CompanyProfile, EventRecord } from "../src/types.js";

const NOW = new Date("2026-08-24T12:00:00Z");
const companies: CompanyProfile[] = [
  {
    name: "Alpha Robotics",
    aliases: ["Alpha"],
    entityId: "company-alpha",
    region: "中国",
    routes: ["本体与硬件", "部署与商业化"],
    thesis: "机器人本体与部署",
    officialUrl: "https://alpha.example/",
  },
];

type EventFixture = EventRecord & { evidenceState?: EvidenceState };

function canonicalEvent(overrides: Partial<EventFixture> = {}): EventFixture {
  return {
    id: "evt-official-funding",
    title: "Alpha Robotics 完成新一轮融资",
    type: "投融资",
    entities: ["Alpha Robotics"],
    primaryEntity: "Alpha Robotics",
    routes: ["本体与硬件"],
    status: "已确证",
    occurredAt: "2026-08-23T02:00:00Z",
    firstSeenAt: "2026-08-23T03:00:00Z",
    lastMaterialChangeAt: "2026-08-23T04:00:00Z",
    lastUpdatedAt: "2026-08-23T04:00:00Z",
    lastVerifiedAt: "2026-08-24T01:00:00Z",
    facts: ["Alpha Robotics 完成新一轮融资。", "本轮资金将用于机器人本体研发。"],
    openQuestions: [],
    evidence: [{
      link: "https://alpha.example/news/funding",
      source: "Alpha Robotics",
      grade: "A",
      publishedAt: "2026-08-23T02:00:00Z",
      supports: "融资公告",
    }],
    timeline: [],
    funding: { entityStatus: "已确认", investors: [] },
    ...overrides,
  };
}

function independentDeploymentEvent(): EventFixture {
  return canonicalEvent({
    id: "evt-bb-deployment",
    title: "Alpha Robotics 启动工厂试点",
    type: "部署案例",
    occurredAt: "2026-08-22T02:00:00Z",
    lastMaterialChangeAt: "2026-08-22T03:00:00Z",
    lastUpdatedAt: "2026-08-22T03:00:00Z",
    facts: ["Alpha Robotics 启动机器人工厂试点。", "该试点覆盖真实生产场景。"],
    evidence: [
      { link: "https://industry-one.example/alpha-pilot", source: "Industry One", grade: "B", publishedAt: "2026-08-22T02:00:00Z", supports: "工厂试点" },
      { link: "https://industry-two.example/alpha-pilot", source: "Industry Two", grade: "B", publishedAt: "2026-08-22T03:00:00Z", supports: "工厂试点" },
    ],
  });
}

test("Top Signals accepts A or independent B+B and rejects weaker events", () => {
  const result = buildDecisionTopSignals([
    canonicalEvent(),
    independentDeploymentEvent(),
    canonicalEvent({
      id: "evt-single-b",
      evidence: [{ link: "https://media.example/one", source: "Media", grade: "B", publishedAt: "2026-08-23T02:00:00Z", supports: "融资" }],
    }),
    canonicalEvent({ id: "evt-conflicted", evidenceState: "conflicted" }),
    canonicalEvent({
      id: "evt-discovery",
      evidence: [{ link: "https://news.google.com/articles/alpha", source: "Google News", grade: "A", publishedAt: "2026-08-23T02:00:00Z", supports: "线索" }],
    }),
  ], companies, NOW);

  assert.deepEqual(result.map((item) => item.eventId), ["evt-official-funding", "evt-bb-deployment"]);
  assert.deepEqual(result[0]!.rankReasons, ["本周发生实质变化", "官方一手证据", "资本事件"]);
  assert.equal(result[1]!.evidenceState, "multi-source");
  assert.doesNotThrow(() => result.forEach(validateTopSignalSource));
});

test("Top Signals rejects unresolved subjects, terminal evidence, and incomplete Chinese copy", () => {
  const result = buildDecisionTopSignals([
    canonicalEvent({ id: "evt-unknown-subject", primaryEntity: "Unknown Robotics" }),
    canonicalEvent({ id: "evt-missing-entity-id", primaryEntity: "Profile Without Id" }),
    canonicalEvent({ id: "evt-rejected", evidenceState: "rejected" }),
    canonicalEvent({ id: "evt-lifecycle-withdrawn", evidenceState: "withdrawn" }),
    canonicalEvent({ id: "evt-withdrawn", evidence: [{ ...canonicalEvent().evidence[0]!, withdrawn: true } as EventRecord["evidence"][number] & { withdrawn: boolean }] }),
    canonicalEvent({ id: "evt-one-fact", facts: ["只有一句完整事实。"] }),
    canonicalEvent({ id: "evt-english-facts", facts: ["Alpha raised funding.", "Funds support robotics."] }),
    canonicalEvent({ id: "evt-fragment", facts: ["Alpha Robotics 完成融资", "资金用于机器人研发。"] }),
  ], [...companies, {
    name: "Profile Without Id", region: "中国", routes: ["本体与硬件"], thesis: "测试", officialUrl: "https://no-id.example/",
  }], NOW);

  assert.deepEqual(result, []);
});

test("Top Signals derives exactly two canonical facts and excludes discovery evidence", () => {
  const result = buildDecisionTopSignals([canonicalEvent({
    facts: ["Alpha Robotics 完成新一轮融资。"],
    timeline: [{ date: "2026-08-23T05:00:00Z", summary: "本轮资金将用于机器人本体研发。", evidenceLinks: ["https://alpha.example/news/funding"] }],
    evidence: [
      canonicalEvent().evidence[0]!,
      { ...canonicalEvent().evidence[0]!, source: "Alpha Robotics Newsroom" },
      { link: "https://news.ycombinator.com/item?id=1", source: "Community Aggregator", grade: "B", publishedAt: "2026-08-23T03:00:00Z", supports: "发现线索" },
      { link: "https://x.com/alpha/status/1", source: "Alpha Social", grade: "A", publishedAt: "2026-08-23T04:00:00Z", supports: "发现线索", withdrawn: true } as EventRecord["evidence"][number] & { withdrawn: boolean },
    ],
  })], companies, NOW);

  assert.deepEqual(result[0]!.factsZh, ["Alpha Robotics 完成新一轮融资。", "本轮资金将用于机器人本体研发。"]);
  assert.deepEqual(result[0]!.evidence.map((item) => item.url), ["https://alpha.example/news/funding"]);
  assert.equal(result[0]!.entityId, "company-alpha");
});

test("Top Signals excludes withdrawn discovery evidence classified by canonical metadata", () => {
  const discoveryMetadata: Array<Pick<PublicFactEvidence, "discovery" | "sourceClass" | "publicationPolicy">> = [
    { discovery: true },
    { sourceClass: "discovery" },
    { publicationPolicy: "仅作线索发现" },
  ];
  const events = discoveryMetadata.map((metadata, index) => canonicalEvent({
    id: `evt-metadata-discovery-${index}`,
    evidence: [
      canonicalEvent().evidence[0]!,
      {
        link: `https://aggregator-${index}.example/alpha`,
        source: `Aggregator ${index}`,
        grade: "B",
        publishedAt: "2026-08-23T03:00:00Z",
        supports: "发现线索",
        withdrawn: true,
        ...metadata,
      } as EventRecord["evidence"][number] & PublicFactEvidence,
    ],
  }));

  assert.deepEqual(buildDecisionTopSignals(events, companies, NOW).map((item) => item.eventId), [
    "evt-metadata-discovery-0",
    "evt-metadata-discovery-1",
    "evt-metadata-discovery-2",
  ]);
});

test("Top Signals rejects placeholder Chinese copy", () => {
  const result = buildDecisionTopSignals([canonicalEvent({
    facts: ["中文简介暂未生成。", "Alpha Robotics 完成新一轮融资。"],
  })], companies, NOW);

  assert.deepEqual(result, []);
});

test("Top Signals keeps exactly one Chinese sentence in each factsZh element", () => {
  const result = buildDecisionTopSignals([canonicalEvent({
    facts: ["Alpha Robotics 完成新一轮融资。资金将用于机器人研发。", "公司将扩大研发团队。"],
  })], companies, NOW);
  assert.deepEqual(result, []);

  const forged = buildDecisionTopSignals([canonicalEvent()], companies, NOW)[0]!;
  forged.factsZh = ["Alpha Robotics 完成新一轮融资。资金将用于机器人研发。", "公司将扩大研发团队。"];
  assert.throws(() => validateTopSignalSource(forged));
});

test("Top Signals deduplicates events, caps each kind at three, and is deterministic", () => {
  const kinds: ArticleKind[] = ["投融资", "产品发布", "部署案例", "公司商业", "开源项目", "研究与数据"];
  const events = kinds.flatMap((kind, kindIndex) => Array.from({ length: 4 }, (_, index) => canonicalEvent({
    id: `evt-${kindIndex}-${index}`,
    type: kind,
    occurredAt: `2026-08-${String(23 - index).padStart(2, "0")}T02:00:00Z`,
    lastMaterialChangeAt: `2026-08-${String(23 - index).padStart(2, "0")}T04:00:00Z`,
    lastUpdatedAt: `2026-08-${String(23 - index).padStart(2, "0")}T04:00:00Z`,
    evidence: [{
      ...canonicalEvent().evidence[0]!,
      link: `https://alpha.example/news/${kindIndex}-${index}`,
    }],
  })));
  events.push(structuredClone(events[0]!));

  const first = buildDecisionTopSignals(events, companies, NOW, 10);
  const second = buildDecisionTopSignals(structuredClone(events), structuredClone(companies), new Date(NOW), 10);
  const counts = new Map<ArticleKind, number>();
  for (const item of first) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);

  assert.equal(first.length, 10);
  assert.ok([...counts.values()].every((count) => count <= 3));
  assert.equal(new Set(first.map((item) => item.eventId)).size, first.length);
  assert.deepEqual(second, first);
  assert.deepEqual(first.slice(0, 3).map((item) => item.eventId), ["evt-0-0", "evt-0-1", "evt-0-2"]);
  assert.ok(first.every((item) => !Object.hasOwn(item, "internalScore") && !Object.hasOwn(item, "rankScore")));
  assert.equal(buildDecisionTopSignals(events, companies, NOW, Number.NaN).length, 10);
  assert.equal(buildDecisionTopSignals(events, companies, NOW, Number.POSITIVE_INFINITY).length, 10);
  assert.equal(buildDecisionTopSignals(events, companies, NOW, Number.NEGATIVE_INFINITY).length, 10);
  assert.equal(buildDecisionTopSignals(events, companies, NOW, -1).length, 0);
  assert.equal(buildDecisionTopSignals(events, companies, NOW, 2.9).length, 2);
});
