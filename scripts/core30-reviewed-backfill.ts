/** One-time explicit local operator driver. Never imported by daily CLI. */
import { cp, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { generate } from "../src/main.js";
import type { ReviewedBackfill } from "../src/core-coverage/reviewed-ingest.js";

export async function runReviewedOfflineGeneration(options: { outputRoot: string; input?: ReviewedBackfill; now: Date }) {
  const keys = ["LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL", "OPENALEX_API_KEY", "X_BEARER_TOKEN", "GITHUB_TOKEN", "GITHUB_REPOSITORY"];
  const saved = keys.map((key) => process.env[key]);
  const previousFetch = globalThis.fetch;
  keys.forEach((key) => delete process.env[key]);
  globalThis.fetch = async () => { throw new Error("Reviewed offline generation blocks external network"); };
  const empty = async () => ({ articles: [], failures: [], sourceOutcomes: [] });
  try {
    return await generate({ root: options.outputRoot, now: options.now, reviewedBackfill: options.input,
      collect: empty, collectX: empty, resolveAcceptedEvidenceHost: async () => { throw new Error("Offline DNS disabled"); } });
  } finally {
    globalThis.fetch = previousFetch;
    keys.forEach((key, index) => { if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index]; });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    if (!["--output-root", "--seed-root", "--input", "--now"].includes(args[index]) || !args[index + 1] || values.has(args[index])) throw new Error("Expected --output-root PATH --now ISO [--seed-root PATH] [--input REVIEWED_JSON]");
    values.set(args[index], args[index + 1]);
  }
  if (!values.has("--output-root") || !values.has("--now")) throw new Error("Explicit output root and clock required");
  const outputRoot = resolve(values.get("--output-root")!);
  const now = new Date(values.get("--now")!);
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid --now");
  const input = values.has("--input") ? JSON.parse(await readFile(resolve(values.get("--input")!), "utf8")) as ReviewedBackfill : undefined;
  if (values.has("--seed-root")) {
    if ((await readdir(outputRoot)).length) throw new Error("Seed destination must be an existing empty isolated directory");
    const seedRoot = resolve(values.get("--seed-root")!);
    for (const path of ["README.md", "daily", "weekly", "sources", "review", "resources", "events", "experiments", "research", "routes", "metrics", "site", "watchlist", "community", "config"]) {
      await cp(join(seedRoot, path), join(outputRoot, path), { recursive: true });
    }
  }
  const manifest = await runReviewedOfflineGeneration({ outputRoot, input, now });
  console.log(JSON.stringify({ outputRoot, mode: input ? "explicit-reviewed-backfill" : "offline-normal-regeneration", manifest }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch((error) => { console.error(error); process.exitCode = 1; });
