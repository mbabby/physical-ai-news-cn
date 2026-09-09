import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readRecentDailyArchives, readRecentDailyArticles } from "../src/weekly.js";

test("historical replay excludes future daily files and future articles but includes Shanghai today", async () => {
  const root = await mkdtemp(join(tmpdir(), "archive-time-boundary-"));
  const now = new Date("2026-09-07T17:00:00Z"); // Shanghai Sep8 01:00
  try {
    for (const date of ["2026-09-07", "2026-09-08", "2026-09-09"]) {
      await writeFile(join(root, `${date}.json`), JSON.stringify({ date, articles: [
        { id: `${date}-past`, publishedAt: "2026-09-07T16:30:00Z", fetchedAt: "2026-09-07T16:30:00Z" },
        { id: `${date}-future`, publishedAt: "2026-09-08T00:00:00Z", fetchedAt: "2026-09-08T00:00:00Z" },
      ] }));
    }
    assert.deepEqual((await readRecentDailyArchives(root, now)).map((a) => a.date).sort(), ["2026-09-07", "2026-09-08"]);
    assert.deepEqual((await readRecentDailyArticles(root, now)).map((a) => a.id).sort(), ["2026-09-07-past", "2026-09-08-past"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
