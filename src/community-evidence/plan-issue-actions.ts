import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertEvidenceIssueSnapshot,
  assertEvidenceTaskLedgerArtifact,
  assertEvidenceTaskSeedArtifact,
} from "./contracts.js";
import { planEvidenceIssueActions } from "./task-ledger.js";

interface Arguments {
  seeds: string;
  issues: string;
  ledger: string;
  now: string;
  out: string;
  wipLimit: number;
}

function parseArguments(argv: string[]): Arguments {
  const usage = "Usage: plan-issue-actions --seeds <path> --issues <path> --ledger <path> --now <ISO> --out <path> [--wip-limit <positive integer>]";
  const required = ["--seeds", "--issues", "--ledger", "--now", "--out"] as const;
  const allowed = new Set([...required, "--wip-limit"]);
  const parsed = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag || !allowed.has(flag) || !value || value.startsWith("--") || parsed.has(flag)) {
      throw new Error(usage);
    }
    parsed.set(flag, value);
  }
  if (!required.every((flag) => parsed.has(flag))) throw new Error(usage);
  const requestedWipLimit = parsed.get("--wip-limit");
  if (requestedWipLimit !== undefined && !/^[1-9]\d*$/.test(requestedWipLimit)) throw new Error(usage);
  return {
    seeds: parsed.get("--seeds")!,
    issues: parsed.get("--issues")!,
    ledger: parsed.get("--ledger")!,
    now: parsed.get("--now")!,
    out: parsed.get("--out")!,
    wipLimit: requestedWipLimit === undefined || BigInt(requestedWipLimit) > 5n ? 5 : Number(requestedWipLimit),
  };
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

export async function runPlanIssueActions(argv: string[]): Promise<void> {
  const args = parseArguments(argv);
  const [seeds, issues, previousLedger] = await Promise.all([
    readJson(args.seeds),
    readJson(args.issues),
    readJson(args.ledger),
  ]);
  assertEvidenceTaskSeedArtifact(seeds);
  assertEvidenceIssueSnapshot(issues);
  assertEvidenceTaskLedgerArtifact(previousLedger);
  const result = planEvidenceIssueActions({ seeds, issues, previousLedger, now: args.now, wipLimit: args.wipLimit });
  assertEvidenceTaskLedgerArtifact(result.ledger);
  await writeFile(args.out, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runPlanIssueActions(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
