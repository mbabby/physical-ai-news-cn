import type { Article, LlmSettings } from "./types.js";

interface CompletionResponse { choices?: Array<{ message?: { content?: string } }> }
interface SummaryPayload { titleZh?: string; summaryZh?: string }

export class CompatibleSummarizer {
  constructor(private readonly settings: LlmSettings) {}

  async summarize(article: Article): Promise<Article> {
    if (!article.excerpt.trim()) return { ...article, titleZh: article.title, summaryZh: "原始来源未提供足够摘要，暂不生成自动中文要点。" };
    if (!this.settings.apiKey || !this.settings.baseUrl || !this.settings.model) {
      return { ...article, titleZh: article.title, summaryZh: "未配置摘要服务；请保留原文链接阅读详情。" };
    }
    try {
      const response = await fetch(`${this.settings.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.settings.apiKey}` },
        body: JSON.stringify({ model: this.settings.model, temperature: 0.1, response_format: { type: "json_object" }, messages: [
          { role: "system", content: "你是严谨的中文科技编辑。只根据给出的英文标题和摘要输出 JSON：titleZh（简洁中文标题）和 summaryZh（2至3条事实性中文要点，以换行分隔）。不得补充未给出的事实。" },
          { role: "user", content: `标题：${article.title}\n摘要：${article.excerpt.slice(0, 4000)}` },
        ] }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as CompletionResponse;
      const content = data.choices?.[0]?.message?.content ?? "";
      const parsed = JSON.parse(content) as SummaryPayload;
      if (!parsed.titleZh || !parsed.summaryZh) throw new Error("模型响应字段不完整");
      return { ...article, titleZh: parsed.titleZh.trim(), summaryZh: parsed.summaryZh.trim() };
    } catch (error) {
      return { ...article, titleZh: article.title, summaryZh: `自动摘要失败：${error instanceof Error ? error.message : "未知错误"}。请阅读原文。` };
    }
  }
}
