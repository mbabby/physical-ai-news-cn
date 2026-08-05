import assert from "node:assert/strict";
import test from "node:test";
import { formatShareableSummary } from "../src/shareable-summary.js";
import type { Article, EventStore } from "../src/types.js";

const eventStore: EventStore = { updatedAt: "2026-08-05", events: [{
  id: "evt-1", title: "Nova Robotics 完成融资", type: "投融资", entities: ["Nova Robotics"], primaryEntity: "Nova Robotics", routes: ["本体与硬件"], status: "已确证", firstSeenAt: "2026-08-05", lastUpdatedAt: "2026-08-05", lastVerifiedAt: "2026-08-05", facts: ["Nova Robotics 完成融资，用于机器人本体研发。"], openQuestions: [], timeline: [], evidence: [{ link: "https://example.com/evidence", source: "Official", grade: "A", publishedAt: "2026-08-05", supports: "融资" }],
}] };
const paper: Article = { id: "paper", title: "Robot paper", titleZh: "真实机器人研究", summaryZh: "论文提出真实机器人策略。代码与基准均可追溯。", link: "https://arxiv.org/abs/1", publishedAt: new Date("2026-08-05"), fetchedAt: new Date("2026-08-05"), source: "arXiv", sourceWeight: 9, excerpt: "", tags: [] };

test("builds a copy-ready brief from public facts only", () => {
  const output = formatShareableSummary(eventStore, [paper], "2026-W32");
  assert.match(output, /Nova Robotics/);
  assert.match(output, /真实机器人研究/);
  assert.match(output, /English short version/);
  assert.match(output, /公司与资本地图/);
});

test("English short version uses the source headline or an English fallback", () => {
  const englishSource = { ...eventStore, events: [{ ...eventStore.events[0]!, sourceTitle: "Nova Robotics Raises a Seed Round" }] };
  assert.match(formatShareableSummary(englishSource, [], "2026-W32"), /Nova Robotics Raises a Seed Round/);
  const fallback = formatShareableSummary(eventStore, [], "2026-W32");
  assert.match(fallback, /Nova Robotics reports a verified capital event/);
  assert.doesNotMatch(fallback, /Nova Robotics: Nova Robotics 完成融资/);
});

test("does not publish unverified or unidentified leads in a shareable brief", () => {
  const hidden: EventStore = { ...eventStore, events: [{ ...eventStore.events[0]!, primaryEntity: undefined, status: "核验中" }] };
  const output = formatShareableSummary(hidden, [], "2026-W32");
  assert.doesNotMatch(output, /Nova Robotics 完成融资/);
  assert.match(output, /暂无同时满足主体/);
});
