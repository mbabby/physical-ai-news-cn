export type ArticleKind = "投融资" | "产品发布" | "公司商业" | "部署案例" | "开源项目" | "研究与数据";
export type PulseKind = "人物观点" | "关键事件";

export interface Article {
  id: string;
  title: string;
  link: string;
  publishedAt: Date;
  fetchedAt: Date;
  source: string;
  sourceWeight: number;
  excerpt: string;
  kind?: ArticleKind;
  tags: string[];
  /** arXiv/Atom author metadata, retained for research authority ranking. */
  authors?: string[];
  scholar?: ScholarlyMetadata;
  titleZh?: string;
  summaryZh?: string;
  score?: number;
  pulseKind?: PulseKind;
  speaker?: string;
}

export interface ScholarlyAuthor {
  name: string;
  totalCitations?: number;
  hIndex?: number;
  institutions: string[];
}

/** Enriched from a scholarly graph only after a conservative work match. */
export interface ScholarlyMetadata {
  provider: "OpenAlex";
  workId: string;
  citedByCount: number;
  isRetracted: boolean;
  institutions: string[];
  authors: ScholarlyAuthor[];
  checkedAt: string;
}

interface BaseSourceConfig {
  name: string;
  weight: number;
  keywords: string[];
}

export interface RssSourceConfig extends BaseSourceConfig {
  type: "rss";
  url: string;
}

export interface AlgoliaSourceConfig extends BaseSourceConfig {
  type: "algolia";
  query: string;
}

export interface XAccountConfig {
  handle: string;
  label: string;
  type: "人物" | "机构";
}

export interface XSourceConfig extends BaseSourceConfig {
  type: "x";
  accounts: XAccountConfig[];
}

export type SourceConfig = RssSourceConfig | AlgoliaSourceConfig | XSourceConfig;

export interface FetchFailure {
  source: string;
  reason: string;
}

export interface SourceOutcome {
  source: string;
  status: "success" | "failure";
  reason?: string;
}

export interface DiscoveredSource {
  domain: string;
  title: string;
  link: string;
  feedUrl?: string;
}

export type CandidateStatus = "候选" | "影子观察" | "已启用" | "已暂停";

export interface CandidateSource extends DiscoveredSource {
  status: CandidateStatus;
  firstSeenAt: string;
  lastSeenAt: string;
  successfulRuns: number;
  failedRuns: number;
  selectedArticles: number;
}

export interface CandidateSourceRegistry {
  updatedAt: string;
  sources: CandidateSource[];
}

export type EvidenceGrade = "A" | "B" | "C" | "D";
export type EventStatus = "核验中" | "已确证" | "持续跟踪" | "已归档" | "待复核";
export type TechnicalRoute = "数据与训练" | "VLA 与具身模型" | "世界模型与空间智能" | "本体与硬件" | "部署与商业化";

export interface EventEvidence {
  link: string;
  source: string;
  grade: EvidenceGrade;
  publishedAt: string;
  supports: string;
}

export interface EventUpdate {
  date: string;
  summary: string;
  evidenceLinks: string[];
}

export interface EventRecord {
  id: string;
  title: string;
  type: ArticleKind;
  entities: string[];
  /** The company this event is actually about. Mentions never update a company card. */
  primaryEntity?: string;
  /** Other tracked companies named in the supporting material. */
  mentionedEntities?: string[];
  routes: TechnicalRoute[];
  status: EventStatus;
  firstSeenAt: string;
  lastUpdatedAt: string;
  lastVerifiedAt: string;
  facts: string[];
  openQuestions: string[];
  evidence: EventEvidence[];
  timeline: EventUpdate[];
}

export interface EventStore {
  updatedAt: string;
  events: EventRecord[];
}

export interface CompanyProfile {
  name: string;
  region: string;
  stage?: "平台公司" | "成长公司" | "创业公司";
  routes: TechnicalRoute[];
  thesis: string;
  officialUrl: string;
}

export type CandidateCompanyStatus = "候选" | "观察中" | "已交叉核验" | "已入库";

/** An internal company dossier assembled from funding candidates, never a public recommendation. */
export interface CandidateCompany {
  id: string;
  name: string;
  aliases: string[];
  status: CandidateCompanyStatus;
  verificationScore: number;
  routes: TechnicalRoute[];
  officialUrl?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  evidence: Array<{ link: string; source: string; sourceWeight: number; publishedAt: string; title: string }>;
  openQuestions: string[];
}

export interface CandidateCompanyRegistry {
  updatedAt: string;
  companies: CandidateCompany[];
}

export interface DigestResult {
  articles: Article[];
  failures: FetchFailure[];
  sourceOutcomes: SourceOutcome[];
}

export interface DailyArchive {
  date: string;
  articles: Article[];
  industryPulse?: IndustryPulse;
  sourceOutcomes?: SourceOutcome[];
  /** Items collected successfully but held back from public surfaces. */
  candidates?: CandidateArticle[];
  /** Safe, credential-free health signals for this generation run. */
  runtimeStatus?: RuntimeStatus[];
  discoveredSources?: DiscoveredSource[];
}

export interface CandidateArticle extends Article {
  stage: "待中文事实简介" | "待公司主体确认" | "不适合公开资讯";
  holdReasons: string[];
}

export interface RuntimeStatus {
  component: "LLM" | "OpenAlex";
  status: "成功" | "部分降级" | "未配置";
  attempted: number;
  succeeded: number;
  failed: number;
  detail: string;
}

export interface IndustryPulse {
  viewpoints: Article[];
  events: Article[];
}

export interface WeeklyArticle extends Article {
  weeklyScore: number;
  selectionReason: string;
}

export interface SourceRegistryEntry {
  name: string;
  type: SourceConfig["type"];
  configuredWeight: number;
  effectiveWeight: number;
  successfulRuns: number;
  failedRuns: number;
  selectedArticles: number;
  reliability?: number;
  recommendation: "保留" | "观察" | "排查";
}

export interface SourceRegistry {
  updatedAt: string;
  windowDays: number;
  sources: SourceRegistryEntry[];
}

export interface LlmSettings {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}
