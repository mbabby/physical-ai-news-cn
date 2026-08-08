import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPipelineHealth, validateHistoryContinuity } from "./runtime/health.js";
import { isObject, readJsonStrict } from "./runtime/storage.js";
import type { RunHistory } from "./types.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

async function main(): Promise<void> {
  const history = await readJsonStrict<RunHistory>(join(root, "review", "run-history.json"), {
    label: "运行历史",
    validate: (value): value is RunHistory => isObject(value) && value.schemaVersion === 1 && Array.isArray(value.runs),
  });
  if (!history) throw new Error("缺少运行历史");
  const continuityErrors = validateHistoryContinuity(history);
  if (continuityErrors.length) throw new Error(`运行连续性异常：\n- ${continuityErrors.join("\n- ")}`);
  const health = buildPipelineHealth(history, new Date());
  console.log(JSON.stringify(health, null, 2));
  if (health.status === "stale") throw new Error(health.reasons.join("；"));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
