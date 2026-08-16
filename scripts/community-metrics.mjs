import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
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
    traffic: unavailableTraffic(),
    contributors: { codeContributors: [], acceptedEvidenceContributors: [], count: 0 },
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
    return unavailableTraffic();
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
  const metrics = await collectCommunityMetrics({ ...options, previous });
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
