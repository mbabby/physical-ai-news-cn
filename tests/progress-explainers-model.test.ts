import assert from "node:assert/strict";
import test from "node:test";
import { buildProgressExplainers } from "../src/progress-explainers/materialize.js";
import { approvedReview, draft, model, source } from "./helpers/progress-explainers.js";

test("orders and caps candidates before bounded draft and review calls", async () => {
  const sources = [4, 1, 3, 2].map((day) => source({ canonicalId: `event:${day}`, revision: `r${day}`, eventDate: `2026-09-0${day}`, materiallyChangedAt: `2026-09-0${day}T00:00:00Z` }));
  const outputs = Array.from({ length: 3 }, () => [draft(), approvedReview]).flat();
  const result = await buildProgressExplainers({ sources, now: new Date("2026-09-10T00:00:00Z"), model: model(outputs) });
  assert.deepEqual(result.artifact.cards.map((card) => card.canonicalId), ["event:4", "event:3", "event:2"]); assert.equal(result.report.requestsSucceeded, 6);
});

test("rejects comparison without a compatible canonical baseline", async () => {
  const result = await buildProgressExplainers({ sources: [source()], now: new Date("2026-09-10T00:00:00Z"), model: model([draft({ comparison: { beforeZh: "40%", afterZh: "60%", task: "抓取", conditions: "相同" }, fieldRefs: { ...draft().fieldRefs, "comparison.beforeZh": ["fact:trial"], "comparison.afterZh": ["fact:result"], "comparison.task": ["fact:trial"], "comparison.conditions": ["fact:trial"] } }), approvedReview]) });
  assert.deepEqual(result.artifact.cards, []); assert.equal(result.report.evidenceRejected, 1);
});
