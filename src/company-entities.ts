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
function domain(value?: string): string | undefined { try { return value ? new URL(value).hostname.replace(/^www\./, "") : undefined; } catch { return undefined; } }
function plausibleCandidateName(value: string): boolean {
  if (value.length < 2 || value.length > 48) return false;
  if (/[：:，,。！？?；;]/.test(value)) return false;
  if (/融资|投资|收购|宣布|完成|获得|走出隐身|初创公司|创业公司|一家|这家|宣称|旗下/i.test(value)) return false;
  return /[\p{Script=Han}A-Za-z]/u.test(value);
}

/** Build an auditable identity graph. A candidate can become review-ready but
 * never silently becomes a public CompanyProfile. */
export function updateCompanyEntityRegistry(existing: CompanyEntityRegistry | undefined, profiles: CompanyProfile[], candidates: CandidateCompanyRegistry, now = new Date()): CompanyEntityRegistry {
  const previous = new Map((existing?.entities ?? []).map((entity) => [entity.id, entity]));
  // Rebuild from authoritative profiles plus the current candidate registry.
  // Historical candidate nodes are deliberately not carried forward: this
  // makes entity cleanup deterministic and prevents headline fragments from
  // becoming permanent graph nodes.
  const entities: CompanyEntity[] = [];
  for (const profile of profiles) {
    const id = stableId(profile);
    const prior = previous.get(id);
    const evidence = (profile.profileEvidence ?? []).map((item) => ({ link: item.link, source: item.source, publishedAt: item.checkedAt, supports: item.supports }));
    const officialDomain = domain(profile.officialUrl);
    entities.push({
      id, entityType: profile.entityType ?? "公司", name: profile.name, legalName: profile.legalName,
      aliases: [...new Set([profile.name, ...(profile.aliases ?? [])])], officialUrl: profile.officialUrl,
      officialDomains: [...new Set([...(profile.officialDomains ?? []), ...(officialDomain ? [officialDomain] : [])])],
      sourceIds: [...new Set(profile.sourceIds ?? [])], products: [...new Set(profile.products ?? [])],
      region: profile.region, stage: profile.stage, routes: [...profile.routes], status: "已建档",
      firstSeenAt: prior?.firstSeenAt ?? now.toISOString(), lastSeenAt: now.toISOString(),
      evidence: [...(prior?.status === "已建档" ? prior.evidence : []), ...evidence].filter((item, index, all) => all.findIndex((other) => other.link === item.link) === index),
      promotion: { eligibleForReview: false, reasons: ["已进入人工维护的公开实体档案。"] },
    });
  }
  for (const candidate of candidates.companies) {
    if (!plausibleCandidateName(candidate.name)) continue;
    let entity = entities.find((item) => sameEntity(item, candidate.name, candidate.aliases));
    const evidence = candidate.evidence.map((item) => ({ link: item.link, source: item.source, publishedAt: item.publishedAt, supports: item.title }));
    if (entity) {
      entity.aliases = [...new Set([...entity.aliases, ...candidate.aliases.filter(plausibleCandidateName)])];
      entity.routes = [...new Set([...entity.routes, ...candidate.routes])];
      for (const item of evidence) if (!entity.evidence.some((saved) => saved.link === item.link)) entity.evidence.push(item);
      entity.lastSeenAt = candidate.lastSeenAt;
      continue;
    }
    const status = candidate.status === "已入库" ? "已建档" : candidate.status;
    const officialDomain = domain(candidate.officialUrl);
    entities.push({ id: candidate.id.replace(/^candidate-/, "company-"), entityType: "公司", name: candidate.name, aliases: [...candidate.aliases.filter(plausibleCandidateName)], officialUrl: candidate.officialUrl, officialDomains: officialDomain ? [officialDomain] : [], sourceIds: [], products: [], routes: [...candidate.routes], status, firstSeenAt: candidate.firstSeenAt, lastSeenAt: candidate.lastSeenAt, evidence, promotion: { eligibleForReview: candidate.status === "已交叉核验", reasons: candidate.status === "已交叉核验" ? ["融资主体已具备官网或多源交叉证据；等待人工建档。"] : ["尚未满足公开公司档案的证据门槛。"] } });
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
