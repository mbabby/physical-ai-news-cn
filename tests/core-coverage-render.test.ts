import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildCompanyClaimLedger } from "../src/company-claim-ledger.js";
import { buildCoreCoverageArtifact, buildCoreCoverageHistory, projectCoreCoveragePublicHistory } from "../src/core-coverage/materialize.js";
import {
  CORE_COVERAGE_FEED_PATH,
  formatCoreCoverageReadme,
  renderCoreCoverageFeed,
  replaceCoreCoverageReadme,
  stageCoreCoverageSurfaces,
  validateCoreCoverageSurfaces,
} from "../src/core-coverage/render.js";
import type { CoverageVersion } from "../src/core-coverage/contracts.js";
import type { CompanyProfile, EventRecord } from "../src/types.js";
import { company, event, NOW } from "./core-coverage-fixtures.js";
import {
  decodeCoreCoverageFilters,
  renderCoreCoverage,
  renderCoreCoverageUnavailable,
  sortCoreCoverageEntries,
} from "../site/core-coverage.js";

function publicInput(options: { lab?: boolean; malicious?: boolean; old?: boolean; recentDisclosure?: boolean } = {}) {
  const first: CompanyProfile = {
    ...company,
    entityType: options.lab ? "实验室" : "公司",
    name: options.malicious ? 'Alpha <script>alert("x")</script> & Lab' : company.name,
    profileEvidence: [{
      ...company.profileEvidence![0]!,
      supports: options.malicious ? 'Alpha <script>alert("x")</script> & Lab 主体身份与机器人研究' : company.profileEvidence![0]!.supports,
    }],
  };
  const companies: CompanyProfile[] = Array.from({ length: 30 }, (_, index) => index === 0 ? first : {
    ...company,
    entityId: `subject-${index}`,
    name: index === 1 ? "Aardvark Robotics" : `Subject ${index}`,
    profileEvidence: [],
  });
  const coverage: CoverageVersion = {
    schemaVersion: 1,
    version: "2026-Q3",
    effectiveFrom: "2026-09-01",
    previousVersion: null,
    changeReasonZh: "研究覆盖",
    members: companies.map((profile, index) => ({
      companyId: profile.entityId!,
      coverageRegion: index < 12 ? "china" : index < 24 ? "north-america" : "other",
      tier: index < 22 ? "commercial" : index < 27 ? "platform" : "strategic",
      reasonZh: index === 0 ? "核查 <路线> 与证据" : "跟踪机器人验证",
      ownerRole: "maintainer",
    })),
  };
  const record: EventRecord = event("product", {
    ...(options.lab ? { type: "研究与数据" as const } : {}),
    ...(options.old ? {
      occurredAt: "2025-10-01T00:00:00Z",
      eventDate: "2025-10-01",
      lastMaterialChangeAt: "2025-10-02T00:00:00Z",
      evidence: event("product").evidence.map((proof) => ({ ...proof, publishedAt: "2025-10-02T00:00:00Z", supports: "事件日期 2025-10-01；产品 Robot One" })),
    } : {}),
    ...(options.recentDisclosure ? {
      occurredAt: "2025-10-01T00:00:00Z",
      eventDate: "2025-10-01",
      lastMaterialChangeAt: "2026-06-08T16:00:00Z",
      evidence: event("product").evidence.map((proof) => ({ ...proof, publishedAt: "2026-08-21T00:00:00Z", supports: "事件日期 2025-10-01；产品 Robot One" })),
    } : {}),
  });
  record.primaryEntity = first.name;
  record.entities = [first.name];
  const events = [record];
  const ledger = buildCompanyClaimLedger(companies, events, { now: NOW, coverageCompanyIds: companies.map((profile) => profile.entityId!) });
  const artifact = buildCoreCoverageArtifact({ coverage, companies, events, ledger, now: NOW });
  const history = projectCoreCoveragePublicHistory(buildCoreCoverageHistory(artifact));
  return { artifact, history };
}

test("README mirrors Core counts and binds every rendered fact marker to the artifact", () => {
  const { artifact } = publicInput({ malicious: true });
  const markdown = formatCoreCoverageReadme(artifact);
  assert.match(markdown, /已核验身份 1\/30/);
  assert.match(markdown, /完整 Brief 1\/30/);
  assert.match(markdown, /Robot One/);
  assert.doesNotMatch(markdown, /<script>/);
  const markers = [...markdown.matchAll(/<!-- core-fact:([^ ]+) -->/g)].map((match) => match[1]);
  assert.ok(markers.length > 0);
  const factIds = new Set(artifact.briefs.flatMap((brief) => brief.knownClaimIds));
  assert.ok(markers.every((id) => factIds.has(id!)));

  const template = "before\n<!-- CORE_COVERAGE_START -->\nold\n<!-- CORE_COVERAGE_END -->\nafter\n";
  const replaced = replaceCoreCoverageReadme(template, artifact);
  assert.equal(replaced.match(/<!-- CORE_COVERAGE_START -->/g)?.length, 1);
  assert.match(replaced, /完整 Brief 1\/30/);
  assert.throws(() => replaceCoreCoverageReadme("no markers", artifact), /Core 30.*占位/);
});

test("collapsed capital summary labels valuation separately when financing amount is unknown", () => {
  const { artifact, history } = publicInput();
  const fact = artifact.briefs[0]!.knownFacts[0]!;
  const proof = fact.fields.product!;
  fact.fields = { round: { ...proof, value: "连续四轮，最终 Series C" }, valuation: { ...proof, value: ">28亿美元" } };
  const html = renderCoreCoverage(artifact, history);
  assert.match(html, /轮次：连续四轮，最终 Series C/);
  assert.match(html, /估值：&gt;28亿美元/);
  assert.doesNotMatch(html, /融资金额：&gt;28亿美元/);
});

test("Core feed includes only current qualified dated facts and XML-escapes hostile text", () => {
  const current = publicInput({ malicious: true }).artifact;
  const xml = renderCoreCoverageFeed(current, "https://example.test/project");
  assert.equal(CORE_COVERAGE_FEED_PATH, "feeds/core-coverage.xml");
  assert.match(xml, /urn:physical-ai:core30:.*company-claim/);
  assert.match(xml, /Alpha &lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &amp; Lab/);
  assert.doesNotMatch(xml, /<script>/);
  assert.match(xml, /事件日期：2026-08-20/);
  const claimId = current.briefs[0]!.knownClaimIds[0]!;
  assert.match(xml, new RegExp(claimId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(current.briefs[0]!.knownFacts[0]!.materialChangeAt, "2026-08-20T00:00:00.000Z");

  const disclosed = publicInput({ recentDisclosure: true }).artifact;
  const disclosureXml = renderCoreCoverageFeed(disclosed, "https://example.test/project");
  assert.match(disclosureXml, /披露日期：2026-08-21/);
  assert.equal(disclosureXml.match(/<guid isPermaLink="false">/g)?.length, 1, "one fact with two clocks has one Feed GUID");

  const borrowed = structuredClone(current);
  const untraceable = structuredClone(borrowed.briefs[0]!.knownFacts[0]!);
  untraceable.claimId = "untraceable-material-fact";
  untraceable.eventIds = ["untraceable-event"];
  untraceable.materialChangeAt = "unknown";
  borrowed.briefs[0]!.knownFacts.push(untraceable);
  borrowed.briefs[0]!.knownClaimIds.push(untraceable.claimId);
  borrowed.briefs[0]!.materialEventIds.push("untraceable-event");
  const borrowedXml = renderCoreCoverageFeed(borrowed, "https://example.test/project");
  assert.doesNotMatch(borrowedXml, /untraceable-material-fact/);

  const old = renderCoreCoverageFeed(publicInput({ old: true }).artifact, "https://example.test/project");
  assert.doesNotMatch(old, /<item>/);
  assert.doesNotMatch(old, /<pubDate>/);
  assert.throws(() => renderCoreCoverageFeed(current, "javascript:alert(1)"), /HTTPS/);
});

test("README and feed reject noncanonical fact IDs before they reach comments or GUIDs", () => {
  const artifact = structuredClone(publicInput().artifact);
  const fact = artifact.briefs[0]!.knownFacts[0]!;
  const priorId = fact.claimId;
  fact.claimId = "claim --> <script>";
  artifact.briefs[0]!.knownClaimIds = [fact.claimId];
  artifact.briefs[0]!.analyses.forEach((analysis) => { analysis.claimIds = analysis.claimIds.map((id) => id === priorId ? fact.claimId : id); });
  assert.throws(() => formatCoreCoverageReadme(artifact), /事实 ID/);
  assert.throws(() => renderCoreCoverageFeed(artifact, "https://example.test/project"), /事实 ID/);
});

test("browser filters ignore unknown tokens and stable sort puts unknown material dates last", () => {
  assert.deepEqual(decodeCoreCoverageFilters("?region=bogus&tier=platform&route=bogus&capital=verified&validation=bogus&sort=recent"), {
    region: "all", tier: "platform", route: "all", capital: "verified", validation: "all", sort: "recent",
  });
  const entries = [
    { subject: { companyId: "z", name: "Same" }, brief: { lastMaterialChangeAt: "unknown" } },
    { subject: { companyId: "b", name: "Same" }, brief: { lastMaterialChangeAt: "2026-08-01T00:00:00Z" } },
    { subject: { companyId: "a", name: "Aardvark" }, brief: { lastMaterialChangeAt: "2026-08-01T00:00:00Z" } },
  ];
  assert.deepEqual(sortCoreCoverageEntries(entries, "name").map((entry) => entry.subject.companyId), ["a", "b", "z"]);
  assert.deepEqual(sortCoreCoverageEntries(entries, "recent").map((entry) => entry.subject.companyId), ["a", "b", "z"]);
});

test("validation-stage filtering reads verified fields rather than legacy claim type", () => {
  const { artifact, history } = publicInput();
  const altered = structuredClone(artifact);
  altered.briefs[0]!.knownFacts[0]!.claimType = "deployment";
  const deployment = renderCoreCoverage(altered, history, decodeCoreCoverageFilters("?validation=deployment"));
  assert.match(deployment, /当前显示 0\/30/);
  const product = renderCoreCoverage(altered, history, decodeCoreCoverageFilters("?validation=product"));
  assert.match(product, /id="company-alpha"/);
});

test("browser rendering separates coverage gaps, verified evidence, lab language and quarterly history", () => {
  const { artifact, history } = publicInput({ lab: true, malicious: true });
  const html = renderCoreCoverage(artifact, history, decodeCoreCoverageFilters(""));
  assert.match(html, /已核验身份<\/span><strong>1<\/strong>/);
  assert.match(html, /完整 Brief<\/span><strong>1<\/strong>/);
  assert.match(html, /id="company-alpha"/);
  assert.match(html, /直接证据/);
  assert.match(html, /研究产出证据/);
  assert.doesNotMatch(html, /创业融资证据不足/);
  assert.match(html, /证据缺口/);
  assert.match(html, /季度覆盖与更正/);
  assert.match(html, /近 90 天发生[\s\S]*事件日期：2026-08-20/);
  assert.match(html, /近 90 天披露[\s\S]*披露日期：2026-08-21/);
  assert.match(html, /data-tier-group="commercial"[\s\S]*data-tier-group="platform"[\s\S]*data-tier-group="strategic"/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);

  const coverageOnly = structuredClone(artifact);
  coverageOnly.briefs[0] = artifact.briefs[1]!;
  coverageOnly.subjects[0] = { ...artifact.subjects[0]!, companyId: artifact.subjects[1]!.companyId };
  assert.match(renderCoreCoverageUnavailable("Core 30 工件缺失"), /当前不可用/);
  assert.throws(() => renderCoreCoverage(artifact, { ...history, generatedAt: "2026-09-07T01:00:00.000Z" }, decodeCoreCoverageFilters("")), /时钟不一致/);

  const corrected = structuredClone(history);
  corrected.corrections = [{
    changeId: "core-correction-one", companyId: "alpha", fieldPath: "claim.fields.product",
    before: { value: "<old>", status: "verified", evidenceIds: ["old"], evidenceUrls: ["https://alpha.example/old"], observedAt: "2026-08-01T00:00:00Z", verifiedAt: "2026-08-01T00:00:00Z" },
    after: { value: "new", status: "verified", evidenceIds: ["new"], evidenceUrls: ["https://alpha.example/new"], observedAt: "2026-08-02T00:00:00Z", verifiedAt: "2026-08-02T00:00:00Z" },
    reason: "metadata-correction", evidenceIds: ["new"], correctedAt: "2026-09-06T01:00:00Z",
  }];
  const correctionHtml = renderCoreCoverage(artifact, corrected, decodeCoreCoverageFilters(""));
  assert.match(correctionHtml, /&lt;old&gt;[\s\S]*→[\s\S]*new/);
  assert.doesNotMatch(correctionHtml, /<old>/);
});

test("browser groups tiers and sorts each timeline deterministically by selected clock then fact ID", () => {
  const { artifact, history } = publicInput();
  const altered = structuredClone(artifact);
  const first = altered.briefs[0]!.knownFacts[0]!;
  const later = structuredClone(first);
  later.claimId = "later-material-fact";
  later.eventIds = ["later-event"];
  later.occurredOn = "2026-09-01";
  later.publishedOn = "2026-09-02";
  later.date = later.occurredOn;
  later.materialChangeAt = "2026-09-02T00:00:00.000Z";
  altered.briefs[0]!.knownFacts.push(later);
  altered.briefs[0]!.knownClaimIds.push(later.claimId);
  altered.briefs[0]!.materialEventIds.push("later-event");
  altered.briefs[0]!.lastMaterialChangeAt = later.materialChangeAt;
  const html = renderCoreCoverage(altered, history, decodeCoreCoverageFilters(""));
  const alphaCard = html.slice(html.indexOf('id="company-alpha"'), html.indexOf('id="company-subject-10"'));
  const timeline = alphaCard.slice(alphaCard.indexOf("<h3>12 个月时间线</h3>"), alphaCard.indexOf('<section class="core-analysis">'));
  assert.ok(timeline.indexOf("later-material-fact") < timeline.indexOf(first.claimId));
  const commercial = html.slice(html.indexOf('data-tier-group="commercial"'), html.indexOf('data-tier-group="platform"'));
  assert.ok(commercial.indexOf('data-company-id="subject-1"') < commercial.indexOf('data-company-id="alpha"'), "name sort is stable inside commercial tier");
});

test("Core README and feed stage in one transaction and exact mirrors reject drift", async () => {
  const root = await mkdtemp(join(tmpdir(), "core-surfaces-"));
  try {
    const { artifact, history } = publicInput();
    const staged: Array<{ path: string; content: string }> = [];
    const template = "before\n<!-- CORE_COVERAGE_START -->\nold\n<!-- CORE_COVERAGE_END -->\nafter\n";
    const readme = stageCoreCoverageSurfaces({
      root,
      transaction: { stage(path, content) { staged.push({ path, content }); } },
      artifact,
      history,
      readme: template,
      pagesUrl: "https://example.test/project",
    });
    assert.equal(staged.length, 1);
    assert.equal(staged[0]!.path, join(root, "site", CORE_COVERAGE_FEED_PATH));
    assert.match(staged[0]!.content, /Physical AI · Core 30/);
    assert.doesNotThrow(() => validateCoreCoverageSurfaces({ artifact, history, readme, feed: staged[0]!.content, pagesUrl: "https://example.test/project" }));
    assert.throws(() => validateCoreCoverageSurfaces({ artifact, history, readme: readme.replace("完整 Brief", "完整卡"), feed: staged[0]!.content, pagesUrl: "https://example.test/project" }), /README/);
    assert.throws(() => validateCoreCoverageSurfaces({ artifact, history, readme, feed: staged[0]!.content.replace("urn:physical-ai:core30:", "urn:forged:"), pagesUrl: "https://example.test/project" }), /Feed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Core static page is deployment-relative and legacy company surfaces retain their entry points", async () => {
  const root = join(import.meta.dirname, "..", "site");
  const [page, companies, index, styles] = await Promise.all([
    readFile(join(root, "core-coverage.html"), "utf8"),
    readFile(join(root, "companies.html"), "utf8"),
    readFile(join(root, "index.html"), "utf8"),
    readFile(join(root, "styles.css"), "utf8"),
  ]);
  assert.match(page, /id="core-coverage-root"/);
  assert.match(page, /src="core-coverage\.js(?:\?[^"]+)?"/);
  assert.match(page, /href="styles\.css(?:\?v=[^"]+)?"/);
  assert.doesNotMatch(page, /(?:src|href)="\//);
  assert.match(companies, /share-pages\.js/);
  assert.match(companies, /id="share-content"/);
  assert.match(companies, /href="core-coverage\.html"/);
  assert.match(index, /href="core-coverage\.html"/);
  assert.match(styles, /@media\s*\(max-width:\s*390px\)[\s\S]*\.core-filters/);
  assert.match(styles, /\.core-card[\s\S]*overflow-wrap:\s*anywhere/);
});
