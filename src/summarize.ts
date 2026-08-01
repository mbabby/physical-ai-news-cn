import type { Article, LlmSettings } from "./types.js";

interface CompletionResponse { choices?: Array<{ message?: { content?: string } }> }
interface SummaryPayload { titleZh?: string; summaryZh?: string }

function parseSummary(content: string): SummaryPayload {
  const json = content.match(/\{[\s\S]*\}/)?.[0] ?? content;
  return JSON.parse(json) as SummaryPayload;
}

export class CompatibleSummarizer {
  constructor(private readonly settings: LlmSettings) {}

  async summarize(article: Article): Promise<Article> {
    if (!this.settings.apiKey || !this.settings.baseUrl || !this.settings.model) {
      return { ...article, titleZh: article.title, summaryZh: article.excerpt.trim() ? "未配置摘要服务；请阅读原文。" : undefined };
    }
    try {
      const response = await fetch(`${this.settings.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.settings.apiKey}` },
        body: JSON.stringify({ model: this.settings.model, temperature: 0.1, messages: [
          { role: "system", content: "你是严谨的中文科技编辑。只根据输入输出一行合法 JSON，禁止 Markdown 或任何其他文字。JSON 字段为 titleZh（简洁、自然的中文标题）和 summaryZh。若给有来源摘要，summaryZh 写成一段 40 至 90 字的中文事实摘要，不得补充未给出的事实；若来源摘要为空，summaryZh 必须为空字符串，只翻译标题。" },
          { role: "user", content: `标题：${article.title}\n来源摘要：${article.excerpt.slice(0, 4000) || "（无）"}` },
        ] }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as CompletionResponse;
      const content = data.choices?.[0]?.message?.content ?? "";
      const parsed = parseSummary(content);
      if (!parsed.titleZh) throw new Error("模型响应缺少中文标题");
      return { ...article, titleZh: parsed.titleZh.trim(), summaryZh: parsed.summaryZh?.trim() || undefined };
    } catch (error) {
      return { ...article, titleZh: article.title, summaryZh: article.excerpt.trim() ? "暂未生成摘要，请阅读原文。" : undefined };
    }
  }
}
