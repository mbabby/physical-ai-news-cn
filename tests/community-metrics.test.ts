import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collectCommunityMetrics, runCommunityMetrics } from "../scripts/community-metrics.mjs";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("collects public repository metrics without sending an authorization header", async () => {
  const requests: Array<{ url: string; authorization?: string }> = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    requests.push({ url, authorization: headers.get("authorization") ?? undefined });
    if (url.endsWith("/contributors?per_page=100&anon=false")) return response([{ login: "alice" }, { login: "dependabot[bot]" }, { login: "actions-user" }]);
    if (url.endsWith("/repos/example/project")) return response({ stargazers_count: 42, forks_count: 7, subscribers_count: 5, open_issues_count: 3 });
    return response({}, 404);
  };
  const metrics = await collectCommunityMetrics({ repository: "example/project", token: "", fetchImpl, now: new Date("2026-08-09T00:00:00Z") });

  assert.deepEqual(metrics.repository, { stars: 42, forks: 7, subscribers: 5, openIssues: 3 });
  assert.deepEqual(metrics.traffic, { status: "unavailable", views14d: null, uniqueVisitors14d: null, clones14d: null, uniqueCloners14d: null, referrers: null });
  assert.deepEqual(metrics.contributors, { codeContributors: ["alice"], acceptedEvidenceContributors: [], count: 1 });
  assert.ok(requests.every((request) => request.authorization === undefined));
});

test("collects privileged traffic and accepted evidence contributors when a token is available", async () => {
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    assert.equal(new Headers(init?.headers).get("authorization"), url.includes("/traffic/") || url.includes("labels=") ? "Bearer secret-token" : null);
    if (url.includes("labels=")) assert.match(url, /[?&]state=all(?:&|$)/);
    if (url.endsWith("/contributors?per_page=100&anon=false")) return response([{ login: "alice" }]);
    if (url.endsWith("/repos/example/project")) return response({ stargazers_count: 50, forks_count: 8, subscribers_count: 6, open_issues_count: 4 });
    if (url.endsWith("/traffic/views")) return response({ count: 120, uniques: 40 });
    if (url.endsWith("/traffic/clones")) return response({ count: 18, uniques: 9 });
    if (url.endsWith("/traffic/popular/referrers")) return response([{ referrer: "github.com", count: 20, uniques: 10 }]);
    if (url.includes("labels=accepted-evidence")) return response([{ user: { login: "bob" } }]);
    if (url.includes("labels=evidence-accepted")) return response([{ user: { login: "alice" } }]);
    return response({}, 404);
  };
  const metrics = await collectCommunityMetrics({ repository: "example/project", token: "secret-token", fetchImpl });

  assert.deepEqual(metrics.traffic, {
    status: "available",
    views14d: 120,
    uniqueVisitors14d: 40,
    clones14d: 18,
    uniqueCloners14d: 9,
    referrers: [{ referrer: "github.com", count: 20, uniques: 10 }],
  });
  assert.deepEqual(metrics.contributors, { codeContributors: ["alice"], acceptedEvidenceContributors: ["alice", "bob"], count: 2 });
});

test("degrades privileged failures and preserves last public metrics when GitHub is temporarily unavailable", async () => {
  const previous = {
    repository: { stars: 21, forks: 4, subscribers: 3, openIssues: 2 },
    contributors: { codeContributors: ["alice"], acceptedEvidenceContributors: ["bob"], count: 2 },
  };
  const fetchImpl = async () => response({ message: "unavailable" }, 503);
  const metrics = await collectCommunityMetrics({ repository: "example/project", token: "secret-token", fetchImpl, previous });

  assert.deepEqual(metrics.repository, previous.repository);
  assert.deepEqual(metrics.traffic, { status: "unavailable", views14d: null, uniqueVisitors14d: null, clones14d: null, uniqueCloners14d: null, referrers: null });
  assert.deepEqual(metrics.contributors, { codeContributors: ["alice"], acceptedEvidenceContributors: ["bob"], count: 2 });
});

test("writes the same stable contract to metrics and public site data", async () => {
  const root = await mkdtemp(join(tmpdir(), "community-metrics-"));
  const fetchImpl = async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/contributors?per_page=100&anon=false")) return response([]);
    if (url.endsWith("/repos/example/project")) return response({ stargazers_count: 2, forks_count: 1, subscribers_count: 0, open_issues_count: 0 });
    return response({}, 404);
  };
  const metrics = await runCommunityMetrics({ root, repository: "example/project", token: "", fetchImpl, now: new Date("2026-08-09T00:00:00Z") });
  const canonical = JSON.parse(await readFile(join(root, "metrics/community.json"), "utf8"));
  const publicCopy = JSON.parse(await readFile(join(root, "site/data/community.json"), "utf8"));

  assert.deepEqual(canonical, metrics);
  assert.deepEqual(publicCopy, metrics);
  assert.deepEqual(Object.keys(metrics), ["generatedAt", "repository", "traffic", "contributors"]);
});

test("restores both community mirrors when the second public swap fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "community-metrics-rollback-"));
  const canonicalPath = join(root, "metrics/community.json");
  const publicPath = join(root, "site/data/community.json");
  await Promise.all([mkdir(join(root, "metrics"), { recursive: true }), mkdir(join(root, "site/data"), { recursive: true })]);
  await Promise.all([
    writeFile(canonicalPath, "last-known-good:canonical\n", "utf8"),
    writeFile(publicPath, "last-known-good:public\n", "utf8"),
  ]);
  const fetchImpl = async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/contributors?per_page=100&anon=false")) return response([]);
    if (url.endsWith("/repos/example/project")) return response({ stargazers_count: 2, forks_count: 1, subscribers_count: 0, open_issues_count: 0 });
    return response({}, 404);
  };

  await assert.rejects(
    () => runCommunityMetrics({
      root,
      repository: "example/project",
      token: "",
      fetchImpl,
      renameImpl: async (source: string, target: string) => {
        if (target === publicPath && source.includes(".tmp-")) throw new Error("injected second swap failure");
        await rename(source, target);
      },
    }),
    /rolled back|回滚/i,
  );
  assert.equal(await readFile(canonicalPath, "utf8"), "last-known-good:canonical\n");
  assert.equal(await readFile(publicPath, "utf8"), "last-known-good:public\n");
});

test("workflow schedules refreshes and explicitly deploys token-authored commits", async () => {
  const workflow = await readFile(".github/workflows/community-metrics.yml", "utf8");
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /contents: write/);
  assert.match(workflow, /actions: write/);
  assert.match(workflow, /COMMUNITY_METRICS_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(workflow, /gh workflow run deploy-pages\.yml --ref main/);
  assert.doesNotMatch(workflow, /echo .*COMMUNITY_METRICS_TOKEN/);
});
