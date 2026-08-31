import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { prepareTopSignalsRelease, publishTopSignalsRelease, validateTopSignalsPublication } from "./publish.js";

const defaultRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function option(args: string[], name: string, required = true): string | undefined {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (required && (!value || value.startsWith("--"))) throw new Error(`Missing required option ${name}`);
  return value;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const root = resolve(option(args, "--root", false) ?? defaultRoot);
  const week = option(args, "--week")!;
  if (command === "prepare") {
    const out = resolve(option(args, "--out")!);
    await prepareTopSignalsRelease(root, week, out);
    return;
  }
  if (command === "publish") {
    const releaseUrl = option(args, "--release-url")!;
    const publishedAt = option(args, "--published-at", false) ?? new Date().toISOString();
    const out = await mkdtemp(join(tmpdir(), "top-signals-publish-gate-"));
    try {
      const { draft } = await prepareTopSignalsRelease(root, week, out);
      await publishTopSignalsRelease({ root, draft, releaseUrl, publishedAt });
    } finally {
      await rm(out, { recursive: true, force: true });
    }
    return;
  }
  if (command === "validate") {
    await validateTopSignalsPublication(root, week);
    return;
  }
  throw new Error("Usage: cli.ts <prepare|publish|validate> --week YYYY-Www [options]");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
