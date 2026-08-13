import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("daily generation stages watchlist artifacts as review-only files", async () => {
  const source = await readFile(join(root, "src", "main.ts"), "utf8");

  assert.match(source, /join\(reviewDir, "watchlist-seeds\.json"\)/);
  assert.match(source, /join\(reviewDir, "watchlist-drafts\.json"\)/);
});

test("watchlist generation follows the claim ledger and shares canonical dashboard inputs", async () => {
  const source = await readFile(join(root, "src", "main.ts"), "utf8");
  const ledger = source.indexOf("const companyClaimLedger = buildCompanyClaimLedger");
  const boards = source.indexOf("const companyBoards = buildCompanyBoards");
  const seeds = source.indexOf("buildThesisSeeds({");
  const dashboard = source.indexOf("buildDashboard(eventStore");

  assert.ok(ledger >= 0 && boards > ledger && seeds > boards && dashboard > seeds);
  assert.match(source, /buildCompanyBoards\(companies, eventStore\.events, \{[\s\S]*?claimLedger: companyClaimLedger/);
  assert.match(source, /buildThesisSeeds\(\{[\s\S]*?events: eventStore\.events,[\s\S]*?boards: companyBoards,[\s\S]*?claimLedger: companyClaimLedger/);
  assert.match(source, /buildDashboard\(eventStore, companies,[\s\S]*?companyClaimLedger,/);
});

test("public consumers do not reference stage-one watchlist artifacts", async () => {
  const [siteData, readme] = await Promise.all([
    readFile(join(root, "src", "site-data.ts"), "utf8"),
    readFile(join(root, "README.md"), "utf8"),
  ]);

  assert.doesNotMatch(siteData, /watchlist-(?:seeds|drafts)/);
  assert.doesNotMatch(readme, /watchlist-(?:seeds|drafts)/);
});
