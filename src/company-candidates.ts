import { createHash } from "node:crypto";
import { normalizeUrl } from "./filter.js";
import type { Article, CandidateCompany, CandidateCompanyRegistry, CompanyProfile, TechnicalRoute } from "./types.js";

const GENERIC = /^(?:行业公司|机器人公司|具身智能公司|人形机器人公司|公司|融资周报|机器人)$/i;
const FUNDING = /融资|投资|收购|估值|funding|raises?|raised|seed|series\s+[a-d]|acquisition|valuation/i;
const TECH = /robot|robotics|humanoid|embodied|physical ai|vla|world model|具身|机器人|人形/i;

function entity(article: Article): string | undefined {
  const title = (article.titleZh ?? article.title).replace(/\s*[-—|｜].*$/, "").trim();
  const chinese = title.match(/^(.{2,34}?)(?:完成|获得|获|宣布|启动).{0,28}?(?:融资|投资|收购|估值)/)?.[1];
  const english = title.match(/^(.{2,50}?)\s+(?:raises?|raised|completes?|secured|lands?)\b/i)?.[1];
  const value = (chinese ?? english)?.replace(/^(?:一家|这家|某家)/, "").trim();
  return value && !GENERIC.test(value) ? value : undefined;
}
function routes(article: Article): TechnicalRoute[] {
  const text = `${article.title} ${article.titleZh ?? ""} ${article.excerpt} ${article.summaryZh ?? ""}`.toLowerCase();
  const output = new Set<TechnicalRoute>();
  if (/vla|vision-language-action|policy|具身模型/.test(text)) output.add("VLA 与具身模型");
  if (/world model|spatial|cosmos|世界模型|空间智能/.test(text)) output.add("世界模型与空间智能");
  if (/humanoid|actuator|robot hardware|人形|本体|触觉/.test(text)) output.add("本体与硬件");
  if (/dataset|training|teleoperation|数据集|训练|遥操作/.test(text)) output.add("数据与训练");
  if (/deploy|customer|factory|commercial|部署|客户|工厂|商业化/.test(text)) output.add("部署与商业化");
  return output.size ? [...output] : ["部署与商业化"];
}
function domain(link: string): string { try { return new URL(link).hostname.replace(/^www\./, ""); } catch { return link; } }
function normalized(value: string): string { return value.toLowerCase().replace(/[\s\-_.，,。()（）]/g, ""); }
function profileFor(name: string, profiles: CompanyProfile[]): CompanyProfile | undefined {
  const target = normalized(name);
  return profiles.find((profile) => [profile.name, ...(profile.aliases ?? [])].some((alias) => normalized(alias) === target));
}
function officialEvidence(company: CandidateCompany): boolean {
  if (!company.officialUrl) return false;
  const officialDomain = domain(company.officialUrl);
  return company.evidence.some((item) => domain(item.link) === officialDomain || domain(item.link).endsWith(`.${officialDomain}`));
}
function score(company: CandidateCompany): number {
  const domains = new Set(company.evidence.map((item) => domain(item.link)));
  const evidenceScore = Math.min(35, Math.max(...company.evidence.map((item) => item.sourceWeight * 3), 0));
  const crossSource = domains.size >= 2 ? 35 : 0;
  const titleSignal = company.evidence.some((item) => /\$\s*\d+|\d+(?:\.\d+)?(?:亿|万)(?:美元|元)|seed|series\s+[a-d]|a\+轮|b轮/i.test(item.title)) ? 10 : 0;
  const official = officialEvidence(company) ? 60 : 0;
  return Math.min(100, evidenceScore + crossSource + titleSignal + (company.routes.length ? 10 : 0) + official);
}
function status(company: CandidateCompany): CandidateCompany["status"] {
  if (officialEvidence(company) && company.verificationScore >= 70) return "已交叉核验";
  if (company.verificationScore >= 55) return "观察中";
  return "候选";
}

/** Merge financing leads into an internal dossier. It deliberately does not promote a company to events/companies.json. */
export function updateCandidateCompanies(existing: CandidateCompanyRegistry | undefined, articles: Article[], now = new Date(), profiles: CompanyProfile[] = []): CandidateCompanyRegistry {
  const companies = [...(existing?.companies ?? [])].map((company) => ({ ...company, aliases: [...company.aliases], routes: [...company.routes], evidence: [...company.evidence], openQuestions: [...company.openQuestions] }));
  for (const article of articles.filter((item) => item.kind === "投融资" && FUNDING.test(`${item.title} ${item.titleZh ?? ""}`) && TECH.test(`${item.title} ${item.titleZh ?? ""} ${item.excerpt}`))) {
    const extractedName = entity(article); if (!extractedName) continue;
    const knownProfile = profileFor(extractedName, profiles);
    const name = knownProfile?.name ?? extractedName;
    const key = normalized(name);
    let company = companies.find((item) => item.aliases.some((alias) => normalized(alias) === key));
    if (!company) {
      company = { id: `candidate-${createHash("sha256").update(key).digest("hex").slice(0, 12)}`, name, aliases: [...new Set([name, extractedName, ...(knownProfile?.aliases ?? [])])], status: "候选", verificationScore: 0, routes: [], officialUrl: knownProfile?.officialUrl, firstSeenAt: now.toISOString(), lastSeenAt: now.toISOString(), evidence: [], openQuestions: [] };
      companies.push(company);
    }
    const evidence = { link: article.link, source: article.source, sourceWeight: article.sourceWeight, publishedAt: article.publishedAt.toISOString(), title: article.titleZh ?? article.title };
    if (!company.evidence.some((item) => normalizeUrl(item.link) === normalizeUrl(evidence.link))) company.evidence.push(evidence);
    company.routes = [...new Set([...company.routes, ...routes(article)])];
    if (!company.officialUrl && /^(?:https?:)?\/\//.test(article.link) && normalized(article.title).includes(normalized(company.name))) company.officialUrl = new URL(article.link).origin;
    company.lastSeenAt = now.toISOString();
    company.verificationScore = score(company);
    company.status = status(company);
    company.openQuestions = company.status === "已交叉核验" ? ["已具备官网或多源融资证据；仍需人工确认主营方向后，才写入公开公司地图。"] : ["需要公司官网/投资方公告，或第二个独立媒体来源确认融资事实与主体。"];
  }
  return { updatedAt: now.toISOString(), companies: companies.sort((a, b) => b.verificationScore - a.verificationScore || b.lastSeenAt.localeCompare(a.lastSeenAt)) };
}

export function formatCandidateCompanyReview(registry: CandidateCompanyRegistry): string {
  const lines = ["# 候选公司核验队列", "", "内部观察层：不会进入首页、公司地图或融资列表。", ""];
  if (!registry.companies.length) return [...lines, "暂无融资候选公司。"].join("\n");
  for (const company of registry.companies) lines.push(`## ${company.name} · ${company.status} · ${company.verificationScore}/100`, "", `- 路线：${company.routes.join(" · ")}`, `- 证据：${company.evidence.map((item) => `[${item.source}](${item.link})`).join(" · ")}`, `- 待核验：${company.openQuestions.join("；")}`, "");
  return lines.join("\n");
}
