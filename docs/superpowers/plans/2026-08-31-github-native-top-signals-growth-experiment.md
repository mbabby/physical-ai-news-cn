# GitHub 原生 Top Signals 两周增长实验实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 在 2026-08-31 至 2026-09-13 期间发布两期可追溯的《Physical AI 资本与产品部署 Top 5》，第一期人工审批、第二期自动门禁，并准确统计从 1 Star 到 11 Star 与 3 位外部引用者的实验结果。

**Architecture:** 复用现有 DecisionTopSignal 作为事实与证据输入，在其上增加一个只做排序、发布和增长度量的薄层。日报事务只生成 Review 草稿与门禁凭据；周发布工作流先创建或更新 GitHub Release，成功后才物化公开归档、Latest 指针和 README 三条摘要。增长指标单独记录快照与外部引用候选，不把 Actions Clone 当用户。

**Tech Stack:** TypeScript 5、Node.js 24、tsx --test、GitHub Actions、GitHub CLI/API、现有 FileTransaction、JSON/Markdown 静态发布。

## Global Constraints

- 实验周期固定为 2026-08-31 至 2026-09-13，人工期为 2026-W36，自动期为 2026-W37。
- 成功条件固定为 Star 从 1 增长至至少 11，且至少 3 位不同外部用户产生有效公开引用。
- 每期最多 5 条、最少 3 条；同一公司最多 2 条，同一种事件类型最多 3 条。
- 只接受融资、并购、产品发布、客户或真实部署；泛行业盘点、观点评论、单一发现层线索和推测性文本不得进入。
- 证据门槛固定为一项官方 A 级证据或两项来源与域名均独立的 B+B 证据。
- 第一期没有与内容摘要绑定的人工批准时不得发布；第二期任一门禁失败时只保留 Review 草稿。
- Release 是当期权威分享版本；Release 成功后才允许更新公开归档、Latest 和 README。
- GitHub Traffic 缺失时必须显示 unknown；Clone 不参与增长判定。
- 不新增数据库、账号、邮件、外部社交平台或第二套公司/事件事实库。
- 不自动向外部仓库发评论、Issue 或 PR；外部互动必须由维护者逐条执行并遵守目标仓库规则。
- 所有功能按 TDD 实现；每个任务完成后只提交该任务涉及的文件。

---

## 文件与职责地图

**新增：**

- experiments/top-signals-growth.json：固定实验日期、周次、基线、目标与数量边界。
- src/top-signals-growth/contracts.ts：配置、信号、草稿、批准、门禁、公开归档和增长指标合同。
- src/top-signals-growth/ranking.ts：从已核验 DecisionTopSignal 构建确定性 Top 5。
- src/top-signals-growth/materialize.ts：生成当周 Review 草稿。
- src/top-signals-growth/gate.ts：人工/自动发布门禁。
- src/top-signals-growth/render.ts：Release、公开归档和 README 渲染。
- src/top-signals-growth/publish.ts：Release 成功后的公开物化。
- src/top-signals-growth/cli.ts：prepare、publish、validate CLI。
- src/top-signals-growth/metrics.ts 与 metrics-cli.ts：增长快照和外部引用候选。
- tests/fixtures/top-signals-growth-gold-v1.json：至少十条正反例。
- tests/top-signals-growth-*.test.ts：合同、排序、物化、门禁、渲染、指标、工作流和发布校验。
- docs/TOP_SIGNALS_GROWTH_EXPERIMENT.md：维护者操作手册。

**修改：**

- src/main.ts：在现有 Decision Product 后生成 Review 草稿。
- src/decision-products/markdown.ts 与 materialize.ts：README 优先渲染最近一次已发布 Top Signals。
- src/validate-release.ts：重建并交叉验证草稿、Release、Latest 与 README。
- package.json：增加四个 Top Signals 命令。
- .github/workflows/weekly-release.yml：Release-first 人工/自动发布。
- .github/workflows/community-metrics.yml：每日增长快照。
- 相关 decision-products、release、propagation 和 metrics 测试。

---

### Task 1: 固定配置、严格合同与 gold set

**Files:**
- Create: experiments/top-signals-growth.json
- Create: src/top-signals-growth/contracts.ts
- Create: tests/fixtures/top-signals-growth-gold-v1.json
- Create: tests/top-signals-growth-contracts.test.ts

**Interfaces:**
- Produces: loadGrowthExperimentConfig(root: string): Promise<GrowthExperimentConfig>
- Produces: validateGrowthExperimentConfig(value: unknown): asserts value is GrowthExperimentConfig
- Produces: validateTopSignalsDraft(value: unknown): asserts value is TopSignalsDraft
- Produces: topSignalsContentSha256(draft: TopSignalsDraft): string
- Produces: validateTopSignalsApproval(value: unknown): asserts value is TopSignalsApproval

- [ ] **Step 1: 写入固定实验配置**

~~~json
{
  "schemaVersion": 1,
  "experimentId": "github-top-signals-2026-08",
  "startDate": "2026-08-31",
  "endDate": "2026-09-13",
  "manualWeek": "2026-W36",
  "automaticWeek": "2026-W37",
  "baselineStars": 1,
  "targetStars": 11,
  "targetExternalAuthors": 3,
  "minSignals": 3,
  "maxSignals": 5,
  "maxSignalsPerEntity": 2,
  "maxSignalsPerKind": 3,
  "channels": ["github-release", "readme", "github-value-contribution"]
}
~~~

- [ ] **Step 2: 写合同失败测试**

~~~ts
test("approval binds canonical content but ignores retry timestamp", () => {
  const first = draftFixture({ generatedAt: "2026-09-03T10:00:00.000Z" });
  const retry = draftFixture({ generatedAt: "2026-09-03T10:05:00.000Z" });
  assert.equal(topSignalsContentSha256(first), topSignalsContentSha256(retry));
  assert.doesNotThrow(() => validateTopSignalsApproval({
    schemaVersion: 1,
    experimentId: first.experimentId,
    week: first.week,
    contentSha256: topSignalsContentSha256(first),
    approvedBy: "mbabby",
    approvedAt: "2026-09-03T10:10:00.000Z"
  }));
});

test("strict contracts reject extra keys and invalid week", () => {
  assert.throws(() => validateTopSignalsDraft({ ...draftFixture(), forged: true }), /keys|字段/i);
  assert.throws(() => validateTopSignalsDraft(draftFixture({ week: "2026-W99" })), /week|周/i);
});
~~~

- [ ] **Step 3: 运行测试并确认失败**

Run: pnpm exec tsx --test tests/top-signals-growth-contracts.test.ts

Expected: FAIL because src/top-signals-growth/contracts.ts does not exist.

- [ ] **Step 4: 实现合同与稳定摘要**

~~~ts
export interface GrowthScoreBreakdown {
  industryCapitalImpact: number;
  evidenceQuality: number;
  recency: number;
  informationGain: number;
  strategicRelevance: number;
  total: number;
}

export interface GrowthTopSignal extends DecisionTopSignal {
  nextValidationPoint: string;
  scoreBreakdown: GrowthScoreBreakdown;
}

export interface TopSignalsDraft {
  schemaVersion: 1;
  experimentId: string;
  week: string;
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
  signals: GrowthTopSignal[];
}

export interface TopSignalsApproval {
  schemaVersion: 1;
  experimentId: string;
  week: string;
  contentSha256: string;
  approvedBy: string;
  approvedAt: string;
}
~~~

topSignalsContentSha256() hashes schemaVersion、experimentId、week、periodStart、periodEnd and signals only. It excludes generatedAt so a byte-identical retry preserves approval.

- [ ] **Step 5: 建立可重建完整事件的 gold set**

The JSON stores deterministic overrides; the test helper applies them to one canonical complete EventRecord and CompanyProfile before calling the existing buildDecisionTopSignals(). Use this exact fixture shape:

~~~ts
interface GrowthGoldCase {
  caseId: string;
  eligible: boolean;
  event: Partial<EventRecord> & { evidenceMode?: "single-b" | "discovery-only" };
  company: Partial<CompanyProfile> | null;
}

function materializeGoldCase(item: GrowthGoldCase): { event: EventRecord; companies: CompanyProfile[] } {
  const company = { ...canonicalCompany(), ...(item.company ?? {}) };
  return {
    event: { ...canonicalEvent(), id: item.caseId, ...item.event },
    companies: item.company === null ? [] : [company]
  };
}
~~~

The fixture must include these cases and their event overrides:

~~~json
[
  {"caseId":"official-funding","eligible":true,"event":{"type":"投融资"},"company":{}},
  {"caseId":"official-product","eligible":true,"event":{"type":"产品发布"},"company":{}},
  {"caseId":"official-deployment","eligible":true,"event":{"type":"部署案例"},"company":{}},
  {"caseId":"independent-bb-acquisition","eligible":true,"event":{"type":"公司商业","title":"Alpha Robotics 完成并购交割"},"company":{}},
  {"caseId":"single-b-funding","eligible":false,"event":{"type":"投融资","evidenceMode":"single-b"},"company":{}},
  {"caseId":"discovery-only-roundup","eligible":false,"event":{"type":"公司商业","evidenceMode":"discovery-only"},"company":{}},
  {"caseId":"ambiguous-company","eligible":false,"event":{"primaryEntity":"Unknown Robotics"},"company":null},
  {"caseId":"conflicted-amount","eligible":false,"event":{"openQuestions":["金额待核验"]},"company":{}},
  {"caseId":"stale-no-new-evidence","eligible":false,"event":{"occurredAt":"2026-07-01T00:00:00.000Z","lastMaterialChangeAt":"2026-07-01T00:00:00.000Z"},"company":{}},
  {"caseId":"stale-with-new-deployment-evidence","eligible":true,"event":{"type":"部署案例","occurredAt":"2026-07-01T00:00:00.000Z","lastMaterialChangeAt":"2026-09-02T00:00:00.000Z"},"company":{}},
  {"caseId":"placeholder-chinese-copy","eligible":false,"event":{"facts":["中文简介暂未生成。","Alpha Robotics 发布进展。"]},"company":{}},
  {"caseId":"opinion-commentary","eligible":false,"event":{"type":"公司商业","title":"我们如何看待机器人行业未来"},"company":{}}
]
~~~

Because evidenceMode is test-fixture shorthand rather than an EventRecord field, the fixture loader must translate single-b and discovery-only into concrete EventEvidence arrays before returning the event; it must delete evidenceMode before calling production code.

- [ ] **Step 6: 运行合同测试**

Run: pnpm exec tsx --test tests/top-signals-growth-contracts.test.ts

Expected: PASS.

- [ ] **Step 7: 提交**

~~~bash
git add experiments/top-signals-growth.json src/top-signals-growth/contracts.ts tests/fixtures/top-signals-growth-gold-v1.json tests/top-signals-growth-contracts.test.ts
git commit -m "test: define Top Signals growth experiment contracts"
~~~

---

### Task 2: 实现硬门槛、五维评分与确定性 Top 5

**Files:**
- Create: src/top-signals-growth/ranking.ts
- Create: tests/top-signals-growth-ranking.test.ts
- Modify: tests/fixtures/top-signals-growth-gold-v1.json

**Interfaces:**
- Consumes: DecisionTopSignal[] and GrowthExperimentConfig
- Produces: buildGrowthTopSignals(signals, now, config): GrowthTopSignal[]
- Produces: scoreGrowthSignal(signal, now): GrowthScoreBreakdown

The goldSignals() test helper must materialize every gold case, call the existing buildDecisionTopSignals() evidence gate, and pass only the resulting DecisionTopSignal values to this new ranking layer.

- [ ] **Step 1: 写门槛和配额失败测试**

~~~ts
test("ranking applies scope and entity/kind quotas", () => {
  const selected = buildGrowthTopSignals(goldSignals(), NOW, config());
  assert.deepEqual(selected.map((item) => item.eventId), [
    "official-funding",
    "official-deployment",
    "official-product",
    "independent-bb-acquisition",
    "stale-with-new-deployment-evidence"
  ]);
  assert.ok(countBy(selected, (item) => item.entityId).every((count) => count <= 2));
  assert.ok(countBy(selected, (item) => item.kind).every((count) => count <= 3));
});
~~~

- [ ] **Step 2: 写评分和确定性失败测试**

~~~ts
test("ranking exposes an exact 100-point explanation", () => {
  const first = buildGrowthTopSignals(goldSignals(), NOW, config());
  const second = buildGrowthTopSignals(structuredClone(goldSignals()), new Date(NOW), config());
  assert.deepEqual(second, first);
  for (const signal of first) {
    const score = signal.scoreBreakdown;
    assert.equal(score.total, score.industryCapitalImpact + score.evidenceQuality + score.recency + score.informationGain + score.strategicRelevance);
    assert.ok(score.total >= 0 && score.total <= 100);
    assert.ok(signal.nextValidationPoint.endsWith("。"));
  }
});
~~~

- [ ] **Step 3: 运行测试并确认失败**

Run: pnpm exec tsx --test tests/top-signals-growth-ranking.test.ts

Expected: FAIL because ranking.ts is missing.

- [ ] **Step 4: 实现固定评分**

~~~ts
const IMPACT_POINTS = { "投融资": 30, "部署案例": 28, "产品发布": 25, "公司商业": 22 } as const;
const EVIDENCE_POINTS = { official: 25, "multi-source": 21 } as const;
~~~

Recency: 3 天内 20、7 天内 16、14 天内 12、30 天内 6、否则 0。Information gain: changedThisWeek 为 15；否则只有 verifiedAt 在 7 天内时为 5。Strategic relevance: 融资 10、部署 10、产品 8、合格并购/客户商业信号 7。

Only 投融资、产品发布、部署案例 and 公司商业 containing 并购|收购|客户|订单|量产|交付 in title/facts are eligible. Events older than 30 days require changedThisWeek=true.

- [ ] **Step 5: 实现下一验证点与比较器**

~~~ts
const NEXT_VALIDATION = {
  "投融资": "继续核验资金到账、估值披露、投资方确认及下一轮融资变化。",
  "产品发布": "继续核验真实客户采用、交付范围、性能边界与后续版本变化。",
  "部署案例": "继续核验部署数量、付费客户、运行周期与规模复制情况。",
  "公司商业": "继续核验交易交割、订单履约、客户身份与收入确认情况。"
} as const;
~~~

Sort by total desc, evidenceQuality desc, occurredAt desc, eventId asc. Apply quotas after sorting.

- [ ] **Step 6: 运行新旧 Top Signals 测试**

Run: pnpm exec tsx --test tests/top-signals-growth-ranking.test.ts tests/decision-products-top-signals.test.ts

Expected: PASS.

- [ ] **Step 7: 提交**

~~~bash
git add src/top-signals-growth/ranking.ts tests/top-signals-growth-ranking.test.ts tests/fixtures/top-signals-growth-gold-v1.json
git commit -m "feat: rank evidence-backed capital and deployment signals"
~~~

---

### Task 3: 在日报事务中生成 Review 草稿

**Files:**
- Create: src/top-signals-growth/materialize.ts
- Create: tests/top-signals-growth-materialize.test.ts
- Modify: src/main.ts
- Modify: tests/decision-products-pipeline.test.ts

**Interfaces:**
- Produces: buildTopSignalsDraft({ artifact, now, config })
- Produces: stageTopSignalsDraft({ root, transaction, draft })
- Stages: review/top-signals-drafts/<week>.json

- [ ] **Step 1: 写物化和非公开边界失败测试**

~~~ts
test("materializes one deterministic review draft without publishing it", () => {
  const result = buildTopSignalsDraft({ artifact: decisionArtifact(), now: NOW, config: config() });
  assert.equal(result.status, "in-experiment");
  assert.equal(result.draft.week, "2026-W36");
  assert.equal(result.draft.signals.length, 5);
  assert.deepEqual(buildTopSignalsDraft({ artifact: decisionArtifact(), now: NOW, config: config() }), result);
});

test("stages only a review path", () => {
  const paths: string[] = [];
  stageTopSignalsDraft({ root: "/repo", draft: draftFixture(), transaction: { stage: (path) => paths.push(path) } });
  assert.deepEqual(paths, ["/repo/review/top-signals-drafts/2026-W36.json"]);
});
~~~

- [ ] **Step 2: 运行测试并确认失败**

Run: pnpm exec tsx --test tests/top-signals-growth-materialize.test.ts

Expected: FAIL because materialize.ts is missing.

- [ ] **Step 3: 实现固定周次与窗口**

buildTopSignalsDraft() must reject invalid clocks, derive ISO week in UTC, return {status:"outside-experiment"} outside W36/W37, call buildGrowthTopSignals(), retain fewer than three signals in Review for gate diagnostics, and never touch README or weekly/top-signals.

- [ ] **Step 4: 接入 src/main.ts**

~~~ts
const growthConfig = await loadGrowthExperimentConfig(outputRoot);
const growthDraft = buildTopSignalsDraft({ artifact: decisionProducts, now, config: growthConfig });
if (growthDraft.status === "in-experiment") {
  stageTopSignalsDraft({ root: outputRoot, transaction, draft: growthDraft.draft });
}
~~~

Add it after Decision Product construction and before transaction.commit().

- [ ] **Step 5: 运行单元和日报集成测试**

Run: pnpm exec tsx --test tests/top-signals-growth-materialize.test.ts tests/decision-products-pipeline.test.ts

Expected: PASS and no public Top Signals path is staged.

- [ ] **Step 6: 提交**

~~~bash
git add src/top-signals-growth/materialize.ts src/main.ts tests/top-signals-growth-materialize.test.ts tests/decision-products-pipeline.test.ts
git commit -m "feat: materialize Top Signals review drafts"
~~~

---

### Task 4: 实现人工/自动门禁和无排序渲染器

**Files:**
- Create: src/top-signals-growth/gate.ts
- Create: src/top-signals-growth/render.ts
- Create: tests/top-signals-growth-gate.test.ts
- Create: tests/top-signals-growth-render.test.ts

**Interfaces:**
- Produces: evaluateTopSignalsGate({ draft, config, approval? }): TopSignalsGateReceipt
- Produces: renderTopSignalsRelease(draft): string
- Produces: renderTopSignalsReadme(draft, releaseUrl): string
- Produces: renderTopSignalsArchive(draft, releaseUrl, publishedAt): PublishedTopSignalsArtifact

- [ ] **Step 1: 写人工批准绑定失败测试**

~~~ts
test("manual week needs approval for the exact content hash", () => {
  const draft = draftFixture({ week: "2026-W36" });
  assert.equal(evaluateTopSignalsGate({ draft, config: config() }).status, "blocked");
  assert.equal(evaluateTopSignalsGate({ draft, config: config(), approval: approvalFixture({ contentSha256: "0".repeat(64) }) }).status, "blocked");
  assert.equal(evaluateTopSignalsGate({ draft, config: config(), approval: approvalFixture({ contentSha256: topSignalsContentSha256(draft) }) }).status, "publishable");
});
~~~

- [ ] **Step 2: 写自动门禁失败测试**

~~~ts
test("automatic week requires three complete signals", () => {
  assert.equal(evaluateTopSignalsGate({ draft: draftFixture({ week: "2026-W37", signalCount: 3 }), config: config() }).status, "publishable");
  const blocked = evaluateTopSignalsGate({ draft: draftFixture({ week: "2026-W37", signalCount: 2 }), config: config() });
  assert.deepEqual(blocked.reasons, ["合格信号不足 3 条"]);
});
~~~

- [ ] **Step 3: 运行门禁测试并确认失败**

Run: pnpm exec tsx --test tests/top-signals-growth-gate.test.ts

Expected: FAIL.

- [ ] **Step 4: 实现门禁凭据**

~~~ts
export interface TopSignalsGateReceipt {
  schemaVersion: 1;
  experimentId: string;
  week: string;
  mode: "manual" | "automatic";
  contentSha256: string;
  status: "publishable" | "blocked";
  reasons: string[];
  evaluatedAt: string;
  approval: null | { approvedBy: string; approvedAt: string };
}
~~~

Reasons must be stable, unique and sorted. Revalidate every nested signal before deciding.

- [ ] **Step 5: 写并实现渲染一致性测试**

~~~ts
test("Release and README preserve canonical order", () => {
  const draft = draftFixture();
  assert.deepEqual(extractSignalIds(renderTopSignalsRelease(draft)), draft.signals.map((item) => item.signalId));
  assert.deepEqual(extractSignalIds(renderTopSignalsReadme(draft, RELEASE_URL)), draft.signals.slice(0, 3).map((item) => item.signalId));
});
~~~

Renderers must include 为什么重要、下一验证点、事件日期、核验日期 and all evidence links. They escape Markdown but never filter or sort.

- [ ] **Step 6: 运行测试**

Run: pnpm exec tsx --test tests/top-signals-growth-gate.test.ts tests/top-signals-growth-render.test.ts

Expected: PASS.

- [ ] **Step 7: 提交**

~~~bash
git add src/top-signals-growth/gate.ts src/top-signals-growth/render.ts tests/top-signals-growth-gate.test.ts tests/top-signals-growth-render.test.ts
git commit -m "feat: gate and render Top Signals releases"
~~~

---

### Task 5: 建立 Release-first CLI 和工作流

**Files:**
- Create: src/top-signals-growth/publish.ts
- Create: src/top-signals-growth/cli.ts
- Create: tests/top-signals-growth-workflow.test.ts
- Modify: src/decision-products/markdown.ts
- Modify: src/decision-products/materialize.ts
- Modify: src/main.ts
- Modify: src/validate-release.ts
- Modify: .github/workflows/weekly-release.yml
- Modify: package.json
- Modify: tests/decision-products-contracts.test.ts
- Modify: tests/release-contract.test.ts

**Interfaces:**
- Produces: prepareTopSignalsRelease(root, week)
- Produces: publishTopSignalsRelease({ root, draft, releaseUrl, publishedAt })
- Produces CLI commands top-signals:prepare, top-signals:publish and top-signals:validate

- [ ] **Step 1: 写 Release-first 顺序失败测试**

~~~ts
test("workflow creates Release before README and Latest", async () => {
  const workflow = await readFile(".github/workflows/weekly-release.yml", "utf8");
  const release = workflow.indexOf("gh release create");
  const publish = workflow.indexOf("pnpm top-signals:publish");
  const push = workflow.indexOf("git push origin HEAD:main");
  assert.ok(release >= 0 && publish > release && push > publish);
  assert.match(workflow, /top-signals-\\$WEEK/);
});
~~~

- [ ] **Step 2: 运行测试并确认失败**

Run: pnpm exec tsx --test tests/top-signals-growth-workflow.test.ts tests/release-contract.test.ts

Expected: FAIL because the old workflow publishes the broad weekly report.

- [ ] **Step 3: 实现 prepare CLI**

prepare validates the configured week, loads review/top-signals-drafts/<week>.json and optional review/top-signals-approvals/<week>.json, evaluates the gate, writes notes and gate.json to a caller-supplied temporary directory, and exits non-zero with all stable reasons when blocked.

- [ ] **Step 4: 实现 Release 后公开物化**

After GitHub returns its canonical URL, publish atomically writes:

~~~text
weekly/top-signals/<week>.json
weekly/top-signals/<week>.md
weekly/top-signals/latest.json
review/top-signals-publication-receipt.json
README.md
~~~

The public artifact includes releaseUrl、publishedAt and contentSha256.

- [ ] **Step 5: 防止日报覆盖已发布 README**

Change existing signatures:

~~~ts
formatDecisionProductReadme(
  artifact: DecisionProductArtifact,
  published?: PublishedTopSignalsArtifact
): string;

stageDecisionProducts(input: StageDecisionProductsInput & {
  publishedTopSignals?: PublishedTopSignalsArtifact;
}): string;
~~~

When published exists, render its first three signals. src/main.ts and src/validate-release.ts load weekly/top-signals/latest.json optionally and pass it through generation and validation.

- [ ] **Step 6: 修改 weekly-release.yml**

The workflow must preserve workflow_dispatch for W36, schedule Thursday 13:00 UTC for W37, install Node 24 and frozen pnpm dependencies, run check and focused tests, stop before gh release when blocked, use stable tag top-signals-$WEEK, create/edit with --latest, fetch the canonical Release URL, publish only after Release success, validate, and commit only weekly/top-signals、publication receipt and README. Report Release and README outcomes separately.

- [ ] **Step 7: 运行 CLI、工作流与决策产品测试**

Run: pnpm exec tsx --test tests/top-signals-growth-workflow.test.ts tests/top-signals-growth-render.test.ts tests/decision-products-contracts.test.ts tests/release-contract.test.ts

Expected: PASS.

- [ ] **Step 8: 提交**

~~~bash
git add src/top-signals-growth/publish.ts src/top-signals-growth/cli.ts src/decision-products/markdown.ts src/decision-products/materialize.ts src/main.ts src/validate-release.ts .github/workflows/weekly-release.yml package.json tests/top-signals-growth-workflow.test.ts tests/decision-products-contracts.test.ts tests/release-contract.test.ts
git commit -m "feat: publish Top Signals with a release-first transaction"
~~~

---

### Task 6: 采集增长快照和外部引用候选

**Files:**
- Create: src/top-signals-growth/metrics.ts
- Create: src/top-signals-growth/metrics-cli.ts
- Create: tests/top-signals-growth-metrics.test.ts
- Create: review/top-signals-reference-decisions.json
- Modify: .github/workflows/community-metrics.yml
- Modify: package.json
- Modify: tests/community-metrics.test.ts

**Interfaces:**
- Produces: collectGrowthSnapshot(input): Promise<GrowthSnapshot>
- Produces: buildGrowthMetrics(input): GrowthMetricsArtifact
- Writes: metrics/top-signals-growth.json、metrics/top-signals-growth-history.json、review/top-signals-reference-candidates.json

- [ ] **Step 1: 写 Star、unknown 和 Clone 排除失败测试**

~~~ts
test("metrics use star delta and never clones as users", () => {
  const metrics = buildGrowthMetrics({
    config: config(),
    snapshots: [{ observedAt: "2026-09-01T00:00:00.000Z", stars: 6, traffic: "unknown", clones14d: 417 }],
    candidates: [],
    decisions: []
  });
  assert.equal(metrics.starDelta, 5);
  assert.equal(metrics.uniqueVisitors14d, "unknown");
  assert.equal(metrics.verifiedExternalAuthors, 0);
  assert.doesNotMatch(JSON.stringify(metrics.goalProgress), /clone/i);
});
~~~

- [ ] **Step 2: 写外部引用去重失败测试**

~~~ts
test("counts one verified reference per external author", () => {
  const metrics = buildGrowthMetrics({
    config: config(),
    snapshots: [snapshot(11)],
    candidates: [],
    decisions: [
      verified("https://github.com/example/a/issues/1", "alice"),
      verified("https://github.com/example/b/issues/2", "alice"),
      verified("https://github.com/example/c/discussions/3", "bob"),
      verified("https://github.com/mbabby/physical-ai-news-cn/issues/1", "mbabby"),
      verified("https://github.com/example/d/issues/4", "github-actions[bot]")
    ]
  });
  assert.equal(metrics.verifiedExternalAuthors, 2);
});
~~~

- [ ] **Step 3: 运行测试并确认失败**

Run: pnpm exec tsx --test tests/top-signals-growth-metrics.test.ts

Expected: FAIL.

- [ ] **Step 4: 实现 GitHub 采集与降级**

Query the public repository endpoint plus token-authenticated traffic/views、traffic/popular/referrers、search/issues and search/code. Failed or malformed privileged endpoints become unknown. Preserve a prior Star count only when the public endpoint fails and mark that snapshot stale=true.

- [ ] **Step 5: 建立人工判定边界**

review/top-signals-reference-decisions.json starts as:

~~~json
{"schemaVersion":1,"decisions":[]}
~~~

Automated search writes candidates only. KPI counts only verified decisions with URL、author、reviewedBy、reviewedAt and reason=external-user-reference. Exclude owner, project-local URLs, bots, duplicate URLs and duplicate authors.

- [ ] **Step 6: 接入 community-metrics.yml**

Run top-signals:metrics after community:metrics and stage the three growth artifacts. Search/Traffic degradation does not fail repository counts; malformed local contracts do fail.

- [ ] **Step 7: 运行增长与社区指标测试**

Run: pnpm exec tsx --test tests/top-signals-growth-metrics.test.ts tests/community-metrics.test.ts

Expected: PASS and metrics/community.json remains backward compatible.

- [ ] **Step 8: 提交**

~~~bash
git add src/top-signals-growth/metrics.ts src/top-signals-growth/metrics-cli.ts tests/top-signals-growth-metrics.test.ts review/top-signals-reference-decisions.json .github/workflows/community-metrics.yml package.json tests/community-metrics.test.ts
git commit -m "feat: measure Top Signals growth experiment"
~~~

---

### Task 7: 绑定草稿、Release、Latest 和 README

**Files:**
- Modify: src/validate-release.ts
- Modify: src/top-signals-growth/publish.ts
- Create: tests/top-signals-growth-release-validation.test.ts
- Modify: tests/release-contract.test.ts
- Modify: tests/release-mutations.test.ts
- Modify: tests/propagation-assets.test.ts

**Interfaces:**
- Produces: validatePublishedTopSignals({ draft, gate, published, latest, readme }): void
- top-signals:validate and validate:release use the same validator.

- [ ] **Step 1: 写对抗性漂移失败测试**

~~~ts
test("rejects drift across every public surface", () => {
  const valid = releaseFixture();
  assert.doesNotThrow(() => validatePublishedTopSignals(valid));
  for (const mutate of [
    (input) => { input.published.signals[0].titleZh = "伪造标题"; },
    (input) => { input.latest.contentSha256 = "0".repeat(64); },
    (input) => { input.readme = input.readme.replace("事件日期", "错误日期"); },
    (input) => { input.gate.status = "blocked"; }
  ]) {
    const forged = releaseFixture();
    mutate(forged);
    assert.throws(() => validatePublishedTopSignals(forged));
  }
});
~~~

- [ ] **Step 2: 运行测试并确认失败**

Run: pnpm exec tsx --test tests/top-signals-growth-release-validation.test.ts

Expected: FAIL.

- [ ] **Step 3: 实现重建式校验**

Validate strict contracts; recompute draft hash; require publishable gate; require archive and Latest same week/hash/order; rerender Markdown and README for exact comparison; bind every evidence URL to current canonical Decision Product; reject Review metadata and private scores from public output.

- [ ] **Step 4: 接入完整 validate:release**

When latest.json exists, load matching public JSON/Markdown、Review draft and receipt. When none exists, validate only the Review draft and do not require public paths.

- [ ] **Step 5: 增加 mutation 和传播入口覆盖**

Mutate title、order、event date、evidence URL、hash、Release URL and README link one at a time; every mutation must fail. Assert stable releases/latest and Top Signals marker links.

- [ ] **Step 6: 运行发布测试**

Run: pnpm exec tsx --test tests/top-signals-growth-release-validation.test.ts tests/release-contract.test.ts tests/release-mutations.test.ts tests/propagation-assets.test.ts

Expected: PASS.

- [ ] **Step 7: 提交**

~~~bash
git add src/validate-release.ts src/top-signals-growth/publish.ts tests/top-signals-growth-release-validation.test.ts tests/release-contract.test.ts tests/release-mutations.test.ts tests/propagation-assets.test.ts
git commit -m "test: bind Top Signals release surfaces"
~~~

---

### Task 8: 操作手册、全量验证与两期演练

**Files:**
- Create: docs/TOP_SIGNALS_GROWTH_EXPERIMENT.md
- Modify: docs/DEVELOPMENT_STANDARDS.md
- Modify: README.md only through the canonical publisher or fixture generation

- [ ] **Step 1: 写维护者手册**

Document these commands:

~~~bash
pnpm top-signals:prepare -- --week 2026-W36 --out /tmp/top-signals-W36
jq -r '.contentSha256' /tmp/top-signals-W36/gate.json
pnpm top-signals:prepare -- --week 2026-W37 --out /tmp/top-signals-W37
pnpm top-signals:validate -- --week 2026-W36
pnpm run validate:release
~~~

Also document the exact approval JSON path and schema, external-reference review, six-interaction limit, disclosure wording, rollback and experiment-close procedure.

- [ ] **Step 2: 运行类型检查和全部测试**

Run: pnpm run check && pnpm test

Expected: exit 0 with zero test failures.

- [ ] **Step 3: 运行发布校验**

Run: pnpm run validate:release && pnpm run validate:health

Expected: validate:release exits 0. validate:health may report degraded historical gaps but no malformed Top Signals artifact.

- [ ] **Step 4: 做固定输入双跑**

Use two temporary fixture roots:

~~~bash
first="$(mktemp -d)"
second="$(mktemp -d)"
pnpm start -- --fixture --output-root "$first"
pnpm start -- --fixture --output-root "$second"
diff -ru "$first/review/top-signals-drafts" "$second/review/top-signals-drafts"
~~~

Expected: no diff.

- [ ] **Step 5: 演练两种门禁**

Verify W36 without approval blocks; matching approval publishes; a one-byte mutation blocks; W37 with 3–5 valid signals publishes; W37 with 2 signals blocks and retains Review; publishing identical W37 twice produces the same tag and bytes.

- [ ] **Step 6: 使用发布验证 Skill**

Follow /Users/lijie/.codex/skills/physical-ai-release-validation/SKILL.md. Do not push or trigger production workflows until every local command has fresh passing evidence.

- [ ] **Step 7: 提交手册**

~~~bash
git add docs/TOP_SIGNALS_GROWTH_EXPERIMENT.md docs/DEVELOPMENT_STANDARDS.md README.md
git commit -m "docs: add Top Signals experiment runbook"
~~~

- [ ] **Step 8: 人工发布检查点**

Before pushing, show the maintainer W36 draft Markdown、content SHA-256、gate receipt、exact changed files、full test count、validate:release and validate:health output. Merge/push only after explicit approval; W36 Release remains a separate manual action after the daily draft exists.
