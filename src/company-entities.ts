import { createHash } from "node:crypto";
import type { CandidateCompanyRegistry, CompanyEntity, CompanyEntityRegistry, CompanyProfile } from "./types.js";

function stableId(profile: Pick<CompanyProfile, "name" | "officialUrl" | "entityId">): string {
  return profile.entityId ?? `company-${createHash("sha256").update(profile.officialUrl || profile.name).digest("hex").slice(0, 12)}`;
}
function normalized(value: string): string { return value.toLowerCase().replace(/[\s\-_.，,。()（）]/g, ""); }
function sameEntity(entity: CompanyEntity, name: string, aliases: string[]): boolean {
  const needles = [name, ...aliases].map(normalized);
  return entity.aliases.some((alias) => needles.includes(normalized(alias))) || needles.includes(normalized(entity.name));
}

/** Build an auditable identity graph. A candidate can become review-ready but
 * never silently becomes a public CompanyProfile. */
export function updateCompanyEntityRegistry(existing: CompanyEntityRegistry | undefined, profiles: CompanyProfile[], candidates: CandidateCompanyRegistry, now = new Date()): CompanyEntityRegistry {
  const entities = [...(existing?.entities ?? [])].map((entity) => ({ ...entity, aliases: [...entity.aliases], routes: [...entity.routes], evidence: [...entity.evidence], promotion: { ...entity.promotion, reasons: [...entity.promotion.reasons] } }));
  for (const profile of profiles) {
    const id = stableId(profile);
    let entity = entities.find((item) => item.id === id || sameEntity(item, profile.name, profile.aliases ?? []));
    const evidence = (profile.profileEvidence ?? []).map((item) => ({ link: item.link, source: item.source, publishedAt: item.checkedAt, supports: item.supports }));
    if (!entity) {
      entity = { id, name: profile.name, aliases: [...new Set([profile.name, ...(profile.aliases ?? [])])], officialUrl: profile.officialUrl, region: profile.region, routes: [...profile.routes], status: "已建档", firstSeenAt: now.toISOString(), lastSeenAt: now.toISOString(), evidence, promotion: { eligibleForReview: false, reasons: ["已进入人工维护的公开公司档案。"] } };
      entities.push(entity);
      continue;
    }
    entity.name = profile.name;
    entity.aliases = [...new Set([...entity.aliases, profile.name, ...(profile.aliases ?? [])])];
    entity.officialUrl = profile.officialUrl;
    entity.region = profile.region;
    entity.routes = [...new Set([...entity.routes, ...profile.routes])];
    entity.status = "已建档";
    entity.lastSeenAt = now.toISOString();
    for (const item of evidence) if (!entity.evidence.some((saved) => saved.link === item.link)) entity.evidence.push(item);
    entity.promotion = { eligibleForReview: false, reasons: ["已进入人工维护的公开公司档案。"] };
  }
  for (const candidate of candidates.companies) {
    let entity = entities.find((item) => sameEntity(item, candidate.name, candidate.aliases));
    const evidence = candidate.evidence.map((item) => ({ link: item.link, source: item.source, publishedAt: item.publishedAt, supports: item.title }));
    if (entity) {
      entity.aliases = [...new Set([...entity.aliases, ...candidate.aliases])];
      entity.routes = [...new Set([...entity.routes, ...candidate.routes])];
      for (const item of evidence) if (!entity.evidence.some((saved) => saved.link === item.link)) entity.evidence.push(item);
      entity.lastSeenAt = candidate.lastSeenAt;
      continue;
    }
    const status = candidate.status === "已入库" ? "已建档" : candidate.status;
    entities.push({ id: candidate.id.replace(/^candidate-/, "company-"), name: candidate.name, aliases: [...candidate.aliases], officialUrl: candidate.officialUrl, routes: [...candidate.routes], status, firstSeenAt: candidate.firstSeenAt, lastSeenAt: candidate.lastSeenAt, evidence, promotion: { eligibleForReview: candidate.status === "已交叉核验", reasons: candidate.status === "已交叉核验" ? ["融资主体已具备官网或多源交叉证据；等待人工建档。"] : ["尚未满足公开公司档案的证据门槛。"] } });
  }
  return { updatedAt: now.toISOString(), entities: entities.sort((a, b) => a.name.localeCompare(b.name, "zh-CN")) };
}

export function formatCompanyEntityReview(registry: CompanyEntityRegistry): string {
  const reviewable = registry.entities.filter((entity) => entity.promotion.eligibleForReview);
  const lines = ["# 公司实体晋升队列", "", "内部审阅层：仅展示满足交叉证据门槛、但尚未人工建档的公司。不会自动写入首页、公司地图或融资列表。", ""];
  if (!reviewable.length) return [...lines, "当前没有待晋升公司实体。"].join("\n");
  for (const entity of reviewable) lines.push(`## ${entity.name} · ${entity.status}`, "", `- 别名：${entity.aliases.join(" · ")}`, `- 路线：${entity.routes.join(" · ") || "待确认"}`, `- 证据：${entity.evidence.map((item) => `[${item.source}](${item.link})`).join(" · ")}`, `- 下一步：${entity.promotion.reasons.join("；")}`, "");
  return lines.join("\n");
}
