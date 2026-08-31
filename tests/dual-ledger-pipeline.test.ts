import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
  "README.md", "daily", "weekly", "sources", "review", "resources", "events", "experiments",
  "research", "routes", "metrics", "site/data", "site/feeds", "watchlist", "community",
];

const emptyCollection = async (): Promise<DigestResult> => ({ articles: [], failures: [], sourceOutcomes: [] });

async function copyFixture(target: string): Promise<void> {
  for (const path of FIXTURE_PATHS) await cp(join(repositoryRoot, path), join(target, path), { recursive: true });
  await rm(join(target, "site/data/decision-products.json"), { force: true });
  await rm(join(target, "watchlist", "current.json"), { force: true });
  await rm(join(target, "watchlist", "theses.json"), { force: true });
  await rm(join(target, "watchlist", "history"), { recursive: true, force: true });
  await mkdir(join(target, "watchlist", "history"), { recursive: true });
}

async function fixedGenerate(root: string, transaction?: FileTransaction, now = FIXED_NOW) {
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
    return await generate({ root, now, collect: emptyCollection, collectX: emptyCollection, transaction });
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

async function writeFundingCycleState(root: string, amount: string, now: Date): Promise<{ companyId: string; eventId: string }> {
  const companies = JSON.parse(await readFile(join(root, "events", "companies.json"), "utf8") as string) as Array<{
    entityId: string; name: string; officialUrl: string;
  }>;
  const company = companies[0]!;
  const eventId = "evt-pipeline-correction-cycle";
  const timestamp = now.toISOString();
  await writeFile(join(root, "events", "index.json"), `${JSON.stringify({
    updatedAt: timestamp,
    events: [{
      id: eventId,
      title: `${company.name} 完成 ${amount} 融资`,
      type: "投融资",
      entities: [company.name],
      primaryEntity: company.name,
      routes: ["VLA 与具身模型"],
      status: "已确证",
      occurredAt: "2026-08-01T00:00:00.000Z",
      firstSeenAt: "2026-08-01T00:00:00.000Z",
      lastEvidenceAt: timestamp,
      lastMaterialChangeAt: timestamp,
      lastUpdatedAt: timestamp,
      lastVerifiedAt: timestamp,
      facts: [], openQuestions: [], timeline: [],
      funding: { entityStatus: "已确认", round: "Seed", amount, investors: [] },
      evidence: [{
        link: `${company.officialUrl.replace(/\/$/, "")}/news/pipeline-cycle`,
        source: `${company.name} 官方公告`,
        grade: "A",
        publishedAt: "2026-08-01T00:00:00.000Z",
        supports: `事件日期 2026-08-01；Seed 轮次；金额 ${amount}`,
      }],
    }],
  }, null, 2)}\n`, "utf8");
  return { companyId: company.entityId, eventId };
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
    assert.deepEqual(await readdir(join(root, "watchlist", "history")), []);
    await fixedGenerate(root);
    assert.equal((await readdir(join(root, "watchlist", "history"))).length, 1);
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

test("daily generation publishes a continuous A to B to A to B correction cycle", async () => {
  const root = await mkdtemp(join(tmpdir(), "dual-ledger-correction-cycle-"));
  try {
    await copyFixture(root);
    const states = [
      ["1200 万美元", new Date("2026-08-23T08:00:00.000Z")],
      ["1300 万美元", new Date("2026-08-24T08:00:00.000Z")],
      ["1200 万美元", new Date("2026-08-25T08:00:00.000Z")],
      ["1300 万美元", new Date("2026-08-26T08:00:00.000Z")],
    ] as const;
    let identity: { companyId: string; eventId: string } | undefined;
    for (const [amount, now] of states) {
      identity = await writeFundingCycleState(root, amount, now);
      await fixedGenerate(root, undefined, now);
    }

    const ledger = JSON.parse(await readFile(join(root, "events", "company-claim-ledger.json"), "utf8") as string) as {
      companies: Array<{ companyId: string; claims: Array<{ eventIds: string[]; corrections: Array<{ correctionId: string; fieldPath: string; before: { value: unknown }; after: { value: unknown } }> }> }>;
    };
    const claim = ledger.companies.find((company) => company.companyId === identity!.companyId)!
      .claims.find((item) => item.eventIds.includes(identity!.eventId))!;
    const amountCorrections = claim.corrections.filter((item) => item.fieldPath === "fields.amount");
    assert.equal(amountCorrections.length, 3);
    assert.equal(new Set(amountCorrections.map((item) => item.correctionId)).size, 3);
    assert.deepEqual(amountCorrections.map((item) => [item.before.value, item.after.value]), [
      ["1200 万美元", "1300 万美元"],
      ["1300 万美元", "1200 万美元"],
      ["1200 万美元", "1300 万美元"],
    ]);
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
