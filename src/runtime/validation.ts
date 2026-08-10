import { hasCompleteChineseCopy, hasCompleteChineseResearchCopy } from "../publication.js";
import type { DailyArchive, EventStore, ResearchRecord, RunHistory, RunManifest } from "../types.js";
import { validateHistoryContinuity } from "./health.js";
import { validateFacts } from "../facts-contract.js";

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
    if (event.status === "已确证") {
      const contract = validateFacts({
        type: event.type,
        eventDate: event.eventDate ?? event.occurredAt,
        firstSeenAt: event.firstSeenAt,
        verifiedAt: event.lastVerifiedAt,
        materiallyChangedAt: event.lastUpdatedAt,
        public: true,
        evidence: event.evidence.map((item) => ({ id: item.link, link: item.link, source: item.source, grade: item.grade, publishedAt: item.publishedAt })),
      });
      if (!contract.valid) errors.push(`已确证事件违反公开事实契约：${event.id}（${contract.issues.map((issue) => issue.code).join(", ")}）`);
    }
  }
  const researchMinimum = Math.min(6, input.previousCompleteResearchCount ?? 0);
  if (input.research.length < researchMinimum) errors.push(`研究卡从 ${researchMinimum} 篇倒退到 ${input.research.length} 篇`);
  for (const record of input.research) {
    if (!hasCompleteChineseResearchCopy(record.article)) errors.push(`公开研究卡缺少完整中文标题或两句事实简介：${record.id}`);
    if (record.article.scholar?.isRetracted) errors.push(`公开研究卡包含已撤稿论文：${record.id}`);
  }
  if (/暂无中文简介|暂未生成中文摘要|中文简介暂未生成/.test(input.readme)) errors.push("README 出现公开占位简介");
  if (errors.length) throw new Error(`发布质量门槛未通过：\n- ${errors.join("\n- ")}`);
}

const validIsoDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
const validTimestamp = (value: string): boolean => Number.isFinite(Date.parse(value));

/** Cross-file contract validation. Publication copy may evolve, but these
 * invariants must remain stable for the workflow, dashboard and reviewers. */
export function validatePublicationArtifacts(archive: DailyArchive, manifest: RunManifest, history?: RunHistory): void {
  const errors: string[] = [];
  if (manifest.schemaVersion !== 1) errors.push(`不支持的运行清单版本：${manifest.schemaVersion}`);
  if (!validIsoDate(manifest.date) || manifest.date !== archive.date) errors.push("运行清单与日报日期不一致");
  if (!manifest.runId.startsWith(`${manifest.date}-`)) errors.push("runId 未包含运行日期前缀");
  if (!validTimestamp(manifest.startedAt) || !validTimestamp(manifest.finishedAt)) errors.push("运行清单时间戳无效");
  else if (Date.parse(manifest.finishedAt) < Date.parse(manifest.startedAt)) errors.push("运行结束时间早于开始时间");
  if (!Number.isInteger(manifest.outputs) || manifest.outputs < 1) errors.push("输出文件计数无效");
  for (const [name, count] of Object.entries(manifest.quality)) {
    if (!Number.isInteger(count) || count < 0) errors.push(`质量计数无效：${name}`);
  }
  const publicTotal = manifest.quality.publicIndustryItems + manifest.quality.publicResearchItems;
  if (publicTotal !== archive.articles.length) errors.push(`公开条目计数不一致：manifest=${publicTotal}，archive=${archive.articles.length}`);
  if (manifest.quality.candidates !== (archive.candidates?.length ?? 0)) errors.push("候选条目计数与日报不一致");
  const sourceFailures = archive.sourceOutcomes?.filter((outcome) => outcome.status === "failure").length ?? 0;
  if (manifest.quality.sourceFailures !== sourceFailures) errors.push("失败信源计数与日报不一致");
  const sourceNames = archive.sourceOutcomes?.map((outcome) => outcome.source) ?? [];
  if (new Set(sourceNames).size !== sourceNames.length) errors.push("日报含重复信源状态");
  const serviceNames = manifest.services.map((service) => service.component);
  if (new Set(serviceNames).size !== serviceNames.length) errors.push("运行清单含重复服务状态");
  for (const service of manifest.services) {
    if (service.attempted < service.succeeded + service.failed) errors.push(`${service.component} 请求计数小于成功与失败之和`);
  }
  const archiveServices = new Map((archive.runtimeStatus ?? []).map((service) => [service.component, service]));
  for (const service of manifest.services) {
    const archived = archiveServices.get(service.component);
    if (!archived || archived.status !== service.status || archived.attempted !== service.attempted || archived.succeeded !== service.succeeded || archived.failed !== service.failed) {
      errors.push(`${service.component} 状态在运行清单与日报间不一致`);
    }
  }
  for (const article of [...archive.articles, ...(archive.candidates ?? [])]) {
    if (!article.id || !article.source || !/^https:\/\//.test(article.link)) errors.push(`文章基础契约不完整：${article.id || "unknown"}`);
    if (!validTimestamp(String(article.publishedAt)) || !validTimestamp(String(article.fetchedAt))) errors.push(`文章时间戳无效：${article.id || "unknown"}`);
  }
  if (history) {
    if (history.schemaVersion !== 1 || history.runs[0]?.runId !== manifest.runId) errors.push("运行历史没有以当前清单为最新记录");
    errors.push(...validateHistoryContinuity(history));
  }
  if (errors.length) throw new Error(`发布产物契约未通过：\n- ${errors.join("\n- ")}`);
}
