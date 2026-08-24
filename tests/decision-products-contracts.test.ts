import assert from "node:assert/strict";
import test from "node:test";
import { stableDecisionId, validateDecisionProductArtifact } from "../src/decision-products/contracts.js";

function validDecisionProductArtifact(): any {
  return {
    schemaVersion: 1,
    generatedAt: "2026-08-24T01:00:00Z",
    periodStart: "2026-08-18",
    topSignals: [{
      signalId: "decision-signal-alpha",
      eventId: "event-alpha",
      entityId: "company-alpha",
      entityName: "Alpha Robotics",
      titleZh: "Alpha 发布新型机器人",
      factsZh: ["Alpha 发布了新型机器人。", "该产品已进入客户试点。"],
      kind: "产品发布",
      routes: ["本体与硬件"],
      occurredAt: "2026-08-23T01:00:00Z",
      verifiedAt: "2026-08-24T01:00:00Z",
      changedThisWeek: true,
      evidenceState: "official",
      evidence: [{ evidenceId: "evidence-alpha", url: "https://alpha.example/news", source: "Alpha", grade: "A" }],
      impact: ["company", "product-deployment"],
      whyItMatters: "AI 研究判断：客户试点提高了产品验证强度。",
      rankReasons: ["本周发生实质变化"],
    }],
    companyCards: [{
      cardId: "decision-company-alpha",
      companyId: "company-alpha",
      companyName: "Alpha Robotics",
      officialUrl: "https://alpha.example/",
      region: "美国",
      stage: "成长型",
      routes: ["本体与硬件"],
      capital: {
        status: "verified",
        summary: "已完成 A 轮融资。",
        evidence: [{ evidenceId: "evidence-capital", url: "https://alpha.example/funding", source: "Alpha", grade: "A" }],
      },
      validationStage: "客户试点",
      productDeployment: {
        status: "developing",
        summary: "客户试点正在推进。",
        evidence: [{ evidenceId: "evidence-product", url: "https://partner.example/pilot", source: "Partner", grade: "B" }],
      },
      recentChanges: [{ eventId: "event-alpha", title: "发布新型机器人", occurredAt: "2026-08-23T01:00:00Z", type: "产品发布" }],
      watchlist: {
        track: "forward-radar",
        lifecycle: "strengthening",
        whyNow: "AI 研究判断：近期新增客户试点。",
        nextValidationPoints: [{ text: "确认规模部署", dueAt: "2026-10-01" }],
      },
      unknownFields: [],
      updatedAt: "2026-08-24T01:00:00Z",
    }],
    researchPassports: [{
      passportId: "decision-research-paper-alpha",
      paperId: "paper-alpha",
      titleZh: "一种机器人操作方法",
      factsZh: ["该方法面向机器人操作。", "论文报告了真实机器人试验。"],
      sourceUrl: "https://arxiv.org/abs/2608.00001",
      task: ["机器人操作"],
      embodiment: ["机械臂"],
      methods: ["视觉语言动作模型"],
      benchmark: {
        name: "LIBERO",
        metric: "成功率",
        result: "74.7%",
        baseline: "70.0%",
        delta: "+4.7pp",
        evidenceUrls: ["https://arxiv.org/abs/2608.00001"],
      },
      realRobotTrials: 20,
      assets: { code: "https://github.com/example/alpha", data: "unknown", weights: "unknown" },
      reproducibilityCost: { level: "medium", rationale: "需要一套机械臂。" },
      authority: { authors: ["Alice"], labs: ["Alpha Lab"], citedByCount: 3, checkedAt: "2026-08-24T01:00:00Z" },
      limitations: ["仅验证单一机械臂。"],
      gaps: ["缺少公开权重"],
      whyWorthAttention: "AI 研究判断：包含实机与精确基准证据。",
      rankReasons: ["包含真实机器人试验"],
    }],
    subscriptions: {
      generatedAt: "2026-08-24T01:00:00Z",
      entries: [{
        subscriptionId: "decision-subscription-all",
        label: "Top Signals",
        description: "每周高置信信号",
        cadence: "weekly",
        format: "rss",
        url: "https://example.com/feeds/top-signals.xml",
        route: "all",
      }],
    },
  };
}

test("decision product artifact rejects undeclared and private payloads", () => {
  const valid = validDecisionProductArtifact();
  assert.doesNotThrow(() => validateDecisionProductArtifact(valid));
  for (const mutate of [
    (value: any) => { value.rawModelOutput = "secret"; },
    (value: any) => { value.topSignals[0].internalScore = 99; },
    (value: any) => { value.companyCards[0].companyId = "candidate-hidden"; },
    (value: any) => { value.researchPassports[0].benchmark.result = "74.7%"; value.researchPassports[0].benchmark.evidenceUrls = []; },
    (value: any) => { value.companyCards[0].watchlist.nextValidationPoints[0].privateNote = "secret"; },
    (value: any) => { value.researchPassports[0].authority.rankScore = 99; },
  ]) {
    const forged = structuredClone(valid);
    mutate(forged);
    assert.throws(() => validateDecisionProductArtifact(forged));
  }
});

test("stable decision identities ignore generation clocks", () => {
  assert.equal(stableDecisionId("signal", "evt-1"), stableDecisionId("signal", "evt-1"));
  assert.notEqual(stableDecisionId("signal", "evt-1"), stableDecisionId("company", "evt-1"));
  assert.equal(stableDecisionId("signal", "evt-1"), "decision-signal-4b6d7fb3f935a7c77819");
});

test("rejects undeclared keys at every nested object boundary", () => {
  for (const addExtraKey of [
    (value: any) => { value.topSignals[0].evidence[0].secret = true; },
    (value: any) => { value.companyCards[0].secret = true; },
    (value: any) => { value.companyCards[0].capital.secret = true; },
    (value: any) => { value.companyCards[0].recentChanges[0].secret = true; },
    (value: any) => { value.companyCards[0].watchlist.secret = true; },
    (value: any) => { value.researchPassports[0].secret = true; },
    (value: any) => { value.researchPassports[0].benchmark.secret = true; },
    (value: any) => { value.researchPassports[0].assets.secret = true; },
    (value: any) => { value.researchPassports[0].reproducibilityCost.secret = true; },
    (value: any) => { value.researchPassports[0].authority.secret = true; },
    (value: any) => { value.subscriptions.secret = true; },
    (value: any) => { value.subscriptions.entries[0].secret = true; },
  ]) {
    const forged = validDecisionProductArtifact();
    addExtraKey(forged);
    assert.throws(() => validateDecisionProductArtifact(forged));
  }
});

test("rejects relative URLs and noncanonical timestamps or dates", () => {
  for (const mutate of [
    (value: any) => { value.topSignals[0].evidence[0].url = "/news"; },
    (value: any) => { value.companyCards[0].officialUrl = "javascript:alert(1)"; },
    (value: any) => { value.researchPassports[0].assets.code = "github/example"; },
    (value: any) => { value.generatedAt = "2026-08-24 01:00:00Z"; },
    (value: any) => { value.topSignals[0].occurredAt = "2026-02-31T01:00:00Z"; },
    (value: any) => { value.companyCards[0].watchlist.nextValidationPoints[0].dueAt = "2026-02-31"; },
    (value: any) => { value.periodStart = "2026-8-18"; },
  ]) {
    const forged = validDecisionProductArtifact();
    mutate(forged);
    assert.throws(() => validateDecisionProductArtifact(forged));
  }
});

test("known public facts require evidence while unknown remains explicit", () => {
  for (const mutate of [
    (value: any) => { value.companyCards[0].capital.evidence = []; },
    (value: any) => { value.companyCards[0].productDeployment.evidence = []; },
    (value: any) => { value.researchPassports[0].benchmark.evidenceUrls = []; },
    (value: any) => { value.companyCards[0].capital.status = "unknown"; },
  ]) {
    const forged = validDecisionProductArtifact();
    mutate(forged);
    assert.throws(() => validateDecisionProductArtifact(forged));
  }

  const unknown = validDecisionProductArtifact();
  unknown.companyCards[0].capital = { status: "unknown", summary: "证据不足（不代表未融资）", evidence: [] };
  unknown.researchPassports[0].benchmark = {
    name: "unknown", metric: "unknown", result: "unknown", baseline: "unknown", delta: "unknown", evidenceUrls: [],
  };
  unknown.researchPassports[0].task = "unknown";
  unknown.researchPassports[0].embodiment = "unknown";
  unknown.researchPassports[0].methods = "unknown";
  unknown.researchPassports[0].realRobotTrials = "unknown";
  unknown.researchPassports[0].assets = { code: "unknown", data: "unknown", weights: "unknown" };
  unknown.researchPassports[0].reproducibilityCost = { level: "unknown", rationale: "unknown" };
  unknown.researchPassports[0].authority = { authors: [], labs: [], citedByCount: "unknown", checkedAt: "unknown" };
  unknown.researchPassports[0].limitations = "unknown";
  assert.doesNotThrow(() => validateDecisionProductArtifact(unknown));
});

test("evidence state and public evidence grades must agree", () => {
  const multiSource = validDecisionProductArtifact();
  multiSource.topSignals[0].evidenceState = "multi-source";
  multiSource.topSignals[0].evidence = [
    { evidenceId: "evidence-one", url: "https://one.example/news", source: "One", grade: "B" },
    { evidenceId: "evidence-two", url: "https://two.example/news", source: "Two", grade: "B" },
  ];
  assert.doesNotThrow(() => validateDecisionProductArtifact(multiSource));

  for (const mutate of [
    (value: any) => { value.topSignals[0].evidenceState = "multi-source"; },
    (value: any) => { value.topSignals[0].evidence[0].grade = "C"; },
    (value: any) => { value.topSignals[0].evidence[0].evidenceId = "evidence-alpha"; value.topSignals[0].evidence.push(structuredClone(value.topSignals[0].evidence[0])); },
  ]) {
    const forged = validDecisionProductArtifact();
    mutate(forged);
    assert.throws(() => validateDecisionProductArtifact(forged));
  }
});

test("multi-source evidence requires independent source origins", () => {
  const forged = validDecisionProductArtifact();
  forged.topSignals[0].evidenceState = "multi-source";
  forged.topSignals[0].evidence = [
    { evidenceId: "evidence-one", url: "https://wire.example/one", source: "Wire One", grade: "B" },
    { evidenceId: "evidence-two", url: "https://wire.example/two", source: "Wire Two", grade: "B" },
  ];
  assert.throws(() => validateDecisionProductArtifact(forged));
});

test("rejects private score diagnostics hidden in public text", () => {
  for (const mutate of [
    (value: any) => { value.topSignals[0].rankReasons = ["internalScore: 99"]; },
    (value: any) => { value.topSignals[0].whyItMatters = "rankScore=12"; },
    (value: any) => { value.topSignals[0].rankReasons = ["internal score: 99"]; },
    (value: any) => { value.topSignals[0].whyItMatters = "rank_score=12"; },
  ]) {
    const forged = validDecisionProductArtifact();
    mutate(forged);
    assert.throws(() => validateDecisionProductArtifact(forged));
  }
});

test("verified company facts require high-confidence public evidence", () => {
  const forged = validDecisionProductArtifact();
  forged.companyCards[0].capital.evidence = [
    { evidenceId: "evidence-b", url: "https://press.example/report", source: "Press", grade: "B" },
  ];
  assert.throws(() => validateDecisionProductArtifact(forged));
});

test("rejects whitespace-padded identities before duplicate checks", () => {
  const forged = validDecisionProductArtifact();
  forged.topSignals.push({
    ...structuredClone(forged.topSignals[0]),
    signalId: " decision-signal-alpha-copy ",
    eventId: " event-alpha ",
  });
  assert.throws(() => validateDecisionProductArtifact(forged));

  const paddedEntity = validDecisionProductArtifact();
  paddedEntity.topSignals[0].entityId = " company-alpha ";
  assert.throws(() => validateDecisionProductArtifact(paddedEntity));

  assert.throws(() => stableDecisionId(" signal", "evt-1"));
  assert.throws(() => stableDecisionId("signal", " evt-1"));
});

test("rejects duplicate public identities in every collection", () => {
  for (const duplicate of [
    (value: any) => { value.topSignals.push(structuredClone(value.topSignals[0])); },
    (value: any) => { value.companyCards.push(structuredClone(value.companyCards[0])); },
    (value: any) => { value.researchPassports.push(structuredClone(value.researchPassports[0])); },
    (value: any) => { value.subscriptions.entries.push(structuredClone(value.subscriptions.entries[0])); },
  ]) {
    const forged = validDecisionProductArtifact();
    duplicate(forged);
    assert.throws(() => validateDecisionProductArtifact(forged));
  }
});
