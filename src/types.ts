export type ArticleKind = "投融资" | "产品发布" | "公司商业" | "部署案例" | "开源项目" | "研究与数据";
export type PulseKind = "人物观点" | "关键事件";
export type SourceTier = "官方公司与实验室" | "开源发布" | "权威产业媒体" | "线索发现层";
export type SourceStatus = "已启用" | "观察" | "已暂停";
export type SourcePublicationPolicy = "可作为一手证据" | "可作为独立报道" | "仅作线索发现";

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
  /** Source tier is attached at collection time; it prevents discovery leads from leaking to public pages. */
  sourceTier?: SourceTier;
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

/** A durable, auditable record for a research card. It is refreshed from
 * arXiv/OpenAlex rather than reconstructed from one day's digest. */
export interface ResearchRecord {
  id: string;
  article: Article;
  firstSeenAt: string;
  lastCheckedAt: string;
  lastShownAt?: string;
  arxivVersion?: number;
  factHash: string;
  status: "新论文" | "候选资源" | "常青资源候选" | "里程碑精读候选" | "待复核" | "已撤稿";
  /** Distinct UTC dates on which this paper was observed.  This prevents a
   * manual rerun from inflating promotion eligibility. */
  seenDates?: string[];
  appearances: number;
  evidenceTags: Array<"真实机器人" | "基准" | "开源">;
  authorityLabels: string[];
  notableAuthor?: string;
  changes: Array<{ date: string; kind: "新收录" | "版本更新" | "元数据更新" | "撤稿" | "待复核"; detail: string }>;
}

export interface ResearchRegistry {
  updatedAt: string;
  records: ResearchRecord[];
}

interface BaseSourceConfig {
  name: string;
  weight: number;
  keywords: string[];
  /** Defaults preserve compatibility for local/test-only sources. */
  tier?: SourceTier;
  status?: SourceStatus;
  publicationPolicy?: SourcePublicationPolicy;
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
  fetchedArticles?: number;
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

export interface FundingFact {
  /** Only a verified canonical company may be named here. */
  entityStatus: "已确认" | "待识别";
  round?: string;
  amount?: string;
  valuation?: string;
  investors: string[];
}

export interface ProductDeploymentFact {
  product?: string;
  customers: string[];
  deployment?: string;
}

export interface EventRecord {
  id: string;
  title: string;
  /** Original source-language headline. Public Chinese surfaces use `title`; English sharing uses this only when it is actually English. */
  sourceTitle?: string;
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
  funding?: FundingFact;
  productDeployment?: ProductDeploymentFact;
}

export interface EventStore {
  updatedAt: string;
  events: EventRecord[];
}

export interface CompanyProfile {
  name: string;
  aliases?: string[];
  region: string;
  stage?: "平台公司" | "成长公司" | "创业公司";
  routes: TechnicalRoute[];
  thesis: string;
  officialUrl: string;
  /** A stable identity lets aliases, candidates and public dossiers converge
   * without treating a translated headline as a new company. */
  entityId?: string;
  /** First-party profile evidence only establishes company identity and focus;
   * it never by itself verifies a financing or deployment event. */
  profileEvidence?: Array<{ link: string; source: string; checkedAt: string; supports: string }>;
}

/** Public, generated dossier. It never fabricates facts that lack evidence. */
export interface CompanyDossier {
  company: CompanyProfile;
  /** Official identity/focus proof. This is deliberately separate from event
   * proof: a company home page never verifies a financing or deployment. */
  identityEvidence: Array<{ link: string; source: string; checkedAt: string; supports: string }>;
  updatedAt: string;
  eventIds: string[];
  funding: Array<{ eventId: string; date: string; fact: FundingFact; evidenceLinks: string[] }>;
  productsAndDeployments: Array<{ eventId: string; date: string; type: ArticleKind; fact: ProductDeploymentFact; evidenceLinks: string[] }>;
  capitalStatus: CapitalEvidenceStatus;
  validationStage: ValidationStage;
}

export interface RouteIndexEntry {
  route: TechnicalRoute;
  companies: string[];
  fundingEventIds: string[];
  productDeploymentEventIds: string[];
}

export type CapitalEvidenceStatus = "已证实" | "有资本信号" | "证据不足";
export type ValidationStage = "证据不足" | "概念 / 研究" | "原型与演示" | "实机验证" | "客户试点" | "规模部署 / 商业化";

/** A public, evidence-backed view of one company inside one technical route. */
export interface RouteCompanySnapshot {
  company: string;
  officialUrl: string;
  region: string;
  stage: string;
  approach: string;
  capitalStatus: CapitalEvidenceStatus;
  capitalEventIds: string[];
  validationStage: ValidationStage;
  productDeploymentEventIds: string[];
  evidenceLinks: string[];
  updatedAt?: string;
}

export interface RouteCompetitionEntry {
  route: TechnicalRoute;
  question: string;
  approaches: string;
  companies: RouteCompanySnapshot[];
  verifiedCapitalCompanies: number;
  verifiedProductDeploymentCompanies: number;
  lastUpdatedAt?: string;
}

export interface RouteCompetitionMap {
  updatedAt: string;
  routes: RouteCompetitionEntry[];
}

export interface RouteCorrection {
  date: string;
  route: TechnicalRoute;
  company: string;
  kind: "资本状态变化" | "验证阶段变化" | "证据移除";
  detail: string;
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
  evidence: Array<{ link: string; source: string; sourceWeight: number; publishedAt: string; title: string; publisher?: string }>;
  openQuestions: string[];
}

export interface CandidateCompanyRegistry {
  updatedAt: string;
  companies: CandidateCompany[];
}

/** Internal identity graph joining curated company profiles with financing
 * candidates. Candidate nodes never become public profiles automatically. */
export type CompanyEntityStatus = "已建档" | "候选" | "观察中" | "已交叉核验";
export interface CompanyEntity {
  id: string;
  name: string;
  aliases: string[];
  officialUrl?: string;
  region?: string;
  routes: TechnicalRoute[];
  status: CompanyEntityStatus;
  firstSeenAt: string;
  lastSeenAt: string;
  evidence: Array<{ link: string; source: string; publishedAt?: string; supports: string }>;
  promotion: { eligibleForReview: boolean; reasons: string[] };
}
export interface CompanyEntityRegistry {
  updatedAt: string;
  entities: CompanyEntity[];
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
  /** Corrections are retained for source-health scoring; absence means no correction was recorded. */
  sourceCorrections?: Array<{ source: string; reason: string; date: string }>;
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

export type RunState = "success" | "degraded" | "failed";

/** Credential-free publication receipt. It is intentionally small enough to
 * keep as a rolling audit trail and strict enough to compare with the files
 * produced by the same transaction. */
export interface RunManifest {
  schemaVersion: 1;
  runId: string;
  date: string;
  startedAt: string;
  finishedAt: string;
  status: RunState;
  quality: {
    publicIndustryItems: number;
    publicResearchItems: number;
    candidates: number;
    sourceFailures: number;
  };
  services: RuntimeStatus[];
  outputs: number;
}

export interface RunHistory {
  schemaVersion: 1;
  updatedAt: string;
  runs: RunManifest[];
}

export interface PipelineHealth {
  schemaVersion: 1;
  checkedAt: string;
  status: "healthy" | "degraded" | "stale";
  latestRunId: string;
  latestDate: string;
  consecutiveSuccessfulPublications: number;
  recentRunCount: number;
  recentSuccessRate: number;
  latestPublicItems: number;
  reasons: string[];
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
  tier: SourceTier;
  status: SourceStatus;
  publicationPolicy: SourcePublicationPolicy;
  configuredWeight: number;
  effectiveWeight: number;
  successfulRuns: number;
  failedRuns: number;
  selectedArticles: number;
  reliability?: number;
  fetchedArticles: number;
  relatedHits: number;
  correctionCount: number;
  health: {
    successRate: number | undefined;
    hitRate: number | undefined;
    inclusionRate: number | undefined;
    correctionRate: number;
    score: number | undefined;
  };
  statusReason?: string;
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

/** A compact, public quality snapshot. Missing GitHub traffic means the
 * repository has not configured the optional traffic collector; it is never
 * rendered as a misleading zero. */
export interface ProjectMetrics {
  updatedAt: string;
  windowDays: number;
  digest: { expectedRuns: number; observedRuns: number; successfulRuns: number; successRate?: number };
  publicContent: { homepageEffectiveItems: number; evidenceABRatio?: number; companyDossierCoverage: number };
  flywheel: { enabledSources: number; observedSources: number; pausedSources: number; promotedSources: number; reviewCandidates: number };
  community: { stars: { status: "未配置" | "已采集"; value?: number }; visitors: { status: "未配置" | "已采集"; value?: number }; referrers: { status: "未配置" | "已采集"; items?: Array<{ source: string; visitors: number }> } };
}
