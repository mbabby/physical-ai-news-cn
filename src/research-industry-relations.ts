import { createHash } from "node:crypto";
import type { Article, CompanyEntity, CompanyProfile, EvidenceGrade, ResearchRecord, SourceTier, TechnicalRoute } from "./types.js";

/**
 * An auditable, deliberately conservative bridge between a research item and a
 * company entity. These edges are not inferred from a shared technical route:
 * every non-adjacency edge starts with an explicit evidence candidate.
 */
export type ResearchIndustryRelationType =
  | "company_official_reference"
  | "author_or_lab_affiliation"
  | "code_or_model_adoption"
  | "joint_project_or_release"
  | "independent_reproduction_or_deployment"
  | "route_adjacency";

export type ResearchIndustryRelationState = "candidate" | "developing" | "verified" | "rejected" | "conflicted" | "adjacent";
export type ResearchIndustryDirection = "research_to_industry";
export type RelationEvidenceVisibility = "public" | "discovery";
export type RelationEvidenceStance = "supports" | "refutes";

export interface RelationEvidenceCandidate {
  paperId: string;
  companyId: string;
  relationType: Exclude<ResearchIndustryRelationType, "route_adjacency">;
  url: string;
  source: string;
  grade: EvidenceGrade;
  /** Date published by the source. It must not be replaced with crawl time. */
  publishedAt: string;
  supports: string;
  visibility?: RelationEvidenceVisibility;
  /** Source registry tier, when known. `线索发现层` is forcibly internal. */
  sourceTier?: SourceTier;
  stance?: RelationEvidenceStance;
  /** An explicit editor/source decision is stronger than a heuristic. */
  disposition?: "rejected" | "conflicted";
}

/** A route overlap is a navigation hint only. It cannot contain proof. */
export interface RouteAdjacencyCandidate {
  paperId: string;
  companyId: string;
  routes: TechnicalRoute[];
}

export interface RelationEvidence {
  url: string;
  source: string;
  grade: EvidenceGrade;
  publishedAt: string;
  supports: string;
  stance: RelationEvidenceStance;
}

export interface ResearchIndustryRelationEdge {
  /** Stable hash of paper ID, company ID and relation type; evidence refreshes do not change it. */
  id: string;
  direction: ResearchIndustryDirection;
  paperId: string;
  companyId: string;
  relationType: ResearchIndustryRelationType;
  relationState: ResearchIndustryRelationState;
  evidence: RelationEvidence[];
  /** Retained for internal review; discovery evidence is never publishable proof. */
  discoveryEvidence: RelationEvidence[];
  evidenceUrls: string[];
  verifiedAt: string | "unknown";
  freshness: { ttlDays: number; state: "fresh" | "stale" | "unknown"; expiresAt: string | "unknown" };
  openQuestions: string[];
  routes?: TechnicalRoute[];
}

export interface ResearchIndustryRelationMetrics {
  inputEvidenceCount: number;
  deduplicatedEvidenceCount: number;
  ignoredUnknownEntityCount: number;
  ignoredDiscoveryEvidenceCount: number;
  totalEdges: number;
  candidateEdges: number;
  developingEdges: number;
  verifiedEdges: number;
  rejectedEdges: number;
  conflictedEdges: number;
  adjacentEdges: number;
  staleEdges: number;
  publicEvidenceCount: number;
  strongEdgeCount: number;
}

export interface ResearchIndustryRelationResult {
  generatedAt: string;
  edges: ResearchIndustryRelationEdge[];
  metrics: ResearchIndustryRelationMetrics;
}

export interface ResearchIndustryRelationOptions {
  now?: Date;
  /** Route adjacency is opt-in and remains `adjacent`, even if it has routes in common. */
  routeAdjacencies?: RouteAdjacencyCandidate[];
}

type ResearchInput = ResearchRecord | Article;
type CompanyInput = CompanyEntity | CompanyProfile;
const UNKNOWN = "unknown" as const;

export function researchIndustryPaperId(item: ResearchInput): string { return item.id; }
/** Matches legacy profiles deterministically when an entity catalog ID is not available yet. */
export function researchIndustryCompanyId(item: CompanyInput): string {
  if ("id" in item) return item.id;
  return item.entityId ?? `company-${createHash("sha256").update(item.officialUrl || item.name).digest("hex").slice(0, 12)}`;
}
function edgeId(paper: string, company: string, type: ResearchIndustryRelationType): string {
  return `research-industry-${createHash("sha256").update(`${paper}\n${company}\n${type}`).digest("hex").slice(0, 16)}`;
}
function evidenceKey(item: RelationEvidenceCandidate): string {
  return [item.url.trim(), item.source.trim().toLowerCase(), item.grade, item.stance ?? "supports", isDiscovery(item) ? "discovery" : "public"].join("\n");
}
function isDiscovery(item: RelationEvidenceCandidate): boolean {
  return item.visibility === "discovery" || item.sourceTier === "线索发现层";
}
function asEvidence(item: RelationEvidenceCandidate): RelationEvidence {
  return { url: item.url, source: item.source, grade: item.grade, publishedAt: item.publishedAt, supports: item.supports, stance: item.stance ?? "supports" };
}
function sortEvidence(items: RelationEvidence[]): RelationEvidence[] {
  return [...items].sort((a, b) => a.url.localeCompare(b.url) || a.source.localeCompare(b.source) || a.publishedAt.localeCompare(b.publishedAt));
}
function independentSource(item: RelationEvidence): string {
  try { return new URL(item.url).hostname.replace(/^www\./, "").toLowerCase(); }
  catch { return item.source.trim().toLowerCase(); }
}
function validDate(value: string): Date | undefined {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
function newestDate(items: RelationEvidence[]): string | typeof UNKNOWN {
  const dated = items.filter((item) => validDate(item.publishedAt)).map((item) => item.publishedAt);
  return dated.sort().at(-1) ?? UNKNOWN;
}
function ttlDays(type: ResearchIndustryRelationType): number {
  if (type === "author_or_lab_affiliation") return 365;
  if (type === "code_or_model_adoption" || type === "independent_reproduction_or_deployment") return 120;
  if (type === "route_adjacency") return 30;
  return 180;
}
function freshness(type: ResearchIndustryRelationType, verifiedAt: string | typeof UNKNOWN, now: Date): ResearchIndustryRelationEdge["freshness"] {
  const ttl = ttlDays(type);
  const verified = verifiedAt === UNKNOWN ? undefined : validDate(verifiedAt);
  if (!verified) return { ttlDays: ttl, state: "unknown", expiresAt: UNKNOWN };
  const expiry = new Date(verified.getTime() + ttl * 86_400_000).toISOString();
  return { ttlDays: ttl, state: now.getTime() > verified.getTime() + ttl * 86_400_000 ? "stale" : "fresh", expiresAt: expiry };
}

/** A is enough. Two B sources must resolve to different source domains/names. */
function proofState(evidence: RelationEvidence[], candidates: RelationEvidenceCandidate[]): ResearchIndustryRelationState {
  if (candidates.some((item) => item.disposition === "rejected")) return "rejected";
  if (candidates.some((item) => item.disposition === "conflicted") || (evidence.some((item) => item.stance === "supports") && evidence.some((item) => item.stance === "refutes"))) return "conflicted";
  const supporting = evidence.filter((item) => item.stance === "supports");
  if (supporting.some((item) => item.grade === "A")) return "verified";
  if (new Set(supporting.filter((item) => item.grade === "B").map(independentSource)).size >= 2) return "verified";
  if (supporting.some((item) => item.grade === "B")) return "developing";
  return "candidate";
}
function questions(state: ResearchIndustryRelationState, publicEvidence: RelationEvidence[], discoveryEvidence: RelationEvidence[]): string[] {
  const result: string[] = [];
  if (!publicEvidence.length && discoveryEvidence.length) result.push("当前仅有发现层线索；需要可公开的一手证据或独立可靠报道。");
  if (state === "candidate") result.push("需要一项 A 级证据，或两项独立 B 级证据，才能核验该关系。");
  if (state === "developing") result.push("当前仅有单一 B 级报道；需要官方证据或另一独立 B 级来源。");
  if (state === "conflicted") result.push("支持与反驳证据冲突；需要人工核对原始发布和适用范围。");
  if (state === "rejected") result.push("该候选已被明确否决；若要重开，需要新的可公开证据。");
  return result;
}
function evidenceScore(edge: ResearchIndustryRelationEdge): number {
  const grades = edge.evidence.filter((item) => item.stance === "supports").map((item) => item.grade);
  return grades.reduce((score, grade) => score + ({ A: 100, B: 35, C: 5, D: 0 } as const)[grade], 0) + edge.evidence.length;
}

/**
 * Materialize relation edges from explicitly supplied proof candidates.
 * Company/research route overlap is ignored unless an opt-in adjacency is
 * provided, and adjacency is never a verified/adopted relationship.
 */
export function buildResearchIndustryRelationEdges(research: ResearchInput[], companies: CompanyInput[], candidates: RelationEvidenceCandidate[], options: ResearchIndustryRelationOptions = {}): ResearchIndustryRelationResult {
  const now = options.now ?? new Date();
  const paperIds = new Set(research.map(researchIndustryPaperId));
  const companyIds = new Set(companies.map(researchIndustryCompanyId));
  const validCandidates = candidates.filter((item) => paperIds.has(item.paperId) && companyIds.has(item.companyId));
  const ignoredUnknownEntityCount = candidates.length - validCandidates.length;
  const grouped = new Map<string, RelationEvidenceCandidate[]>();
  for (const candidate of validCandidates) {
    const key = `${candidate.paperId}\n${candidate.companyId}\n${candidate.relationType}`;
    const list = grouped.get(key) ?? [];
    if (!list.some((existing) => evidenceKey(existing) === evidenceKey(candidate))) list.push(candidate);
    grouped.set(key, list);
  }
  const edges: ResearchIndustryRelationEdge[] = [];
  for (const entries of grouped.values()) {
    const first = entries[0]!;
    const publicEvidence = sortEvidence(entries.filter((item) => !isDiscovery(item)).map(asEvidence));
    const discoveryEvidence = sortEvidence(entries.filter(isDiscovery).map(asEvidence));
    const relationState = proofState(publicEvidence, entries);
    const verifiedAt = relationState === "verified" ? newestDate(publicEvidence.filter((item) => item.stance === "supports")) : UNKNOWN;
    edges.push({
      id: edgeId(first.paperId, first.companyId, first.relationType), direction: "research_to_industry", paperId: first.paperId, companyId: first.companyId,
      relationType: first.relationType, relationState, evidence: publicEvidence, discoveryEvidence,
      evidenceUrls: publicEvidence.map((item) => item.url), verifiedAt,
      freshness: freshness(first.relationType, verifiedAt, now), openQuestions: questions(relationState, publicEvidence, discoveryEvidence),
    });
  }
  for (const adjacency of options.routeAdjacencies ?? []) {
    if (!paperIds.has(adjacency.paperId) || !companyIds.has(adjacency.companyId)) continue;
    const routes = [...new Set(adjacency.routes)].sort();
    if (!routes.length) continue;
    edges.push({
      id: edgeId(adjacency.paperId, adjacency.companyId, "route_adjacency"), direction: "research_to_industry", paperId: adjacency.paperId, companyId: adjacency.companyId,
      relationType: "route_adjacency", relationState: "adjacent", evidence: [], discoveryEvidence: [], evidenceUrls: [], verifiedAt: UNKNOWN,
      freshness: freshness("route_adjacency", UNKNOWN, now), routes,
      openQuestions: ["路线相邻仅用于导航；需要显式公开证据才能建立研究—产业关系。"],
    });
  }
  const uniqueEdges = [...new Map(edges.map((edge) => [edge.id, edge])).values()]
    .sort((a, b) => a.paperId.localeCompare(b.paperId) || a.companyId.localeCompare(b.companyId) || a.relationType.localeCompare(b.relationType));
  const count = (state: ResearchIndustryRelationState) => uniqueEdges.filter((edge) => edge.relationState === state).length;
  const metrics: ResearchIndustryRelationMetrics = {
    inputEvidenceCount: candidates.length, deduplicatedEvidenceCount: validCandidates.length - [...grouped.values()].reduce((total, items) => total + items.length, 0),
    ignoredUnknownEntityCount, ignoredDiscoveryEvidenceCount: validCandidates.filter(isDiscovery).length,
    totalEdges: uniqueEdges.length, candidateEdges: count("candidate"), developingEdges: count("developing"), verifiedEdges: count("verified"), rejectedEdges: count("rejected"), conflictedEdges: count("conflicted"), adjacentEdges: count("adjacent"),
    staleEdges: uniqueEdges.filter((edge) => edge.freshness.state === "stale").length,
    publicEvidenceCount: uniqueEdges.reduce((total, edge) => total + edge.evidence.length, 0), strongEdgeCount: uniqueEdges.filter((edge) => edge.relationState === "verified" && edge.relationType !== "route_adjacency").length,
  };
  return { generatedAt: now.toISOString(), edges: uniqueEdges, metrics };
}

/** Strong edges are exactly verified evidence-backed edges; route adjacency is excluded by construction. */
export function selectTopResearchIndustryEdges(edges: ResearchIndustryRelationEdge[], limit = 20): ResearchIndustryRelationEdge[] {
  const safeLimit = Math.min(20, Math.max(0, Math.floor(limit)));
  return edges.filter((edge) => edge.relationState === "verified" && edge.relationType !== "route_adjacency")
    .sort((a, b) => evidenceScore(b) - evidenceScore(a) || b.verifiedAt.localeCompare(a.verifiedAt) || a.id.localeCompare(b.id))
    .slice(0, safeLimit);
}
