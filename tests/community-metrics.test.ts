import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildFlywheelMetrics, collectCommunityMetrics, runCommunityMetrics } from "../scripts/community-metrics.mjs";

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
  assert.deepEqual({ openTasks: metrics.openTasks, categoryCoverage: metrics.categoryCoverage, acceptedThisWeek: metrics.acceptedThisWeek,
    newContributorsThisWeek: metrics.newContributorsThisWeek, staleRatio: metrics.staleRatio, invalidRatio: metrics.invalidRatio,
    promotionConversion: metrics.promotionConversion }, {
    openTasks: 0, categoryCoverage: [], acceptedThisWeek: 0, newContributorsThisWeek: 0,
    staleRatio: 0, invalidRatio: 0, promotionConversion: 0,
  });
  assert.ok(requests.every((request) => request.authorization === undefined));
});

test("builds aggregate flywheel metrics without contributor rankings or per-user scores", () => {
  const accepted = (contributor: string, occurredAt: string, promoted = false) => [{
    taskId: `task-${contributor}`, issueNumber: contributor === "alice" ? 41 : 42, contributor,
    evidenceUrl: `https://evidence.example/${contributor}`, state: "accepted", occurredAt,
  }, ...(promoted ? [{ taskId: `task-${contributor}`, issueNumber: contributor === "alice" ? 41 : 42, contributor,
    evidenceUrl: `https://evidence.example/${contributor}`, state: "promoted", occurredAt: "2026-08-25T09:00:00.000Z" }] : [])];
  const metrics = buildFlywheelMetrics({
    publicTasks: { tasks: [{ category: "company-funding" }, { category: "research-metadata" }] },
    ledger: { entries: [{ state: "open" }, { state: "stale" }, { state: "rejected" }, { state: "accepted" }] },
    contributions: { events: [
      ...accepted("alice", "2026-08-18T08:00:00.000Z"),
      ...accepted("alice", "2026-08-25T08:00:00.000Z", true),
      ...accepted("bob", "2026-08-25T08:30:00.000Z"),
    ] },
    now: new Date("2026-08-25T10:00:00.000Z"),
  });
  assert.deepEqual(metrics, {
    openTasks: 2, categoryCoverage: ["company-funding", "research-metadata"], acceptedThisWeek: 2,
    newContributorsThisWeek: 1, staleRatio: 0.5, invalidRatio: 0.25, promotionConversion: 0.5,
  });
  assert.doesNotMatch(JSON.stringify(metrics), /ranking|score|topContributors|alice|bob/i);
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

test("treats incomplete or malformed successful traffic responses as unavailable but preserves explicit zeroes", async () => {
  const trafficCases: Array<{ name: string; views: unknown; clones: unknown; referrers: unknown }> = [
    { name: "missing views counts", views: {}, clones: { count: 0, uniques: 0 }, referrers: [] },
    { name: "non-finite clone count", views: { count: 0, uniques: 0 }, clones: "non-finite", referrers: [] },
    { name: "wrong referrer container", views: { count: 0, uniques: 0 }, clones: { count: 0, uniques: 0 }, referrers: {} },
    { name: "incomplete referrer entry", views: { count: 0, uniques: 0 }, clones: { count: 0, uniques: 0 }, referrers: [{ referrer: "github.com", count: 0 }] },
  ];
  for (const trafficCase of trafficCases) {
    const fetchImpl = async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/contributors?per_page=100&anon=false")) return response([]);
      if (url.endsWith("/repos/example/project")) return response({ stargazers_count: 2, forks_count: 1, subscribers_count: 0, open_issues_count: 0 });
      if (url.endsWith("/traffic/views")) return response(trafficCase.views);
      if (url.endsWith("/traffic/clones")) {
        if (trafficCase.clones === "non-finite") return new Response("{\"count\":1e999,\"uniques\":0}", { headers: { "content-type": "application/json" } });
        return response(trafficCase.clones);
      }
      if (url.endsWith("/traffic/popular/referrers")) return response(trafficCase.referrers);
      if (url.includes("labels=")) return response([]);
      return response({}, 404);
    };
    const metrics = await collectCommunityMetrics({ repository: "example/project", token: "secret-token", fetchImpl });
    assert.deepEqual(metrics.traffic, { status: "unavailable", views14d: null, uniqueVisitors14d: null, clones14d: null, uniqueCloners14d: null, referrers: null }, trafficCase.name);
  }

  const zeroFetch = async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/contributors?per_page=100&anon=false")) return response([]);
    if (url.endsWith("/repos/example/project")) return response({ stargazers_count: 2, forks_count: 1, subscribers_count: 0, open_issues_count: 0 });
    if (url.endsWith("/traffic/views") || url.endsWith("/traffic/clones")) return response({ count: 0, uniques: 0 });
    if (url.endsWith("/traffic/popular/referrers")) return response([]);
    if (url.includes("labels=")) return response([]);
    return response({}, 404);
  };
  const metrics = await collectCommunityMetrics({ repository: "example/project", token: "secret-token", fetchImpl: zeroFetch });
  assert.deepEqual(metrics.traffic, { status: "available", views14d: 0, uniqueVisitors14d: 0, clones14d: 0, uniqueCloners14d: 0, referrers: [] });
});

test("degrades privileged failures and preserves last public metrics when GitHub is temporarily unavailable", async () => {
  const previous = {
    repository: { stars: 21, forks: 4, subscribers: 3, openIssues: 2 },
    contributors: { codeContributors: ["alice"], acceptedEvidenceContributors: ["bob"], count: 2 },
    openTasks: 4, categoryCoverage: ["company-funding"], acceptedThisWeek: 2, newContributorsThisWeek: 1,
    staleRatio: 0.25, invalidRatio: 0.1, promotionConversion: 0.5,
  };
  const fetchImpl = async () => response({ message: "unavailable" }, 503);
  const metrics = await collectCommunityMetrics({ repository: "example/project", token: "secret-token", fetchImpl, previous });

  assert.deepEqual(metrics.repository, previous.repository);
  assert.deepEqual(metrics.traffic, { status: "unavailable", views14d: null, uniqueVisitors14d: null, clones14d: null, uniqueCloners14d: null, referrers: null });
  assert.deepEqual(metrics.contributors, { codeContributors: ["alice"], acceptedEvidenceContributors: ["bob"], count: 2 });
  assert.deepEqual({ openTasks: metrics.openTasks, categoryCoverage: metrics.categoryCoverage, acceptedThisWeek: metrics.acceptedThisWeek,
    newContributorsThisWeek: metrics.newContributorsThisWeek, staleRatio: metrics.staleRatio, invalidRatio: metrics.invalidRatio,
    promotionConversion: metrics.promotionConversion }, {
    openTasks: 4, categoryCoverage: ["company-funding"], acceptedThisWeek: 2, newContributorsThisWeek: 1,
    staleRatio: 0.25, invalidRatio: 0.1, promotionConversion: 0.5,
  });
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
  assert.deepEqual(Object.keys(metrics), [
    "generatedAt", "repository", "traffic", "contributors", "openTasks", "categoryCoverage", "acceptedThisWeek",
    "newContributorsThisWeek", "staleRatio", "invalidRatio", "promotionConversion",
  ]);
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
