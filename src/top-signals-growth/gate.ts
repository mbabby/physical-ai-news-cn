import {
  topSignalsContentSha256,
  validateGrowthExperimentConfig,
  validateTopSignalsApproval,
  validateTopSignalsDraft,
  type GrowthExperimentConfig,
  type TopSignalsApproval,
  type TopSignalsDraft,
} from "./contracts.js";

export interface TopSignalsGateReceipt {
  schemaVersion: 1;
  experimentId: string;
  week: string;
  mode: "manual" | "automatic";
  contentSha256: string;
  status: "publishable" | "blocked";
  reasons: string[];
  evaluatedAt: string;
  approval: null | { approvedBy: string; approvedAt: string };
}

export interface EvaluateTopSignalsGateInput {
  draft: TopSignalsDraft;
  config: GrowthExperimentConfig;
  approval?: TopSignalsApproval;
}

/** Evaluate a fully validated draft without selecting, filtering, or modifying its signals. */
export function evaluateTopSignalsGate({ draft, config, approval }: EvaluateTopSignalsGateInput): TopSignalsGateReceipt {
  validateGrowthExperimentConfig(config);
  validateTopSignalsDraft(draft);
  if (approval) validateTopSignalsApproval(approval);

  const contentSha256 = topSignalsContentSha256(draft);
  const mode = draft.week === config.manualWeek ? "manual" : "automatic";
  const reasons = new Set<string>();
  const boundApproval = approval
    && approval.experimentId === draft.experimentId
    && approval.week === draft.week
    && approval.contentSha256 === contentSha256
    ? { approvedBy: approval.approvedBy, approvedAt: approval.approvedAt }
    : null;

  if (mode === "manual" && !boundApproval) {
    reasons.add(approval ? "人工批准未绑定当前内容" : "缺少人工批准");
  }
  if (mode === "automatic" && draft.signals.length < config.minSignals) {
    reasons.add(`合格信号不足 ${config.minSignals} 条`);
  }

  const sortedReasons = [...reasons].sort();
  return {
    schemaVersion: 1,
    experimentId: draft.experimentId,
    week: draft.week,
    mode,
    contentSha256,
    status: sortedReasons.length === 0 ? "publishable" : "blocked",
    reasons: sortedReasons,
    evaluatedAt: new Date().toISOString(),
    approval: boundApproval,
  };
}
