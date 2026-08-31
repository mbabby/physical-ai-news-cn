import { join } from "node:path";

import type { DecisionProductArtifact } from "../decision-products/contracts.js";
import type { FileTransaction } from "../runtime/storage.js";
import { isoWeek } from "../weekly.js";
import {
  validateGrowthExperimentConfig,
  validateTopSignalsDraft,
  type GrowthExperimentConfig,
  type TopSignalsDraft,
} from "./contracts.js";
import { buildGrowthTopSignals } from "./ranking.js";

export type TopSignalsDraftResult =
  | { status: "outside-experiment" }
  | { status: "in-experiment"; draft: TopSignalsDraft };

export function buildTopSignalsDraft(input: {
  artifact: DecisionProductArtifact;
  now: Date;
  config: GrowthExperimentConfig;
}): TopSignalsDraftResult {
  if (!Number.isFinite(input.now.getTime())) throw new Error("Top Signals draft requires a valid fixed clock");
  validateGrowthExperimentConfig(input.config);

  const week = isoWeek(input.now);
  if (week !== input.config.manualWeek && week !== input.config.automaticWeek) {
    return { status: "outside-experiment" };
  }

  const periodStart = new Date(Date.UTC(
    input.now.getUTCFullYear(),
    input.now.getUTCMonth(),
    input.now.getUTCDate() - (input.now.getUTCDay() || 7) + 1,
  ));
  const periodEnd = new Date(periodStart.getTime() + 6 * 24 * 60 * 60 * 1_000);
  const draft: TopSignalsDraft = {
    schemaVersion: 1,
    experimentId: input.config.experimentId,
    week,
    generatedAt: input.now.toISOString(),
    periodStart: periodStart.toISOString().slice(0, 10),
    periodEnd: periodEnd.toISOString().slice(0, 10),
    signals: buildGrowthTopSignals(input.artifact.topSignals, input.now, input.config),
  };
  validateTopSignalsDraft(draft);
  return { status: "in-experiment", draft };
}

export function stageTopSignalsDraft(input: {
  root: string;
  transaction: Pick<FileTransaction, "stage">;
  draft: TopSignalsDraft;
}): void {
  validateTopSignalsDraft(input.draft);
  input.transaction.stage(
    join(input.root, "review", "top-signals-drafts", `${input.draft.week}.json`),
    `${JSON.stringify(input.draft, null, 2)}\n`,
  );
}
