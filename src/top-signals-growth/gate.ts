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

const GATE_KEYS = [
  "schemaVersion", "experimentId", "week", "mode", "contentSha256", "status", "reasons", "evaluatedAt", "approval",
] as const;
const BOUND_APPROVAL_KEYS = ["approvedBy", "approvedAt"] as const;

function exactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && JSON.stringify(Object.keys(value as Record<string, unknown>).sort()) === JSON.stringify([...keys].sort());
}

function canonicalTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

export function validateTopSignalsGateReceipt(value: unknown): asserts value is TopSignalsGateReceipt {
  if (!exactKeys(value, GATE_KEYS)) throw new Error("Invalid Top Signals gate receipt keys");
  const gate = value as unknown as TopSignalsGateReceipt;
  if (gate.schemaVersion !== 1 || typeof gate.experimentId !== "string" || !/^\d{4}-W\d{2}$/.test(gate.week)
    || !["manual", "automatic"].includes(gate.mode) || !/^[a-f0-9]{64}$/.test(gate.contentSha256)
    || !["publishable", "blocked"].includes(gate.status) || !canonicalTimestamp(gate.evaluatedAt)
    || !Array.isArray(gate.reasons) || gate.reasons.some((reason) => typeof reason !== "string" || !reason.trim())
    || new Set(gate.reasons).size !== gate.reasons.length
    || JSON.stringify(gate.reasons) !== JSON.stringify([...gate.reasons].sort())) {
    throw new Error("Invalid Top Signals gate receipt");
  }
  if (gate.status === "publishable" ? gate.reasons.length !== 0 : gate.reasons.length === 0) {
    throw new Error("Invalid Top Signals gate status and reasons");
  }
  if (gate.approval !== null && (!exactKeys(gate.approval, BOUND_APPROVAL_KEYS)
    || typeof gate.approval.approvedBy !== "string" || !gate.approval.approvedBy.trim()
    || !canonicalTimestamp(gate.approval.approvedAt))) {
    throw new Error("Invalid Top Signals gate approval");
  }
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
