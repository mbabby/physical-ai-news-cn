import assert from "node:assert/strict";
import test from "node:test";
import { buildResearchIndustryRelationEdges, researchIndustryCompanyId, selectTopResearchIndustryEdges, type RelationEvidenceCandidate } from "../src/research-industry-relations.js";
import type { Article, CompanyProfile } from "../src/types.js";

const NOW = new Date("2026-08-10T00:00:00.000Z");
const paper: Article = { id: "paper-1", title: "Robot policy", link: "https://arxiv.org/abs/1", source: "arXiv", sourceWeight: 1, excerpt: "", tags: [], publishedAt: NOW, fetchedAt: NOW };
const company: CompanyProfile = { entityId: "company-1", name: "Alpha Robotics", region: "美国", routes: ["VLA 与具身模型"], thesis: "", officialUrl: "https://alpha.example" };
function evidence(overrides: Partial<RelationEvidenceCandidate> = {}): RelationEvidenceCandidate {
  return { paperId: "paper-1", companyId: "company-1", relationType: "code_or_model_adoption", url: "https://alpha.example/releases/policy", source: "Alpha 官方发布", grade: "A", publishedAt: "2026-08-01T00:00:00.000Z", supports: "明确说明采用该论文模型", ...overrides };
}

test("verifies an explicit A-grade research-to-industry adoption edge", () => {
  const result = buildResearchIndustryRelationEdges([paper], [company], [evidence()], { now: NOW });
  const edge = result.edges[0]!;
  assert.equal(edge.direction, "research_to_industry");
  assert.equal(edge.relationState, "verified");
  assert.equal(edge.verifiedAt, "2026-08-01T00:00:00.000Z");
  assert.deepEqual(edge.evidenceUrls, ["https://alpha.example/releases/policy"]);
  assert.equal(result.metrics.strongEdgeCount, 1);
});

test("keeps a single B source developing and requires independently sourced B evidence", () => {
  const oneB = buildResearchIndustryRelationEdges([paper], [company], [evidence({ grade: "B", url: "https://media-one.example/report", source: "媒体一" })], { now: NOW });
  assert.equal(oneB.edges[0]!.relationState, "developing");
  const sameDomain = buildResearchIndustryRelationEdges([paper], [company], [evidence({ grade: "B", url: "https://media-one.example/report", source: "媒体一" }), evidence({ grade: "B", url: "https://media-one.example/followup", source: "另一标题" })], { now: NOW });
  assert.equal(sameDomain.edges[0]!.relationState, "developing");
  const twoB = buildResearchIndustryRelationEdges([paper], [company], [evidence({ grade: "B", url: "https://media-one.example/report", source: "媒体一" }), evidence({ grade: "B", url: "https://media-two.example/report", source: "媒体二" })], { now: NOW });
  assert.equal(twoB.edges[0]!.relationState, "verified");
});

test("does not publish a discovery lead or derive a strong edge from route adjacency", () => {
  const result = buildResearchIndustryRelationEdges([paper], [company], [evidence({ grade: "D", sourceTier: "线索发现层", url: "https://news.example/lead" })], { now: NOW, routeAdjacencies: [{ paperId: "paper-1", companyId: "company-1", routes: ["VLA 与具身模型"] }] });
  assert.equal(result.edges.find((edge) => edge.relationType === "code_or_model_adoption")!.relationState, "candidate");
  assert.deepEqual(result.edges.find((edge) => edge.relationType === "code_or_model_adoption")!.evidenceUrls, []);
  const adjacency = result.edges.find((edge) => edge.relationType === "route_adjacency")!;
  assert.equal(adjacency.relationState, "adjacent");
  assert.equal(selectTopResearchIndustryEdges(result.edges).length, 0);
});

test("marks explicit supporting and refuting proof as conflicted", () => {
  const result = buildResearchIndustryRelationEdges([paper], [company], [evidence(), evidence({ url: "https://alpha.example/correction", stance: "refutes", supports: "官方否认采用" })], { now: NOW });
  assert.equal(result.edges[0]!.relationState, "conflicted");
  assert.equal(result.metrics.conflictedEdges, 1);
});

test("deduplicates evidence, has stable edge ids, tracks TTL, and is idempotent", () => {
  const old = evidence({ publishedAt: "2026-01-01T00:00:00.000Z" });
  const first = buildResearchIndustryRelationEdges([paper], [company], [old, { ...old }], { now: NOW });
  const second = buildResearchIndustryRelationEdges([paper], [company], [{ ...old }, old], { now: NOW });
  assert.deepEqual(first, second);
  assert.equal(first.edges[0]!.evidence.length, 1);
  assert.equal(first.metrics.deduplicatedEvidenceCount, 1);
  assert.equal(first.edges[0]!.freshness.state, "stale");
  assert.match(first.edges[0]!.id, /^research-industry-/);
});

test("gives a legacy company profile without entityId a deterministic relation identity", () => {
  const legacy = { ...company, entityId: undefined };
  const companyId = researchIndustryCompanyId(legacy);
  const result = buildResearchIndustryRelationEdges([paper], [legacy], [evidence({ companyId })], { now: NOW });
  assert.equal(result.edges[0]!.companyId, companyId);
  assert.equal(researchIndustryCompanyId(legacy), companyId);
});
