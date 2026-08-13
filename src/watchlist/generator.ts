import { fetchWithRetry } from "../runtime/http.js";
import type { LlmSettings, RuntimeStatus } from "../types.js";
import type { CompanyThesis } from "./contracts.js";
import type { SelectedThesisSeed } from "./scoring.js";

const PROMPT_VERSION = "watchlist-thesis-v1";
const METHODOLOGY_VERSION = "v1";
const EXPIRY_MS = 60 * 24 * 60 * 60 * 1_000;
const PROHIBITED_INVESTMENT_LANGUAGE = /买入|卖出|目标价|回报率|收益率|建议配置|\bbuy\b|\bsell\b|target price|\breturns?\b/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type CompanyThesisDraft = Omit<CompanyThesis, "thesisId" | "lifecycle" | "thesisVersion">;

export type ThesisGenerationResult =
  | { ok: true; draft: CompanyThesisDraft }
  | { ok: false; code: "llm-unavailable" | "invalid-json" | "invalid-shape" };

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

export interface CanonicalFactExcerpt {
  excerpt: string;
  officialNames: string[];
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
    || new Set(fact.officialNames).size !== fact.officialNames.length)) return undefined;
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
    "禁止买入、卖出、目标价、建议配置、回报率、收益率或任何投资回报预测。",
  ].join("\n");
}

function userPrompt(seed: SelectedThesisSeed, facts: Array<{ referenceId: string } & CanonicalFactExcerpt>): string {
  return JSON.stringify({
    companyId: seed.companyId,
    officialCompanyName: seed.companyName,
    track: seed.track,
    routes: seed.routes,
    allowedFactReferenceIds: seed.factReferenceIds,
    canonicalFacts: facts,
  });
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
          response_format: { type: "json_object" },
          temperature: 0,
          messages: [
            { role: "system", content: systemPrompt() },
            { role: "user", content: userPrompt(seed, facts) },
          ],
        }),
      }, {
        timeoutMs: 30_000,
        attempts: 2,
        fetchImpl: this.options.fetchImpl,
        sleep: this.options.sleep,
      });
    } catch {
      return this.failure("llm-unavailable");
    }

    let envelope: CompletionResponse;
    try {
      envelope = await response.json() as CompletionResponse;
    } catch {
      return this.failure("llm-unavailable");
    }
    const content = envelope.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) return this.failure("llm-unavailable");

    let payload: unknown;
    try {
      payload = JSON.parse(content);
    } catch {
      return this.failure("invalid-json");
    }
    if (!isGeneratedPayload(payload, seed, facts)) return this.failure("invalid-shape");

    const now = (this.options.now ?? (() => new Date()))();
    if (!Number.isFinite(now.getTime())) return this.failure("invalid-shape");
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
