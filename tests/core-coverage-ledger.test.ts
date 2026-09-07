import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildCompanyClaimLedger } from "../src/company-claim-ledger.js";
import type { CoverageVersion } from "../src/core-coverage/contracts.js";
import { canonicalCompanyEventOwners, validateDualLedgers } from "../src/dual-ledger.js";
import type { CompanyProfile, EventRecord } from "../src/types.js";

const NOW = new Date("2026-09-06T00:00:00.000Z");
const companies = JSON.parse(await readFile(new URL("../events/companies.json", import.meta.url), "utf8")) as CompanyProfile[];
const config = JSON.parse(await readFile(new URL("../config/core-coverage.json", import.meta.url), "utf8")) as CoverageVersion;

function event(overrides: Partial<EventRecord>): EventRecord {
  return {
    id: "evt-subject", title: "主体发布研究成果", type: "研究与数据", entities: [], primaryEntity: "",
    routes: ["VLA 与具身模型"], status: "已确证", occurredAt: "2026-09-01T00:00:00.000Z",
    firstSeenAt: "2026-09-01T00:00:00.000Z", lastEvidenceAt: "2026-09-01T00:00:00.000Z",
    lastMaterialChangeAt: "2026-09-01T00:00:00.000Z", lastUpdatedAt: "2026-09-01T00:00:00.000Z",
    lastVerifiedAt: "2026-09-01T00:00:00.000Z", facts: [], openQuestions: [], timeline: [],
    evidence: [{ link: "https://example.com/evidence", source: "主体官网", grade: "A", publishedAt: "2026-09-01T00:00:00.000Z", supports: "事件日期 2026-09-01；产品 机器人策略模型" }],
    productDeployment: { product: "机器人策略模型", customers: [] },
    ...overrides,
  };
}

test("keeps legacy Top 15 while explicit coverage selects all 30 configured subjects in list order", () => {
  const coverageCompanyIds = config.members.map((member) => member.companyId);
  const legacy = buildCompanyClaimLedger(companies, [], { now: NOW });
  const core = buildCompanyClaimLedger([...companies].reverse(), [], { now: NOW, coverageCompanyIds });

  assert.equal(legacy.companies.length, 15);
  assert.equal(core.companies.length, 30);
  assert.deepEqual(core.companies.map((entry) => entry.companyId), coverageCompanyIds);
  assert.equal(core.limit, 30);
  assert.equal(core.metrics.companiesWithEligibleEvents, 0);
});

test("explicit coverage rejects duplicate and unknown canonical IDs", () => {
  assert.throws(
    () => buildCompanyClaimLedger(companies, [], { now: NOW, coverageCompanyIds: ["unitree", "unitree"] }),
    /重复.*unitree/,
  );
  assert.throws(
    () => buildCompanyClaimLedger(companies, [], { now: NOW, coverageCompanyIds: ["unitree", "not-in-company-registry"] }),
    /未知.*not-in-company-registry/,
  );
});

test("explicit coverage ignores the legacy limit and permits a laboratory with no fabricated funding claim", () => {
  const ledger = buildCompanyClaimLedger(companies, [], {
    now: NOW,
    limit: 0,
    coverageCompanyIds: ["toyota-research-institute"],
  });

  assert.equal(ledger.companies.length, 1);
  assert.deepEqual(ledger.companies[0]!.claims, []);
});

test("attributes financing only to its primary canonical subject, not a mentioned subsidiary", () => {
  const financing = event({
    id: "evt-parent-financing", title: "XPeng 完成融资", type: "投融资",
    primaryEntity: "XPeng", entities: ["XPeng", "小鹏机器人"],
    funding: { entityStatus: "已确认", round: "战略融资", amount: "10 亿美元", investors: [] },
    productDeployment: undefined,
    evidence: [{ link: "https://example.com/xpeng", source: "XPeng 官网", grade: "A", publishedAt: "2026-09-01T00:00:00.000Z", supports: "事件日期 2026-09-01；战略融资轮次；金额 10 亿美元" }],
  });
  const ledger = buildCompanyClaimLedger(companies, [financing], { now: NOW, coverageCompanyIds: ["xpeng-robotics"] });

  assert.equal(ledger.companies[0]!.claims.some((claim) => claim.eventIds.includes("evt-parent-financing")), false);
  assert.equal(ledger.companies[0]!.metrics.attributedEventCount, 0);
});

test("does not treat TRI as investee when mentioned in Toyota financing, but retains TRI research", () => {
  const toyotaFunding = event({
    id: "evt-toyota-financing", title: "Toyota 完成融资", type: "投融资",
    primaryEntity: "Toyota Motor Corporation", entities: ["Toyota Motor Corporation", "Toyota Research Institute", "TRI"],
    funding: { entityStatus: "已确认", round: "战略融资", amount: "10 亿美元", investors: [] },
    productDeployment: undefined,
  });
  const triResearch = event({
    id: "evt-tri-research", title: "TRI 发布机器人策略模型",
    primaryEntity: "TRI", entities: ["Toyota Research Institute", "TRI"],
  });
  const ledger = buildCompanyClaimLedger(companies, [toyotaFunding, triResearch], {
    now: NOW,
    coverageCompanyIds: ["toyota-research-institute"],
  });

  assert.deepEqual(ledger.companies[0]!.claims.map((claim) => claim.eventIds), [["evt-tri-research"]]);
  assert.equal(ledger.companies[0]!.claims[0]!.claimType, "research-team");
  assert.equal(ledger.companies[0]!.metrics.attributedEventCount, 1);
});

test("does not attribute an event through an alias shared by multiple canonical subjects", () => {
  const ambiguousCompanies: CompanyProfile[] = [
    { entityId: "alpha-lab", entityType: "实验室", name: "Alpha Lab", aliases: ["Shared Lab"], region: "北美", routes: [], thesis: "测试", officialUrl: "https://alpha.example" },
    { entityId: "beta-lab", entityType: "实验室", name: "Beta Lab", aliases: ["Shared Lab"], region: "北美", routes: [], thesis: "测试", officialUrl: "https://beta.example" },
  ];
  const ambiguousEvent = event({ primaryEntity: "Shared Lab", entities: ["Shared Lab"] });
  const ledger = buildCompanyClaimLedger(ambiguousCompanies, [ambiguousEvent], {
    now: NOW,
    coverageCompanyIds: ["alpha-lab", "beta-lab"],
  });

  assert.deepEqual(ledger.companies.map((entry) => entry.claims), [[], []]);
  assert.equal(ledger.metrics.attributedEventCount, 0);
});

test("uses the same canonical alias and ID ownership in ledger construction and dual-ledger validation", () => {
  const alpha: CompanyProfile = {
    entityId: "alpha-lab", entityType: "实验室", name: "Alpha Laboratory", legalName: "Alpha Research Institute",
    aliases: ["ARI"], region: "北美", routes: [], thesis: "测试", officialUrl: "https://alpha.example",
  };
  for (const primaryEntity of ["ARI", "alpha-lab", "Alpha Research Institute"]) {
    const research = event({ id: `evt-${primaryEntity}`, primaryEntity, entities: [primaryEntity] });
    const companyLedger = buildCompanyClaimLedger([alpha], [research], { now: NOW, coverageCompanyIds: ["alpha-lab"] });
    assert.doesNotThrow(() => validateDualLedgers({
      company: companyLedger,
      benchmark: { generatedAt: companyLedger.generatedAt, entries: [] },
      companyIds: new Set(["alpha-lab"]),
      companyEventOwners: canonicalCompanyEventOwners([alpha], [research]),
      paperIds: new Set(), decisionCards: [], expectedGeneratedAt: companyLedger.generatedAt,
    }));
  }
});

test("dual-ledger validation fails closed when an event primary identity is ambiguous", () => {
  const alpha: CompanyProfile = { entityId: "alpha-lab", entityType: "实验室", name: "Alpha Lab", aliases: ["Shared Lab"], region: "北美", routes: [], thesis: "测试", officialUrl: "https://alpha.example" };
  const beta: CompanyProfile = { entityId: "beta-lab", entityType: "实验室", name: "Beta Lab", aliases: ["Shared Lab"], region: "北美", routes: [], thesis: "测试", officialUrl: "https://beta.example" };
  const research = event({ primaryEntity: "Shared Lab", entities: ["Shared Lab"] });
  const companyLedger = buildCompanyClaimLedger([alpha], [research], { now: NOW, coverageCompanyIds: ["alpha-lab"] });

  assert.throws(() => validateDualLedgers({
    company: companyLedger,
    benchmark: { generatedAt: companyLedger.generatedAt, entries: [] },
    companyIds: new Set(["alpha-lab", "beta-lab"]),
    companyEventOwners: canonicalCompanyEventOwners([alpha, beta], [research]),
    paperIds: new Set(), decisionCards: [], expectedGeneratedAt: companyLedger.generatedAt,
  }), /non-canonical company event/);
});

test("explicit laboratory coverage retains research only and suppresses funding or deployment claims", () => {
  const triFunding = event({ id: "evt-tri-funding", type: "投融资", primaryEntity: "TRI", entities: ["TRI"], funding: { entityStatus: "已确认", round: "Seed", amount: "1000 万美元", investors: [] }, productDeployment: undefined });
  const triDeployment = event({ id: "evt-tri-deployment", type: "部署案例", primaryEntity: "TRI", entities: ["TRI"] });
  const triResearch = event({ id: "evt-tri-research-only", primaryEntity: "TRI", entities: ["TRI"] });
  const ledger = buildCompanyClaimLedger(companies, [triFunding, triDeployment, triResearch], {
    now: NOW,
    coverageCompanyIds: ["toyota-research-institute"],
  });

  assert.deepEqual(ledger.companies[0]!.claims.map((claim) => claim.claimType), ["research-team"]);
  assert.deepEqual(ledger.companies[0]!.claims[0]!.eventIds, ["evt-tri-research-only"]);
});
