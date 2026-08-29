import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assertContributionLedgerArtifact } from "../src/community-evidence/contracts.ts";

const DEFAULT_REPOSITORY = "mbabby/physical-ai-news-cn";

function uniqueLogins(logins) {
  const automationAccounts = new Set(["actions-user", "github-actions", "dependabot"]);
  return [...new Set(logins.filter((login) => {
    if (typeof login !== "string" || !login) return false;
    const normalized = login.toLowerCase();
    return !normalized.endsWith("[bot]") && !automationAccounts.has(normalized);
  }))].sort((a, b) => a.localeCompare(b));
}

function safeRepository(repository) {
  const normalized = String(repository || "").trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized)) {
    throw new Error(`Invalid GitHub repository identifier: ${normalized || "(empty)"}`);
  }
  return normalized;
}

function fallbackMetrics(generatedAt) {
  return {
    generatedAt,
    repository: { stars: 0, forks: 0, subscribers: 0, openIssues: 0 },
    traffic: unavailableTraffic(),
    contributors: { codeContributors: [], acceptedEvidenceContributors: [], count: 0 },
    ...emptyFlywheelMetrics(),
  };
}

function emptyFlywheelMetrics() {
  return {
    openTasks: 0,
    categoryCoverage: [],
    acceptedThisWeek: 0,
    newContributorsThisWeek: 0,
    staleRatio: 0,
    invalidRatio: 0,
    promotionConversion: 0,
  };
}

function weekStart(now) {
  const day = now.getUTCDay() || 7;
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day + 1);
}

function ratio(numerator, denominator) {
  return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(4));
}

function contributionPair(event) {
  return [event.taskId, event.issueNumber, event.contributor, event.evidenceUrl].join("\n");
}

export function buildFlywheelMetrics({ publicTasks, ledger, contributions, now = new Date() } = {}) {
  const tasks = Array.isArray(publicTasks?.tasks) ? publicTasks.tasks : [];
  const entries = Array.isArray(ledger?.entries) ? ledger.entries : [];
  const events = Array.isArray(contributions?.events) ? contributions.events : [];
  const start = weekStart(now);
  const end = start + 7 * 86_400_000;
  const acceptedThisWeek = events.filter((event) => event?.state === "accepted"
    && Date.parse(event.occurredAt) >= start && Date.parse(event.occurredAt) < end);
  const priorContributors = new Set(events.filter((event) => event?.state === "accepted" && Date.parse(event.occurredAt) < start)
    .map((event) => event.contributor));
  const acceptedPairs = new Set(events.filter((event) => event?.state === "accepted").map(contributionPair));
  const promotedPairs = new Set(events.filter((event) => event?.state === "promoted").map(contributionPair));
  const wip = entries.filter((entry) => ["open", "contributed", "stale"].includes(entry?.state));
  return {
    openTasks: tasks.length,
    categoryCoverage: [...new Set(tasks.map((task) => task?.category).filter((value) => typeof value === "string"))].sort(),
    acceptedThisWeek: acceptedThisWeek.length,
    newContributorsThisWeek: new Set(acceptedThisWeek.map((event) => event.contributor)
      .filter((contributor) => !priorContributors.has(contributor))).size,
    staleRatio: ratio(wip.filter((entry) => entry.state === "stale").length, wip.length),
    invalidRatio: ratio(entries.filter((entry) => entry.state === "rejected").length, entries.length),
    promotionConversion: ratio([...promotedPairs].filter((pair) => acceptedPairs.has(pair)).length, acceptedPairs.size),
  };
}

function unavailableTraffic() {
  return {
    status: "unavailable",
    views14d: null,
    uniqueVisitors14d: null,
    clones14d: null,
    uniqueCloners14d: null,
    referrers: null,
  };
}

function isCount(value) {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

function validTrafficSummary(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && isCount(value.count) && isCount(value.uniques);
}

function validReferrers(value) {
  return Array.isArray(value) && value.every((item) => item && typeof item === "object" && !Array.isArray(item)
    && typeof item.referrer === "string" && item.referrer.trim().length > 0
    && isCount(item.count) && isCount(item.uniques));
}

function normalizeExisting(value, generatedAt) {
  const fallback = fallbackMetrics(generatedAt);
  if (!value || typeof value !== "object") return fallback;
  const repository = value.repository && typeof value.repository === "object" ? value.repository : {};
  const contributors = value.contributors && typeof value.contributors === "object" ? value.contributors : {};
  const codeContributors = uniqueLogins(Array.isArray(contributors.codeContributors) ? contributors.codeContributors : []);
  const acceptedEvidenceContributors = uniqueLogins(Array.isArray(contributors.acceptedEvidenceContributors) ? contributors.acceptedEvidenceContributors : []);
  return {
    generatedAt,
    repository: {
      stars: Number.isFinite(repository.stars) ? repository.stars : 0,
      forks: Number.isFinite(repository.forks) ? repository.forks : 0,
      subscribers: Number.isFinite(repository.subscribers) ? repository.subscribers : 0,
      openIssues: Number.isFinite(repository.openIssues) ? repository.openIssues : 0,
    },
    traffic: unavailableTraffic(),
    contributors: {
      codeContributors,
      acceptedEvidenceContributors,
      count: new Set([...codeContributors, ...acceptedEvidenceContributors]).size,
    },
    openTasks: isCount(value.openTasks) ? value.openTasks : fallback.openTasks,
    categoryCoverage: Array.isArray(value.categoryCoverage)
      ? [...new Set(value.categoryCoverage.filter((item) => typeof item === "string"))].sort()
      : fallback.categoryCoverage,
    acceptedThisWeek: isCount(value.acceptedThisWeek) ? value.acceptedThisWeek : fallback.acceptedThisWeek,
    newContributorsThisWeek: isCount(value.newContributorsThisWeek) ? value.newContributorsThisWeek : fallback.newContributorsThisWeek,
    staleRatio: typeof value.staleRatio === "number" && value.staleRatio >= 0 && value.staleRatio <= 1 ? value.staleRatio : fallback.staleRatio,
    invalidRatio: typeof value.invalidRatio === "number" && value.invalidRatio >= 0 && value.invalidRatio <= 1 ? value.invalidRatio : fallback.invalidRatio,
    promotionConversion: typeof value.promotionConversion === "number" && value.promotionConversion >= 0 && value.promotionConversion <= 1
      ? value.promotionConversion : fallback.promotionConversion,
  };
}

async function githubJson(fetchImpl, url, token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "physical-ai-news-cn-community-metrics",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetchImpl(url, { headers });
  if (!response.ok) {
    const endpoint = new URL(url).pathname;
    throw new Error(`GitHub API request failed (${response.status}) for ${endpoint}`);
  }
  return response.json();
}

async function collectTraffic(fetchImpl, apiBase, repository, token) {
  if (!token) return unavailableTraffic();
  try {
    const [views, clones, referrers] = await Promise.all([
      githubJson(fetchImpl, `${apiBase}/repos/${repository}/traffic/views`, token),
      githubJson(fetchImpl, `${apiBase}/repos/${repository}/traffic/clones`, token),
      githubJson(fetchImpl, `${apiBase}/repos/${repository}/traffic/popular/referrers`, token),
    ]);
    if (!validTrafficSummary(views) || !validTrafficSummary(clones) || !validReferrers(referrers)) return unavailableTraffic();
    return {
      status: "available",
      views14d: views.count,
      uniqueVisitors14d: views.uniques,
      clones14d: clones.count,
      uniqueCloners14d: clones.uniques,
      referrers: referrers.map((item) => ({ referrer: item.referrer, count: item.count, uniques: item.uniques })),
    };
  } catch {
    return unavailableTraffic();
  }
}

function collectAcceptedEvidenceContributors(contributions) {
  try {
    assertContributionLedgerArtifact(contributions);
    return uniqueLogins(contributions.events
      .filter((event) => event.state === "accepted")
      .map((event) => event.contributor));
  } catch {
    return null;
  }
}

export async function collectCommunityMetrics({
  repository = process.env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY,
  token = process.env.COMMUNITY_METRICS_TOKEN || process.env.GITHUB_TOKEN || "",
  fetchImpl = globalThis.fetch,
  now = new Date(),
  previous,
  flywheel,
  contributions,
  apiBase = "https://api.github.com",
} = {}) {
  const repo = safeRepository(repository);
  const generatedAt = now.toISOString();
  const result = normalizeExisting(previous, generatedAt);

  const acceptedEvidenceContributors = collectAcceptedEvidenceContributors(contributions);
  const [repositoryResult, codeContributorsResult, traffic] = await Promise.all([
    githubJson(fetchImpl, `${apiBase}/repos/${repo}`, "").catch(() => null),
    githubJson(fetchImpl, `${apiBase}/repos/${repo}/contributors?per_page=100&anon=false`, "").catch(() => null),
    collectTraffic(fetchImpl, apiBase, repo, token),
  ]);

  if (repositoryResult) {
    result.repository = {
      stars: Number(repositoryResult.stargazers_count) || 0,
      forks: Number(repositoryResult.forks_count) || 0,
      subscribers: Number(repositoryResult.subscribers_count) || 0,
      openIssues: Number(repositoryResult.open_issues_count) || 0,
    };
  }
  const codeContributors = codeContributorsResult
    ? uniqueLogins(codeContributorsResult.map((contributor) => contributor?.login))
    : result.contributors.codeContributors;
  const accepted = acceptedEvidenceContributors ?? result.contributors.acceptedEvidenceContributors;
  result.traffic = traffic;
  result.contributors = {
    codeContributors,
    acceptedEvidenceContributors: accepted,
    count: new Set([...codeContributors, ...accepted]).size,
  };
  if (flywheel) Object.assign(result, flywheel);
  return result;
}

async function readPrevious(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

async function readFlywheelArtifacts(root) {
  const [publicTasks, ledger, contributions] = await Promise.all([
    readPrevious(resolve(root, "site/data/community-tasks.json")),
    readPrevious(resolve(root, "review/evidence-task-ledger.json")),
    readPrevious(resolve(root, "community/contributions.json")),
  ]);
  return { publicTasks, ledger, contributions };
}

async function publishMirrorPair({ canonicalPath, publicPath, content, renameImpl = rename, transactionId = `${process.pid}-${Date.now()}` }) {
  const files = [canonicalPath, publicPath].map((path) => ({
    path,
    temp: `${path}.tmp-${transactionId}`,
    backup: `${path}.bak-${transactionId}`,
    existed: false,
  }));
  const swapped = [];
  try {
    for (const file of files) {
      await mkdir(dirname(file.path), { recursive: true });
      await writeFile(file.temp, content, "utf8");
      try {
        await readFile(file.path, "utf8");
        file.existed = true;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    for (const file of files) {
      if (file.existed) await renameImpl(file.path, file.backup);
      try {
        await renameImpl(file.temp, file.path);
        swapped.push(file);
      } catch (error) {
        if (file.existed) await renameImpl(file.backup, file.path).catch(() => undefined);
        throw error;
      }
    }
    await Promise.all(files.filter((file) => file.existed).map((file) => unlink(file.backup).catch(() => undefined)));
  } catch (error) {
    for (const file of [...swapped].reverse()) {
      await unlink(file.path).catch(() => undefined);
      if (file.existed) await renameImpl(file.backup, file.path).catch(() => undefined);
    }
    await Promise.all(files.flatMap((file) => [unlink(file.temp).catch(() => undefined), unlink(file.backup).catch(() => undefined)]));
    throw new Error("Community metrics mirror publish failed; rolled back both public mirrors.", { cause: error });
  }
}

export async function runCommunityMetrics({
  root = process.cwd(),
  output = "metrics/community.json",
  siteOutput = "site/data/community.json",
  ...options
} = {}) {
  const outputPath = resolve(root, output);
  const siteOutputPath = resolve(root, siteOutput);
  const previous = options.previous ?? await readPrevious(outputPath);
  const artifacts = await readFlywheelArtifacts(root);
  const completeFlywheel = artifacts.publicTasks && artifacts.ledger && artifacts.contributions;
  const flywheel = options.flywheel ?? (completeFlywheel ? buildFlywheelMetrics({ ...artifacts, now: options.now ?? new Date() }) : undefined);
  const metrics = await collectCommunityMetrics({
    ...options,
    previous,
    flywheel,
    contributions: options.contributions ?? artifacts.contributions,
  });
  await publishMirrorPair({
    canonicalPath: outputPath,
    publicPath: siteOutputPath,
    content: `${JSON.stringify(metrics, null, 2)}\n`,
    renameImpl: options.renameImpl,
  });
  return metrics;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCommunityMetrics()
    .then((metrics) => {
      const traffic = metrics.traffic.status === "available" ? "available" : "unavailable (degraded)";
      console.log(`Community metrics updated: stars=${metrics.repository.stars}, contributors=${metrics.contributors.count}, traffic=${traffic}`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "Community metrics collection failed");
      process.exitCode = 1;
    });
}
