import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEvidenceTaskId,
  type AcceptedEvidenceArtifact,
  type ContributionLedgerArtifact,
  type EvidenceTaskCategory,
  type EvidenceTaskLedgerArtifact,
  type EvidenceTaskSeed,
  type EvidenceTaskSeedArtifact,
  type EvidenceTargetField,
} from "../src/community-evidence/contracts.js";
import {
  buildCommunityEvidencePublication,
  buildCommunityTaskPublicArtifact,
} from "../src/community-evidence/publication.js";

const NOW = "2026-08-25T08:00:00.000Z";
const REPOSITORY = "acme/physical-ai-news-cn";

const definitions: Array<[EvidenceTaskCategory, EvidenceTargetField, "company" | "event" | "research", string]> = [
  ["research-metadata", "research.codeUrl", "research", "Gamma 研究"],
  ["product-deployment", "deployment.customer", "event", "Beta 部署"],
  ["company-funding", "funding.amount", "company", "Alpha Robotics"],
];

function fixture() {
  const seeds = definitions.map(([category, targetField, kind, name], index): EvidenceTaskSeed => {
    const subject = { kind, id: `public-${index}`, name, url: `https://${category}.example/item` };
    const materialVersion = `material-${index}`;
    return {
      id: buildEvidenceTaskId(subject, targetField, materialVersion),
      version: 1,
      category,
      subject,
      targetField,
      contextZh: `${name} 的一个公开字段需要原始来源确认。`,
      referenceUrls: [subject.url],
      suggestedLocations: ["官方页面"],
      qualifiedEvidenceZh: ["可公开核验的原始来源"],
      disqualifiedEvidenceZh: ["没有原始链接的转述"],
      replyTemplateZh: "证据链接：\n证据摘录：\n来源类型：",
      estimatedMinutes: 2,
      generatedWeek: "2026-W35",
      materialVersion,
      supersedesTaskId: null,
    };
  }).sort((left, right) => left.category.localeCompare(right.category));
  const seedArtifact: EvidenceTaskSeedArtifact = { schemaVersion: 1, generatedAt: NOW, generatedWeek: "2026-W35", seeds };
  const ledger: EvidenceTaskLedgerArtifact = {
    schemaVersion: 1,
    generatedAt: NOW,
    entries: seeds.map((seed, index) => ({
      taskId: seed.id,
      taskVersion: 1,
      category: seed.category,
      subject: seed.subject,
      targetField: seed.targetField,
      materialVersion: seed.materialVersion,
      supersedesTaskId: null,
      issueNumber: 41 + index,
      issueUrl: `https://attacker.example/issues/${41 + index}`,
      state: index === 1 ? "contributed" : "open",
      createdAt: "2026-08-24T08:00:00.000Z",
      updatedAt: NOW,
      lastActivityAt: NOW,
      closedAt: null,
    })).sort((left, right) => left.taskId.localeCompare(right.taskId)),
  };
  const accepted: AcceptedEvidenceArtifact = {
    schemaVersion: 1,
    generatedAt: NOW,
    entries: [{
      id: "accepted-evidence-4ec2a8dc6ee7b53a02bb71a3",
      taskId: seeds[0]!.id,
      issueNumber: 41,
      category: seeds[0]!.category,
      subject: seeds[0]!.subject,
      targetField: seeds[0]!.targetField,
      contributor: "alice",
      evidenceUrl: "https://evidence.example/alpha",
      acceptedAt: "2026-08-24T09:00:00.000Z",
    }],
  };
  const states = ["accepted", "promoted", "corrected", "withdrawn"] as const;
  const contributions: ContributionLedgerArtifact = {
    schemaVersion: 1,
    generatedAt: NOW,
    events: states.map((state, index) => ({
      id: `contribution-event-${String(index).padStart(24, "0")}`,
      taskId: seeds[index % seeds.length]!.id,
      issueNumber: 41 + (index % seeds.length),
      contributor: index === 0 ? "alice" : "bob",
      evidenceUrl: `https://evidence.example/${state}`,
      category: seeds[index % seeds.length]!.category,
      subject: seeds[index % seeds.length]!.subject,
      targetField: seeds[index % seeds.length]!.targetField,
      state,
      occurredAt: `2026-08-24T${String(9 + index).padStart(2, "0")}:00:00.000Z`,
      sourceUrl: `https://github.com/${REPOSITORY}/issues/${41 + (index % seeds.length)}`,
      publicTargetUrl: state === "promoted" ? seeds[index % seeds.length]!.subject.url : null,
    })).sort((left, right) => left.occurredAt.localeCompare(right.occurredAt)),
  };
  return { seeds: seedArtifact, ledger, accepted, contributions };
}

test("projects validated active tasks in stable category order with canonical repository Issue URLs", () => {
  const input = fixture();
  const artifact = buildCommunityTaskPublicArtifact({ ...input, repository: REPOSITORY, generatedAt: NOW });
  assert.deepEqual(artifact.tasks.map((task) => task.category), ["company-funding", "product-deployment", "research-metadata"]);
  assert.deepEqual(artifact.tasks.map((task) => task.issueUrl), [41, 42, 43].map((number) => `https://github.com/${REPOSITORY}/issues/${number}`));
  assert.equal(artifact.tasks[0]?.estimatedMinutes, 2);
  assert.equal(artifact.tasks[0]?.contextZh, "Alpha Robotics 的一个公开字段需要原始来源确认。");
});

test("publishes weekly metrics and recent lifecycle records without private or ranking fields", () => {
  const publication = buildCommunityEvidencePublication({ ...fixture(), repository: REPOSITORY, generatedAt: NOW });
  assert.deepEqual(publication.metrics, { openTasks: 3, weeklyAccepted: 1, newContributors: 1 });
  assert.deepEqual(publication.recentContributions.map((item) => item.state), ["withdrawn", "corrected", "promoted", "accepted"]);
  assert.deepEqual(new Set(publication.recentContributions.map((item) => item.category)), new Set(["company-funding", "product-deployment", "research-metadata"]));
  const serialized = JSON.stringify(publication);
  assert.doesNotMatch(serialized, /taskId|contribution-event|accepted-evidence-|score|rank|comment|email|secret|Top contributors/i);
  assert.doesNotMatch(serialized, /没有融资|没有部署|没有代码/);
});

test("does not fabricate tasks when no ledger entry meets the public threshold", () => {
  const input = fixture();
  input.ledger.entries = input.ledger.entries.map((entry) => ({ ...entry, state: "stale" }));
  const publication = buildCommunityEvidencePublication({ ...input, repository: REPOSITORY, generatedAt: NOW });
  assert.deepEqual(publication.taskArtifact.tasks, []);
  assert.equal(publication.metrics.openTasks, 0);
});

test("rejects invalid input artifacts before projecting a public view", () => {
  const input = fixture();
  (input.ledger.entries[0] as unknown as Record<string, unknown>).rawComment = "private";
  assert.throws(() => buildCommunityTaskPublicArtifact({ ...input, repository: REPOSITORY, generatedAt: NOW }), /private boundary|exact keys/);
});

test("accepts the contract's canonical timestamp form without milliseconds", () => {
  const input = fixture();
  const generatedAt = "2026-08-25T08:00:00Z";
  input.seeds.generatedAt = generatedAt;
  input.ledger.generatedAt = generatedAt;
  input.accepted.generatedAt = generatedAt;
  input.contributions.generatedAt = generatedAt;
  assert.equal(buildCommunityTaskPublicArtifact({ ...input, repository: REPOSITORY, generatedAt }).generatedAt, generatedAt);
});

test("weekly acceptance metrics survive a later correction or withdrawal", () => {
  const input = fixture();
  input.accepted.entries = [];
  const publication = buildCommunityEvidencePublication({ ...input, repository: REPOSITORY, generatedAt: NOW });
  assert.deepEqual(publication.metrics, { openTasks: 3, weeklyAccepted: 1, newContributors: 1 });
});

test("fails closed on unsupported negative unknown claims from seeds and prior public tasks", () => {
  const phrases = [
    "尚未找到融资公告",
    "没有公开的部署信息",
    "未发现客户证据",
    "no public evidence of funding",
    "部署证据仍未找到",
    "公司官网尚未找到",
    "公司官方名称仍未确认",
    "产品官方页面暂未找到",
    "official website has not been found",
    "official company name has not been confirmed",
    "official product page has not been found",
    "official company URL has not been found",
    "official company URLs have not been found",
    "official product URL has not been found",
    "official product URLs have not been found",
    "real robot trial has not been confirmed",
    "real robot trials have not been confirmed",
    "融资轮次尚未确认",
    "融资金额尚未确认",
    "融资估值尚未确认",
    "投资方尚未确认",
    "监管文件尚未找到",
    "产品发布日期尚未确认",
    "部署地点尚未确认",
    "部署规模尚未确认",
    "代码仓库尚未找到",
    "数据集尚未找到",
    "模型权重尚未找到",
    "真实机器人实验尚未确认",
    "作者机构尚未确认",
  ];
  for (const phrase of phrases) {
    const seeded = fixture();
    const seededTask = seeded.seeds.seeds[0]!;
    seededTask.contextZh = phrase;
    assert.throws(
      () => buildCommunityTaskPublicArtifact({ ...seeded, repository: REPOSITORY, generatedAt: NOW }),
      /unsupported negative unknown claim/,
      `seed: ${phrase}`,
    );

    const priorInput = fixture();
    const clean = buildCommunityTaskPublicArtifact({ ...priorInput, repository: REPOSITORY, generatedAt: NOW });
    const taskId = priorInput.ledger.entries.find((entry) => entry.state === "open")!.taskId;
    priorInput.seeds.seeds = priorInput.seeds.seeds.filter((seed) => seed.id !== taskId);
    const priorTask = clean.tasks.find((task) => task.id === taskId)!;
    priorTask.contextZh = phrase;
    assert.throws(
      () => buildCommunityTaskPublicArtifact({ ...priorInput, previousTasks: clean, repository: REPOSITORY, generatedAt: NOW }),
      /unsupported negative unknown claim/,
      `prior: ${phrase}`,
    );
  }
});

test("does not mistake ordinary future wording for a negative unknown claim", () => {
  for (const phrase of ["未来融资计划待原始公告确认", "未来将公开代码"]) {
    const input = fixture();
    input.seeds.seeds[0]!.contextZh = phrase;
    assert.doesNotThrow(
      () => buildCommunityTaskPublicArtifact({ ...input, repository: REPOSITORY, generatedAt: NOW }),
      phrase,
    );
  }
});
