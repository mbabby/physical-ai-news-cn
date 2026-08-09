import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { upsertEvents } from "../src/event-center.js";
import { migrateEventTime } from "../src/event-time.js";
import type { CompanyProfile, EventStore } from "../src/types.js";

const target = process.argv[2];
if (!target) throw new Error("用法：tsx scripts/migrate-event-times.ts <event-store.json> [--write]");

const file = resolve(target);
const input = JSON.parse(await readFile(file, "utf8")) as EventStore;
const companyFile = join(dirname(file), "companies.json");
const companies = await readFile(companyFile, "utf8").then((body) => JSON.parse(body) as CompanyProfile[]).catch(() => []);
const migrated: EventStore = { ...input, events: input.events.map(migrateEventTime) };
// Running the regular normalizer with no new articles also removes legacy
// research, discovery-only and unnamed records that must live in candidate
// archives rather than the public fact store.
const output = upsertEvents(migrated, [], new Date(input.updatedAt), companies);
const body = `${JSON.stringify(output, null, 2)}\n`;

if (process.argv.includes("--write")) {
  await writeFile(file, body, "utf8");
  process.stdout.write(`已迁移 ${output.events.length} 条事件：${file}\n`);
} else {
  process.stdout.write(body);
}
