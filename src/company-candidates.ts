import { createHash } from "node:crypto";
import { normalizeUrl } from "./filter.js";
import type { Article, CandidateCompany, CandidateCompanyRegistry, CompanyProfile, TechnicalRoute } from "./types.js";

const GENERIC = /^(?:行业公司|机器人公司|具身智能公司|人形机器人公司|公司|融资周报|机器人)$/i;
const DESCRIPTIVE_SUBJECT = /(?:孵化|旗下|一家|这家|某家).{0,12}(?:初创公司|初创企业|创业公司|机器人公司)$|产业园|园区|基金|政府|揭牌|融资买入|ETF|总投资/i;
const FUNDING = /融资|投资|收购|估值|funding|raises?|raised|seed|series\s+[a-d]|acquisition|valuation/i;
const TECH = /robot|robotics|humanoid|embodied|physical ai|vla|world model|具身|机器人|人形/i;

function cleanedEntityName(value: string): string | undefined {
  let name = value
    .replace(/^(?:一家|这家|某家)/, "")
    .replace(/^(?:中国\s*)?(?:机器人|人形机器人|具身智能)\s*(?:初创公司|创业公司|公司)\s*/i, "")
    .replace(/^(?:chinese\s+)?(?:robotics?|humanoid|embodied\s+ai)\s+(?:startup|company)\s+/i, "")
    .replace(/[，,:：；;]+$/, "")
    .trim();
  // A translated headline may contain a descriptive clause before a clear
  // Latin company name. Prefer the explicit proper noun over the whole clause.
  const latinNames = [...name.matchAll(/\b([A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*){1,3})\b/g)];
  const latin = latinNames.at(-1)?.[1];
  if (latin && /(?:Robotics|Robot|AI|Labs|Integrity|Dynamics|Automation)$/i.test(latin)) name = latin;
  if (!name || GENERIC.test(name) || DESCRIPTIVE_SUBJECT.test(name)) return undefined;
  return name;
}
function entity(article: Article): string | undefined {
  const title = (article.titleZh ?? article.title).replace(/\s*[-—|｜].*$/, "").trim();
  const chinese = title.match(/^(.{2,40}?)(?:(?:完成|获得|获|宣布|启动).{0,28}?)?(?:融资|投资|收购|估值)/)?.[1];
  const english = title.match(/^(.{2,50}?)\s+(?:raises?|raised|completes?|secured|lands?)\b/i)?.[1];
  return cleanedEntityName(chinese ?? english ?? "");
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
function sameCompanyName(left: string, right: string): boolean {
  const a = normalized(left); const b = normalized(right);
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b; const longer = a.length > b.length ? a : b;
  return shorter.length >= 7 && (longer.startsWith(shorter) || longer.endsWith(shorter));
}
function nameQuality(value: string): number {
  let quality = 100 - value.length;
  if (/融资|投资|收购|初创公司|旗下|远程操控|走出隐身/.test(value)) quality -= 60;
  if (/^[A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*){1,3}$/.test(value)) quality += 12;
  return quality;
}
function publisher(title: string): string | undefined {
  const value = title.match(/\s[-–—|]\s([^|–—]{2,80})$/)?.[1]?.trim();
  return value && !/robotics|funding|physical ai/i.test(value) ? value : undefined;
}
function evidenceOrigin(item: CandidateCompany["evidence"][number]): string {
  if (/news\.google\.com/i.test(item.link) && item.publisher) return `publisher:${normalized(item.publisher)}`;
  return `domain:${domain(item.link)}`;
}
function profileFor(name: string, profiles: CompanyProfile[]): CompanyProfile | undefined {
  return profiles.find((profile) => [profile.name, ...(profile.aliases ?? [])].some((alias) => sameCompanyName(alias, name)));
}
function domainLooksOfficialFor(name: string, link: string): boolean {
  const compact = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return compact.length >= 4 && domain(link).replace(/[^a-z0-9]/g, "").includes(compact);
}
function officialEvidence(company: CandidateCompany): boolean {
  if (!company.officialUrl) return false;
  const officialDomain = domain(company.officialUrl);
  return company.evidence.some((item) => domain(item.link) === officialDomain || domain(item.link).endsWith(`.${officialDomain}`));
}
function score(company: CandidateCompany): number {
  const origins = new Set(company.evidence.map(evidenceOrigin));
  const evidenceScore = Math.min(35, Math.max(...company.evidence.map((item) => item.sourceWeight * 3), 0));
  // Publisher labels from Google News count only inside the private review
  // queue. They can move a lead to observation, but status() still requires
  // official-domain evidence before it becomes cross-verified.
  const crossSource = origins.size >= 2 ? 35 : 0;
  const titleSignal = company.evidence.some((item) => /\$\s*\d+|\d+(?:\.\d+)?(?:亿|万)(?:美元|元)|seed|series\s+[a-d]|a\+轮|b轮/i.test(item.title)) ? 10 : 0;
  const official = officialEvidence(company) ? 60 : 0;
  return Math.min(100, evidenceScore + crossSource + titleSignal + (company.routes.length ? 10 : 0) + official);
}

function mergeCompany(target: CandidateCompany, incoming: CandidateCompany): void {
  if (nameQuality(incoming.name) > nameQuality(target.name)) target.name = incoming.name;
  target.aliases = [...new Set([...target.aliases, ...incoming.aliases, incoming.name])];
  target.routes = [...new Set([...target.routes, ...incoming.routes])];
  target.officialUrl ??= incoming.officialUrl;
  target.firstSeenAt = target.firstSeenAt < incoming.firstSeenAt ? target.firstSeenAt : incoming.firstSeenAt;
  target.lastSeenAt = target.lastSeenAt > incoming.lastSeenAt ? target.lastSeenAt : incoming.lastSeenAt;
  for (const item of incoming.evidence) {
    const saved = target.evidence.find((evidence) => normalizeUrl(evidence.link) === normalizeUrl(item.link));
    if (saved) saved.publisher ??= item.publisher;
    else target.evidence.push(item);
  }
}

function compactCompanies(input: CandidateCompany[]): CandidateCompany[] {
  const output: CandidateCompany[] = [];
  for (const company of input) {
    const cleaned = cleanedEntityName(company.name);
    if (!cleaned) continue;
    if (cleaned !== company.name) {
      company.aliases = [...new Set([...company.aliases, company.name, cleaned])];
      company.name = cleaned;
    }
    const evidenceLinks = new Set(company.evidence.map((item) => normalizeUrl(item.link)));
    const existing = output.find((item) =>
      [item.name, ...item.aliases].some((left) => [company.name, ...company.aliases].some((right) => sameCompanyName(left, right)))
      || item.evidence.some((evidence) => evidenceLinks.has(normalizeUrl(evidence.link)))
    );
    if (existing) mergeCompany(existing, company); else output.push(company);
  }
  return output;
}
function status(company: CandidateCompany): CandidateCompany["status"] {
  if (officialEvidence(company) && company.verificationScore >= 70) return "已交叉核验";
  if (company.verificationScore >= 55) return "观察中";
  return "候选";
}

/** Merge financing leads into an internal dossier. It deliberately does not promote a company to events/companies.json. */
export function updateCandidateCompanies(existing: CandidateCompanyRegistry | undefined, articles: Article[], now = new Date(), profiles: CompanyProfile[] = []): CandidateCompanyRegistry {
  const companies = compactCompanies([...(existing?.companies ?? [])].map((company) => ({ ...company, aliases: [...company.aliases], routes: [...company.routes], evidence: company.evidence.map((item) => ({ ...item })), openQuestions: [...company.openQuestions] })));
  for (const article of articles.filter((item) => item.kind === "投融资" && FUNDING.test(`${item.title} ${item.titleZh ?? ""}`) && TECH.test(`${item.title} ${item.titleZh ?? ""} ${item.excerpt}`))) {
    const extractedName = entity(article); if (!extractedName) continue;
    const knownProfile = profileFor(extractedName, profiles);
    const name = knownProfile?.name ?? extractedName;
    const key = normalized(name);
    let company = companies.find((item) => [item.name, ...item.aliases].some((alias) => sameCompanyName(alias, name)));
    if (!company) {
      company = { id: `candidate-${createHash("sha256").update(key).digest("hex").slice(0, 12)}`, name, aliases: [...new Set([name, extractedName, ...(knownProfile?.aliases ?? [])])], status: "候选", verificationScore: 0, routes: [], officialUrl: knownProfile?.officialUrl, firstSeenAt: now.toISOString(), lastSeenAt: now.toISOString(), evidence: [], openQuestions: [] };
      companies.push(company);
    }
    const evidence = { link: article.link, source: article.source, sourceWeight: article.sourceWeight, publishedAt: article.publishedAt.toISOString(), title: article.titleZh ?? article.title, publisher: publisher(article.title) };
    const saved = company.evidence.find((item) => normalizeUrl(item.link) === normalizeUrl(evidence.link));
    if (saved) saved.publisher ??= evidence.publisher; else company.evidence.push(evidence);
    company.routes = [...new Set([...company.routes, ...routes(article)])];
    if (!company.officialUrl && domainLooksOfficialFor(company.name, article.link)) company.officialUrl = new URL(article.link).origin;
    company.lastSeenAt = now.toISOString();
  }
  for (const company of companies) {
    company.verificationScore = score(company);
    company.status = status(company);
    company.openQuestions = company.status === "已交叉核验" ? ["已具备官网或多源融资证据；仍需人工确认主营方向后，才写入公开公司地图。"] : company.status === "观察中" ? ["已有多个独立媒体线索；仍需公司官网、投资方公告或监管披露完成一手核验。"] : ["需要公司官网/投资方公告，或第二个独立媒体来源确认融资事实与主体。"];
  }
  return { updatedAt: now.toISOString(), companies: companies.sort((a, b) => b.verificationScore - a.verificationScore || b.lastSeenAt.localeCompare(a.lastSeenAt)) };
}

export function formatCandidateCompanyReview(registry: CandidateCompanyRegistry): string {
  const lines = ["# 候选公司核验队列", "", "内部观察层：不会进入首页、公司地图或融资列表。", ""];
  if (!registry.companies.length) return [...lines, "暂无融资候选公司。"].join("\n");
  for (const company of registry.companies) {
    const query = encodeURIComponent(`"${company.name}" (融资 OR funding OR raises OR investment)`);
    const officialQuery = encodeURIComponent(`"${company.name}" official investors funding`);
    lines.push(`## ${company.name} · ${company.status} · ${company.verificationScore}/100`, "", `- 路线：${company.routes.join(" · ")}`, `- 证据：${company.evidence.map((item) => `[${item.publisher ?? item.source}](${item.link})`).join(" · ")}`, `- 核验入口：[媒体交叉检索](https://www.google.com/search?q=${query}) · [官网 / 投资方检索](https://www.google.com/search?q=${officialQuery})${company.officialUrl ? ` · [候选官网](${company.officialUrl})` : ""}`, `- 待核验：${company.openQuestions.join("；")}`, "");
  }
  return lines.join("\n");
}
