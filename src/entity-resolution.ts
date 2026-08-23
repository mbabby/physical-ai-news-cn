import type { Article, CompanyProfile, EventRecord } from "./types.js";

export type EntityResolutionMethod = "subject-exact" | "ambiguous" | "unresolved";
export type EntityDisposition = "public" | "review";

export interface EntityResolution {
  canonicalSubject?: string;
  mentionedEntities: string[];
  confidence: number;
  method: EntityResolutionMethod;
  disposition: EntityDisposition;
  reviewReason?: "subject-not-in-catalog" | "subject-ambiguous" | "subject-not-found";
}

export const DEFAULT_COMPANY_IDENTITIES: Record<string, string[]> = {
  Tesla: ["tesla", "optimus"], NVIDIA: ["nvidia"], "Google DeepMind": ["google deepmind", "gemini robotics", "google robotics"], Meta: ["meta ai", "meta robotics"],
  Figure: ["figure ai", "figure robot", "figure 02", "figure 03", "helix"], "Physical Intelligence": ["physical intelligence"], "World Labs": ["world labs"],
  "1X": ["1x technologies", "1x humanoid"], Apptronik: ["apptronik", "apollo humanoid"], "Agility Robotics": ["agility robotics", "digit robot"], "Sanctuary AI": ["sanctuary ai"], Skild: ["skild ai"], Dexterity: ["dexterity ai"], "Boston Dynamics": ["boston dynamics"],
  "宇树科技": ["unitree", "宇树"], "优必选": ["ubtech", "优必选"], "智元机器人": ["智元机器人", "agibot"], "银河通用": ["galbot", "银河通用"], "星海图": ["星海图", "galaxea", "galaxea ai"], "众擎机器人": ["engineai", "众擎"], "傅利叶智能": ["fourier intelligence", "傅利叶"], "逐际动力": ["limx dynamics", "逐际"], "松延动力": ["noetix", "松延"], "魔法原子": ["magiclab", "魔法原子"], "乐聚机器人": ["leju robot", "乐聚"], "NEURA Robotics": ["neura robotics"], ANYbotics: ["anybotics"],
};

const GENERIC_SUBJECT = /^(?:humanoid|humanoid robots?|robotics?|robots?|robot company|机器人公司|人形机器人(?:公司)?|具身智能公司|行业公司|公司)$/iu;
const ROUNDUP = /(?:roundup|weekly|review|companies to watch|market (?:report|outlook)|盘点|周报|观察|市场(?:报告|展望))/iu;

function normalized(value: string): string {
  return value.toLowerCase().normalize("NFKC").replace(/[“”'‘’]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function identities(companies: CompanyProfile[]): Record<string, string[]> {
  const result: Record<string, string[]> = Object.fromEntries(Object.entries(DEFAULT_COMPANY_IDENTITIES).map(([name, aliases]) => [name, [...aliases]]));
  for (const company of companies) result[company.name] = [...new Set([company.name, company.legalName ?? "", ...(result[company.name] ?? []), ...(company.aliases ?? [])].filter(Boolean))];
  return result;
}

function aliasPattern(alias: string): RegExp {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return /^[\x00-\x7F]+$/.test(alias) ? new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu") : new RegExp(escaped, "iu");
}

function exactIdentity(subject: string, catalog: Record<string, string[]>): string[] {
  const key = normalized(subject);
  return Object.entries(catalog).filter(([name, aliases]) => [name, ...aliases].some((alias) => {
    const identity = normalized(alias);
    if (identity === key) return true;
    // A company may be followed by its product in a possessive subject, e.g.
    // “Google DeepMind 的 Gemini Robotics VLA”. The owner must still be the
    // leading exact identity; arbitrary trailing prose is not accepted.
    return normalized(subject).startsWith(`${identity} 的 `) || normalized(subject).startsWith(`${identity} 旗下 `);
  })).map(([name]) => name);
}

function titleMentions(title: string, catalog: Record<string, string[]>): string[] {
  return Object.entries(catalog).filter(([, aliases]) => aliases.some((alias) => {
    if (GENERIC_SUBJECT.test(alias)) return false;
    return aliasPattern(alias).test(title);
  })).map(([name]) => name);
}

export function findMentionedEntities(value: string, companies: CompanyProfile[] = []): string[] {
  return titleMentions(value, identities(companies));
}

function grammaticalSubject(title: string): string | undefined {
  const clean = title.replace(/\s+[-—|｜]\s+[^-—|｜]+$/, "").trim();
  if (ROUNDUP.test(clean)) return undefined;
  const patterns = [
    /^(.{1,64}?)(?:\s+(?:raises?|raised|launches?|launched|releases?|released|deploys?|deployed|ships?|shipped|unveils?|unveiled|announces?|announced|acquires?|acquired|secures?|secured|lands?|landed|gets?|begins?|plans?|explains?|discusses?|expands?|builds?)\b)/iu,
    /^(.{1,40}?)(?:完成|获得|获|宣布|发布|推出|部署|交付|启用|签约|量产|计划|收购|融资|估值|将于|将在|正|拟)/u,
    /^([^：:]{1,40})[：:]/u,
  ];
  for (const pattern of patterns) {
    const candidate = clean.match(pattern)?.[1]?.replace(/^(?:一家|这家|某家)/u, "").trim();
    if (candidate && (!GENERIC_SUBJECT.test(candidate) || candidate === "Humanoid")) return candidate;
  }
  return undefined;
}

export function resolveTitleEntity(title: string, companies: CompanyProfile[] = []): EntityResolution {
  const catalog = identities(companies);
  const subject = grammaticalSubject(title);
  const mentioned = titleMentions(title, catalog);
  if (!subject) return { mentionedEntities: mentioned, confidence: 0, method: mentioned.length > 1 ? "ambiguous" : "unresolved", disposition: "review", reviewReason: mentioned.length > 1 ? "subject-ambiguous" : "subject-not-found" };
  const matches = exactIdentity(subject, catalog);
  if (matches.length === 1) return { canonicalSubject: matches[0], mentionedEntities: mentioned.filter((name) => name !== matches[0]), confidence: 1, method: "subject-exact", disposition: "public" };
  return { mentionedEntities: mentioned, confidence: 0, method: matches.length > 1 ? "ambiguous" : "unresolved", disposition: "review", reviewReason: matches.length > 1 ? "subject-ambiguous" : "subject-not-in-catalog" };
}

export function resolveArticleEntity(article: Pick<Article, "title" | "titleZh">, companies: CompanyProfile[] = []): EntityResolution {
  const titles = [article.titleZh, article.title].filter(Boolean) as string[];
  const resolutions = titles.map((title) => resolveTitleEntity(title, companies));
  const publicMatches = [...new Set(resolutions.map((item) => item.canonicalSubject).filter(Boolean) as string[])];
  const mentionedEntities = [...new Set(resolutions.flatMap((item) => item.mentionedEntities).filter((name) => !publicMatches.includes(name)))];
  if (publicMatches.length === 1) return { canonicalSubject: publicMatches[0], mentionedEntities, confidence: 1, method: "subject-exact", disposition: "public" };
  return { mentionedEntities: [...new Set([...mentionedEntities, ...publicMatches])], confidence: 0, method: publicMatches.length > 1 ? "ambiguous" : "unresolved", disposition: "review", reviewReason: publicMatches.length > 1 ? "subject-ambiguous" : resolutions.find((item) => item.reviewReason)?.reviewReason ?? "subject-not-found" };
}

export function resolveStoredEventEntity(event: Pick<EventRecord, "title" | "sourceTitle">, companies: CompanyProfile[] = []): EntityResolution {
  return resolveArticleEntity({ title: event.sourceTitle ?? event.title, titleZh: event.title }, companies);
}
