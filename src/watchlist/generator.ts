import { fetchWithRetry, HttpRequestError } from "../runtime/http.js";
import type { LlmSettings, RuntimeStatus } from "../types.js";
import type { CompanyThesis } from "./contracts.js";
import type { SelectedThesisSeed } from "./scoring.js";

const PROMPT_VERSION = "watchlist-thesis-v1";
const METHODOLOGY_VERSION = "v1";
const EXPIRY_MS = 60 * 24 * 60 * 60 * 1_000;
const PROHIBITED_INVESTMENT_LANGUAGE = /买入|卖出|目标价|投资建议|建议配置|推荐(?!算法|系统|模型|引擎|机制)|回报率|收益率|投资(?:收益|回报)|(?:预计|预期|预估|有望|或将|可能)(?:将)?(?:获得|实现|带来|产生|达到|取得)?(?:投资)?(?:收益|回报)|\bbuy\b|\bsell\b|target price|\breturns?\b/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const FACT_ATOM_KINDS = new Set(["company", "official-name", "product", "route", "funding-amount", "valuation", "customer", "date", "quantity", "action"]);

export interface ThesisSentenceCitation {
  path: string;
  sentenceIndex: number;
  text: string;
  claimKind: "analysis" | "validation-point" | "falsifier";
  referenceIds: string[];
  factAtomIds: string[];
  sensitiveFields: Array<"amount" | "valuation" | "customer" | "revenue" | "order">;
}

export type FactAtomKind =
  | "company" | "official-name" | "product" | "route" | "funding-amount" | "valuation"
  | "customer" | "date" | "quantity" | "action";

export interface CanonicalFactAtom {
  id: string;
  referenceId: string;
  kind: FactAtomKind;
  value: string;
}

export function scheduleAtomId(path: string, dueAt: string): string {
  return `schedule:${path}:${dueAt}`;
}

export type CompanyThesisDraft = Omit<CompanyThesis, "thesisId" | "lifecycle" | "thesisVersion" | "verifiedSensitiveBindings"> & {
  sentenceCitations: ThesisSentenceCitation[];
};

export type ThesisGenerationResult =
  | { ok: true; draft: CompanyThesisDraft }
  | { ok: false; code: "llm-unavailable" | ProviderFailureCode | "provider-response" | "invalid-json" | "invalid-shape" };

type ProviderFailureCode =
  | "provider-timeout" | "provider-rate-limit" | "provider-auth" | "provider-payment-required"
  | "provider-server" | "provider-client" | "provider-network";

export interface WatchlistGeneratorOptions {
  now?: () => Date;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

interface CompletionResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
}

interface GeneratedPayload {
  whyNow: string;
  routeAndDependencies: string;
  nextValidationPoints: Array<{ text: string; dueAt: string }>;
  falsifiers: Array<{ text: string }>;
  factReferenceIds: string[];
  confidence: "high" | "medium" | "low";
}

const OUTPUT_KEYS = new Set([
  "whyNow",
  "routeAndDependencies",
  "nextValidationPoints",
  "falsifiers",
  "factReferenceIds",
  "confidence",
]);

// Kimi K3 otherwise defaults to max reasoning and an output budget of 131k
// tokens. This bounded schema keeps the daily job fast while the validators
// below remain the authoritative publication gate.
const WATCHLIST_RESPONSE_SCHEMA = {
  name: "watchlist_thesis",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      whyNow: { type: "string" },
      routeAndDependencies: { type: "string" },
      nextValidationPoints: {
        type: "array",
        minItems: 1,
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
          properties: { text: { type: "string" }, dueAt: { type: "string" } },
          required: ["text", "dueAt"],
        },
      },
      falsifiers: {
        type: "array",
        minItems: 1,
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
          properties: { text: { type: "string" } },
          required: ["text"],
        },
      },
      factReferenceIds: { type: "array", minItems: 1, items: { type: "string" } },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
    },
    required: [
      "whyNow",
      "routeAndDependencies",
      "nextValidationPoints",
      "falsifiers",
      "factReferenceIds",
      "confidence",
    ],
  },
} as const;

export interface CanonicalFactExcerpt {
  excerpt: string;
  officialNames: string[];
  factAtoms: CanonicalFactAtom[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: ReadonlySet<string>): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function hasSafeDirectionalProse(value: unknown, maxCharacters: number): value is string {
  return isNonEmptyString(value)
    && value.startsWith("AI 研究判断")
    && Array.from(value).length <= maxCharacters
    && !PROHIBITED_INVESTMENT_LANGUAGE.test(value);
}

function isValidationPoint(value: unknown): value is { text: string; dueAt: string } {
  return isObject(value)
    && hasExactKeys(value, new Set(["text", "dueAt"]))
    && isNonEmptyString(value.text)
    && hasValidDate(value.dueAt)
    && !PROHIBITED_INVESTMENT_LANGUAGE.test(value.text);
}

function isFalsifier(value: unknown): value is { text: string } {
  return isObject(value)
    && hasExactKeys(value, new Set(["text"]))
    && isNonEmptyString(value.text)
    && !PROHIBITED_INVESTMENT_LANGUAGE.test(value.text);
}

function generatedSentences(value: string): string[] {
  return value.match(/[^。！？!?]+[。！？!?]?/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [];
}

function expectedSentenceBindings(value: GeneratedPayload): Array<{ path: string; sentenceIndex: number; text: string }> {
  const fields = [
    { path: "whyNow", text: value.whyNow },
    { path: "routeAndDependencies", text: value.routeAndDependencies },
    ...value.nextValidationPoints.map((point, index) => ({ path: `nextValidationPoints.${index}`, text: point.text })),
    ...value.falsifiers.map((falsifier, index) => ({ path: `falsifiers.${index}`, text: falsifier.text })),
  ];
  return fields.flatMap(({ path, text }) => generatedSentences(text).map((sentence, sentenceIndex) => ({ path, sentenceIndex, text: sentence })));
}

function isGeneratedPayload(
  value: unknown,
  seed: SelectedThesisSeed,
  facts: Array<{ referenceId: string } & CanonicalFactExcerpt>,
): value is GeneratedPayload {
  if (!isObject(value) || !hasExactKeys(value, OUTPUT_KEYS)) return false;
  if (!hasSafeDirectionalProse(value.whyNow, 120) || !hasSafeDirectionalProse(value.routeAndDependencies, 160)) return false;
  const directionalProse = `${value.whyNow}\n${value.routeAndDependencies}`;
  if (!directionalProse.includes(seed.companyName)) return false;
  if (!Array.isArray(value.nextValidationPoints)
    || value.nextValidationPoints.length < 1
    || value.nextValidationPoints.length > 3
    || !value.nextValidationPoints.every(isValidationPoint)) return false;
  if (!Array.isArray(value.falsifiers)
    || value.falsifiers.length < 1
    || value.falsifiers.length > 3
    || !value.falsifiers.every(isFalsifier)) return false;
  if (!Array.isArray(value.factReferenceIds)
    || value.factReferenceIds.length < 1
    || !value.factReferenceIds.every(isNonEmptyString)
    || new Set(value.factReferenceIds).size !== value.factReferenceIds.length) return false;
  const allowedReferences = new Set(seed.factReferenceIds);
  if (value.factReferenceIds.some((referenceId) => !allowedReferences.has(referenceId))) return false;
  const typed = value as unknown as GeneratedPayload;
  const outputReferences = new Set(typed.factReferenceIds);
  if (!facts.some((fact) => outputReferences.has(fact.referenceId) && fact.factAtoms.length > 0)) return false;
  const generatedProse = [
    directionalProse,
    ...value.nextValidationPoints.map((point) => point.text),
    ...value.falsifiers.map((falsifier) => falsifier.text),
  ].join("\n");
  const officialNames = new Set(facts.flatMap((fact) => fact.officialNames));
  if ([...officialNames].some((name) => !generatedProse.includes(name))) return false;
  return value.confidence === "high" || value.confidence === "medium" || value.confidence === "low";
}

function selectedFacts(
  seed: SelectedThesisSeed,
  factsByReferenceId: Readonly<Record<string, CanonicalFactExcerpt>>,
): Array<{ referenceId: string } & CanonicalFactExcerpt> | undefined {
  const selected = seed.factReferenceIds.map((referenceId) => ({ referenceId, ...factsByReferenceId[referenceId] }));
  if (selected.some((fact) => !isNonEmptyString(fact.excerpt)
    || !Array.isArray(fact.officialNames)
    || fact.officialNames.some((name) => !isNonEmptyString(name))
    || new Set(fact.officialNames).size !== fact.officialNames.length
    || !Array.isArray(fact.factAtoms)
    || fact.factAtoms.some((atom) => !isNonEmptyString(atom.id) || atom.referenceId !== fact.referenceId
      || !FACT_ATOM_KINDS.has(atom.kind) || !isNonEmptyString(atom.value))
    || new Set(fact.factAtoms.map((atom) => atom.id)).size !== fact.factAtoms.length)) return undefined;
  return selected;
}

function systemPrompt(): string {
  return [
    "你是严谨的 Physical AI 公司研究编辑。只使用提供的规范事实，不得补充、猜测或引用外部信息。",
    "只输出一个 JSON 对象，不要 Markdown、代码围栏、解释或额外字段。",
    "严格输出字段：whyNow、routeAndDependencies、nextValidationPoints、falsifiers、factReferenceIds、confidence。",
    "whyNow 不超过 120 个字符；routeAndDependencies 不超过 160 个字符；两段方向性文字都以“AI 研究判断”开头。",
    "nextValidationPoints 为 1–3 条，每条只有 text 与 YYYY-MM-DD dueAt；falsifiers 为 1–3 条，每条只有 text。",
    "factReferenceIds 只能使用输入列出的引用 ID；confidence 只能是 high、medium 或 low。",
    "公司、产品和模型名称必须保留输入中的官方拼写及大小写，不得翻译、音译或改名。",
    "不要在文案中写融资金额、估值、客户、营收或订单；事实引用和逐句绑定由系统生成。",
    "禁止推荐、投资建议、买入、卖出、目标价、建议配置、预计收益、投资回报或任何回报预测。",
  ].join("\n");
}

function isoDayAtOffset(now: Date, days: number): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days)).toISOString().slice(0, 10);
}

function userPrompt(seed: SelectedThesisSeed, facts: Array<{ referenceId: string } & CanonicalFactExcerpt>, now: Date): string {
  return JSON.stringify({
    companyId: seed.companyId,
    officialCompanyName: seed.companyName,
    track: seed.track,
    routes: seed.routes,
    allowedFactReferenceIds: seed.factReferenceIds,
    validationDueAtWindow: { notBefore: isoDayAtOffset(now, 30), notAfter: isoDayAtOffset(now, 90) },
    canonicalFacts: facts,
  });
}

function derivedSensitiveFields(text: string, atoms: CanonicalFactAtom[]): ThesisSentenceCitation["sensitiveFields"] {
  const fields: ThesisSentenceCitation["sensitiveFields"] = [];
  if (atoms.some((atom) => atom.kind === "funding-amount" && text.includes(atom.value))) fields.push("amount");
  if (atoms.some((atom) => atom.kind === "valuation" && text.includes(atom.value))) fields.push("valuation");
  if (atoms.some((atom) => atom.kind === "customer" && text.includes(atom.value))) fields.push("customer");
  return fields;
}

function deriveSentenceCitations(
  payload: GeneratedPayload,
  facts: Array<{ referenceId: string } & CanonicalFactExcerpt>,
): ThesisSentenceCitation[] {
  const referenceIds = [...payload.factReferenceIds];
  const atoms = facts.filter((fact) => referenceIds.includes(fact.referenceId)).flatMap((fact) => fact.factAtoms);
  const atomIds = [...new Set(atoms.map((atom) => atom.id))];
  return expectedSentenceBindings(payload).map((sentence) => {
    const pointIndex = sentence.path.startsWith("nextValidationPoints.") ? Number(sentence.path.split(".")[1]) : undefined;
    const scheduleId = pointIndex === undefined ? undefined
      : scheduleAtomId(sentence.path, payload.nextValidationPoints[pointIndex]?.dueAt ?? "");
    return {
      ...sentence,
      claimKind: sentence.path.startsWith("nextValidationPoints.")
        ? "validation-point" : sentence.path.startsWith("falsifiers.") ? "falsifier" : "analysis",
      referenceIds,
      factAtomIds: scheduleId ? [...atomIds, scheduleId] : atomIds,
      sensitiveFields: derivedSensitiveFields(sentence.text, atoms),
    };
  });
}

function providerFailureCode(error: unknown): ProviderFailureCode {
  if (!(error instanceof HttpRequestError)) return "provider-network";
  if (error.kind === "rate_limit") return "provider-rate-limit";
  if (error.kind === "payment_required") return "provider-payment-required";
  return `provider-${error.kind}`;
}

export class WatchlistGenerator {
  private attempted = 0;
  private succeeded = 0;
  private failed = 0;

  constructor(
    private readonly settings: LlmSettings,
    private readonly factsByReferenceId: Readonly<Record<string, CanonicalFactExcerpt>>,
    private readonly options: WatchlistGeneratorOptions = {},
  ) {}

  status(): RuntimeStatus {
    if (!this.configured()) {
      return {
        component: "LLM",
        status: "未配置",
        attempted: 0,
        succeeded: 0,
        failed: 0,
        detail: "未配置兼容 OpenAI 的观察名单生成服务；不会产生新草稿。",
      };
    }
    return {
      component: "LLM",
      status: this.failed ? "部分降级" : "成功",
      attempted: this.attempted,
      succeeded: this.succeeded,
      failed: this.failed,
      detail: this.failed
        ? "观察名单生成未全部完成；失败项保留在内部审核层。"
        : "观察名单结构化草稿已完成。",
    };
  }

  async generate(seed: SelectedThesisSeed): Promise<ThesisGenerationResult> {
    if (!this.configured()) return { ok: false, code: "llm-unavailable" };
    this.attempted += 1;
    const facts = selectedFacts(seed, this.factsByReferenceId);
    if (!facts) return this.failure("invalid-shape");
    const now = (this.options.now ?? (() => new Date()))();
    if (!Number.isFinite(now.getTime())) return this.failure("invalid-shape");

    let response: Response;
    try {
      response = await fetchWithRetry(`${this.settings.baseUrl!.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.settings.apiKey}`,
        },
        body: JSON.stringify({
          model: this.settings.model,
          response_format: { type: "json_schema", json_schema: WATCHLIST_RESPONSE_SCHEMA },
          max_completion_tokens: 4096,
          reasoning_effort: "low",
          messages: [
            { role: "system", content: systemPrompt() },
            { role: "user", content: userPrompt(seed, facts, now) },
          ],
        }),
      }, {
        timeoutMs: 30_000,
        attempts: 2,
        fetchImpl: this.options.fetchImpl,
        sleep: this.options.sleep,
      });
    } catch (error) {
      return this.failure(providerFailureCode(error));
    }

    let envelope: CompletionResponse;
    try {
      envelope = await response.json() as CompletionResponse;
    } catch {
      return this.failure("provider-response");
    }
    const content = envelope.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) return this.failure("provider-response");

    let payload: unknown;
    try {
      payload = JSON.parse(content);
    } catch {
      return this.failure("invalid-json");
    }
    if (!isGeneratedPayload(payload, seed, facts)) return this.failure("invalid-shape");

    const generatedAt = now.toISOString();
    const draft: CompanyThesisDraft = {
      companyId: seed.companyId,
      track: seed.track,
      whyNow: payload.whyNow,
      routeAndDependencies: payload.routeAndDependencies,
      nextValidationPoints: payload.nextValidationPoints,
      falsifiers: payload.falsifiers,
      factReferenceIds: payload.factReferenceIds,
      inferenceLabels: ["AI 研究判断"],
      confidence: payload.confidence,
      generatedAt,
      expiresAt: new Date(now.getTime() + EXPIRY_MS).toISOString(),
      modelVersion: this.settings.model!,
      promptVersion: PROMPT_VERSION,
      methodologyVersion: METHODOLOGY_VERSION,
      sentenceCitations: deriveSentenceCitations(payload, facts),
    };
    this.succeeded += 1;
    return { ok: true, draft };
  }

  private configured(): boolean {
    return Boolean(this.settings.apiKey && this.settings.baseUrl && this.settings.model);
  }

  private failure(code: Exclude<ThesisGenerationResult, { ok: true }>["code"]): ThesisGenerationResult {
    this.failed += 1;
    return { ok: false, code };
  }
}
