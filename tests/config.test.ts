import assert from "node:assert/strict";
import test from "node:test";
import { SOURCES } from "../src/config.js";

test("arXiv discovery covers the main Physical AI categories without dropping the robotics relevance terms", () => {
  const arxiv = SOURCES.find((source) => source.id === "academic-arxiv-robotics");
  assert.ok(arxiv);
  for (const category of ["cs.RO", "cs.AI", "cs.LG", "cs.CV"]) assert.match(arxiv.url, new RegExp(category.replace(".", "\\.")));
  assert.match(arxiv.url, /robot/);
  assert.match(arxiv.url, /embodied/);
  assert.match(arxiv.url, /max_results=150/);
});
