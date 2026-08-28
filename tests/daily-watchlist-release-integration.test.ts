import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { generate } from "../src/main.js";
import {
  assertAcceptedEvidenceArtifact,
  assertCommunityTaskPublicArtifact,
  assertContributionLedgerArtifact,
  assertEvidenceTaskLedgerArtifact,
  assertEvidenceTaskSeedArtifact,
  buildEvidenceTaskId,
  type EvidenceIssueSnapshot,
  type EvidenceTaskCategory,
  type EvidenceTaskSeed,
  type EvidenceTaskSeedArtifact,
  type EvidenceTargetField,
} from "../src/community-evidence/contracts.js";
import { FileTransaction } from "../src/runtime/storage.js";
import type { DashboardData } from "../src/site-data.js";
import type { Article, DailyArchive, DigestResult, EventRecord, EventStore, ResearchRecord, RunManifest } from "../src/types.js";
import { buildWatchlistConfigCatalog, decodeWatchlistConfig, encodeWatchlistConfig } from "../src/watchlist/config.js";
import type { CompanyThesisArtifact, WatchlistSnapshot } from "../src/watchlist/contracts.js";
import type { WatchlistFeedManifest } from "../src/watchlist/feeds.js";
import type { WatchlistPreviewArtifact } from "../src/watchlist/preview.js";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXED_NOW = new Date("2026-08-16T08:00:00.000Z");
const FIXTURE_RESEARCH_TITLE = "固定机器人基准：真实机器人操作与开源复现";
const FIXTURE_PATHS = [
  "README.md", "daily", "weekly", "sources", "review", "resources", "events",
  "research", "routes", "metrics", "site/data", "site/feeds", "watchlist", "community",
];

const emptyCollection = async (): Promise<DigestResult> => ({ articles: [], failures: [], sourceOutcomes: [] });
const timeoutCollection = async (): Promise<DigestResult> => ({
  articles: [],
  failures: [{ source: "fixture-source", reason: "timeout" }],
  sourceOutcomes: [{ source: "fixture-source", status: "failure", reason: "timeout", fetchedArticles: 0 }],
});

function communityEvidenceFixture(): { seeds: EvidenceTaskSeedArtifact; snapshot: EvidenceIssueSnapshot; evidenceUrl: string } {
  const fixture: Record<EvidenceTaskCategory, { kind: "company" | "event" | "research"; id: string; name: string; url: string; targetField: EvidenceTargetField }> = {
    "company-funding": { kind: "company", id: "daily-company-alpha", name: "Daily Alpha Robotics", url: "https://daily-alpha.example/", targetField: "funding.amount" },
    "product-deployment": { kind: "event", id: "daily-event-beta", name: "Daily Beta 部署", url: "https://daily-beta.example/deployment", targetField: "deployment.customer" },
    "research-metadata": { kind: "research", id: "daily-paper-gamma", name: "Daily Gamma 研究", url: "https://daily-gamma.example/paper", targetField: "research.codeUrl" },
  };
  const items = (Object.keys(fixture) as EvidenceTaskCategory[]).map((category): EvidenceTaskSeed => {
    const item = fixture[category];
    const subject = { kind: item.kind, id: item.id, name: item.name, url: item.url };
    const materialVersion = `daily-material-${category}`;
    return {
      id: buildEvidenceTaskId(subject, item.targetField, materialVersion), version: 1, category, subject, targetField: item.targetField,
      contextZh: `${item.name} 的单一字段仍待公开证据确认。`, referenceUrls: [item.url], suggestedLocations: ["官方页面"],
      qualifiedEvidenceZh: ["可公开核验的原始来源"], disqualifiedEvidenceZh: ["没有原始链接的转述"],
      replyTemplateZh: "证据链接：\n证据摘录：\n来源类型：", estimatedMinutes: 2, generatedWeek: "2026-W33",
      materialVersion, supersedesTaskId: null,
    };
  });
  const seeds: EvidenceTaskSeedArtifact = { schemaVersion: 1, generatedAt: FIXED_NOW.toISOString(), generatedWeek: "2026-W33", seeds: items };
  assertEvidenceTaskSeedArtifact(seeds);
  const evidenceUrl = "https://accepted-daily-evidence.example/funding";
  const snapshot: EvidenceIssueSnapshot = {
    schemaVersion: 1,
    fetchedAt: FIXED_NOW.toISOString(),
    repo: "acme/physical-ai-news-cn",
    issues: items.map((item, index) => ({
      number: 71 + index, taskId: item.id, taskVersion: 1, state: "open",
      labels: ["evidence-task", `evidence-task-${item.category}`, ...(index === 0 ? ["accepted-evidence"] : []), "two-minute-task"].sort(),
      authorLogin: index === 0 ? "alice" : "maintainer", authorAssociation: index === 0 ? "FIRST_TIME_CONTRIBUTOR" : "MEMBER",
      createdAt: "2026-08-15T08:00:00.000Z", updatedAt: index === 0 ? "2026-08-16T07:00:00.000Z" : "2026-08-15T08:00:00.000Z", closedAt: null,
      evidenceUrls: index === 0 ? [evidenceUrl] : [],
      submittedEvidence: index === 0 ? [{ contributor: "alice", evidenceUrl, submittedAt: "2026-08-15T08:00:00.000Z" }] : [],
      acceptedContributors: index === 0 ? ["alice"] : [],
      acceptedEvidence: index === 0 ? [{ contributor: "alice", evidenceUrl }] : [],
    })),
  };
  return { seeds, snapshot, evidenceUrl };
}

async function seedDeterministicResearchState(root: string): Promise<void> {
  const article: Article = {
    id: "arxiv:2608.00001",
    title: "A Reproducible Real-Robot Manipulation Benchmark",
    titleZh: FIXTURE_RESEARCH_TITLE,
    summaryZh: "论文在真实机器人上建立操作基准，并报告相对基线的成功率提升。作者同时公开评测协议与代码，便于独立复现。",
    link: "https://arxiv.org/abs/2608.00001v1",
    publishedAt: new Date("2026-08-15T00:00:00.000Z"),
    fetchedAt: new Date("2026-08-15T01:00:00.000Z"),
    source: "arXiv · Robotics",
    sourceWeight: 9,
    excerpt: "We evaluate a real robot manipulation benchmark against a baseline. Code available at https://github.com/example/fixture-robot-benchmark.",
    kind: "研究与数据",
    tags: ["研究", "robot"],
    authors: ["Fixture Researcher"],
    scholar: {
      provider: "OpenAlex",
      workId: "https://openalex.org/W7200000001",
      citedByCount: 12,
      isRetracted: false,
      institutions: ["Tsinghua University"],
      authors: [{
        name: "Fixture Researcher",
        totalCitations: 320,
        hIndex: 8,
        institutions: ["Tsinghua University"],
      }],
      checkedAt: "2026-08-15T02:00:00.000Z",
    },
  };
  const record: ResearchRecord = {
    id: article.id,
    article,
    firstSeenAt: "2026-08-15T01:00:00.000Z",
    lastCheckedAt: "2026-08-15T02:00:00.000Z",
    arxivVersion: 1,
    factHash: "eeaee1154b6802ce",
    status: "新论文",
    seenDates: ["2026-08-15"],
    appearances: 1,
    evidenceTags: ["真实机器人", "基准", "开源"],
    authorityLabels: ["清华大学"],
    notableAuthor: "Fixture Researcher",
    changes: [{
      date: "2026-08-15T01:00:00.000Z",
      kind: "新收录",
      detail: "进入固定集成测试论文池。",
    }],
  };
  const archive: DailyArchive = {
    date: "2026-08-15",
    articles: [article],
    candidates: [],
    sourceOutcomes: [],
    runtimeStatus: [],
  };
  await writeFile(join(root, "research", "registry.json"), `${JSON.stringify({
    updatedAt: "2026-08-15T02:00:00.000Z",
    records: [record],
  }, null, 2)}\n`);
  await writeFile(join(root, "daily", "2026-08-15.json"), `${JSON.stringify(archive, null, 2)}\n`);
}

async function copyFixture(target: string): Promise<void> {
  await mkdir(target, { recursive: true });
  for (const path of FIXTURE_PATHS) await cp(join(repositoryRoot, path), join(target, path), { recursive: true });
  await Promise.all([
    "review/evidence-task-seeds.json", "review/evidence-issue-snapshot.json", "review/evidence-task-ledger.json",
    "review/accepted-evidence.json", "review/accepted-evidence-revalidation.json", "community/contributions.json", "site/data/community-tasks.json",
  ].map((path) => rm(join(target, path), { force: true })));
  await rm(join(target, "site/data/decision-products.json"), { force: true });
  // Daily archives, research metadata and source registries are mutable
  // production inputs. Copying them into a fixed-clock integration fixture
  // lets a real refresh leak into the test: the first generation enriches the
  // copied state, then the second generation renders different public bytes.
  // Start these inputs from deterministic state (including one complete
  // research card) while keeping the real README/dashboard publication
  // boundary and all of its strict assertions.
  await rm(join(target, "daily"), { recursive: true, force: true });
  await mkdir(join(target, "daily"), { recursive: true });
  await rm(join(target, "research"), { recursive: true, force: true });
  await mkdir(join(target, "research"), { recursive: true });
  await seedDeterministicResearchState(target);
  await writeFile(join(target, "sources", "candidates.json"), `${JSON.stringify({
    updatedAt: FIXED_NOW.toISOString(),
    sources: [],
  }, null, 2)}\n`);
  await writeFile(join(target, "sources", "registry.json"), `${JSON.stringify({
    updatedAt: FIXED_NOW.toISOString(),
    windowDays: 30,
    sources: [],
  }, null, 2)}\n`);
  // Immutable snapshots are publication outputs, not test inputs. Keeping the
  // repository's ever-growing history makes this fixed-clock harness collide
  // with a historical week after a real daily release adds that week.
  await rm(join(target, "watchlist", "current.json"), { force: true });
  await rm(join(target, "watchlist", "theses.json"), { force: true });
  await rm(join(target, "watchlist", "history"), { recursive: true, force: true });
  await mkdir(join(target, "watchlist", "history"), { recursive: true });
}

async function seedNonEmptyPriorPreview(root: string): Promise<void> {
  const generatedAt = FIXED_NOW.toISOString();
  // The publication fixture must reference a canonically attributable event.
  // Never borrow this event from mutable production history: a legitimate
  // cleanup may quarantine it and make an otherwise fixed integration test
  // depend on the order in which real daily runs happened.
  const eventPath = join(root, "events", "index.json");
  const eventStore = JSON.parse(await readFile(eventPath, "utf8")) as EventStore;
  const canonicalEvent: EventRecord = {
    id: "evt-9da8fb3e629b",
    title: "NVIDIA 发布 Cosmos 物理 AI 平台更新",
    sourceTitle: "NVIDIA launches a Cosmos platform update for physical AI",
    type: "产品发布",
    entities: ["NVIDIA"],
    primaryEntity: "NVIDIA",
    mentionedEntities: [],
    routes: ["世界模型与空间智能"],
    status: "已确证",
    occurredAt: "2026-08-09T08:00:00.000Z",
    eventDate: "2026-08-09",
    dateSource: "official-published",
    dateConfidence: "high",
    firstSeenAt: "2026-08-09T08:00:00.000Z",
    lastEvidenceAt: "2026-08-09T08:00:00.000Z",
    lastMaterialChangeAt: "2026-08-09T08:00:00.000Z",
    lastUpdatedAt: "2026-08-09T08:00:00.000Z",
    lastVerifiedAt: "2026-08-09T08:00:00.000Z",
    facts: ["NVIDIA 发布 Cosmos 物理 AI 平台更新，并提供可追溯的一手产品说明。"],
    openQuestions: ["后续是否有独立部署或复现证据？"],
    evidence: [{
      link: "https://www.nvidia.com/en-us/ai/cosmos/",
      source: "NVIDIA 官方",
      grade: "A",
      publishedAt: "2026-08-09T08:00:00.000Z",
      supports: "NVIDIA 发布 Cosmos 物理 AI 平台更新",
    }],
    timeline: [{
      date: "2026-08-09T08:00:00.000Z",
      summary: "NVIDIA 发布 Cosmos 物理 AI 平台更新，并提供可追溯的一手产品说明。",
      evidenceLinks: ["https://www.nvidia.com/en-us/ai/cosmos/"],
    }],
    productDeployment: { product: "Cosmos", customers: [] },
  };
  eventStore.events = [canonicalEvent, ...eventStore.events.filter((event) => event.id !== canonicalEvent.id)];
  eventStore.updatedAt = generatedAt;
  await writeFile(eventPath, `${JSON.stringify(eventStore, null, 2)}\n`);
  const thesis = {
    thesisId: "thesis-nvidia-stage4-fixture",
    companyId: "nvidia",
    track: "forward-radar" as const,
    lifecycle: "new" as const,
    thesisVersion: 1,
    whyNow: "AI 研究判断：NVIDIA 已出现可追溯的规范事实。",
    routeAndDependencies: "AI 研究判断：NVIDIA 当前沿世界模型与空间智能路线观察。",
    nextValidationPoints: [{ text: "核验后续可追溯的产品或部署事实。", dueAt: "2026-10-08" }],
    falsifiers: [{ text: "若规范事实被撤回，则停止当前判断。" }],
    factReferenceIds: ["evt-9da8fb3e629b"],
    verifiedSensitiveBindings: [],
    inferenceLabels: ["AI 研究判断"],
    confidence: "medium" as const,
    generatedAt: "2026-08-09T08:00:00.000Z",
    expiresAt: "2026-10-08T08:00:00.000Z",
    modelVersion: "fixture-lkg",
    promptVersion: "fixture-v1",
    methodologyVersion: "v1",
  };
  const preview: WatchlistPreviewArtifact = {
    schemaVersion: 2,
    generatedAt,
    theses: [thesis],
  };
  const priorSnapshot: WatchlistSnapshot = {
    week: "2026-W32",
    snapshotVersion: 1,
    methodologyVersion: "v1",
    generatedAt: thesis.generatedAt,
    forwardRadar: [{ companyId: thesis.companyId, thesisId: thesis.thesisId, thesisVersion: 1, group: "priority-focus" }],
    validatedMomentum: [],
    changesSinceLastWeek: [],
    routeShareException: {
      route: "VLA 与具身模型",
      share: 1,
      reason: "固定集成夹具仅保留一条可追溯路线。",
    },
  };
  const thesisArtifact: CompanyThesisArtifact = { schemaVersion: 1, generatedAt: thesis.generatedAt, theses: [thesis] };
  await writeFile(join(root, "review", "watchlist-preview.json"), `${JSON.stringify(preview, null, 2)}\n`);
  await writeFile(join(root, "watchlist", "current.json"), `${JSON.stringify(priorSnapshot, null, 2)}\n`);
  await writeFile(join(root, "watchlist", "history", "2026-W32-v1.json"), `${JSON.stringify(priorSnapshot, null, 2)}\n`);
  await writeFile(join(root, "watchlist", "theses.json"), `${JSON.stringify(thesisArtifact, null, 2)}\n`);
}

async function runFixedGeneration(root: string, options: {
  collect?: typeof emptyCollection;
  transaction?: FileTransaction;
  now?: Date;
  llmOutage?: boolean;
  communityEvidence?: ReturnType<typeof communityEvidenceFixture>;
  evidenceFetch?: typeof fetch;
  evidenceResolve?: (hostname: string) => Promise<string[]>;
} = {}): Promise<RunManifest> {
  const priorLlmKey = process.env.LLM_API_KEY;
  const priorLlmBaseUrl = process.env.LLM_BASE_URL;
  const priorLlmModel = process.env.LLM_MODEL;
  const priorOpenAlexKey = process.env.OPENALEX_API_KEY;
  const priorFetch = globalThis.fetch;
  const priorGithubToken = process.env.GITHUB_TOKEN;
  const priorGithubRepository = process.env.GITHUB_REPOSITORY;
  if (options.llmOutage) {
    process.env.LLM_API_KEY = "fixture-secret";
    process.env.LLM_BASE_URL = "https://llm-outage.invalid/v1";
    process.env.LLM_MODEL = "fixture-model";
    globalThis.fetch = async () => { throw new TypeError("fixture provider outage"); };
  } else {
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;
  }
  delete process.env.OPENALEX_API_KEY;
  if (options.communityEvidence) {
    process.env.GITHUB_TOKEN = "fixture-token";
    process.env.GITHUB_REPOSITORY = options.communityEvidence.snapshot.repo;
  } else {
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_REPOSITORY;
  }
  try {
    return await generate({
      root,
      now: options.now ?? FIXED_NOW,
      collect: options.collect ?? emptyCollection,
      collectX: emptyCollection,
      transaction: options.transaction,
      communityEvidenceSeeds: options.communityEvidence?.seeds,
      fetchCommunityEvidenceSnapshot: options.communityEvidence ? async () => options.communityEvidence!.snapshot : undefined,
      fetchAcceptedEvidence: options.evidenceFetch,
      resolveAcceptedEvidenceHost: options.evidenceResolve,
    });
  } finally {
    globalThis.fetch = priorFetch;
    if (priorLlmKey === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = priorLlmKey;
    if (priorLlmBaseUrl === undefined) delete process.env.LLM_BASE_URL;
    else process.env.LLM_BASE_URL = priorLlmBaseUrl;
    if (priorLlmModel === undefined) delete process.env.LLM_MODEL;
    else process.env.LLM_MODEL = priorLlmModel;
    if (priorOpenAlexKey === undefined) delete process.env.OPENALEX_API_KEY;
    else process.env.OPENALEX_API_KEY = priorOpenAlexKey;
    if (priorGithubToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = priorGithubToken;
    if (priorGithubRepository === undefined) delete process.env.GITHUB_REPOSITORY;
    else process.env.GITHUB_REPOSITORY = priorGithubRepository;
  }
}

type PublicGroup = { bytes: Record<string, string>; semantics: unknown };

async function capturePublicGroup(root: string): Promise<PublicGroup> {
  const snapshotBytes = await readFile(join(root, "watchlist", "current.json"), "utf8");
  const snapshot = JSON.parse(snapshotBytes) as WatchlistSnapshot;
  const manifest = JSON.parse(await readFile(join(root, "site", "feeds", "manifest.json"), "utf8")) as WatchlistFeedManifest;
  const paths = [
    "watchlist/current.json",
    `watchlist/history/${snapshot.week}-v${snapshot.snapshotVersion}.json`,
    "watchlist/theses.json",
    "review/watchlist-preview.json",
    "review/watchlist-preview.md",
    "review/watchlist-issue-seeds.json",
    "review/evidence-task-seeds.json",
    "review/evidence-issue-snapshot.json",
    "review/evidence-task-ledger.json",
    "review/accepted-evidence.json",
    "review/accepted-evidence-revalidation.json",
    "community/contributions.json",
    "site/data/community-tasks.json",
    "site/feeds/manifest.json",
    ...manifest.companyFeeds.map(({ path }) => `site/${path}`),
    ...manifest.routeFeeds.map(({ path }) => `site/${path}`),
    "site/data/watchlist-changes.json",
    "metrics/watchlist.json",
    "site/data/dashboard.json",
    "README.md",
  ];
  const bytes = Object.fromEntries(await Promise.all(paths.map(async (path) => [path, await readFile(join(root, path), "utf8")] as const)));
  const dashboard = JSON.parse(bytes["site/data/dashboard.json"]!) as { watchlist: Parameters<typeof buildWatchlistConfigCatalog>[0] };
  const catalog = buildWatchlistConfigCatalog(dashboard.watchlist);
  const configPayload = encodeWatchlistConfig(catalog);
  bytes["@share/catalog.json"] = `${JSON.stringify(catalog, null, 2)}\n`;
  bytes["@share/config.txt"] = `${configPayload}\n`;
  const feedGuids = Object.entries(bytes)
    .filter(([path]) => path.endsWith(".xml"))
    .flatMap(([path, xml]) => [...xml.matchAll(/<guid isPermaLink="false">([^<]+)<\/guid>/g)].map((match) => `${path}\0${match[1]}`))
    .sort();
  const theses = JSON.parse(bytes["watchlist/theses.json"]!) as CompanyThesisArtifact;
  const preview = JSON.parse(bytes["review/watchlist-preview.json"]!) as WatchlistPreviewArtifact;
  return {
    bytes,
    semantics: {
      snapshot: [snapshot.week, snapshot.snapshotVersion, snapshot.generatedAt],
      thesisVersions: theses.theses.map(({ thesisId, thesisVersion }) => [thesisId, thesisVersion]),
      previewVersions: preview.theses.map(({ thesisId, thesisVersion }) => [thesisId, thesisVersion]),
      feedManifest: manifest,
      feedGuids,
      issueSeeds: JSON.parse(bytes["review/watchlist-issue-seeds.json"]!),
      changes: JSON.parse(bytes["site/data/watchlist-changes.json"]!),
      metrics: JSON.parse(bytes["metrics/watchlist.json"]!),
      share: { catalog, payload: configPayload, decoded: decodeWatchlistConfig(configPayload, catalog) },
    },
  };
}

async function expectFailedWithoutPublicChange(
  root: string,
  before: PublicGroup,
  expectedCode: string,
  run: () => Promise<unknown>,
): Promise<void> {
  await assert.rejects(run, (error: unknown) => {
    const failure = error as { status?: unknown; code?: unknown; message?: unknown };
    assert.equal(failure.status, "failed");
    assert.equal(failure.code, expectedCode);
    assert.equal(typeof failure.message, "string");
    assert.doesNotMatch(String(failure.message), /fixture-secret|not-json/);
    return true;
  });
  assert.deepEqual(await capturePublicGroup(root), before);
}

test("accepted community evidence reaches daily revalidation without entering canonical surfaces", async () => {
  const root = await mkdtemp(join(tmpdir(), "community-evidence-full-daily-"));
  try {
    await copyFixture(root);
    await seedNonEmptyPriorPreview(root);
    const fixture = communityEvidenceFixture();
    const manifest = await runFixedGeneration(root, {
      communityEvidence: fixture,
      evidenceFetch: async (input) => {
        const response = new Response("Daily Alpha Robotics raised $10M on 2026-08-16", { headers: { "content-type": "text/plain" } });
        Object.defineProperty(response, "url", { value: String(input) });
        return response;
      },
      evidenceResolve: async () => ["8.8.8.8"],
    });
    const artifactPaths = {
      seeds: "review/evidence-task-seeds.json",
      ledger: "review/evidence-task-ledger.json",
      accepted: "review/accepted-evidence.json",
      revalidation: "review/accepted-evidence-revalidation.json",
      contributions: "community/contributions.json",
      public: "site/data/community-tasks.json",
    } as const;
    const artifacts = Object.fromEntries(await Promise.all(Object.entries(artifactPaths).map(async ([key, path]) => [key, JSON.parse(await readFile(join(root, path), "utf8"))] as const)));
    assert.doesNotThrow(() => assertEvidenceTaskSeedArtifact(artifacts.seeds));
    assert.doesNotThrow(() => assertEvidenceTaskLedgerArtifact(artifacts.ledger));
    assert.doesNotThrow(() => assertAcceptedEvidenceArtifact(artifacts.accepted));
    assert.equal(artifacts.revalidation.results[0].fetch.status, "success");
    assert.equal(artifacts.revalidation.results[0].outcome, "insufficient");
    assert.doesNotThrow(() => assertContributionLedgerArtifact(artifacts.contributions));
    assert.doesNotThrow(() => assertCommunityTaskPublicArtifact(artifacts.public));
    const enrichment = JSON.parse(await readFile(join(root, "review/evidence-enrichment.json"), "utf8")) as { revalidationTargets?: Array<{ evidenceUrl: string; disposition: string; mayPublish: boolean }> };
    assert.deepEqual(enrichment.revalidationTargets, [{
      id: artifacts.accepted.entries[0].id,
      taskId: artifacts.accepted.entries[0].taskId,
      issueNumber: 71,
      category: "company-funding",
      subject: fixture.seeds.seeds[0]!.subject,
      targetField: "funding.amount",
      evidenceUrl: fixture.evidenceUrl,
      domain: "accepted-daily-evidence.example",
      acceptedAt: "2026-08-16T07:00:00.000Z",
      disposition: "revalidation-only",
      requiredChecks: ["entity", "source-tier", "field-consistency", "conflict", "date"],
      mayPublish: false,
      mayUpgradeFactGrade: false,
    }]);
    for (const path of ["events/index.json", "events/companies.json", "research/decision-cards.json", "README.md"]) {
      assert.doesNotMatch(await readFile(join(root, path), "utf8"), /accepted-daily-evidence/);
    }
    assert.equal(manifest.services.find((service) => service.component === "GitHub")?.status, "成功");
    assert.equal(manifest.services.find((service) => service.component === "EvidenceRevalidation")?.status, "成功");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("two fixed-input complete daily generations are byte- and semantics-idempotent", async () => {
  const root = await mkdtemp(join(tmpdir(), "stage4-daily-idempotence-"));
  try {
    await copyFixture(root);
    await seedNonEmptyPriorPreview(root);
    await runFixedGeneration(root);
    const first = await capturePublicGroup(root);
    const firstDashboard = JSON.parse(first.bytes["site/data/dashboard.json"]!) as DashboardData;
    assert.ok((JSON.parse(first.bytes["watchlist/current.json"]!) as WatchlistSnapshot).forwardRadar.length > 0);
    assert.match(first.bytes["README.md"]!, new RegExp(FIXTURE_RESEARCH_TITLE));
    assert.match(first.bytes["README.md"]!, /<kbd>清华大学<\/kbd>/);
    assert.ok(firstDashboard.stats.research >= 1);
    assert.ok(firstDashboard.research.some(({ title }) => title === FIXTURE_RESEARCH_TITLE));

    await runFixedGeneration(root);
    const second = await capturePublicGroup(root);
    const secondDashboard = JSON.parse(second.bytes["site/data/dashboard.json"]!) as DashboardData;
    assert.match(second.bytes["README.md"]!, new RegExp(FIXTURE_RESEARCH_TITLE));
    assert.match(second.bytes["README.md"]!, /<kbd>清华大学<\/kbd>/);
    assert.ok(secondDashboard.stats.research >= 1);
    assert.ok(secondDashboard.research.some(({ title }) => title === FIXTURE_RESEARCH_TITLE));
    assert.deepEqual(second.bytes, first.bytes);
    assert.deepEqual(second.semantics, first.semantics);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("complete daily Watchlist group preserves LKG bytes across the Stage 4 fault matrix", async (t) => {
  const baselineRoot = await mkdtemp(join(tmpdir(), "stage4-daily-fault-baseline-"));
  try {
    await copyFixture(baselineRoot);
    await seedNonEmptyPriorPreview(baselineRoot);
    await runFixedGeneration(baselineRoot);
    const baseline = await capturePublicGroup(baselineRoot);

    const fault = async (
      name: string,
      prepare: (root: string) => Promise<() => Promise<unknown>>,
      expected: { status: "success" | "degraded" } | { status: "failed"; code: string },
    ) => {
      await t.test(name, async () => {
        const root = await mkdtemp(join(tmpdir(), `stage4-${name}-`));
        try {
          await cp(baselineRoot, root, { recursive: true });
          const run = await prepare(root);
          if (expected.status === "failed") await expectFailedWithoutPublicChange(root, baseline, expected.code, run);
          else {
            const manifest = await run() as RunManifest;
            assert.equal(manifest.status, expected.status);
            assert.deepEqual(await capturePublicGroup(root), baseline);
          }
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      });
    };

    await fault("llm-outage", async (root) => async () => {
        const manifest = await runFixedGeneration(root, {
          llmOutage: true,
        });
        assert.deepEqual(manifest.services.find(({ component }) => component === "Watchlist"), {
          component: "Watchlist",
          status: "部分降级",
          attempted: 1,
          succeeded: 0,
          failed: 1,
          detail: "生成 0 张新判断卡；保留 1 张上一有效版本；排除 0 家。 失败原因：provider-network 1。",
        });
        return manifest;
    }, { status: "degraded" });
    await fault("corrupt-prior-json", async (root) => {
      await writeFile(join(root, "watchlist", "history", "2026-W32-v1.json"), "{not-json\n");
      return async () => runFixedGeneration(root);
    }, { status: "failed", code: "corrupt-watchlist-history" });
    await fault("history-week-identity-mismatch", async (root) => {
      const path = join(root, "watchlist", "history", "2026-W32-v1.json");
      const snapshot = JSON.parse(await readFile(path, "utf8")) as WatchlistSnapshot;
      await writeFile(path, `${JSON.stringify({ ...snapshot, week: "2026-W31" }, null, 2)}\n`);
      return async () => runFixedGeneration(root);
    }, { status: "failed", code: "corrupt-watchlist-history" });
    await fault("history-version-identity-mismatch", async (root) => {
      const path = join(root, "watchlist", "history", "2026-W32-v1.json");
      const snapshot = JSON.parse(await readFile(path, "utf8")) as WatchlistSnapshot;
      await writeFile(path, `${JSON.stringify({ ...snapshot, snapshotVersion: 2 }, null, 2)}\n`);
      return async () => runFixedGeneration(root);
    }, { status: "failed", code: "corrupt-watchlist-history" });
    await fault("corrupt-current-json", async (root) => {
      await writeFile(join(root, "watchlist", "current.json"), "{not-json\n");
      return async () => runFixedGeneration(root);
    }, { status: "failed", code: "corrupt-watchlist-current" });
    await fault("invalid-company-id", async (root) => {
      const path = join(root, "events", "companies.json");
      const companies = JSON.parse(await readFile(path, "utf8")) as Array<{ entityId?: string }>;
      companies[0]!.entityId = "INVALID/company/id";
      await writeFile(path, `${JSON.stringify(companies, null, 2)}\n`);
      return async () => runFixedGeneration(root);
    }, { status: "failed", code: "invalid-company-id" });
    await fault("evidence-withdrawal", async (root) => {
      const theses = JSON.parse(await readFile(join(root, "watchlist", "theses.json"), "utf8")) as CompanyThesisArtifact;
      const withdrawn = new Set(theses.theses.flatMap((thesis) => thesis.factReferenceIds));
      const path = join(root, "events", "index.json");
      const store = JSON.parse(await readFile(path, "utf8")) as EventStore;
      for (const event of store.events) if (withdrawn.has(event.id)) {
        (event as typeof event & { evidenceState: string }).evidenceState = "withdrawn";
        event.evidence = event.evidence.map((item) => ({ ...item, withdrawn: true }));
      }
      await writeFile(path, `${JSON.stringify(store, null, 2)}\n`);
      return async () => runFixedGeneration(root);
    }, { status: "failed", code: "evidence-withdrawal" });
    await fault("source-timeout", async (root) => async () => {
      const manifest = await runFixedGeneration(root, { collect: timeoutCollection });
      const archive = JSON.parse(await readFile(join(root, "daily", `${manifest.date}.json`), "utf8")) as DailyArchive;
      assert.equal(manifest.status, "degraded");
      assert.equal(manifest.quality.sourceFailures, 1);
      assert.deepEqual(archive.sourceOutcomes?.find(({ source }) => source === "fixture-source"), {
        source: "fixture-source",
        status: "failure",
        reason: "timeout",
        fetchedArticles: 0,
      });
      return manifest;
    }, { status: "degraded" });
    await fault("file-transaction-swap-failure", async (root) => async () => runFixedGeneration(root, {
      transaction: new FileTransaction("stage4-full-group-failure", { failAfterSwaps: 5 }),
    }), { status: "failed", code: "transaction-swap-failure" });
  } finally {
    await rm(baselineRoot, { recursive: true, force: true });
  }
});
