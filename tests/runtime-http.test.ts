import assert from "node:assert/strict";
import test from "node:test";
import { fetchWithRetry, HttpRequestError, mapWithConcurrency } from "../src/runtime/http.js";

test("fetchWithRetry honors a retryable rate limit", async () => {
  let calls = 0; const waits: number[] = [];
  const response = await fetchWithRetry("https://example.test", {}, {
    attempts: 2,
    fetchImpl: async () => ++calls === 1 ? new Response("", { status: 429, headers: { "Retry-After": "1" } }) : new Response("ok"),
    sleep: async (ms) => { waits.push(ms); },
  });
  assert.equal(await response.text(), "ok"); assert.equal(calls, 2); assert.deepEqual(waits, [1_000]);
});

test("fetchWithRetry fails fast for authentication errors", async () => {
  let calls = 0;
  await assert.rejects(() => fetchWithRetry("https://example.test", {}, { attempts: 3, fetchImpl: async () => { calls += 1; return new Response("", { status: 401 }); } }), (error: unknown) => error instanceof HttpRequestError && error.kind === "auth");
  assert.equal(calls, 1);
});

test("mapWithConcurrency preserves input order and caps active requests", async () => {
  let active = 0; let peak = 0;
  const output = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
    active += 1; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 2)); active -= 1;
    return value * 2;
  });
  assert.deepEqual(output, [2, 4, 6, 8, 10]); assert.equal(peak, 2);
});
