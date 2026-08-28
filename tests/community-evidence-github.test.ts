import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEvidenceTaskId,
  type EvidenceTaskLedgerArtifact,
  type EvidenceTaskSeedArtifact,
} from "../src/community-evidence/contracts.js";
import {
  CommunityEvidenceRemoteError,
  fetchEvidenceIssueSnapshot,
} from "../src/community-evidence/github-issues.js";
import { planEvidenceIssueActions } from "../src/community-evidence/task-ledger.js";

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
          body: "Human submission https://Evidence.EXAMPLE/report?b=2&a=1#section",
          user: { login: "helper" },
          author_association: "NONE",
          created_at: "2026-08-23T01:30:00Z",
          updated_at: "2026-08-23T01:30:00Z",
        },
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
        "证据链接：https://Source.EXAMPLE:443/report#details",
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
      evidenceUrls: ["https://evidence.example/report?b=2&a=1", "https://forged.example/claim", "https://source.example/report"],
      submittedEvidence: [
        { contributor: "alice", evidenceUrl: "https://source.example/report", submittedAt: "2026-08-20T00:00:00Z" },
        { contributor: "helper", evidenceUrl: "https://evidence.example/report?b=2&a=1", submittedAt: "2026-08-23T01:30:00Z" },
        { contributor: "stranger", evidenceUrl: "https://forged.example/claim", submittedAt: "2026-08-23T03:00:00Z" },
      ],
      acceptedContributors: ["alice", "helper"],
      acceptedEvidence: [
        { contributor: "alice", evidenceUrl: "https://source.example/report" },
        { contributor: "helper", evidenceUrl: "https://evidence.example/report?b=2&a=1" },
      ],
    }],
  });
  assert.equal(JSON.stringify(snapshot).includes("private discussion"), false);
  assert.equal(snapshot.issues[0]?.acceptedContributors.includes("forged"), false);
  assert.equal(requests.filter((url) => url.includes("/comments")).length, 1);
  assert.match(requests[0]!, /labels=two-minute-task/);
});

test("separates Task 3 template context from submitted reply evidence and attribution", async () => {
  const seedArtifact: EvidenceTaskSeedArtifact = {
    schemaVersion: 1,
    generatedAt: "2026-08-20T00:00:00Z",
    generatedWeek: "2026-W35",
    seeds: [{
      id: taskId,
      version: 1,
      category: "company-funding",
      subject,
      targetField: "funding.amount",
      contextZh: "Alpha Robotics 的融资金额仍待公开证据确认。",
      referenceUrls: ["https://context.example/reference"],
      suggestedLocations: ["公司公告"],
      qualifiedEvidenceZh: ["明确披露金额的原始来源"],
      disqualifiedEvidenceZh: ["没有原始链接的转述"],
      replyTemplateZh: "证据链接：\n证据摘录：\n来源类型：",
      estimatedMinutes: 2,
      generatedWeek: "2026-W35",
      materialVersion: "material-1",
      supersedesTaskId: null,
    }],
  };
  const emptyLedger: EvidenceTaskLedgerArtifact = { schemaVersion: 1, generatedAt: "2026-08-20T00:00:00Z", entries: [] };
  const planned = planEvidenceIssueActions({
    seeds: seedArtifact,
    issues: { schemaVersion: 1, fetchedAt: "2026-08-20T00:00:00Z", repo: REPO, issues: [] },
    previousLedger: emptyLedger,
    now: "2026-08-20T00:00:00Z",
  });
  const create = planned.actions.find((action) => action.action === "create");
  assert.ok(create && create.action === "create");

  const fetchSnapshot = (accepted: boolean) => fetchEvidenceIssueSnapshot({
    repo: REPO,
    token: "test-token",
    now: NOW,
    fetchImpl: async (input) => {
      if (String(input).includes("/comments")) {
        return response([
          {
            body: "Ordinary reply https://submitted.example/proof",
            user: { login: "helper" },
            author_association: "CONTRIBUTOR",
            created_at: "2026-08-23T01:00:00Z",
            updated_at: "2026-08-23T01:00:00Z",
          },
          {
            body: "证据链接：https://author.example/proof",
            user: { login: "alice" },
            author_association: "NONE",
            created_at: "2026-08-23T02:00:00Z",
            updated_at: "2026-08-23T02:00:00Z",
          },
          {
            body: "<!-- accepted-contributor:@helper --> https://submitted.example/proof",
            user: { login: "maintainer" },
            author_association: "OWNER",
            created_at: "2026-08-23T03:00:00Z",
            updated_at: "2026-08-23T03:00:00Z",
          },
        ]);
      }
      return response([{
        number: 41,
        body: create.body,
        state: "open",
        labels: [{ name: "two-minute-task" }, ...(accepted ? [{ name: "accepted-evidence" }] : [])],
        user: { login: "alice" },
        author_association: "NONE",
        created_at: "2026-08-20T00:00:00Z",
        updated_at: "2026-08-23T03:00:00Z",
        closed_at: null,
      }]);
    },
  });

  const beforeAcceptance = await fetchSnapshot(false);
  assert.deepEqual(beforeAcceptance.issues[0]?.evidenceUrls, [
    "https://author.example/proof",
    "https://submitted.example/proof",
  ]);
  assert.deepEqual(beforeAcceptance.issues[0]?.acceptedEvidence, []);
  assert.deepEqual(beforeAcceptance.issues[0]?.submittedEvidence, [
    { contributor: "alice", evidenceUrl: "https://author.example/proof", submittedAt: "2026-08-23T02:00:00Z" },
    { contributor: "helper", evidenceUrl: "https://submitted.example/proof", submittedAt: "2026-08-23T01:00:00Z" },
  ]);
  assert.equal(JSON.stringify(beforeAcceptance).includes(subject.url), false);
  assert.equal(JSON.stringify(beforeAcceptance).includes("https://context.example/reference"), false);
  assert.equal(JSON.stringify(beforeAcceptance).includes("Ordinary reply"), false);

  const openLedger: EvidenceTaskLedgerArtifact = {
    schemaVersion: 1,
    generatedAt: "2026-08-23T03:00:00Z",
    entries: [{
      ...planned.ledger.entries[0]!,
      issueNumber: 41,
      issueUrl: `https://github.com/${REPO}/issues/41`,
      state: "open",
      updatedAt: "2026-08-23T03:00:00Z",
      lastActivityAt: "2026-08-20T00:00:00Z",
    }],
  };
  const lifecycle = planEvidenceIssueActions({ seeds: seedArtifact, issues: beforeAcceptance, previousLedger: openLedger, now: NOW });
  assert.equal(lifecycle.ledger.entries[0]?.state, "contributed");

  const afterAcceptance = await fetchSnapshot(true);
  assert.deepEqual(afterAcceptance.issues[0]?.acceptedEvidence, [
    { contributor: "alice", evidenceUrl: "https://author.example/proof" },
    { contributor: "helper", evidenceUrl: "https://submitted.example/proof" },
  ]);
});

test("normalizes a GitHub Actions bot author but credits only a human maintainer-bound contributor", async () => {
  const snapshot = await fetchEvidenceIssueSnapshot({
    repo: REPO,
    token: "test-token",
    now: NOW,
    fetchImpl: async (input) => {
      if (String(input).includes("/comments")) {
        return response([{
          body: "Original submission https://submitted.example/proof",
          user: { login: "helper" },
          author_association: "NONE",
          created_at: "2026-08-23T02:00:00Z",
          updated_at: "2026-08-23T02:00:00Z",
        }, {
          body: "<!-- accepted-contributor:@helper --> https://submitted.example/proof",
          user: { login: "maintainer" },
          author_association: "OWNER",
          created_at: "2026-08-23T03:00:00Z",
          updated_at: "2026-08-23T03:00:00Z",
        }]);
      }
      return response([{
        number: 41,
        body: `<!-- evidence-task-id:${taskId} -->\n<!-- evidence-task-version:1 -->`,
        state: "open",
        labels: [{ name: "accepted-evidence" }, { name: "two-minute-task" }],
        user: { login: "github-actions[bot]" },
        author_association: "NONE",
        created_at: "2026-08-20T00:00:00Z",
        updated_at: "2026-08-23T03:00:00Z",
        closed_at: null,
      }]);
    },
  });

  assert.equal(snapshot.issues[0]?.authorLogin, "github-actions[bot]");
  assert.deepEqual(snapshot.issues[0]?.acceptedContributors, ["helper"]);
  assert.deepEqual(snapshot.issues[0]?.acceptedEvidence, [
    { contributor: "helper", evidenceUrl: "https://submitted.example/proof" },
  ]);
});

test("rejects a maintainer attribution marker when the named human never submitted that evidence", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    if (String(input).includes("/comments")) {
      return response([{
        body: "<!-- accepted-contributor:@helper --> https://submitted.example/proof",
        user: { login: "maintainer" },
        author_association: "OWNER",
        created_at: "2026-08-23T03:00:00Z",
        updated_at: "2026-08-23T03:00:00Z",
      }]);
    }
    return response([{
      number: 41,
      body: `<!-- evidence-task-id:${taskId} -->\n<!-- evidence-task-version:1 -->`,
      state: "open",
      labels: [{ name: "accepted-evidence" }, { name: "two-minute-task" }],
      user: { login: "github-actions[bot]" },
      author_association: "NONE",
      created_at: "2026-08-20T00:00:00Z",
      updated_at: "2026-08-23T03:00:00Z",
      closed_at: null,
    }]);
  };

  await assert.rejects(
    fetchEvidenceIssueSnapshot({ repo: REPO, token: "test-token", fetchImpl, now: NOW }),
    (error: unknown) => error instanceof CommunityEvidenceRemoteError && /earlier contributor submission/i.test(error.message),
  );
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
