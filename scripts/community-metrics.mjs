import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_REPOSITORY = "mbabby/physical-ai-news-cn";
const ACCEPTED_EVIDENCE_LABELS = ["accepted-evidence", "evidence-accepted"];

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
    traffic: { status: "unavailable", referrers: [] },
    contributors: { codeContributors: [], acceptedEvidenceContributors: [], count: 0 },
  };
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
    traffic: { status: "unavailable", referrers: [] },
    contributors: {
      codeContributors,
      acceptedEvidenceContributors,
      count: new Set([...codeContributors, ...acceptedEvidenceContributors]).size,
    },
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
  if (!token) return { status: "unavailable", referrers: [] };
  try {
    const [views, clones, referrers] = await Promise.all([
      githubJson(fetchImpl, `${apiBase}/repos/${repository}/traffic/views`, token),
      githubJson(fetchImpl, `${apiBase}/repos/${repository}/traffic/clones`, token),
      githubJson(fetchImpl, `${apiBase}/repos/${repository}/traffic/popular/referrers`, token),
    ]);
    return {
      status: "available",
      views14d: Number(views.count) || 0,
      uniqueVisitors14d: Number(views.uniques) || 0,
      clones14d: Number(clones.count) || 0,
      uniqueCloners14d: Number(clones.uniques) || 0,
      referrers: Array.isArray(referrers)
        ? referrers.map((item) => ({ referrer: String(item.referrer || ""), count: Number(item.count) || 0, uniques: Number(item.uniques) || 0 })).filter((item) => item.referrer)
        : [],
    };
  } catch {
    return { status: "unavailable", referrers: [] };
  }
}

async function collectAcceptedEvidenceContributors(fetchImpl, apiBase, repository, token) {
  if (!token) return null;
  try {
    const issuesByLabel = await Promise.all(
      ACCEPTED_EVIDENCE_LABELS.map((label) =>
        githubJson(fetchImpl, `${apiBase}/repos/${repository}/issues?state=all&labels=${encodeURIComponent(label)}&per_page=100`, token),
      ),
    );
    return uniqueLogins(issuesByLabel.flatMap((issues) => Array.isArray(issues) ? issues.map((issue) => issue?.user?.login) : []));
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
  apiBase = "https://api.github.com",
} = {}) {
  const repo = safeRepository(repository);
  const generatedAt = now.toISOString();
  const result = normalizeExisting(previous, generatedAt);

  const [repositoryResult, codeContributorsResult, traffic, acceptedEvidenceContributors] = await Promise.all([
    githubJson(fetchImpl, `${apiBase}/repos/${repo}`, "").catch(() => null),
    githubJson(fetchImpl, `${apiBase}/repos/${repo}/contributors?per_page=100&anon=false`, "").catch(() => null),
    collectTraffic(fetchImpl, apiBase, repo, token),
    collectAcceptedEvidenceContributors(fetchImpl, apiBase, repo, token),
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
  return result;
}

async function readPrevious(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
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
  const metrics = await collectCommunityMetrics({ ...options, previous });
  await Promise.all([writeJsonAtomic(outputPath, metrics), writeJsonAtomic(siteOutputPath, metrics)]);
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
