import type { DecisionTopSignal } from "../decision-products/contracts.js";
import type {
  GrowthExperimentConfig,
  GrowthScoreBreakdown,
  GrowthTopSignal,
} from "./contracts.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const IMPACT_POINTS = { "投融资": 30, "部署案例": 28, "产品发布": 25, "公司商业": 22 } as const;
const EVIDENCE_POINTS = { official: 25, "multi-source": 21 } as const;
const STRATEGIC_POINTS = { "投融资": 10, "部署案例": 10, "产品发布": 8, "公司商业": 7 } as const;
const NEXT_VALIDATION = {
  "投融资": "继续核验资金到账、估值披露、投资方确认及下一轮融资变化。",
  "产品发布": "继续核验真实客户采用、交付范围、性能边界与后续版本变化。",
  "部署案例": "继续核验部署数量、付费客户、运行周期与规模复制情况。",
  "公司商业": "继续核验交易交割、订单履约、客户身份与收入确认情况。",
} as const;

type EligibleKind = keyof typeof IMPACT_POINTS;

function ageInMilliseconds(timestamp: string, now: Date): number {
  return now.getTime() - Date.parse(timestamp);
}

function isEligibleKind(signal: DecisionTopSignal): signal is DecisionTopSignal & { kind: EligibleKind } {
  if (signal.kind !== "公司商业") return signal.kind in IMPACT_POINTS;
  return /并购|收购|客户|订单|量产|交付/u.test(`${signal.titleZh}\n${signal.factsZh.join("\n")}`);
}

function recencyPoints(signal: DecisionTopSignal, now: Date): number {
  const age = ageInMilliseconds(signal.occurredAt, now);
  if (age <= 3 * DAY_MS) return 20;
  if (age <= 7 * DAY_MS) return 16;
  if (age <= 14 * DAY_MS) return 12;
  if (age <= 30 * DAY_MS) return 6;
  return 0;
}

function informationGainPoints(signal: DecisionTopSignal, now: Date): number {
  if (signal.changedThisWeek) return 15;
  return ageInMilliseconds(signal.verifiedAt, now) <= 7 * DAY_MS ? 5 : 0;
}

function isInScope(signal: DecisionTopSignal, now: Date): signal is DecisionTopSignal & { kind: EligibleKind } {
  return isEligibleKind(signal)
    && (ageInMilliseconds(signal.occurredAt, now) <= 30 * DAY_MS || signal.changedThisWeek);
}

export function scoreGrowthSignal(signal: DecisionTopSignal, now: Date): GrowthScoreBreakdown {
  if (!Number.isFinite(now.getTime())) throw new Error("Growth ranking requires a valid fixed clock");
  const kind = signal.kind as EligibleKind;
  const industryCapitalImpact = IMPACT_POINTS[kind] ?? 0;
  const evidenceQuality = EVIDENCE_POINTS[signal.evidenceState];
  const recency = recencyPoints(signal, now);
  const informationGain = informationGainPoints(signal, now);
  const strategicRelevance = STRATEGIC_POINTS[kind] ?? 0;
  return {
    industryCapitalImpact,
    evidenceQuality,
    recency,
    informationGain,
    strategicRelevance,
    total: industryCapitalImpact + evidenceQuality + recency + informationGain + strategicRelevance,
  };
}

function compareGrowthSignals(left: GrowthTopSignal, right: GrowthTopSignal): number {
  return right.scoreBreakdown.total - left.scoreBreakdown.total
    || right.scoreBreakdown.evidenceQuality - left.scoreBreakdown.evidenceQuality
    || right.occurredAt.localeCompare(left.occurredAt)
    || left.eventId.localeCompare(right.eventId);
}

export function buildGrowthTopSignals(
  signals: DecisionTopSignal[],
  now: Date,
  config: GrowthExperimentConfig,
): GrowthTopSignal[] {
  if (!Number.isFinite(now.getTime())) throw new Error("Growth ranking requires a valid fixed clock");
  const ranked = signals
    .filter((signal): signal is DecisionTopSignal & { kind: EligibleKind } => isInScope(signal, now))
    .map((signal) => ({
      ...signal,
      nextValidationPoint: NEXT_VALIDATION[signal.kind],
      scoreBreakdown: scoreGrowthSignal(signal, now),
    }))
    .sort(compareGrowthSignals);

  const selected: GrowthTopSignal[] = [];
  const entityCounts = new Map<string, number>();
  const kindCounts = new Map<EligibleKind, number>();
  for (const signal of ranked) {
    if ((entityCounts.get(signal.entityId) ?? 0) >= config.maxSignalsPerEntity
      || (kindCounts.get(signal.kind) ?? 0) >= config.maxSignalsPerKind) continue;
    selected.push(signal);
    entityCounts.set(signal.entityId, (entityCounts.get(signal.entityId) ?? 0) + 1);
    kindCounts.set(signal.kind, (kindCounts.get(signal.kind) ?? 0) + 1);
    if (selected.length === config.maxSignals) break;
  }
  return selected;
}
