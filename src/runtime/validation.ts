import { hasCompleteChineseCopy } from "../publication.js";
import type { DailyArchive, EventStore, ResearchRecord } from "../types.js";

export interface PublicationValidationInput {
  archive: DailyArchive;
  events: EventStore;
  research: ResearchRecord[];
  readme: string;
  expectedDate: string;
  previousCompleteResearchCount?: number;
}

export function validatePublication(input: PublicationValidationInput): void {
  const errors: string[] = [];
  if (input.archive.date !== input.expectedDate) errors.push(`日报日期 ${input.archive.date} 与运行日期 ${input.expectedDate} 不一致`);
  const articleIds = input.archive.articles.map((article) => article.id);
  if (new Set(articleIds).size !== articleIds.length) errors.push("日报含重复文章 ID");
  for (const article of input.archive.articles) {
    if (!hasCompleteChineseCopy(article)) errors.push(`公开文章缺少完整中文事实简介：${article.id}`);
    if (!/^https?:\/\//.test(article.link)) errors.push(`公开文章链接无效：${article.id}`);
  }
  const eventIds = input.events.events.map((event) => event.id);
  if (new Set(eventIds).size !== eventIds.length) errors.push("事件中心含重复事件 ID");
  for (const event of input.events.events) {
    if (!event.evidence.length || event.evidence.some((evidence) => !/^https?:\/\//.test(evidence.link))) errors.push(`事件缺少可追溯证据：${event.id}`);
  }
  const researchMinimum = Math.min(6, input.previousCompleteResearchCount ?? 0);
  if (input.research.length < researchMinimum) errors.push(`研究卡从 ${researchMinimum} 篇倒退到 ${input.research.length} 篇`);
  if (/暂无中文简介|暂未生成中文摘要|中文简介暂未生成/.test(input.readme)) errors.push("README 出现公开占位简介");
  if (errors.length) throw new Error(`发布质量门槛未通过：\n- ${errors.join("\n- ")}`);
}
