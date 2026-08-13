import type { TechnicalRoute } from "../types.js";
import type { WatchlistTrack } from "./contracts.js";
import type { ThesisSeed } from "./seeds.js";

export interface ThesisScoreComponent {
  key: string;
  label: string;
  points: number;
  maxPoints: number;
  basis: string;
  /** Missing source data is neutral, never a negative assertion. */
  unknown: boolean;
}

export interface ThesisScoringContext {
  /** Reserved for deterministic, structured inputs added by later pipeline stages. */
  readonly now?: Date;
}

export interface ScoredThesisSeed extends ThesisSeed {
  score: number;
  components: ThesisScoreComponent[];
  eligible: boolean;
  ineligibilityReasons: string[];
  primaryRoute: TechnicalRoute | undefined;
}

export type WatchlistSelectionGroup = "priority-focus" | "continued-observation";

export interface SelectedThesisSeed extends ScoredThesisSeed {
  selectionGroup: WatchlistSelectionGroup;
}

export interface WatchlistSelectionOptions {
  totalLimit?: number;
  perTrackTarget?: number;
  maxRouteShare?: number;
}

export interface SelectedWatchlistSeeds {
  forwardRadar: SelectedThesisSeed[];
  validatedMomentum: SelectedThesisSeed[];
}

const FORWARD_COMPONENTS = {
  route: { key: "route-differentiation", label: "路线差异化", maxPoints: 25 },
  team: { key: "team-history", label: "团队与历史能力", maxPoints: 20 },
  capital: { key: "capital-partnership-talent", label: "资本、合作及人才信号", maxPoints: 15 },
  position: { key: "value-chain-position", label: "潜在价值链位置", maxPoints: 15 },
  novelty: { key: "novelty", label: "信号新颖性", maxPoints: 15 },
  verification: { key: "verifiability", label: "后续可验证性", maxPoints: 10 },
} as const;

const MOMENTUM_COMPONENTS = {
  traction: { key: "customer-deployment-revenue-production", label: "客户、部署、收入与量产", maxPoints: 30 },
  product: { key: "technology-product", label: "技术或产品实质进展", maxPoints: 20 },
  capital: { key: "capital", label: "资本持续支持", maxPoints: 15 },
  continuity: { key: "continuity-30-90", label: "30/90 天连续强化", maxPoints: 15 },
  evidence: { key: "evidence-strength", label: "证据强度", maxPoints: 15 },
  diversity: { key: "diversity", label: "路线与地域多样性", maxPoints: 5 },
} as const;

const DEPLOYMENT_ROUTE: TechnicalRoute = "部署与商业化";
const CAPITAL_FIELDS = new Set(["amount", "valuation"]);
const TRACTION_FIELDS = new Set(["customer", "revenue", "order"]);

function component(
  descriptor: { key: string; label: string; maxPoints: number },
  points: number,
  basis: string,
  unknown = false,
): ThesisScoreComponent {
  return { ...descriptor, points, basis, unknown };
}

function evidencePoints(grade: ThesisSeed["evidenceGrade"], maxPoints: number): number {
  if (grade === "A") return maxPoints;
  if (grade === "B+B") return Math.floor(maxPoints * 0.8);
  return Math.floor(maxPoints * 0.5);
}

function primaryRoute(seed: ThesisSeed): TechnicalRoute | undefined {
  return [...seed.routes].sort()[0];
}

function hasVerified(seed: ThesisSeed, fields: Set<string>): boolean {
  return seed.verifiedSensitiveFields.some((field) => fields.has(field));
}

function forwardComponents(seed: ThesisSeed): ThesisScoreComponent[] {
  const routeCount = new Set(seed.routes).size;
  const routePoints = routeCount >= 3 ? 25 : routeCount === 2 ? 20 : routeCount === 1 ? 15 : 0;
  const hasCapitalSignal = hasVerified(seed, CAPITAL_FIELDS);
  return [
    component(FORWARD_COMPONENTS.route, routePoints, routeCount ? `已记录 ${routeCount} 条技术路线` : "种子未提供技术路线", routeCount === 0),
    component(FORWARD_COMPONENTS.team, 0, "种子未提供可核验的团队或历史结构字段", true),
    component(FORWARD_COMPONENTS.capital, hasCapitalSignal ? 15 : 0,
      hasCapitalSignal ? "存在字段级核验的资本事实" : "种子未提供字段级核验的资本、合作或人才事实", !hasCapitalSignal),
    component(FORWARD_COMPONENTS.position, routeCount ? 15 : 0,
      routeCount ? "技术路线明确，可定位潜在价值链位置" : "种子未提供技术路线", routeCount === 0),
    component(FORWARD_COMPONENTS.novelty, 0, "种子未提供可比较的时间序列或新颖性基线", true),
    component(FORWARD_COMPONENTS.verification, seed.factReferenceIds.length ? evidencePoints(seed.evidenceGrade, 10) : 0,
      seed.factReferenceIds.length ? `${seed.evidenceGrade} 级证据关联 ${seed.factReferenceIds.length} 条事实引用` : "种子未提供事实引用", seed.factReferenceIds.length === 0),
  ];
}

function momentumComponents(seed: ThesisSeed): ThesisScoreComponent[] {
  const hasTraction = hasVerified(seed, TRACTION_FIELDS) || seed.routes.includes(DEPLOYMENT_ROUTE);
  const hasProductSignal = seed.routes.some((route) => route !== DEPLOYMENT_ROUTE);
  const hasCapitalSignal = hasVerified(seed, CAPITAL_FIELDS);
  const routeCount = new Set(seed.routes).size;
  return [
    component(MOMENTUM_COMPONENTS.traction, hasTraction ? 30 : 0,
      hasTraction ? "已记录字段级核验的客户、收入或订单，或明确的部署与商业化路线" : "种子未提供可核验的客户、部署、收入或量产结构信号", !hasTraction),
    component(MOMENTUM_COMPONENTS.product, hasProductSignal ? 20 : 0,
      hasProductSignal ? "已记录非部署技术路线" : "种子未提供可核验的技术或产品结构信号", !hasProductSignal),
    component(MOMENTUM_COMPONENTS.capital, hasCapitalSignal ? 15 : 0,
      hasCapitalSignal ? "存在字段级核验的资本事实" : "种子未提供字段级核验的资本事实", !hasCapitalSignal),
    component(MOMENTUM_COMPONENTS.continuity, 0, "种子未提供可比较的 30/90 天时间序列", true),
    component(MOMENTUM_COMPONENTS.evidence, evidencePoints(seed.evidenceGrade, 15), `${seed.evidenceGrade} 级种子证据`, false),
    component(MOMENTUM_COMPONENTS.diversity, 0,
      routeCount
        ? `已记录 ${routeCount} 条技术路线；种子未提供地域字段，无法完成路线与地域多样性判断`
        : "种子未提供技术路线和地域字段，无法完成路线与地域多样性判断", true),
  ];
}

function eligibility(seed: ThesisSeed): string[] {
  const reasons: string[] = [];
  if (!seed.companyId.trim()) reasons.push("缺少公司 ID");
  if (!seed.factReferenceIds.length) reasons.push("缺少可追溯事实引用");
  if (!seed.routes.length) reasons.push("缺少技术路线");
  if (seed.track === "validated-momentum" && seed.evidenceGrade === "B") reasons.push("验证动量至少需要 A 或 B+B 证据，单一 B 级来源不合格");
  return reasons;
}

function neutralComponents(seed: ThesisSeed, reason: string): ThesisScoreComponent[] {
  const descriptors = seed.track === "forward-radar" ? Object.values(FORWARD_COMPONENTS) : Object.values(MOMENTUM_COMPONENTS);
  return descriptors.map((descriptor) => component(descriptor, 0, `资格门槛未通过；未评分：${reason}`, true));
}

/** Deterministically score a canonical seed without interpreting missing data as a negative fact. */
export function scoreThesisSeed(seed: ThesisSeed, _context: ThesisScoringContext = {}): ScoredThesisSeed {
  const ineligibilityReasons = eligibility(seed);
  const components = ineligibilityReasons.length
    ? neutralComponents(seed, ineligibilityReasons.join("；"))
    : seed.track === "forward-radar" ? forwardComponents(seed) : momentumComponents(seed);
  return {
    ...seed,
    routes: [...seed.routes].sort(),
    factReferenceIds: [...seed.factReferenceIds].sort(),
    verifiedSensitiveFields: [...seed.verifiedSensitiveFields].sort(),
    unknownSensitiveFields: [...seed.unknownSensitiveFields].sort(),
    evidenceSummary: [...seed.evidenceSummary].sort(),
    components,
    score: ineligibilityReasons.length ? 0 : components.reduce((sum, item) => sum + item.points, 0),
    eligible: ineligibilityReasons.length === 0,
    ineligibilityReasons,
    primaryRoute: primaryRoute(seed),
  };
}

function compareScored(left: ScoredThesisSeed, right: ScoredThesisSeed): number {
  return right.score - left.score || left.companyId.localeCompare(right.companyId);
}

function trackOf(item: ScoredThesisSeed): WatchlistTrack {
  return item.track;
}

function integerAtLeast(value: number | undefined, fallback: number, minimum: number): number {
  return Math.max(minimum, Math.floor(value ?? fallback));
}

/**
 * Select only already-eligible candidates. The per-track target is a ceiling,
 * not a mandate: unavailable or diversity-blocked candidates leave slots empty.
 */
export function selectWatchlistSeeds(scored: ScoredThesisSeed[], options: WatchlistSelectionOptions = {}): SelectedWatchlistSeeds {
  const totalLimit = integerAtLeast(options.totalLimit, 10, 0);
  const perTrackTarget = Math.min(5, integerAtLeast(options.perTrackTarget, 5, 0));
  const maxRouteShare = Math.min(1, Math.max(0, options.maxRouteShare ?? 0.4));
  const routeLimit = maxRouteShare === 0 ? 0 : Math.max(1, Math.floor(totalLimit * maxRouteShare));

  const deduped = new Map<string, ScoredThesisSeed>();
  for (const candidate of scored.filter((item) => item.eligible).sort((left, right) => {
    if (left.companyId !== right.companyId) return left.companyId.localeCompare(right.companyId);
    if (left.track !== right.track) return left.track === "validated-momentum" ? -1 : 1;
    return compareScored(left, right);
  })) {
    const existing = deduped.get(candidate.companyId);
    if (!existing || (candidate.track === "validated-momentum" && existing.track !== "validated-momentum")) deduped.set(candidate.companyId, candidate);
  }

  const routeCounts = new Map<TechnicalRoute, number>();
  const choose = (track: WatchlistTrack): ScoredThesisSeed[] => {
    const selected: ScoredThesisSeed[] = [];
    for (const candidate of [...deduped.values()].filter((item) => trackOf(item) === track).sort(compareScored)) {
      if (selected.length >= perTrackTarget || selected.length >= totalLimit) break;
      const currentRouteCount = candidate.primaryRoute ? routeCounts.get(candidate.primaryRoute) ?? 0 : 0;
      if (candidate.primaryRoute && currentRouteCount >= routeLimit) continue;
      selected.push(candidate);
      if (candidate.primaryRoute) routeCounts.set(candidate.primaryRoute, currentRouteCount + 1);
    }
    return selected;
  };

  // Momentum is considered first across both tracks, matching the cross-track precedence rule.
  const validatedMomentum = choose("validated-momentum");
  const remainingLimit = Math.max(0, totalLimit - validatedMomentum.length);
  const forwardRadar = choose("forward-radar").slice(0, remainingLimit);

  const group = (items: ScoredThesisSeed[]): SelectedThesisSeed[] => items.map((item, index) => ({
    ...item,
    selectionGroup: index < 3 ? "priority-focus" : "continued-observation",
  }));
  return { forwardRadar: group(forwardRadar), validatedMomentum: group(validatedMomentum) };
}
