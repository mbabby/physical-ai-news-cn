import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { loadGrowthExperimentConfig, validateGrowthExperimentConfig } from "./contracts.js";
import type { GrowthExperimentConfig } from "./contracts.js";

const DEFAULT_REPOSITORY = "mbabby/physical-ai-news-cn";
const BOT_LOGINS = new Set(["actions-user", "github-actions", "dependabot"]);

export interface GrowthTrafficSummary {
  status: "available";
  views14d: number;
  uniqueVisitors14d: number;
  referrers: GrowthReferrer[];
}

export interface GrowthReferrer {
  referrer: string;
  count: number;
  uniques: number;
}

export interface GrowthReferenceCandidate {
  url: string;
  author: string;
  source: "issues" | "code";
  title: string;
}

export interface GrowthReferenceSearch {
  status: "available";
  candidates: GrowthReferenceCandidate[];
}

export interface GrowthSnapshot {
  observedAt: string;
  stars: number;
  stale: boolean;
  traffic: GrowthTrafficSummary | "unknown";
  referenceSearch: GrowthReferenceSearch | "unknown";
  clones14d?: number;
}

export interface GrowthReferenceDecision {
  url: string;
  author: string;
  reviewedBy: string;
  reviewedAt: string;
  reason: "external-user-reference";
}

export interface GrowthMetricsArtifact {
  schemaVersion: 1;
  experimentId: string;
  generatedAt: string;
  baselineStars: number;
  targetStars: number;
  starDelta: number;
  uniqueVisitors14d: number | "unknown";
  verifiedExternalAuthors: number;
  targetExternalAuthors: number;
  candidateReferences: number | "unknown";
  goalProgress: {
    stars: {
      baseline: number;
      current: number;
      target: number;
      delta: number;
      remaining: number;
    };
    externalAuthors: {
      current: number;
      target: number;
      remaining: number;
    };
    traffic: {
      uniqueVisitors14d: number | "unknown";
    };
  };
}

export interface CollectGrowthSnapshotInput {
  repository?: string;
  token?: string;
  fetchImpl?: typeof fetch;
  now?: Date;
  previous?: Pick<GrowthSnapshot, "observedAt" | "stars" | "traffic" | "referenceSearch">;
  apiBase?: string;
}

export interface BuildGrowthMetricsInput {
  config: GrowthExperimentConfig;
  snapshots: Array<GrowthSnapshot | LegacyGrowthSnapshot>;
  candidates: GrowthReferenceCandidate[] | "unknown";
  decisions: unknown[];
  repository?: string;
}

export interface RunGrowthMetricsInput extends CollectGrowthSnapshotInput {
  root?: string;
  config?: GrowthExperimentConfig;
  metricsOutput?: string;
  historyOutput?: string;
  candidatesOutput?: string;
  decisionsInput?: string;
}

interface LegacyGrowthSnapshot {
  observedAt: string;
  stars: number;
  traffic: GrowthTrafficSummary | "unknown";
  clones14d?: number;
}

interface GrowthHistoryArtifact {
  schemaVersion: 1;
  snapshots: GrowthSnapshot[];
}

interface GrowthReferenceCandidatesArtifact {
  schemaVersion: 1;
  generatedAt: string;
  candidates: GrowthReferenceCandidate[];
}

interface GrowthReferenceDecisionsArtifact {
  schemaVersion: 1;
  decisions: unknown[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function httpUrl(value: unknown): value is string {
  if (!nonEmptyString(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function safeRepository(repository: string | undefined): string {
  const normalized = String(repository || DEFAULT_REPOSITORY).trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized)) {
    throw new Error(`Invalid GitHub repository identifier: ${normalized || "(empty)"}`);
  }
  return normalized;
}

function repositoryOwner(repository: string): string {
  return repository.split("/")[0]!.toLowerCase();
}

function unavailableIfMalformedTraffic(views: unknown, referrers: unknown): GrowthTrafficSummary | "unknown" {
  if (!isRecord(views) || !isCount(views.count) || !isCount(views.uniques)) return "unknown";
  if (!Array.isArray(referrers) || !referrers.every((item) => isRecord(item)
    && nonEmptyString(item.referrer) && isCount(item.count) && isCount(item.uniques))) return "unknown";
  return {
    status: "available",
    views14d: views.count,
    uniqueVisitors14d: views.uniques,
    referrers: referrers.map((item) => ({
      referrer: String(item.referrer),
      count: Number(item.count),
      uniques: Number(item.uniques),
    })),
  };
}

async function githubJson(fetchImpl: typeof fetch, url: string, token: string): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "physical-ai-news-cn-top-signals-growth",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetchImpl(url, { headers });
  if (!response.ok) throw new Error(`GitHub API request failed (${response.status}) for ${new URL(url).pathname}`);
  return response.json() as Promise<unknown>;
}

async function collectTraffic(fetchImpl: typeof fetch, apiBase: string, repository: string, token: string): Promise<GrowthTrafficSummary | "unknown"> {
  if (!token) return "unknown";
  try {
    const [views, referrers] = await Promise.all([
      githubJson(fetchImpl, `${apiBase}/repos/${repository}/traffic/views`, token),
      githubJson(fetchImpl, `${apiBase}/repos/${repository}/traffic/popular/referrers`, token),
    ]);
    return unavailableIfMalformedTraffic(views, referrers);
  } catch {
    return "unknown";
  }
}

function candidateFromIssue(item: unknown): GrowthReferenceCandidate | null {
  if (!isRecord(item) || !nonEmptyString(item.html_url)) return null;
  const user = isRecord(item.user) ? item.user : {};
  if (!nonEmptyString(user.login)) return null;
  return {
    url: item.html_url,
    author: user.login,
    source: "issues",
    title: nonEmptyString(item.title) ? item.title : item.html_url,
  };
}

function candidateFromCode(item: unknown): GrowthReferenceCandidate | null {
  if (!isRecord(item) || !nonEmptyString(item.html_url)) return null;
  const repository = isRecord(item.repository) ? item.repository : {};
  const owner = isRecord(repository.owner) ? repository.owner : {};
  if (!nonEmptyString(owner.login)) return null;
  return {
    url: item.html_url,
    author: owner.login,
    source: "code",
    title: nonEmptyString(item.name) ? item.name : item.html_url,
  };
}

function searchItems(value: unknown): unknown[] | null {
  return isRecord(value) && Array.isArray(value.items) ? value.items : null;
}

function uniqueCandidates(candidates: GrowthReferenceCandidate[]): GrowthReferenceCandidate[] {
  const seen = new Set<string>();
  const result: GrowthReferenceCandidate[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.url)) continue;
    seen.add(candidate.url);
    result.push(candidate);
  }
  return result.sort((left, right) => left.url.localeCompare(right.url));
}

async function collectReferenceCandidates(fetchImpl: typeof fetch, apiBase: string, repository: string, token: string): Promise<GrowthReferenceSearch | "unknown"> {
  if (!token) return "unknown";
  const query = encodeURIComponent(`"physical-ai-news-cn" -repo:${repository}`);
  try {
    const [issues, code] = await Promise.all([
      githubJson(fetchImpl, `${apiBase}/search/issues?q=${query}&per_page=20`, token),
      githubJson(fetchImpl, `${apiBase}/search/code?q=${query}&per_page=20`, token),
    ]);
    const issueItems = searchItems(issues);
    const codeItems = searchItems(code);
    if (!issueItems || !codeItems) return "unknown";
    return {
      status: "available",
      candidates: uniqueCandidates([
        ...issueItems.map(candidateFromIssue).filter((item): item is GrowthReferenceCandidate => Boolean(item)),
        ...codeItems.map(candidateFromCode).filter((item): item is GrowthReferenceCandidate => Boolean(item)),
      ]),
    };
  } catch {
    return "unknown";
  }
}

function starsFromRepository(value: unknown): number | null {
  return isRecord(value) && isCount(value.stargazers_count) ? value.stargazers_count : null;
}

export async function collectGrowthSnapshot({
  repository = process.env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY,
  token = process.env.TOP_SIGNALS_METRICS_TOKEN || process.env.COMMUNITY_METRICS_TOKEN || process.env.GITHUB_TOKEN || "",
  fetchImpl = globalThis.fetch,
  now = new Date(),
  previous,
  apiBase = "https://api.github.com",
}: CollectGrowthSnapshotInput = {}): Promise<GrowthSnapshot> {
  const repo = safeRepository(repository);
  const [repositoryResult, traffic, referenceSearch] = await Promise.all([
    githubJson(fetchImpl, `${apiBase}/repos/${repo}`, "").catch(() => null),
    collectTraffic(fetchImpl, apiBase, repo, token),
    collectReferenceCandidates(fetchImpl, apiBase, repo, token),
  ]);
  const stars = starsFromRepository(repositoryResult);
  return {
    observedAt: now.toISOString(),
    stars: stars ?? (isCount(previous?.stars) ? previous.stars : 0),
    stale: stars === null,
    traffic,
    referenceSearch,
  };
}

function latestSnapshot(snapshots: Array<GrowthSnapshot | LegacyGrowthSnapshot>): GrowthSnapshot | LegacyGrowthSnapshot {
  if (!snapshots.length) throw new Error("Top Signals growth metrics require at least one snapshot");
  return [...snapshots].sort((left, right) => left.observedAt.localeCompare(right.observedAt)).at(-1)!;
}

function isBot(login: string): boolean {
  const normalized = login.toLowerCase();
  return normalized.endsWith("[bot]") || BOT_LOGINS.has(normalized);
}

function isProjectLocalUrl(url: string, repository: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname.toLowerCase() === "github.com" && parsed.pathname.toLowerCase().startsWith(`/${repository.toLowerCase()}/`);
  } catch {
    return false;
  }
}

function validDecision(value: unknown): GrowthReferenceDecision | null {
  if (!isRecord(value)) return null;
  if (!httpUrl(value.url) || !nonEmptyString(value.author) || !nonEmptyString(value.reviewedBy)
    || !canonicalTimestamp(value.reviewedAt) || value.reason !== "external-user-reference") return null;
  return {
    url: value.url,
    author: value.author,
    reviewedBy: value.reviewedBy,
    reviewedAt: value.reviewedAt,
    reason: "external-user-reference",
  };
}

function verifiedExternalAuthorCount(decisions: unknown[], repository: string): number {
  const owner = repositoryOwner(repository);
  const seenUrls = new Set<string>();
  const seenAuthors = new Set<string>();
  for (const value of decisions) {
    const decision = validDecision(value);
    if (!decision) continue;
    const author = decision.author.toLowerCase();
    const url = decision.url.toLowerCase();
    if (author === owner || isBot(author) || isProjectLocalUrl(decision.url, repository) || seenUrls.has(url) || seenAuthors.has(author)) continue;
    seenUrls.add(url);
    seenAuthors.add(author);
  }
  return seenAuthors.size;
}

function candidateCount(candidates: GrowthReferenceCandidate[] | "unknown"): number | "unknown" {
  return candidates === "unknown" ? "unknown" : candidates.length;
}

function visitorsFrom(snapshot: GrowthSnapshot | LegacyGrowthSnapshot): number | "unknown" {
  return snapshot.traffic === "unknown" ? "unknown" : snapshot.traffic.uniqueVisitors14d;
}

export function buildGrowthMetrics({
  config,
  snapshots,
  candidates,
  decisions,
  repository = DEFAULT_REPOSITORY,
}: BuildGrowthMetricsInput): GrowthMetricsArtifact {
  validateGrowthExperimentConfig(config);
  const repo = safeRepository(repository);
  const latest = latestSnapshot(snapshots);
  const starDelta = latest.stars - config.baselineStars;
  const uniqueVisitors14d = visitorsFrom(latest);
  const verifiedExternalAuthors = verifiedExternalAuthorCount(decisions, repo);
  return {
    schemaVersion: 1,
    experimentId: config.experimentId,
    generatedAt: latest.observedAt,
    baselineStars: config.baselineStars,
    targetStars: config.targetStars,
    starDelta,
    uniqueVisitors14d,
    verifiedExternalAuthors,
    targetExternalAuthors: config.targetExternalAuthors,
    candidateReferences: candidateCount(candidates),
    goalProgress: {
      stars: {
        baseline: config.baselineStars,
        current: latest.stars,
        target: config.targetStars,
        delta: starDelta,
        remaining: Math.max(0, config.targetStars - latest.stars),
      },
      externalAuthors: {
        current: verifiedExternalAuthors,
        target: config.targetExternalAuthors,
        remaining: Math.max(0, config.targetExternalAuthors - verifiedExternalAuthors),
      },
      traffic: { uniqueVisitors14d },
    },
  };
}

async function readJson(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return undefined;
    throw new Error(`Invalid Top Signals growth local artifact: cannot read valid JSON at ${path}`, { cause: error });
  }
}

function validHistoryTraffic(value: unknown): value is GrowthTrafficSummary | "unknown" {
  if (value === "unknown") return true;
  if (!isRecord(value) || !exactKeys(value, ["status", "views14d", "uniqueVisitors14d", "referrers"])) return false;
  return value.status === "available" && isCount(value.views14d) && isCount(value.uniqueVisitors14d)
    && Array.isArray(value.referrers) && value.referrers.every((item) => isRecord(item)
      && exactKeys(item, ["referrer", "count", "uniques"])
      && nonEmptyString(item.referrer) && isCount(item.count) && isCount(item.uniques));
}

function validHistoryCandidate(value: unknown): value is GrowthReferenceCandidate {
  return isRecord(value) && exactKeys(value, ["url", "author", "source", "title"])
    && httpUrl(value.url) && nonEmptyString(value.author) && (value.source === "issues" || value.source === "code")
    && nonEmptyString(value.title);
}

function validHistoryReferenceSearch(value: unknown): value is GrowthReferenceSearch | "unknown" {
  if (value === "unknown") return true;
  return isRecord(value) && exactKeys(value, ["status", "candidates"])
    && value.status === "available" && Array.isArray(value.candidates)
    && value.candidates.every(validHistoryCandidate);
}

function validateHistorySnapshot(value: unknown, index: number): GrowthSnapshot {
  if (!isRecord(value)) throw new Error(`Invalid Top Signals growth local artifact: history snapshot ${index} is malformed`);
  const allowedKeys = Object.hasOwn(value, "clones14d")
    ? ["observedAt", "stars", "stale", "traffic", "referenceSearch", "clones14d"]
    : ["observedAt", "stars", "stale", "traffic", "referenceSearch"];
  if (!exactKeys(value, allowedKeys) || !canonicalTimestamp(value.observedAt) || !isCount(value.stars)
    || typeof value.stale !== "boolean" || !validHistoryTraffic(value.traffic)
    || !validHistoryReferenceSearch(value.referenceSearch)
    || (Object.hasOwn(value, "clones14d") && !isCount(value.clones14d))) {
    throw new Error(`Invalid Top Signals growth local artifact: history snapshot ${index} is malformed`);
  }
  return value as unknown as GrowthSnapshot;
}

function assertHistory(value: unknown | undefined): GrowthHistoryArtifact {
  if (value === undefined) return { schemaVersion: 1, snapshots: [] };
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.snapshots)) {
    throw new Error("Invalid Top Signals growth local artifact: history contract is malformed");
  }
  return {
    schemaVersion: 1,
    snapshots: value.snapshots.map(validateHistorySnapshot),
  };
}

function assertDecisions(value: unknown | undefined): GrowthReferenceDecisionsArtifact {
  if (value === undefined) return { schemaVersion: 1, decisions: [] };
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.decisions)) {
    throw new Error("Invalid Top Signals growth local artifact: reference decisions contract is malformed");
  }
  return { schemaVersion: 1, decisions: value.decisions };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function runGrowthMetrics({
  root = process.cwd(),
  config,
  metricsOutput = "metrics/top-signals-growth.json",
  historyOutput = "metrics/top-signals-growth-history.json",
  candidatesOutput = "review/top-signals-reference-candidates.json",
  decisionsInput = "review/top-signals-reference-decisions.json",
  ...snapshotInput
}: RunGrowthMetricsInput = {}): Promise<GrowthMetricsArtifact> {
  const resolvedRoot = resolve(root);
  const resolvedConfig = config ?? await loadGrowthExperimentConfig(resolvedRoot);
  const historyPath = join(resolvedRoot, historyOutput);
  const decisionsPath = join(resolvedRoot, decisionsInput);
  const history = assertHistory(await readJson(historyPath));
  const decisions = assertDecisions(await readJson(decisionsPath));
  const snapshot = await collectGrowthSnapshot({
    ...snapshotInput,
    previous: snapshotInput.previous ?? history.snapshots.at(-1),
  });
  const candidates = snapshot.referenceSearch === "unknown" ? [] : snapshot.referenceSearch.candidates;
  const artifact = buildGrowthMetrics({
    config: resolvedConfig,
    snapshots: [...history.snapshots, snapshot],
    candidates: snapshot.referenceSearch === "unknown" ? "unknown" : candidates,
    decisions: decisions.decisions,
    repository: snapshotInput.repository,
  });
  const candidatesArtifact: GrowthReferenceCandidatesArtifact = {
    schemaVersion: 1,
    generatedAt: snapshot.observedAt,
    candidates,
  };
  await Promise.all([
    writeJson(join(resolvedRoot, metricsOutput), artifact),
    writeJson(historyPath, { schemaVersion: 1, snapshots: [...history.snapshots, snapshot] }),
    writeJson(join(resolvedRoot, candidatesOutput), candidatesArtifact),
  ]);
  return artifact;
}
