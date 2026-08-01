import assert from "node:assert/strict";
import test from "node:test";
import { parseXResponse } from "../src/fetchers/x.js";
import { selectIndustryPulse } from "../src/pulse.js";
import type { Article, XSourceConfig } from "../src/types.js";

const source: XSourceConfig = {
  type: "x", name: "X test", weight: 7, keywords: ["robot"],
  accounts: [{ handle: "robotleader", label: "机器人领军者", type: "人物" }],
};

test("parses allowlisted X posts as a viewpoint with a stable post link", () => {
  const articles = parseXResponse({
    data: [{ id: "42", text: "Robotics needs better world models.", author_id: "a", created_at: "2026-08-01T00:00:00.000Z" }],
    includes: { users: [{ id: "a", name: "Robot Leader", username: "robotleader" }] },
  }, source);
  assert.equal(articles.length, 1);
  assert.equal(articles[0].pulseKind, "人物观点");
  assert.equal(articles[0].link, "https://x.com/robotleader/status/42");
});

test("keeps viewpoints and verified daily events in separate pulse lanes", () => {
  const base: Article = { id: "view", title: "robot viewpoint", link: "https://x.com/a/status/1", publishedAt: new Date(), fetchedAt: new Date(), source: "X · A", sourceWeight: 7, excerpt: "robot", tags: [], pulseKind: "人物观点" };
  const event: Article = { ...base, id: "event", link: "https://example.com/event", pulseKind: undefined, kind: "产品发布" };
  const pulse = selectIndustryPulse([base], [event]);
  assert.equal(pulse.viewpoints.length, 1);
  assert.equal(pulse.events[0].id, "event");
});
