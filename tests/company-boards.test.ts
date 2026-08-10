import assert from "node:assert/strict";
import test from "node:test";
import { buildCompanyBoards } from "../src/company-boards.js";
import type { EvidenceState } from "../src/facts-contract.js";
import type { CompanyProfile, EventRecord } from "../src/types.js";

const NOW = new Date("2026-08-10T00:00:00.000Z");

function company(name: string, overrides: Partial<CompanyProfile> = {}): CompanyProfile {
  return {
    entityId: name.toLowerCase().replace(/\s+/g, "-"), entityType: "公司", name, region: "北美", stage: "成长公司",
    routes: ["VLA 与具身模型"], thesis: `${name} 的受控档案`, officialUrl: `https://${name.toLowerCase().replace(/\s+/g, "-")}.example`,
    sourceIds: [`official-${name}`], profileEvidence: [{ link: `https://${name}.example/about`, source: `${name} 官网`, checkedAt: "2026-08-01", supports: "公司主体与路线" }],
    ...overrides,
  };
}

function event(companyName: string, overrides: Partial<EventRecord> & { evidenceState?: EvidenceState } = {}): EventRecord & { evidenceState?: EvidenceState } {
  return {
    id: `evt-${companyName}`, title: `${companyName} 宣布工厂部署`, type: "部署案例", entities: [companyName], primaryEntity: companyName,
    routes: ["部署与商业化"], status: "已确证", occurredAt: "2026-08-05T00:00:00.000Z", firstSeenAt: "2026-08-05T00:00:00.000Z",
    lastEvidenceAt: "2026-08-05T00:00:00.000Z", lastMaterialChangeAt: "2026-08-05T00:00:00.000Z", lastUpdatedAt: "2026-08-05T00:00:00.000Z", lastVerifiedAt: "2026-08-06T00:00:00.000Z",
    facts: ["已在工厂部署机器人"], openQuestions: [], timeline: [], productDeployment: { deployment: "工厂部署", customers: [] },
    evidence: [{ link: `https://${companyName}.example/news`, source: `${companyName} 官网`, grade: "A", publishedAt: "2026-08-05T00:00:00.000Z", supports: "部署日期与范围" }],
    ...overrides,
  };
}

test("ranks a Top 5 momentum board only from recent A or independent B+B events and exposes score evidence", () => {
  const companies = Array.from({ length: 6 }, (_, index) => company(`Company ${index + 1}`));
  const events = companies.map((item, index) => event(item.name, {
    id: `evt-${index}`, occurredAt: index === 0 ? "2026-08-09T00:00:00.000Z" : `2026-08-0${index + 2}T00:00:00.000Z`,
    ...(index === 0 ? { status: "持续跟踪" as const, evidenceState: "corroborated" as const, evidence: [
      { link: "https://media-one.example/deploy", source: "媒体一", grade: "B" as const, publishedAt: "2026-08-02T00:00:00.000Z", supports: "部署" },
      { link: "https://media-two.example/deploy", source: "媒体二", grade: "B" as const, publishedAt: "2026-08-02T00:00:00.000Z", supports: "部署" },
    ] } : {}),
  }));
  const result = buildCompanyBoards(companies, events, { now: NOW });
  assert.equal(result.momentum.mode, "ranked");
  assert.equal(result.momentum.entries.length, 5);
  assert.deepEqual(result.momentum.entries.map((item) => item.rank), [1, 2, 3, 4, 5]);
  assert.equal(result.momentum.entries.some((item) => item.qualifyingEvents[0]?.evidenceGrade === "B+B"), true);
  assert.equal(result.momentum.entries.every((item) => item.scoreBreakdown.reduce((sum, part) => sum + part.points, 0) === item.score), true);
  assert.equal(result.momentum.entries.every((item) => item.evidenceDates[0]?.startsWith("2026-08")), true);
});

test("rejects single-B, discovery-only, conflicted, withdrawn and stale events from momentum", () => {
  const companies = [company("Single B"), company("Discovery"), company("Conflict"), company("Withdrawn"), company("Stale"), company("Good")];
  const events = [
    event("Single B", { evidence: [{ link: "https://media.example/one", source: "单一媒体", grade: "B", publishedAt: "2026-08-05T00:00:00Z", supports: "报道" }] }),
    event("Discovery", { evidence: [
      { link: "https://news.google.com/a", source: "Google News · 媒体一", grade: "B", publishedAt: "2026-08-05T00:00:00Z", supports: "线索" },
      { link: "https://twitter.example/a", source: "X · 媒体二", grade: "B", publishedAt: "2026-08-05T00:00:00Z", supports: "线索" },
    ] }),
    event("Conflict", { evidenceState: "conflicted" }),
    event("Withdrawn", { evidenceState: "withdrawn" }),
    event("Stale", { occurredAt: "2026-06-01T00:00:00Z", lastVerifiedAt: "2026-08-09T00:00:00Z" }),
    event("Good"),
  ];
  const result = buildCompanyBoards(companies, events, { now: NOW });
  assert.deepEqual(result.momentum.entries.map((item) => item.companyName), ["Good"]);
  assert.equal(result.momentum.entries[0]?.rank, null);
  assert.equal(result.momentum.mode, "watchlist");
});

test("uses the real eventDate rather than crawler timestamps for age and evidence display", () => {
  const oldOccurrence = event("Date Co", {
    occurredAt: undefined, eventDate: "2026-06-30", firstSeenAt: "2026-08-09T00:00:00Z",
    lastEvidenceAt: "2026-08-09T00:00:00Z", lastVerifiedAt: "2026-08-09T00:00:00Z", lastUpdatedAt: "2026-08-09T00:00:00Z",
  });
  const result = buildCompanyBoards([company("Date Co")], [oldOccurrence], { now: NOW });
  assert.equal(result.momentum.sampleSize, 0);
  assert.deepEqual(result.momentum.entries, []);
});

test("keeps strategic scoring independent from momentum and preserves unknown funding semantics", () => {
  const platform = company("Platform", { stage: "平台公司", routes: ["数据与训练", "VLA 与具身模型", "部署与商业化"] });
  const startup = company("Startup", { stage: "创业公司", routes: ["本体与硬件"] });
  const before = buildCompanyBoards([platform, startup], [], { now: NOW });
  const after = buildCompanyBoards([platform, startup], [event("Startup")], { now: NOW });
  assert.deepEqual(after.strategic.entries, before.strategic.entries);
  assert.equal(after.strategic.mode, "watchlist");
  assert.equal(after.strategic.entries.every((item) => item.rank === null), true);
  assert.equal(after.strategic.entries.every((item) => item.capital.state === "evidence_insufficient" && item.capital.value === "unknown"), true);
  assert.equal(after.strategic.entries.every((item) => item.capital.note.includes("不代表该公司未融资")), true);
});

test("is idempotent and deterministically degrades samples below the ranking threshold", () => {
  const companies = [company("Zulu"), company("Alpha")];
  const events = [event("Zulu"), event("Alpha")];
  const first = buildCompanyBoards(companies, events, { now: NOW, minimumSampleSize: 3 });
  const second = buildCompanyBoards([...companies].reverse(), [...events].reverse(), { now: NOW, minimumSampleSize: 3 });
  assert.deepEqual(first, second);
  assert.equal(first.momentum.mode, "watchlist");
  assert.deepEqual(first.momentum.entries.map((item) => item.rank), [null, null]);
  assert.deepEqual(first.momentum.entries.map((item) => item.companyName), ["Alpha", "Zulu"]);
});
