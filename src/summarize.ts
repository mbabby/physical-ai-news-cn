import type { Article, LlmSettings, RuntimeStatus } from "./types.js";
import { hasCompleteChineseCopy, hasCompleteChineseResearchCopy } from "./publication.js";
import { fetchWithRetry } from "./runtime/http.js";

interface CompletionResponse { choices?: Array<{ message?: { content?: string } }> }
interface SummaryPayload { titleZh?: string; summaryZh?: string }

export type SummaryLane = "industry" | "research" | "pulse";

interface LaneStats {
  attempted: number;
  succeeded: number;
  failed: number;
  invalid: number;
  cacheHits: number;
  circuitOpen: boolean;
}

function parseSummary(content: string): SummaryPayload {
  // JSON mode is not consistently implemented by every OpenAI-compatible
  // provider. Accept it when available, then fall back to the deliberately
  // simple two-line response format used in the prompt below.
  try {
    const json = content.match(/\{[\s\S]*\}/)?.[0] ?? content;
    const parsed = JSON.parse(json) as SummaryPayload;
    if (parsed.titleZh) return parsed;
  } catch {}

  const normalized = content.replace(/```(?:text|json)?\s*/gi, "").replace(/```/g, "").trim();
  const titleZh = normalized.match(/(?:^|\n)\s*(?:\*\*)?标题(?:\*\*)?[：:]\s*(.+?)(?=\n|$)/)?.[1]?.trim();
  const summaryZh = normalized.match(/(?:^|\n)\s*(?:\*\*)?摘要(?:\*\*)?[：:]\s*([\s\S]+)$/)?.[1]?.trim();
  return { titleZh, summaryZh };
}

export class CompatibleSummarizer {
  private readonly lanes = new Map<SummaryLane, LaneStats>();
  constructor(private readonly settings: LlmSettings) {}

  private lane(name: SummaryLane): LaneStats {
    let stats = this.lanes.get(name);
    if (!stats) {
      stats = { attempted: 0, succeeded: 0, failed: 0, invalid: 0, cacheHits: 0, circuitOpen: false };
      this.lanes.set(name, stats);
    }
    return stats;
  }

  recordCacheHits(count: number, lane: SummaryLane = "industry"): void {
    if (count > 0) this.lane(lane).cacheHits += count;
  }

  status(): RuntimeStatus {
    const configured = Boolean(this.settings.apiKey && this.settings.baseUrl && this.settings.model);
    const totals = [...this.lanes.values()].reduce((all, lane) => ({
      attempted: all.attempted + lane.attempted, succeeded: all.succeeded + lane.succeeded,
      failed: all.failed + lane.failed, invalid: all.invalid + lane.invalid, cacheHits: all.cacheHits + lane.cacheHits,
    }), { attempted: 0, succeeded: 0, failed: 0, invalid: 0, cacheHits: 0 });
    const openLanes = [...this.lanes.entries()].filter(([, lane]) => lane.circuitOpen).map(([name]) => name);
    if (!configured) return { component: "LLM", status: "未配置", attempted: totals.attempted, succeeded: 0, failed: 0, detail: `未配置兼容 OpenAI 的摘要服务；缓存命中 ${totals.cacheHits}。内容不会发布到首页。` };
    const degraded = totals.failed > 0 || totals.invalid > 0;
    return {
      component: "LLM", status: degraded ? "部分降级" : "成功", attempted: totals.attempted, succeeded: totals.succeeded, failed: totals.failed,
      detail: `有效完成 ${totals.succeeded}；无效模型输出 ${totals.invalid}；提供方失败 ${totals.failed}；缓存命中 ${totals.cacheHits}${openLanes.length ? `；${openLanes.join("、")} 通道已熔断` : ""}。`,
    };
  }

  async summarize(article: Article, lane: SummaryLane = "industry"): Promise<Article> {
    if (!article.excerpt.trim()) return { ...article, titleZh: article.title, summaryZh: "暂无原文摘要，请阅读原文。" };
    if (!this.settings.apiKey || !this.settings.baseUrl || !this.settings.model) {
      return { ...article, titleZh: article.title, summaryZh: "未配置摘要服务；请阅读原文。" };
    }
    // A provider outage must not multiply into one minute of retries for every
    // remaining article. Two failed articles are enough evidence to stop new
    // requests for this run; publication then restores verified copy or keeps
    // the item in the private candidate layer.
    const stats = this.lane(lane);
    if (stats.circuitOpen) return { ...article, titleZh: article.title, summaryZh: "暂未生成中文摘要，请阅读原文。" };
    stats.attempted += 1;
    // The provider can briefly throttle a parallel batch. Retry only provider
    // failures: malformed completions are content errors, not outage evidence.
    let lastError = "unknown error";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetchWithRetry(`${this.settings.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          // Kimi-compatible endpoints occasionally take longer than a short
          // interactive request. Thirty seconds preserves a bounded daily
          // job while avoiding needless fallback cards during normal load.
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.settings.apiKey}` },
          body: JSON.stringify({ model: this.settings.model, messages: [
            { role: "system", content: "你是严谨的中文科技编辑。只根据输入输出两行纯文本，不要 Markdown、JSON 或解释。第一行固定为“标题：”加简洁自然的中文标题。公司、机构、产品、模型与论文名称必须保留原始官方写法（如 World Labs、SceniX、Gemini Robotics），不要翻译、音译或在名称前拼接人物名；只翻译事件本身。不要保留媒体名、站点名或英文原标题尾缀。第二行固定为“摘要：”。有来源摘要时，摘要必须恰好两句、合计 45 至 90 字：第一句说明研究做了什么，第二句说明其在真实机器人、基准或可复现性上的已知证据；没有对应证据时明确写“摘要未提供真实机器人、基准或开源证据”。不得补充未给出的事实。来源摘要为空时，摘要写“暂无原文摘要，请阅读原文。”。" },
            { role: "user", content: `标题：${article.title}\n作者：${article.authors?.join("、") || "（未提供）"}\n来源摘要：${article.excerpt.slice(0, 4000) || "（无）"}` },
          ] }),
        // The outer loop retries provider failures. Keep the HTTP helper to one
        // attempt here so one item has a strict 60-second total
        // budget instead of accidentally multiplying retries to four calls.
        }, { timeoutMs: 30_000, attempts: 1 });
        let data: CompletionResponse;
        try {
          const payload = await response.json();
          if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid completion payload");
          data = payload as CompletionResponse;
        }
        catch {
          stats.invalid += 1;
          console.warn("[summary] rejected malformed model completion");
          return { ...article, titleZh: article.title, summaryZh: "暂未生成中文摘要，请阅读原文。" };
        }
        const parsed = parseSummary(data.choices?.[0]?.message?.content ?? "");
        const completed = { ...article, titleZh: parsed.titleZh?.trim(), summaryZh: parsed.summaryZh?.trim() };
        const valid = article.kind === "研究与数据" || article.source.startsWith("arXiv ·")
          ? hasCompleteChineseResearchCopy(completed)
          : hasCompleteChineseCopy(completed);
        if (!valid) {
          stats.invalid += 1;
          console.warn("[summary] rejected invalid model completion");
          return { ...article, titleZh: article.title, summaryZh: "暂未生成中文摘要，请阅读原文。" };
        }
        stats.succeeded += 1;
        return completed;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 800));
      }
    }
    // Deliberately exclude URL, key and article payload: workflow logs should
    // reveal only the actionable provider status, never credentials or source text.
    console.warn(`[summary] unavailable after retry (${lastError})`);
    stats.failed += 1;
    if (stats.failed >= 2) stats.circuitOpen = true;
    return { ...article, titleZh: article.title, summaryZh: "暂未生成中文摘要，请阅读原文。" };
  }
}
