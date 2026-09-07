import { buildCompanyClaimLedger } from "../src/company-claim-ledger.js";
import type { CoverageVersion } from "../src/core-coverage/contracts.js";
import type { CompanyProfile, EventRecord } from "../src/types.js";

export const NOW = new Date("2026-09-06T01:00:00Z");
export const company: CompanyProfile = {
  entityId: "alpha", entityType: "公司", name: "Alpha Robotics", officialUrl: "https://alpha.example", region: "北美", routes: [], thesis: "机器人研究",
  profileEvidence: [{ link: "https://alpha.example/about", source: "Alpha", supports: "Alpha Robotics 主体身份与机器人研究", checkedAt: "2026-09-01T00:00:00Z" }],
};
export function event(type: "funding" | "deployment" | "product" = "deployment", overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: `event-${type}`, title: "不可直接使用的营销摘要：全球领先", type: type === "funding" ? "投融资" : type === "product" ? "产品发布" : "部署案例",
    primaryEntity: company.name, entities: [company.name], routes: [], status: "已确证", occurredAt: "2026-08-20T00:00:00Z", eventDate: "2026-08-20", dateSource: "explicit", dateConfidence: "high",
    firstSeenAt: "2026-08-20T00:00:00Z", lastEvidenceAt: "2026-08-20T00:00:00Z", lastMaterialChangeAt: "2026-08-20T00:00:00Z", lastUpdatedAt: "2026-08-20T00:00:00Z", lastVerifiedAt: "2026-09-01T00:00:00Z", facts: [], openQuestions: [], timeline: [],
    ...(type === "funding" ? { funding: { entityStatus: "已确认", round: "Seed", amount: "1200 万美元", investors: [] } } : { productDeployment: { product: "Robot One", customers: [], ...(type === "deployment" ? { deployment: "工厂测试" } : {}) } }),
    evidence: [{ link: `https://alpha.example/${type}`, source: "Alpha", grade: "A", publishedAt: "2026-08-21T00:00:00Z", supports: type === "funding" ? "事件日期 2026-08-20；轮次 Seed；金额 1200 万美元" : "事件日期 2026-08-20；产品 Robot One；部署 工厂测试" }],
    ...overrides,
  };
}
export const coverage: CoverageVersion = { schemaVersion: 1, version: "2026-Q3", effectiveFrom: "2026-09-01", previousVersion: null, changeReasonZh: "研究覆盖", members: [{ companyId: "alpha", coverageRegion: "north-america", tier: "commercial", ownerRole: "maintainer", reasonZh: "研究机器人验证" }] };
export function fixture(events: EventRecord[] = [event()], companies: CompanyProfile[] = [company]) {
  const ledger = buildCompanyClaimLedger(companies, events, { now: NOW, coverageCompanyIds: companies.map((item) => item.entityId!) });
  return { coverage, companies, ledger, events, now: NOW };
}
