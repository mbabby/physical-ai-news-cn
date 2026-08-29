import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildCompanyClaimLedger } from "../src/company-claim-ledger.js";
import { stableDecisionId, type DecisionProductArtifact } from "../src/decision-products/contracts.js";
import {
  assertAcceptedEvidenceRevalidationArtifact,
  revalidateAcceptedEvidence,
} from "../src/community-evidence/revalidation.js";
import {
  buildContributionEventId,
  buildEvidenceTaskId,
  type AcceptedEvidenceArtifact,
  type EvidenceSubject,
  type EvidenceTargetField,
} from "../src/community-evidence/contracts.js";
import type { ArticleKind, CompanyProfile, EventRecord, ResearchRecord, SourceConfig } from "../src/types.js";

const NOW = new Date("2026-08-25T12:00:00Z");
const ACCEPTED_AT = "2026-08-25T10:00:00Z";
const URL = "https://alpha.example/funding?round=seed&a=1";
const PAGES = "https://mbabby.github.io/physical-ai-news-cn";
const subject: EvidenceSubject = { kind: "company", id: "alpha", name: "Alpha Robotics", url: "https://alpha.example/" };
const company = {
  entityId: "alpha", name: "Alpha Robotics", aliases: ["Alpha"], region: "全球", routes: [], thesis: "fixture",
  officialUrl: "https://alpha.example/", officialDomains: ["alpha.example"],
} as CompanyProfile;

function accepted(targetField: EvidenceTargetField = "funding.amount", evidenceUrl = URL, acceptedSubject = subject): AcceptedEvidenceArtifact {
  const taskId = buildEvidenceTaskId(acceptedSubject, targetField, "material-1");
  return {
    schemaVersion: 1,
    generatedAt: NOW.toISOString(),
    entries: [{
      id: buildContributionEventId({ taskId, issueNumber: 41, contributor: "alice", evidenceUrl, state: "accepted", occurredAt: ACCEPTED_AT }),
      taskId, issueNumber: 41, category: targetField.startsWith("funding.") || targetField.startsWith("company.")
        ? "company-funding" : targetField.startsWith("research.") ? "research-metadata" : "product-deployment",
      subject: acceptedSubject, targetField, contributor: "alice", evidenceUrl, acceptedAt: ACCEPTED_AT,
    }],
  };
}

function event(evidence = [{ link: URL, source: "Alpha 官网", grade: "A" as const, publishedAt: "2026-08-24T08:00:00Z", supports: "融资金额 $10M" }]): EventRecord {
  return {
    id: "event-alpha-funding", title: "Alpha Robotics raises $10M", type: "投融资" as ArticleKind,
    entities: ["Alpha Robotics"], primaryEntity: "Alpha Robotics", routes: [], status: "已确证",
    occurredAt: "2026-08-24T08:00:00Z", firstSeenAt: "2026-08-24T08:00:00Z",
    lastEvidenceAt: "2026-08-24T08:00:00Z", lastUpdatedAt: "2026-08-24T08:00:00Z",
    lastVerifiedAt: "2026-08-24T09:00:00Z", facts: ["Alpha Robotics raises $10M"], openQuestions: [],
    evidence, timeline: [], funding: { entityStatus: "已确认", amount: "$10M", investors: [] },
  };
}

function source(url = "https://alpha.example/feed.xml", tier: SourceConfig["tier"] = "官方公司与实验室"): SourceConfig {
  return {
    type: "rss", name: "Alpha source", url, weight: tier === "权威产业媒体" ? 7 : 10, keywords: [],
    entityIds: tier === "官方公司与实验室" ? ["alpha"] : undefined,
    tier, status: "已启用", publicationPolicy: tier === "权威产业媒体" ? "可作为独立报道" : "可作为一手证据",
  };
}

function decisionProducts(events = [event()]): DecisionProductArtifact {
  const canonicalEvent = events[0];
  const signalId = canonicalEvent ? stableDecisionId("signal", canonicalEvent.id) : "decision-signal-empty";
  return {
    schemaVersion: 1,
    generatedAt: NOW.toISOString(),
    periodStart: "2026-08-24",
    topSignals: canonicalEvent ? [{
      signalId, eventId: canonicalEvent.id, entityId: "alpha", entityName: "Alpha Robotics", titleZh: canonicalEvent.title,
      factsZh: ["Alpha Robotics 完成一项公开事件。", "规范证据已经通过发布门槛。"], kind: canonicalEvent.type,
      routes: ["部署与商业化"], occurredAt: canonicalEvent.occurredAt!, verifiedAt: canonicalEvent.lastVerifiedAt,
      changedThisWeek: true, evidenceState: canonicalEvent.evidence.some((item) => item.grade === "A") ? "official" : "multi-source",
      evidence: canonicalEvent.evidence.map((item, index) => ({ evidenceId: `evidence-${index}`, url: item.link, source: item.source, grade: item.grade })),
      impact: ["capital"], whyItMatters: "规范公开事件。", rankReasons: ["公开证据完整"],
    }] : [],
    companyCards: [{
      cardId: stableDecisionId("company", "alpha"), companyId: "alpha", companyName: "Alpha Robotics",
      officialUrl: company.officialUrl, region: "全球", stage: "创业公司", routes: ["部署与商业化"],
      capital: {
        status: "verified", summary: "Alpha Robotics 融资金额为 $10M。",
        evidence: events.flatMap((item) => item.evidence.map((evidence, index) => ({ evidenceId: `capital-${item.id}-${index}`, url: evidence.link, source: evidence.source, grade: evidence.grade }))),
      },
      validationStage: "客户试点", productDeployment: { status: "unknown", summary: "证据不足（不代表没有产品或部署进展）", evidence: [] },
      recentChanges: [], watchlist: { track: "unknown", lifecycle: "持续复核", whyNow: "规范证据已更新", nextValidationPoints: [] },
      unknownFields: [], updatedAt: NOW.toISOString(),
    }],
    researchPassports: [],
    subscriptions: { generatedAt: NOW.toISOString(), entries: [] },
  };
}

function canonical(events = [event()], sources: SourceConfig[] = [source()]) {
  return {
    companies: [company],
    events,
    companyClaimLedger: buildCompanyClaimLedger([company], events, { now: NOW }),
    researchDecisionCards: [],
    researchRecords: [] as ResearchRecord[],
    benchmarkResultLedger: { generatedAt: NOW.toISOString(), entries: [] },
    sources,
    decisionProducts: decisionProducts(events),
    pagesBaseUrl: PAGES,
  };
}

function html(body = "<html><title>Alpha Robotics raises $10M</title><time>2026-08-24</time></html>", init: ResponseInit = {}, responseUrl = URL): Response {
  const response = new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8", ...init.headers }, ...init });
  Object.defineProperty(response, "url", { value: responseUrl });
  return response;
}

const safeDns = async (): Promise<string[]> => ["8.8.8.8"];

function publicCompanySubject(): EvidenceSubject {
  const canonicalAlias = company.aliases![0]!;
  const digest = createHash("sha256").update(`company\nname:${canonicalAlias.toLocaleLowerCase("en-US")}`).digest("hex").slice(0, 24);
  return { ...subject, id: `company-${digest}` };
}

test("fetches only the exact accepted URL and emits a five-check structured canonical match", async () => {
  const requests: string[] = [];
  const result = await revalidateAcceptedEvidence({ accepted: accepted(), ...canonical(), now: NOW }, {
    fetchImpl: async (input) => { requests.push(String(input)); return html(); },
    resolveHost: safeDns,
    sleep: async () => undefined,
  });

  assert.deepEqual(requests, [URL]);
  assert.doesNotThrow(() => assertAcceptedEvidenceRevalidationArtifact(result.artifact));
  assert.equal(result.artifact.status, "success");
  assert.equal(result.status.status, "成功");
  assert.deepEqual(result.artifact.results[0]?.checks, {
    entity: "pass", sourceTier: "pass", fieldConsistency: "pass", conflict: "pass", date: "pass",
  });
  assert.deepEqual(result.artifact.results[0]?.source, { domain: "alpha.example", tier: "A", classification: "company-official" });
  assert.equal(result.artifact.results[0]?.canonicalMatch?.evidenceUrl, URL);
  assert.equal(result.artifact.results[0]?.canonicalMatch?.targetField, "funding.amount");
  assert.equal(result.artifact.results[0]?.canonicalMatch?.publicTargetUrl, `${PAGES}/companies.html#${stableDecisionId("company", "alpha")}`);
});

test("resolves a production-style hashed company subject to one canonical company without leaking its entity ID", async () => {
  const hashedSubject = publicCompanySubject();
  const result = await revalidateAcceptedEvidence({ accepted: accepted("funding.amount", URL, hashedSubject), ...canonical(), now: NOW }, {
    fetchImpl: async () => html(), resolveHost: safeDns, sleep: async () => undefined,
  });
  assert.equal(result.artifact.results[0]?.outcome, "matched");
  assert.equal(result.artifact.results[0]?.subjectId, hashedSubject.id);
  assert.equal(result.artifact.results[0]?.canonicalMatch?.canonicalRecordId.startsWith("company-claim-"), true);
  assert.doesNotMatch(JSON.stringify(result.artifact), /candidate-|entityId/);
});

test("keeps the complete prior revalidation audit history when appending a new attempt", async () => {
  const seedAt = new Date("2026-08-25T10:01:00Z");
  const seed = await revalidateAcceptedEvidence({ accepted: accepted(), ...canonical(), now: seedAt }, {
    fetchImpl: async () => { throw new Error("offline"); },
    resolveHost: safeDns,
    sleep: async () => undefined,
  });
  const results = Array.from({ length: 501 }, (_, index) => {
    const attemptedAt = new Date(seedAt.getTime() + index * 1_000).toISOString();
    return { ...structuredClone(seed.artifact.results[0]!), attemptedAt };
  });
  const previous = {
    schemaVersion: 1 as const,
    generatedAt: results.at(-1)!.attemptedAt,
    status: "degraded" as const,
    results,
  };

  const next = await revalidateAcceptedEvidence({ accepted: accepted(), ...canonical(), previous, now: NOW }, {
    fetchImpl: async () => html(),
    resolveHost: safeDns,
    sleep: async () => undefined,
  });

  assert.equal(next.artifact.results.length, 502);
  assert.deepEqual(next.artifact.results.slice(0, 501), results);
});

test("reuses the A-or-independent-B+B publication gate for canonical matching", async () => {
  const second = "https://media-two.example/alpha";
  const events = [event([
    { link: URL, source: "Media One", grade: "B", publishedAt: "2026-08-24T08:00:00Z", supports: "融资金额 $10M" },
    { link: second, source: "Media Two", grade: "B", publishedAt: "2026-08-24T08:01:00Z", supports: "融资金额 $10M" },
  ])];
  const sources = [source("https://alpha.example/feed.xml", "权威产业媒体"), source("https://media-two.example/feed.xml", "权威产业媒体")];
  const result = await revalidateAcceptedEvidence({ accepted: accepted(), ...canonical(events, sources), now: NOW }, {
    fetchImpl: async () => html(), resolveHost: safeDns, sleep: async () => undefined,
  });
  assert.equal(result.artifact.results[0]?.source.tier, "B");
  assert.equal(result.artifact.results[0]?.outcome, "matched");
});

test("field conflicts, value mismatches, future dates, discovery sources, and unsupported targets fail closed", async () => {
  const cases: Array<{ name: string; input: ReturnType<typeof canonical>; target?: EvidenceTargetField; body?: string }> = [
    { name: "value mismatch", input: canonical(), body: "Alpha Robotics raises $8M on 2026-08-24" },
    { name: "future date", input: canonical([event([{ link: URL, source: "Alpha", grade: "A", publishedAt: "2026-08-26T08:00:00Z", supports: "融资金额 $10M" }])]) },
    { name: "discovery", input: canonical([event()], [source("https://alpha.example/feed.xml", "线索发现层")]) },
    { name: "unsupported", input: canonical(), target: "deployment.location" },
  ];
  const conflicted = canonical();
  const amount = conflicted.companyClaimLedger.companies[0]!.claims.find((claim) => claim.claimType === "funding")!.fields.amount;
  Object.assign(amount, { status: "conflicted", value: "unknown", conflictingValues: ["$8M", "$10M"] });
  cases.push({ name: "conflict", input: conflicted });

  for (const item of cases) {
    const result = await revalidateAcceptedEvidence({ accepted: accepted(item.target), ...item.input, now: NOW }, {
      fetchImpl: async () => html(item.body), resolveHost: safeDns, sleep: async () => undefined,
    });
    assert.notEqual(result.artifact.results[0]?.outcome, "matched", item.name);
    assert.equal(result.artifact.results[0]?.canonicalMatch, null, item.name);
  }
});

test("transport, unsafe-host, MIME, and size failures degrade without persisting URL, body, secrets, or raw errors", async () => {
  const secretBody = "PRIVATE BODY token=super-secret";
  const cases = [
    { artifact: accepted(), fetchImpl: async () => { throw new Error(`boom ${secretBody} ${URL}`); } },
    { artifact: accepted("funding.amount", "https://127.0.0.1/private"), fetchImpl: async () => { throw new Error("must not fetch"); } },
    { artifact: accepted(), fetchImpl: async () => new Response(secretBody, { headers: { "content-type": "application/octet-stream" } }) },
    { artifact: accepted(), fetchImpl: async () => html("x".repeat(256)) },
  ];
  for (const [index, item] of cases.entries()) {
    const result = await revalidateAcceptedEvidence({ accepted: item.artifact, ...canonical(), now: NOW }, {
      fetchImpl: item.fetchImpl, resolveHost: safeDns, sleep: async () => undefined, maxBodyBytes: index === 3 ? 64 : 1024,
    });
    assert.equal(result.artifact.status, "degraded");
    assert.equal(result.artifact.results[0]?.outcome, "degraded");
    assert.equal(result.artifact.results[0]?.canonicalMatch, null);
    assert.doesNotMatch(JSON.stringify(result.artifact), /super-secret|PRIVATE BODY|boom|must not fetch/);
    assert.doesNotMatch(JSON.stringify(result.status), /super-secret|PRIVATE BODY|funding\?round|127\.0\.0\.1|boom|alpha\.example/);
  }
});

test("research evidence cannot match a different canonical paper subject", async () => {
  const researchSubject: EvidenceSubject = { kind: "research", id: "paper-beta", name: "Beta Policy", url: "https://arxiv.org/abs/2608.00002" };
  const result = await revalidateAcceptedEvidence({
    accepted: accepted("research.codeUrl", "https://github.com/acme/beta", researchSubject),
    ...canonical([], [{ type: "github-releases", name: "GitHub", repo: "acme/beta", weight: 9, keywords: [], tier: "开源发布", status: "已启用", publicationPolicy: "可作为一手证据" }]),
    researchDecisionCards: [{
      identity: { paperId: { value: "paper-alpha", evidenceUrls: ["https://arxiv.org/abs/2608.00001"] } },
      artifacts: { code: { value: "https://github.com/acme/beta", evidenceUrls: ["https://github.com/acme/beta"] } },
      gates: [], eligibleForTopResearch: true,
    }] as never,
    now: NOW,
  }, { fetchImpl: async () => html("Beta Policy code", {}, "https://github.com/acme/beta"), resolveHost: safeDns, sleep: async () => undefined });
  assert.equal(result.artifact.results[0]?.checks.entity, "fail");
  assert.equal(result.artifact.results[0]?.canonicalMatch, null);
});

test("matches real event and research task subjects only when the exact canonical field is on a public decision surface", async () => {
  const eventUrl = "https://alpha.example/deployments/beta";
  const deploymentEvent: EventRecord = {
    ...event([{ link: eventUrl, source: "Alpha 官网", grade: "A", publishedAt: "2026-08-24T08:00:00Z", supports: "Beta Customer deployment" }]),
    id: "event-beta-deployment", title: "Alpha Robotics deploys with Beta Customer", type: "部署案例",
    funding: undefined, productDeployment: { product: "Alpha One", customers: ["Beta Customer"], deployment: "12 sites in Berlin" },
  };
  const eventSubject: EvidenceSubject = { kind: "event", id: deploymentEvent.id, name: deploymentEvent.title, url: eventUrl };
  const eventResult = await revalidateAcceptedEvidence({
    accepted: accepted("deployment.customer", eventUrl, eventSubject),
    ...canonical([deploymentEvent]),
    now: NOW,
  }, { fetchImpl: async () => html("Alpha Robotics deploys with Beta Customer on 2026-08-24", {}, eventUrl), resolveHost: safeDns, sleep: async () => undefined });
  assert.equal(eventResult.artifact.results[0]?.outcome, "matched");
  assert.equal(eventResult.artifact.results[0]?.canonicalMatch?.canonicalArtifact, "event-store");
  assert.equal(eventResult.artifact.results[0]?.canonicalMatch?.publicTargetUrl, `${PAGES}/?signal=${stableDecisionId("signal", deploymentEvent.id)}`);

  const codeUrl = "https://github.com/acme/paper-alpha";
  const paperUrl = "https://arxiv.org/abs/2608.00001";
  const researchSubject: EvidenceSubject = { kind: "research", id: "paper-alpha", name: "Alpha Robot Policy", url: paperUrl };
  const card = {
    identity: { paperId: { value: "paper-alpha", evidenceUrls: [paperUrl] } },
    artifacts: {
      code: { value: codeUrl, evidenceUrls: [paperUrl, codeUrl] },
      data: { value: "unknown", evidenceUrls: [] }, weights: { value: "unknown", evidenceUrls: [] },
    },
    realRobotTrials: { value: "unknown", evidenceUrls: [] }, lab: { value: ["Acme Lab"], evidenceUrls: [paperUrl] },
    openAlex: { retraction: { value: false, evidenceUrls: [] }, freshness: { value: "fresh", evidenceUrls: [] } },
    gates: [], eligibleForTopResearch: true,
  } as never;
  const researchRecord = {
    id: "paper-alpha", status: "里程碑精读候选", article: { id: "paper-alpha", title: "Alpha Robot Policy", excerpt: "Alpha Robot Policy code", link: paperUrl, publishedAt: new Date("2026-08-20T00:00:00Z") },
  } as ResearchRecord;
  const researchProducts = decisionProducts([]);
  researchProducts.researchPassports = [{
    passportId: stableDecisionId("research", "paper-alpha"), paperId: "paper-alpha", titleZh: "Alpha 机器人策略", factsZh: ["该研究公开了机器人策略。", "该研究提供了可复核代码。"],
    sourceUrl: paperUrl, task: ["机器人操作"], embodiment: ["机械臂"], methods: ["策略学习"],
    benchmark: { name: "unknown", metric: "unknown", result: "unknown", baseline: "unknown", delta: "unknown", evidenceUrls: [] },
    realRobotTrials: "unknown", assets: { code: codeUrl, data: "unknown", weights: "unknown" },
    reproducibilityCost: { level: "unknown", rationale: "unknown" }, authority: { openAlexWorkId: "W123", authors: [], labs: ["Acme Lab"], citedByCount: 0, checkedAt: NOW.toISOString() },
    limitations: "unknown", gaps: [], whyWorthAttention: "公开代码可独立复核。", rankReasons: ["证据完整"],
  }];
  const researchResult = await revalidateAcceptedEvidence({
    accepted: accepted("research.codeUrl", codeUrl, researchSubject),
    ...canonical([], [{ type: "github-releases", name: "Acme code", repo: "acme/paper-alpha", weight: 9, keywords: [], role: "代码发布", tier: "开源发布", status: "已启用", publicationPolicy: "可作为一手证据" }]),
    researchDecisionCards: [card], researchRecords: [researchRecord], decisionProducts: researchProducts, now: NOW,
  }, { fetchImpl: async () => html("Alpha Robot Policy code 2026-08-20", {}, codeUrl), resolveHost: safeDns, sleep: async () => undefined });
  assert.equal(researchResult.artifact.results[0]?.outcome, "matched");
  assert.equal(researchResult.artifact.results[0]?.canonicalMatch?.canonicalArtifact, "research-decision-card");
  assert.equal(researchResult.artifact.results[0]?.canonicalMatch?.publicTargetUrl, `${PAGES}/research.html#${stableDecisionId("research", "paper-alpha")}`);
});

test("rejects DNS-private hosts and any response URL other than the exact accepted URL", async () => {
  let fetched = false;
  const dnsPrivate = await revalidateAcceptedEvidence({ accepted: accepted(), ...canonical(), now: NOW }, {
    resolveHost: async () => ["127.0.0.1"],
    fetchImpl: async () => { fetched = true; return html(); },
    sleep: async () => undefined,
  });
  assert.equal(fetched, false);
  assert.equal(dnsPrivate.artifact.results[0]?.fetch.failureCode, "unsafe-url");

  let mappedFetched = false;
  const mappedLoopback = await revalidateAcceptedEvidence({ accepted: accepted(), ...canonical(), now: NOW }, {
    resolveHost: async () => ["::ffff:7f00:1"],
    fetchImpl: async () => { mappedFetched = true; return html(); },
    sleep: async () => undefined,
  });
  assert.equal(mappedFetched, false);
  assert.equal(mappedLoopback.artifact.results[0]?.fetch.failureCode, "unsafe-url");

  const changedUrl = await revalidateAcceptedEvidence({ accepted: accepted(), ...canonical(), now: NOW }, {
    resolveHost: safeDns,
    fetchImpl: async () => html(undefined, {}, "https://alpha.example/different"),
    sleep: async () => undefined,
  });
  assert.equal(changedUrl.artifact.results[0]?.fetch.failureCode, "unsafe-redirect");
  assert.equal(changedUrl.artifact.results[0]?.canonicalMatch, null);
});

test("exact revalidation validation rejects private diagnostics and malformed binding fields", async () => {
  const valid = await revalidateAcceptedEvidence({ accepted: accepted(), ...canonical(), now: NOW }, {
    fetchImpl: async () => html(), resolveHost: safeDns, sleep: async () => undefined,
  });
  const mutations: Array<(artifact: typeof valid.artifact) => void> = [
    (artifact) => { artifact.results[0]!.taskId = "task-forged"; },
    (artifact) => { artifact.results[0]!.issueNumber = -1; },
    (artifact) => { artifact.results[0]!.contributor = "github-actions[bot]"; },
    (artifact) => { artifact.results[0]!.targetField = "funding.private" as never; },
    (artifact) => { artifact.results[0]!.candidateValue = "apiKey=super-secret"; },
    (artifact) => { artifact.results[0]!.canonicalMatch!.matchedAt = ACCEPTED_AT; },
  ];
  for (const mutate of mutations) {
    const artifact = structuredClone(valid.artifact);
    mutate(artifact);
    assert.throws(() => assertAcceptedEvidenceRevalidationArtifact(artifact));
  }
});
