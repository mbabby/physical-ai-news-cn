import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { blockingHistoryContinuityErrors, buildPipelineHealth } from "./runtime/health.js";
import { isObject, readJsonStrict } from "./runtime/storage.js";
import type { RunHistory } from "./types.js";

const root = process.env.PIPELINE_HEALTH_ROOT
  ? resolve(process.env.PIPELINE_HEALTH_ROOT)
  : join(dirname(fileURLToPath(import.meta.url)), "..");
const now = process.env.PIPELINE_HEALTH_NOW ? new Date(process.env.PIPELINE_HEALTH_NOW) : new Date();

async function main(): Promise<void> {
  const history = await readJsonStrict<RunHistory>(join(root, "review", "run-history.json"), {
    label: "运行历史",
    validate: (value): value is RunHistory => isObject(value) && value.schemaVersion === 1 && Array.isArray(value.runs),
  });
  if (!history) throw new Error("缺少运行历史");
  const continuityErrors = blockingHistoryContinuityErrors(history);
  if (continuityErrors.length) throw new Error(`运行连续性异常：\n- ${continuityErrors.join("\n- ")}`);
  const health = buildPipelineHealth(history, now);
  console.log(JSON.stringify(health, null, 2));
  if (health.status === "stale") throw new Error(health.reasons.join("；"));
  if (health.dailyPublicationFreshness.state === "missing") throw new Error("北京时间日报未在 09:20 前成功发布");
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
