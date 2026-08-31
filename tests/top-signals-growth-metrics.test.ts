import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildGrowthMetrics, collectGrowthSnapshot, runGrowthMetrics } from "../src/top-signals-growth/metrics.js";
import type { GrowthExperimentConfig } from "../src/top-signals-growth/contracts.js";

function config(overrides: Partial<GrowthExperimentConfig> = {}): GrowthExperimentConfig {
  return {
    schemaVersion: 1,
    experimentId: "github-top-signals-2026-08",
    startDate: "2026-08-31",
    endDate: "2026-09-13",
    manualWeek: "2026-W36",
    automaticWeek: "2026-W37",
    baselineStars: 1,
    targetStars: 11,
    targetExternalAuthors: 3,
    minSignals: 3,
    maxSignals: 5,
    maxSignalsPerEntity: 2,
    maxSignalsPerKind: 3,
    channels: ["github-release", "readme", "github-value-contribution"],
    ...overrides,
  };
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function snapshot(stars: number) {
  return {
    observedAt: "2026-09-01T00:00:00.000Z",
    stars,
    traffic: { status: "available" as const, views14d: 80, uniqueVisitors14d: 12, referrers: [] },
    referenceSearch: { status: "available" as const, candidates: [] },
  };
}

function verified(url: string, author: string) {
  return {
    url,
    author,
    reviewedBy: "mbabby",
    reviewedAt: "2026-09-01T01:00:00.000Z",
    reason: "external-user-reference",
  };
}

test("metrics use star delta and never clones as users", () => {
  const metrics = buildGrowthMetrics({
    config: config(),
    snapshots: [{ observedAt: "2026-09-01T00:00:00.000Z", stars: 6, traffic: "unknown", clones14d: 417 }],
    candidates: [],
    decisions: [],
  });
  assert.equal(metrics.starDelta, 5);
  assert.equal(metrics.uniqueVisitors14d, "unknown");
  assert.equal(metrics.verifiedExternalAuthors, 0);
  assert.doesNotMatch(JSON.stringify(metrics.goalProgress), /clone/i);
});

test("counts one verified reference per external author", () => {
  const metrics = buildGrowthMetrics({
    config: config(),
    snapshots: [snapshot(11)],
    candidates: [],
    decisions: [
      verified("https://github.com/example/a/issues/1", "alice"),
      verified("https://github.com/example/b/issues/2", "alice"),
      verified("https://github.com/example/c/discussions/3", "bob"),
      verified("https://github.com/mbabby/physical-ai-news-cn/issues/1", "mbabby"),
      verified("https://github.com/example/d/issues/4", "github-actions[bot]"),
    ],
  });
  assert.equal(metrics.verifiedExternalAuthors, 2);
});

test("ignores verified reference decisions without absolute http urls", () => {
  const metrics = buildGrowthMetrics({
    config: config(),
    snapshots: [snapshot(11)],
    candidates: [],
    decisions: [
      verified("not-a-url", "alice"),
      verified("ftp://github.com/example/b/issues/2", "bob"),
      verified("https://github.com/example/c/issues/3", "carol"),
    ],
  });
  assert.equal(metrics.verifiedExternalAuthors, 1);
});

test("collects public stars while privileged traffic and search failures become unknown", async () => {
  const requests: Array<{ url: string; authorization?: string }> = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const authorization = new Headers(init?.headers).get("authorization") ?? undefined;
    requests.push({ url, authorization });
    if (url.endsWith("/repos/example/project")) return response({ stargazers_count: 9 });
    if (url.endsWith("/traffic/views")) return response({ count: "malformed", uniques: 3 });
    if (url.endsWith("/traffic/popular/referrers")) return response({ referrer: "not-an-array" });
    if (url.includes("/search/")) return response({ message: "requires privileges" }, 403);
    return response({}, 404);
  };

  const collected = await collectGrowthSnapshot({
    repository: "example/project",
    token: "secret-token",
    fetchImpl,
    now: new Date("2026-09-01T00:00:00.000Z"),
  });

  assert.equal(collected.stars, 9);
  assert.equal(collected.stale, false);
  assert.equal(collected.traffic, "unknown");
  assert.equal(collected.referenceSearch, "unknown");
  assert.equal(requests.find((request) => request.url.endsWith("/repos/example/project"))?.authorization, undefined);
  assert.ok(requests.filter((request) => request.url.includes("/traffic/") || request.url.includes("/search/"))
    .every((request) => request.authorization === "Bearer secret-token"));
});

test("preserves previous stars as stale only when the public repository endpoint fails", async () => {
  const collected = await collectGrowthSnapshot({
    repository: "example/project",
    token: "secret-token",
    previous: { observedAt: "2026-08-31T00:00:00.000Z", stars: 4, traffic: "unknown", referenceSearch: "unknown" },
    fetchImpl: async () => response({ message: "temporary failure" }, 503),
    now: new Date("2026-09-01T00:00:00.000Z"),
  });

  assert.equal(collected.stars, 4);
  assert.equal(collected.stale, true);
  assert.equal(collected.traffic, "unknown");
  assert.equal(collected.referenceSearch, "unknown");
});

test("rejects malformed nested local history snapshots before writing metrics", async () => {
  const root = await mkdtemp(join(tmpdir(), "top-signals-growth-bad-history-"));
  await mkdir(join(root, "metrics"), { recursive: true });
  await writeFile(join(root, "metrics/top-signals-growth-history.json"), `${JSON.stringify({
    schemaVersion: 1,
    snapshots: [{
      observedAt: "2026-09-02T00:00:00.000Z",
      stars: 6,
      stale: false,
      traffic: { status: "available", views14d: 20, uniqueVisitors14d: "7", referrers: [] },
      referenceSearch: { status: "available", candidates: [] },
    }],
  })}\n`, "utf8");

  await assert.rejects(
    () => runGrowthMetrics({
      root,
      config: config(),
      repository: "example/project",
      token: "",
      fetchImpl: async () => response({ stargazers_count: 7 }),
      now: new Date("2026-09-01T00:00:00.000Z"),
    }),
    /history snapshot 0/i,
  );
});

test("writes growth metrics, history, and automated reference candidates", async () => {
  const root = await mkdtemp(join(tmpdir(), "top-signals-growth-"));
  const fetchImpl = async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/repos/example/project")) return response({ stargazers_count: 6 });
    if (url.endsWith("/traffic/views")) return response({ count: 21, uniques: 7 });
    if (url.endsWith("/traffic/popular/referrers")) return response([{ referrer: "github.com", count: 5, uniques: 4 }]);
    if (url.includes("/search/issues")) return response({ items: [{ html_url: "https://github.com/example/other/issues/1", user: { login: "alice" }, title: "Physical AI News reference" }] });
    if (url.includes("/search/code")) return response({ items: [{ html_url: "https://github.com/example/site/blob/main/README.md", repository: { owner: { login: "bob" } }, name: "README.md" }] });
    return response({}, 404);
  };

  const artifact = await runGrowthMetrics({
    root,
    config: config(),
    repository: "example/project",
    token: "secret-token",
    fetchImpl,
    now: new Date("2026-09-01T00:00:00.000Z"),
  });
  const metrics = JSON.parse(await readFile(join(root, "metrics/top-signals-growth.json"), "utf8"));
  const history = JSON.parse(await readFile(join(root, "metrics/top-signals-growth-history.json"), "utf8"));
  const candidates = JSON.parse(await readFile(join(root, "review/top-signals-reference-candidates.json"), "utf8"));

  assert.deepEqual(metrics, artifact);
  assert.equal(history.snapshots.length, 1);
  assert.equal(candidates.candidates.length, 2);
  assert.equal(metrics.uniqueVisitors14d, 7);
});
