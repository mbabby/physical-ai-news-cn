import assert from "node:assert/strict";
import test from "node:test";
import { WatchlistGenerator } from "../src/watchlist/generator.js";
import type { SelectedThesisSeed } from "../src/watchlist/scoring.js";

const NOW = new Date("2026-08-13T01:00:00.000Z");
const API_KEY = "secret-provider-key";
const FACTS = {
  "event-alpha": {
    excerpt: "Alpha Robotics 官方宣布 Atlas-X 使用 Gemini Robotics 完成工厂试点。",
    officialNames: ["Alpha Robotics", "Atlas-X", "Gemini Robotics"],
  },
  "event-extra": { excerpt: "这条未被种子引用的事实不得进入提示词。", officialNames: [] },
};

const seed: SelectedThesisSeed = {
  companyId: "company-alpha",
  companyName: "Alpha Robotics",
  track: "validated-momentum",
  routes: ["VLA 与具身模型", "部署与商业化"],
  factReferenceIds: ["event-alpha"],
  evidenceGrade: "A",
  verifiedSensitiveFields: ["customer"],
  unknownSensitiveFields: ["amount", "valuation", "revenue", "order"],
  evidenceSummary: ["Alpha Robotics completed a factory pilot with Atlas-X and Gemini Robotics"],
  score: 82,
  components: [],
  eligible: true,
  ineligibilityReasons: [],
  primaryRoute: "VLA 与具身模型",
  selectionGroup: "priority-focus",
};

function completion(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function validPayload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    whyNow: "AI 研究判断：Alpha Robotics 的 Atlas-X 工厂试点为 Gemini Robotics 提供了新的公开验证节点。",
    routeAndDependencies: "AI 研究判断：Atlas-X 路线依赖 Gemini Robotics、真实工厂数据及后续客户验证。",
    nextValidationPoints: [{ text: "核验 Alpha Robotics 是否公布 Atlas-X 后续试点结果", dueAt: "2026-09-30" }],
    falsifiers: [{ text: "Alpha Robotics 官方撤回 Atlas-X 工厂试点公告" }],
    factReferenceIds: ["event-alpha"],
    confidence: "high",
    ...overrides,
  });
}

function generator(fetchImpl: typeof fetch, facts = FACTS): WatchlistGenerator {
  return new WatchlistGenerator(
    { apiKey: API_KEY, baseUrl: "https://llm.example/v1/", model: "model-official" },
    facts,
    { now: () => new Date(NOW), fetchImpl, sleep: async () => undefined },
  );
}

test("parses exact JSON, preserves official names, and sends only seed facts", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const subject = generator(async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return completion(validPayload());
  });

  const result = await subject.generate(seed);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.draft.companyId, seed.companyId);
  assert.equal(result.draft.track, seed.track);
  assert.match(result.draft.whyNow, /^AI 研究判断：/);
  assert.match(result.draft.whyNow, /Alpha Robotics/);
  assert.match(result.draft.whyNow, /Atlas-X/);
  assert.match(result.draft.whyNow, /Gemini Robotics/);
  assert.deepEqual(result.draft.inferenceLabels, ["AI 研究判断"]);
  assert.equal(result.draft.modelVersion, "model-official");
  assert.equal(requestUrl, "https://llm.example/v1/chat/completions");
  assert.equal(requestInit?.method, "POST");
  assert.equal((requestInit?.headers as Record<string, string>).Authorization, `Bearer ${API_KEY}`);
  const requestBody = JSON.parse(String(requestInit?.body)) as { messages: Array<{ content: string }> };
  const prompt = requestBody.messages.map((message) => message.content).join("\n");
  assert.match(prompt, /只使用提供的规范事实/);
  assert.match(prompt, /Alpha Robotics/);
  assert.match(prompt, /Atlas-X/);
  assert.match(prompt, /Gemini Robotics/);
  assert.doesNotMatch(prompt, /未被种子引用/);
});

test("malformed JSON returns invalid-json without repairing markdown fences", async () => {
  const subject = generator(async () => completion(`\`\`\`json\n${validPayload()}\n\`\`\``));

  assert.deepEqual(await subject.generate(seed), { ok: false, code: "invalid-json" });
});

test("invalid prose and collection bounds return invalid-shape", async () => {
  const invalidPayloads = [
    validPayload({ whyNow: `AI 研究判断：${"甲".repeat(121)}` }),
    validPayload({ routeAndDependencies: `AI 研究判断：${"乙".repeat(161)}` }),
    validPayload({ nextValidationPoints: [] }),
    validPayload({ nextValidationPoints: [
      { text: "节点一", dueAt: "2026-09-01" }, { text: "节点二", dueAt: "2026-09-02" },
      { text: "节点三", dueAt: "2026-09-03" }, { text: "节点四", dueAt: "2026-09-04" },
    ] }),
    validPayload({ falsifiers: [] }),
    validPayload({ whyNow: "Alpha Robotics 已完成公开试点。" }),
    validPayload({ whyNow: "AI 研究判断：建议买入 Alpha Robotics，目标价会上涨。" }),
  ];

  for (const payload of invalidPayloads) {
    const subject = generator(async () => completion(payload));
    assert.deepEqual(await subject.generate(seed), { ok: false, code: "invalid-shape" });
  }
});

test("extra output fields and unsupported fact references return invalid-shape", async () => {
  const extraField = generator(async () => completion(validPayload({ recommendation: "关注" })));
  const unsupportedReference = generator(async () => completion(validPayload({ factReferenceIds: ["event-extra"] })));

  assert.deepEqual(await extraField.generate(seed), { ok: false, code: "invalid-shape" });
  assert.deepEqual(await unsupportedReference.generate(seed), { ok: false, code: "invalid-shape" });
});

test("preserves explicit single-token and non-Latin official product or model names", async () => {
  const facts = {
    "event-alpha": {
      excerpt: "Alpha Robotics 宣布 Tesla 与 宇树科技 参与 Atlas-X 工厂试点。",
      officialNames: ["Alpha Robotics", "Tesla", "宇树科技", "Atlas-X"],
    },
  };
  const preserved = generator(async () => completion(validPayload({
    whyNow: "AI 研究判断：Alpha Robotics 公布 Tesla 与 宇树科技 参与 Atlas-X 工厂试点。",
    routeAndDependencies: "AI 研究判断：Atlas-X 路线依赖 Tesla 与 宇树科技 的后续公开验证。",
  })), facts);
  const altered = generator(async () => completion(validPayload({
    whyNow: "AI 研究判断：Alpha Robotics 公布特斯拉与 Unitree 参与 Atlas-X 工厂试点。",
    routeAndDependencies: "AI 研究判断：Atlas-X 路线依赖后续公开验证。",
  })), facts);

  assert.equal((await preserved.generate(seed)).ok, true);
  assert.deepEqual(await altered.generate(seed), { ok: false, code: "invalid-shape" });
});

test("unavailable configuration or provider returns llm-unavailable and safe status", async () => {
  const unconfigured = new WatchlistGenerator({}, FACTS, { now: () => new Date(NOW) });
  assert.deepEqual(await unconfigured.generate(seed), { ok: false, code: "llm-unavailable" });
  assert.deepEqual(unconfigured.status(), {
    component: "LLM", status: "未配置", attempted: 0, succeeded: 0, failed: 0,
    detail: "未配置兼容 OpenAI 的观察名单生成服务；不会产生新草稿。",
  });

  const unavailable = generator(async () => { throw new Error(`provider failed ${API_KEY} ${FACTS["event-alpha"].excerpt}`); });
  assert.deepEqual(await unavailable.generate(seed), { ok: false, code: "llm-unavailable" });
  assert.deepEqual(unavailable.status(), {
    component: "LLM", status: "部分降级", attempted: 1, succeeded: 0, failed: 1,
    detail: "观察名单生成未全部完成；失败项保留在内部审核层。",
  });
  assert.doesNotMatch(JSON.stringify(unavailable.status()), new RegExp(`${API_KEY}|Atlas-X|event-alpha`));
});

test("generatedAt is injected once and expiresAt is exactly sixty days later", async () => {
  let clockCalls = 0;
  const subject = new WatchlistGenerator(
    { apiKey: API_KEY, baseUrl: "https://llm.example/v1", model: "model-official" },
    FACTS,
    { now: () => { clockCalls += 1; return new Date(NOW); }, fetchImpl: async () => completion(validPayload()) },
  );

  const result = await subject.generate(seed);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(clockCalls, 1);
  assert.equal(result.draft.generatedAt, "2026-08-13T01:00:00.000Z");
  assert.equal(result.draft.expiresAt, "2026-10-12T01:00:00.000Z");
  assert.equal(Date.parse(result.draft.expiresAt) - Date.parse(result.draft.generatedAt), 60 * 24 * 60 * 60 * 1_000);
});

test("uses a thirty-second request timeout and retries one timeout once", async () => {
  let calls = 0;
  const timeoutValues: number[] = [];
  const originalTimeout = AbortSignal.timeout;
  Object.defineProperty(AbortSignal, "timeout", {
    configurable: true,
    value: (milliseconds: number) => {
      timeoutValues.push(milliseconds);
      return originalTimeout(60_000);
    },
  });
  try {
    const subject = generator(async (_input, init) => {
      calls += 1;
      assert.ok(init?.signal);
      if (calls === 1) throw new DOMException("timed out", "TimeoutError");
      return completion(validPayload());
    });

    const result = await subject.generate(seed);

    assert.equal(result.ok, true);
    assert.equal(calls, 2);
    assert.deepEqual(timeoutValues, [30_000, 30_000]);
  } finally {
    Object.defineProperty(AbortSignal, "timeout", { configurable: true, value: originalTimeout });
  }
});

test("status counts generation outcomes rather than exposing provider payloads", async () => {
  let calls = 0;
  const subject = generator(async () => completion(++calls === 1 ? validPayload() : "not json"));

  await subject.generate(seed);
  await subject.generate(seed);

  assert.deepEqual(subject.status(), {
    component: "LLM", status: "部分降级", attempted: 2, succeeded: 1, failed: 1,
    detail: "观察名单生成未全部完成；失败项保留在内部审核层。",
  });
});
