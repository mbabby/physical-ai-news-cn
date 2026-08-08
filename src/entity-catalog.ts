import type { CompanyProfile, SourceConfig } from "./types.js";

function domain(value: string): string { return new URL(value).hostname.replace(/^www\./, "").toLowerCase(); }

export interface EntityCoverage {
  total: number;
  companies: number;
  labs: number;
  withOfficialDomain: number;
  withAutomatedFirstPartySource: number;
  byRegion: Array<{ region: string; count: number }>;
  byRoute: Array<{ route: string; count: number }>;
}

/** Reject inconsistent identity/source catalogs before collection starts. */
export function validateEntitySourceBindings(entities: CompanyProfile[], sources: SourceConfig[]): string[] {
  const errors: string[] = [];
  const entityIds = new Set<string>(); const names = new Set<string>(); const domains = new Set<string>();
  const sourceIds = new Set<string>();
  for (const source of sources) {
    if (!source.id) continue;
    if (sourceIds.has(source.id)) errors.push(`重复信源 ID：${source.id}`);
    sourceIds.add(source.id);
  }
  for (const entity of entities) {
    if (!entity.entityId) { errors.push(`实体缺少稳定 ID：${entity.name}`); continue; }
    if (entityIds.has(entity.entityId)) errors.push(`重复实体 ID：${entity.entityId}`);
    entityIds.add(entity.entityId);
    const normalizedName = entity.name.toLowerCase().replace(/\s+/g, "");
    if (names.has(normalizedName)) errors.push(`重复实体名称：${entity.name}`); names.add(normalizedName);
    try {
      const host = domain(entity.officialUrl);
      if (domains.has(host)) errors.push(`多个实体共享官网域名：${host}`); domains.add(host);
    } catch { errors.push(`实体官网无效：${entity.name}`); }
    for (const sourceId of entity.sourceIds ?? []) {
      const source = sources.find((item) => item.id === sourceId);
      if (!source) { errors.push(`实体 ${entity.name} 引用了不存在的信源：${sourceId}`); continue; }
      if (!source.entityIds?.includes(entity.entityId)) errors.push(`信源 ${sourceId} 未反向绑定实体 ${entity.entityId}`);
    }
  }
  for (const source of sources) for (const entityId of source.entityIds ?? []) if (!entityIds.has(entityId)) errors.push(`信源 ${source.id ?? source.name} 绑定了不存在的实体：${entityId}`);
  return errors;
}

export function buildEntityCoverage(entities: CompanyProfile[], sources: SourceConfig[]): EntityCoverage {
  const automated = new Set(sources.filter((source) => source.tier === "官方公司与实验室" && source.status !== "已暂停").flatMap((source) => source.entityIds ?? []));
  const count = (values: string[]) => [...new Map(values.map((value) => [value, values.filter((item) => item === value).length])).entries()].map(([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value || a.key.localeCompare(b.key, "zh-CN"));
  return {
    total: entities.length,
    companies: entities.filter((entity) => (entity.entityType ?? "公司") === "公司").length,
    labs: entities.filter((entity) => entity.entityType === "实验室").length,
    withOfficialDomain: entities.filter((entity) => { try { return Boolean(domain(entity.officialUrl)); } catch { return false; } }).length,
    withAutomatedFirstPartySource: entities.filter((entity) => Boolean(entity.entityId && automated.has(entity.entityId))).length,
    byRegion: count(entities.map((entity) => entity.region)).map(({ key, value }) => ({ region: key, count: value })),
    byRoute: count(entities.flatMap((entity) => entity.routes)).map(({ key, value }) => ({ route: key, count: value })),
  };
}

export function formatEntityCoverage(coverage: EntityCoverage, updatedAt = new Date()): string {
  const percent = coverage.total ? Math.round(coverage.withAutomatedFirstPartySource / coverage.total * 100) : 0;
  return [
    "# 实体与一手信源覆盖", "",
    "本页只统计已经确认官网的正式实体；自动发现的候选公司不会计入覆盖率。", "",
    `- 正式实体：**${coverage.total}**（公司 ${coverage.companies}、实验室 ${coverage.labs}）`,
    `- 官网覆盖：**${coverage.withOfficialDomain}/${coverage.total}**`,
    `- 自动化一手源覆盖：**${coverage.withAutomatedFirstPartySource}/${coverage.total}（${percent}%）**`, "",
    "## 地区", "", ...coverage.byRegion.map((item) => `- ${item.region}：${item.count}`), "",
    "## 技术路线", "", ...coverage.byRoute.map((item) => `- ${item.route}：${item.count}`), "",
    `*更新时间：${updatedAt.toISOString().slice(0, 10)}*`, "",
  ].join("\n");
}
