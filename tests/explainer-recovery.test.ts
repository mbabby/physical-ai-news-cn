import assert from "node:assert/strict";
import test from "node:test";
import { buildProgressExplainers } from "../src/progress-explainers/materialize.js";
import { HttpRequestError } from "../src/runtime/http.js";
import { CompatibleSummarizer } from "../src/summarize.js";
import { renderProgressExplainersMarkdown } from "../src/progress-explainers/markdown.js";
import { validateProgressExplainersArtifact } from "../src/progress-explainers/validate.js";
import { source, draft, approvedReview, previousArtifact } from "./helpers/progress-explainers.js";
import { renderProgressExplainers } from "../site/progress-explainers.js";
import * as materialize from "../src/progress-explainers/materialize.js";

const now = new Date("2026-09-10T00:00:00Z");
const sources = [1, 2, 3].map(i => source({ canonicalId: `event:${i}` }));
test("transient failure does not prevent the next candidate from passing both gates", async () => {
  let calls = 0;
  const result = await buildProgressExplainers({ sources: sources.slice(0, 2), now, model: { async completeJson() {
    if (++calls === 1) throw new HttpRequestError("timeout", "timeout", undefined, true);
    return calls === 2 ? draft() : approvedReview;
  } } });
  assert.deepEqual(result.artifact.cards.map(c => c.canonicalId), ["event:2"]);
  assert.equal(result.report.timedOut, 1);
  assert.equal(result.report.requestsSucceeded, 2);
});
test("persistent transient failure stops after two candidates and preserves valid history", async () => {
  let calls = 0;
  const previous = previousArtifact();
  const result = await buildProgressExplainers({ sources: [source(), ...sources], previous, now, model: { async completeJson() {
    calls++; throw new HttpRequestError("timeout", "timeout", undefined, true);
  } } });
  assert.equal(calls, 2);
  assert.equal(result.report.timedOut, 2);
  assert.equal(result.artifact.lastContentUpdatedAt, previous.lastContentUpdatedAt);
  assert.equal(result.artifact.cards[0]?.revision, previous.cards[0]?.revision);
});
test("authentication failure is not retried by the real transport adapter", async () => {
  const prior = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response("", { status: 401 }); };
  try {
    const result = await buildProgressExplainers({ sources, now, model: new CompatibleSummarizer({ apiKey: "test", baseUrl: "https://test.invalid", model: "test" }) });
    assert.equal(calls, 1);
    assert.equal(result.report.failed, 1);
  } finally { globalThis.fetch = prior; }
});
test("timeout diagnostics are public but provider text is not, with old artifacts still supported", async () => {
  const result = await buildProgressExplainers({ sources, now, model: { async completeJson() { throw new HttpRequestError("secret-provider-payload", "timeout", undefined, true); } } });
  assert.match(renderProgressExplainersMarkdown(result.artifact), /生成请求超时/);
  assert.match(renderProgressExplainers(result.artifact), /生成请求超时/);
  assert.doesNotMatch(JSON.stringify(result.artifact), /secret-provider-payload/);
  validateProgressExplainersArtifact(previousArtifact());
  assert.throws(() => validateProgressExplainersArtifact({ ...result.artifact, reason: "untrusted-provider-text" }));
});
test("core failure emits an actionable Actions warning independently of archive success", async () => {
  const result = await buildProgressExplainers({ sources, now, model: { async completeJson() { throw new HttpRequestError("private text", "timeout", undefined, true); } } });
  assert.equal(typeof materialize.reportExplainerStatus, "function");
  const warnings: string[] = [];
  const status = materialize.reportExplainerStatus(result);
  materialize.warnExplainerStatus(status, (message: string) => warnings.push(message));
  assert.equal(status.status, "部分降级");
  assert.equal(status.failed, 2);
  assert.match(status.detail, /生成请求超时/);
  assert.match(warnings.join(""), /::warning.*核心解读不可用/);
  assert.doesNotMatch(warnings.join(""), /private text/);
});

test("response-body timeout recovers through the same bounded transport retry", async () => {
  const prior = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => {
    if (++calls === 1) return { ok: true, json: async () => { throw new DOMException("body aborted", "AbortError"); } } as Response;
    return Response.json({ choices: [{ message: { content: JSON.stringify(calls === 2 ? draft() : approvedReview) } }] });
  };
  try {
    const result = await buildProgressExplainers({ sources: [source()], now, model: new CompatibleSummarizer({ apiKey: "test", baseUrl: "https://test.invalid", model: "test" }) });
    assert.equal(result.artifact.cards.length, 1);
    assert.equal(calls, 3, "retry draft body once, then independently review it");
  } finally { globalThis.fetch = prior; }
});

test("unreviewed draft after review timeout is never published and healthy status does not warn", async () => {
  let calls = 0;
  const result = await buildProgressExplainers({ sources: [source()], now, model: { async completeJson() {
    if (++calls === 1) return draft();
    throw new HttpRequestError("timeout", "timeout", undefined, true);
  } } });
  assert.deepEqual(result.artifact.cards, []);
  assert.equal(result.artifact.lastContentUpdatedAt, null);
  const warnings: string[] = [];
  materialize.warnExplainerStatus({ component: "ProgressExplainers", status: "成功", attempted: 2, succeeded: 2, failed: 0, detail: "成功" }, message => warnings.push(message));
  assert.deepEqual(warnings, []);
});
