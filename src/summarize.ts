import type { Article, LlmSettings } from "./types.js";

interface CompletionResponse { choices?: Array<{ message?: { content?: string } }> }
interface SummaryPayload { titleZh?: string; summaryZh?: string }

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
  constructor(private readonly settings: LlmSettings) {}

  async summarize(article: Article): Promise<Article> {
    if (!this.settings.apiKey || !this.settings.baseUrl || !this.settings.model) {
      return { ...article, titleZh: article.title, summaryZh: "未配置摘要服务；请阅读原文。" };
    }
    // The provider can briefly throttle a parallel batch. Retry transient
    // failures so that a later research batch does not quietly become six
    // identical placeholder cards on the homepage.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(`${this.settings.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.settings.apiKey}` },
          body: JSON.stringify({ model: this.settings.model, messages: [
            { role: "system", content: "你是严谨的中文科技编辑。只根据输入输出两行纯文本，不要 Markdown、JSON 或解释。第一行固定为“标题：”加简洁自然的中文标题。公司、机构、产品、模型与论文名称必须保留原始官方写法（如 World Labs、SceniX、Gemini Robotics），不要翻译、音译或在名称前拼接人物名；只翻译事件本身。不要保留媒体名、站点名或英文原标题尾缀。第二行固定为“摘要：”。有来源摘要时，摘要写 35 至 60 字的中文事实简介，不得补充未给出的事实；来源摘要为空时，摘要写“暂无原文摘要，请阅读原文。”。" },
            { role: "user", content: `标题：${article.title}\n来源摘要：${article.excerpt.slice(0, 4000) || "（无）"}` },
          ] }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = (await response.json()) as CompletionResponse;
        const content = data.choices?.[0]?.message?.content ?? "";
        const parsed = parseSummary(content);
        if (!parsed.titleZh) throw new Error("模型响应缺少中文标题");
        return { ...article, titleZh: parsed.titleZh.trim(), summaryZh: parsed.summaryZh?.trim() || "暂无原文摘要，请阅读原文。" };
      } catch {
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 800));
      }
    }
    return { ...article, titleZh: article.title, summaryZh: "暂未生成中文摘要，请阅读原文。" };
  }
}
