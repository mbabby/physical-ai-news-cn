import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { generate } from "../src/main.js";
import { FileTransaction } from "../src/runtime/storage.js";
import type { DigestResult } from "../src/types.js";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXED_NOW = new Date("2026-08-23T08:00:00.000Z");
const FIXTURE_PATHS = [
  "README.md", "daily", "weekly", "sources", "review", "resources", "events",
  "research", "routes", "metrics", "site/data", "site/feeds", "watchlist",
];

const emptyCollection = async (): Promise<DigestResult> => ({ articles: [], failures: [], sourceOutcomes: [] });

async function copyFixture(target: string): Promise<void> {
  for (const path of FIXTURE_PATHS) await cp(join(repositoryRoot, path), join(target, path), { recursive: true });
}

async function fixedGenerate(root: string, transaction?: FileTransaction) {
  const previous = {
    llmKey: process.env.LLM_API_KEY,
    llmBase: process.env.LLM_BASE_URL,
    llmModel: process.env.LLM_MODEL,
    openAlex: process.env.OPENALEX_API_KEY,
  };
  delete process.env.LLM_API_KEY;
  delete process.env.LLM_BASE_URL;
  delete process.env.LLM_MODEL;
  delete process.env.OPENALEX_API_KEY;
  try {
    return await generate({ root, now: FIXED_NOW, collect: emptyCollection, collectX: emptyCollection, transaction });
  } finally {
    const restore = (name: "LLM_API_KEY" | "LLM_BASE_URL" | "LLM_MODEL" | "OPENALEX_API_KEY", value: string | undefined) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    restore("LLM_API_KEY", previous.llmKey);
    restore("LLM_BASE_URL", previous.llmBase);
    restore("LLM_MODEL", previous.llmModel);
    restore("OPENALEX_API_KEY", previous.openAlex);
  }
}

async function ledgerBytes(root: string): Promise<Record<string, string>> {
  const paths = [
    "events/company-claim-ledger.json",
    "research/benchmark-result-ledger.json",
    "review/dual-ledger-metrics.json",
  ];
  return Object.fromEntries(await Promise.all(paths.map(async (path) => [path, await readFile(join(root, path), "utf8")] as const)));
}

test("daily generation publishes both ledgers and metrics byte-identically for a fixed rerun", async () => {
  const root = await mkdtemp(join(tmpdir(), "dual-ledger-idempotence-"));
  try {
    await copyFixture(root);
    await fixedGenerate(root);
    const first = await ledgerBytes(root);
    const company = JSON.parse(first["events/company-claim-ledger.json"]!) as { generatedAt: string };
    const benchmark = JSON.parse(first["research/benchmark-result-ledger.json"]!) as { generatedAt: string };
    const metrics = JSON.parse(first["review/dual-ledger-metrics.json"]!) as { generatedAt: string };
    assert.equal(company.generatedAt, FIXED_NOW.toISOString());
    assert.equal(benchmark.generatedAt, company.generatedAt);
    assert.equal(metrics.generatedAt, company.generatedAt);

    await fixedGenerate(root);
    assert.deepEqual(await ledgerBytes(root), first);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("corrupt previous ledgers stop generation before publishing another ledger generation", async () => {
  const root = await mkdtemp(join(tmpdir(), "dual-ledger-corrupt-prior-"));
  try {
    await copyFixture(root);
    await fixedGenerate(root);
    const before = await ledgerBytes(root);
    await writeFile(join(root, "events", "company-claim-ledger.json"), "{not-json\n", "utf8");

    await assert.rejects(() => fixedGenerate(root), (error: unknown) => {
      assert.equal((error as { code?: string }).code, "corrupt-dual-ledger");
      return true;
    });
    assert.equal(await readFile(join(root, "research", "benchmark-result-ledger.json"), "utf8"), before["research/benchmark-result-ledger.json"]);
    assert.equal(await readFile(join(root, "review", "dual-ledger-metrics.json"), "utf8"), before["review/dual-ledger-metrics.json"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("malformed current claims and forged correction histories fail closed", async (t) => {
  const baseline = await mkdtemp(join(tmpdir(), "dual-ledger-strict-prior-"));
  try {
    await copyFixture(baseline);
    await fixedGenerate(baseline);
    await t.test("partial current field schema is not accepted as legacy", async () => {
      const root = await mkdtemp(join(tmpdir(), "dual-ledger-partial-current-"));
      try {
        await cp(baseline, root, { recursive: true });
        const path = join(root, "events", "company-claim-ledger.json");
        const ledger = JSON.parse(await readFile(path, "utf8")) as { companies: Array<{ claims: Array<{ fields: unknown }> }> };
        ledger.companies[0]!.claims[0]!.fields = {};
        await writeFile(path, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
        await assert.rejects(() => fixedGenerate(root), (error: unknown) => (error as { code?: string }).code === "corrupt-dual-ledger");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
    await t.test("forged correction IDs and chains are rejected", async () => {
      const root = await mkdtemp(join(tmpdir(), "dual-ledger-forged-correction-"));
      try {
        await cp(baseline, root, { recursive: true });
        const path = join(root, "events", "company-claim-ledger.json");
        const ledger = JSON.parse(await readFile(path, "utf8")) as { generatedAt: string; companies: Array<{ claims: Array<Record<string, unknown>> }> };
        const claim = ledger.companies[0]!.claims[0]!;
        const field = (claim.fields as Record<string, unknown>).amount;
        claim.corrections = [{
          correctionId: "ledger-correction-forged",
          ledgerType: "company-claim",
          subjectId: claim.claimId,
          fieldPath: "fields.amount",
          before: field,
          after: field,
          reason: "metadata-correction",
          evidenceIds: [],
          correctedAt: ledger.generatedAt,
        }];
        await writeFile(path, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
        await assert.rejects(() => fixedGenerate(root), (error: unknown) => (error as { code?: string }).code === "corrupt-dual-ledger");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  } finally {
    await rm(baseline, { recursive: true, force: true });
  }
});

test("transaction failure rolls back both ledgers and their shared metrics", async () => {
  const root = await mkdtemp(join(tmpdir(), "dual-ledger-rollback-"));
  try {
    await copyFixture(root);
    await fixedGenerate(root);
    const before = await ledgerBytes(root);

    await assert.rejects(() => fixedGenerate(root, new FileTransaction("dual-ledger-failure", {
      failAfterPath: join(root, "review", "dual-ledger-metrics.json"),
    })), (error: unknown) => {
      assert.equal((error as { code?: string }).code, "transaction-swap-failure");
      return true;
    });
    assert.deepEqual(await ledgerBytes(root), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
