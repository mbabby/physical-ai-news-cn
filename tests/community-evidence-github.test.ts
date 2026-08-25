import assert from "node:assert/strict";
import test from "node:test";
import { buildEvidenceTaskId } from "../src/community-evidence/contracts.js";
import {
  CommunityEvidenceRemoteError,
  fetchEvidenceIssueSnapshot,
} from "../src/community-evidence/github-issues.js";

const NOW = "2026-08-24T12:00:00Z";
const REPO = "acme/physical-ai-news-cn";
const subject = { kind: "company" as const, id: "company-alpha", name: "Alpha Robotics", url: "https://alpha.example/" };
const taskId = buildEvidenceTaskId(subject, "funding.amount", "material-1");

function response(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...init.headers },
    ...init,
  });
}

test("normalizes paginated Issues and explicit maintainer attribution without retaining comment text", async () => {
  const requests: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.includes("page=2")) {
      return response([{
        number: 42,
        body: "no task marker",
        state: "open",
        labels: [{ name: "two-minute-task" }],
        user: { login: "ignored" },
        author_association: "NONE",
        created_at: "2026-08-23T00:00:00Z",
        updated_at: "2026-08-23T00:00:00Z",
        closed_at: null,
      }]);
    }
    if (url.endsWith("/issues/41/comments?per_page=100")) {
      return response([
        {
          body: "private discussion https://Evidence.EXAMPLE/report?b=2&a=1#section <!-- accepted-contributor:@helper -->",
          user: { login: "maintainer" },
          author_association: "MEMBER",
          created_at: "2026-08-23T02:00:00Z",
          updated_at: "2026-08-23T02:00:00Z",
        },
        {
          body: "<!-- accepted-contributor:@forged --> https://forged.example/claim",
          user: { login: "stranger" },
          author_association: "NONE",
          created_at: "2026-08-23T03:00:00Z",
          updated_at: "2026-08-23T03:00:00Z",
        },
      ]);
    }
    return response([{
      number: 41,
      body: [
        `<!-- evidence-task-id:${taskId} -->`,
        "<!-- evidence-task-version:1 -->",
        "Evidence: https://Source.EXAMPLE:443/report#details",
      ].join("\n"),
      state: "closed",
      labels: [
        { name: "two-minute-task" },
        { name: "accepted-evidence" },
        { name: "unsafe-private-label" },
        { name: "evidence-task-company-funding" },
      ],
      user: { login: "alice" },
      author_association: "FIRST_TIMER",
      created_at: "2026-08-20T00:00:00Z",
      updated_at: "2026-08-24T00:00:00Z",
      closed_at: "2026-08-24T00:00:00Z",
    }], { headers: { link: '<https://api.github.com/repos/acme/physical-ai-news-cn/issues?labels=two-minute-task&state=all&per_page=100&page=2>; rel="next"' } });
  };

  const snapshot = await fetchEvidenceIssueSnapshot({ repo: REPO, token: "test-token", fetchImpl, now: NOW });

  assert.deepEqual(snapshot, {
    schemaVersion: 1,
    fetchedAt: NOW,
    repo: REPO,
    issues: [{
      number: 41,
      taskId,
      taskVersion: 1,
      state: "closed",
      labels: ["accepted-evidence", "evidence-task-company-funding", "two-minute-task"],
      authorLogin: "alice",
      authorAssociation: "FIRST_TIMER",
      createdAt: "2026-08-20T00:00:00Z",
      updatedAt: "2026-08-24T00:00:00Z",
      closedAt: "2026-08-24T00:00:00Z",
      evidenceUrls: ["https://evidence.example/report?b=2&a=1", "https://source.example/report"],
      acceptedContributors: ["alice", "helper"],
      acceptedEvidence: [
        { contributor: "alice", evidenceUrl: "https://source.example/report" },
        { contributor: "helper", evidenceUrl: "https://evidence.example/report?b=2&a=1" },
      ],
    }],
  });
  assert.equal(JSON.stringify(snapshot).includes("private discussion"), false);
  assert.equal(JSON.stringify(snapshot).includes("forged"), false);
  assert.equal(requests.filter((url) => url.includes("/comments")).length, 1);
  assert.match(requests[0]!, /labels=two-minute-task/);
});

test("rejects malformed task markers before requesting comments", async () => {
  let commentRequests = 0;
  const fetchImpl: typeof fetch = async (input) => {
    if (String(input).includes("/comments")) commentRequests += 1;
    return response([{
      number: 41,
      body: `<!-- evidence-task-id:${taskId.toUpperCase()} -->\n<!-- evidence-task-version:1 -->`,
      state: "open",
      labels: [{ name: "two-minute-task" }],
      user: { login: "alice" },
      author_association: "NONE",
      created_at: "2026-08-20T00:00:00Z",
      updated_at: "2026-08-20T00:00:00Z",
      closed_at: null,
    }]);
  };

  await assert.rejects(
    fetchEvidenceIssueSnapshot({ repo: REPO, token: "test-token", fetchImpl, now: NOW }),
    (error: unknown) => error instanceof CommunityEvidenceRemoteError && /marker/.test(error.message),
  );
  assert.equal(commentRequests, 0);
});

test("rejects a malformed marker hidden beside one valid marker", async () => {
  const fetchImpl: typeof fetch = async () => response([{
    number: 41,
    body: [
      `<!-- evidence-task-id:${taskId} -->`,
      "<!-- evidence-task-id:not-a-task -->",
      "<!-- evidence-task-version:1 -->",
    ].join("\n"),
    state: "open",
    labels: [{ name: "two-minute-task" }],
    user: { login: "alice" },
    author_association: "NONE",
    created_at: "2026-08-20T00:00:00Z",
    updated_at: "2026-08-20T00:00:00Z",
    closed_at: null,
  }]);
  await assert.rejects(
    fetchEvidenceIssueSnapshot({ repo: REPO, token: "test-token", fetchImpl, now: NOW }),
    (error: unknown) => error instanceof CommunityEvidenceRemoteError && /marker/.test(error.message),
  );
});

test("accepts a final pagination Link header that has no next relation", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    if (String(input).includes("/comments")) return response([]);
    return response([{
      number: 41,
      body: `<!-- evidence-task-id:${taskId} -->\n<!-- evidence-task-version:1 -->`,
      state: "open",
      labels: [{ name: "two-minute-task" }],
      user: { login: "alice" },
      author_association: "NONE",
      created_at: "2026-08-20T00:00:00Z",
      updated_at: "2026-08-20T00:00:00Z",
      closed_at: null,
    }], { headers: { link: '<https://api.github.com/repos/acme/physical-ai-news-cn/issues?page=1>; rel="prev"' } });
  };
  const snapshot = await fetchEvidenceIssueSnapshot({ repo: REPO, token: "test-token", fetchImpl, now: NOW });
  assert.equal(snapshot.issues.length, 1);
});

test("rejects an accepted contributor marker without exactly one evidence URL", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    if (String(input).includes("/comments")) {
      return response([{
        body: "<!-- accepted-contributor:@helper --> no URL",
        user: { login: "maintainer" },
        author_association: "OWNER",
        created_at: "2026-08-23T02:00:00Z",
        updated_at: "2026-08-23T02:00:00Z",
      }]);
    }
    return response([{
      number: 41,
      body: `<!-- evidence-task-id:${taskId} -->\n<!-- evidence-task-version:1 -->`,
      state: "open",
      labels: [{ name: "accepted-evidence" }, { name: "two-minute-task" }],
      user: { login: "alice" },
      author_association: "NONE",
      created_at: "2026-08-20T00:00:00Z",
      updated_at: "2026-08-23T02:00:00Z",
      closed_at: null,
    }]);
  };
  await assert.rejects(
    fetchEvidenceIssueSnapshot({ repo: REPO, token: "test-token", fetchImpl, now: NOW }),
    (error: unknown) => error instanceof CommunityEvidenceRemoteError && /accepted contributor/i.test(error.message),
  );
});

test("wraps HTTP, schema, and unsafe pagination failures in one remote error type", async (t) => {
  await t.test("HTTP failure", async () => {
    await assert.rejects(
      fetchEvidenceIssueSnapshot({ repo: REPO, token: "token", now: NOW, fetchImpl: async () => response({}, { status: 503 }) }),
      CommunityEvidenceRemoteError,
    );
  });
  await t.test("schema failure", async () => {
    await assert.rejects(
      fetchEvidenceIssueSnapshot({ repo: REPO, token: "token", now: NOW, fetchImpl: async () => response([{ number: "41" }]) }),
      CommunityEvidenceRemoteError,
    );
  });
  await t.test("pagination failure", async () => {
    await assert.rejects(
      fetchEvidenceIssueSnapshot({
        repo: REPO,
        token: "token",
        now: NOW,
        fetchImpl: async () => response([], { headers: { link: '<https://evil.example/issues?page=2>; rel="next"' } }),
      }),
      CommunityEvidenceRemoteError,
    );
  });
});
