import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Reset only a test's temporary checkout, never the source repository. Shared
 * publication histories are outputs, not inputs to historical-clock fixtures.
 * Tests add the particular canonical events they intend to exercise afterward. */
export async function resetPublicationFixture(root: string, now: Date, options: { coreCoverage?: boolean } = {}): Promise<void> {
  const paths = [
    "events/company-claim-ledger.json", "research/benchmark-result-ledger.json",
    "review/run-history.json", "review/cases.json", "review/assignments.json",
    "site/data/decision-products.json", "review/decision-products-retention.json",
    "site/data/core-coverage.json", "site/data/core-coverage-history.json", "site/feeds/core-coverage.xml",
    "events/core-coverage-history.json", "review/core30-backfill.json",
    "watchlist/current.json", "watchlist/theses.json",
    ...(!options.coreCoverage ? ["config/core-coverage.json"] : []),
  ];
  await Promise.all(paths.map((path) => rm(join(root, path), { force: true })));
  await rm(join(root, "watchlist/history"), { recursive: true, force: true });
  await mkdir(join(root, "watchlist/history"), { recursive: true });
  await mkdir(join(root, "events"), { recursive: true });
  await writeFile(join(root, "events/index.json"), `${JSON.stringify({ updatedAt: now.toISOString(), events: [] }, null, 2)}\n`);
}
