# Core 30 Investment Research Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking. 默认在当前任务按依赖执行；获得并行授权后按下述文件所有权拆分。

**Goal:** 建立季度固定的 30 主体研究覆盖，回填 12 个月证据，输出可纠错的公司 Brief 和 90 天变化视图。

**Architecture:** 复用 CompanyProfile、EventRecord、Company Claim Ledger 与 FileTransaction；新增 core-coverage 模块维护版本、回填任务和研究投影。内部补证状态与公开研究工件分开，公开页面、Markdown 与 Feed 读取同一份已验证快照。

**Tech Stack:** Node 24、pnpm 11.9.0、TypeScript、node:test/tsx、静态 HTML/CSS/JavaScript；不新增数据库或供应商。

## Global Constraints

- 已批准规格：`docs/superpowers/specs/2026-09-06-core30-investment-research-design.md`。
- 30 主体：中国 12、北美 12、其他 6；商业 22、平台 5、战略 3。地区为研究槽位，不代表法律国籍。
- 12 个日历月回填，含基准日的 90 个自然日当前窗口；Asia/Shanghai。
- 融资、部署等沿用非发现层 A 或独立 B+B；金额和日期未知不能以零或采集时间补齐。
- 覆盖卡、完整 Brief、近期事件分别计数；历史事实不因核验年龄被删除。
- 当前状态判断 30 天复核期限；冲突或撤回立即使依赖分析无效。
- 不变更运行计划、权限、供应商、秘密配置。社区证据沿用人工采纳后再核验。
- 不直接改写历史生成物。新增配置的首次生效日以启用日为准，不倒签。
- 保存用户未跟踪的 `.DS_Store`、`AGENTS.md`；实施采用独立工作区。提交、合并、推送、真实生成和发布各按已有授权范围执行，本计划不视为外部发布授权。

## 已核实的代码限制

`src/company-claim-ledger.ts` 的 MAX_COMPANIES=15；`src/decision-products/company-card.ts` 的 DEFAULT_LIMIT=20；materialize.ts 的 COMPANY_LIMIT=20。旧卡投影拒绝过期 claim，保留路径排除非“公司”主体。不能只添加一份名单或全局替换数字。

Core 30 的研究覆盖与旧 decision companyCards 保持不同语义：新增公开 `site/data/core-coverage.json`，从同一账本和事件派生；旧决策工件 schemaVersion=1 及严格字段白名单继续有效。新增工件不保存另一套事实，也不能被旧的 20 卡限额截断。

## 任务依赖与文件所有权

| 周期 | 任务 | 依赖 | 主要所有权 |
| --- | --- | --- | --- |
| 1 | T1 覆盖契约与版本 | 无 | core-coverage/contracts.ts、registry.ts、配置 |
| 1 | T2 账本指定覆盖与身份审计 | T1 | company-claim-ledger.ts、身份证据 |
| 1 | T3 可恢复回填与优先队列 | T1 | core-coverage/backfill.ts、review 集成 |
| 2 | T4 时间线与历史事实 | T2 | core-coverage/timeline.ts |
| 2 | T5 分析依赖与完整 Brief | T4 | core-coverage/brief.ts、corrections.ts |
| 3 | T6 公共工件与发布链路 | T3、T5 | core-coverage/materialize.ts、main.ts、发布校验 |
| 3 | T7 地图、变化与统一统计 | T6 的契约 | site/core-coverage.js、页面、Markdown、Feed |
| 全程 | T8 联合验收与真实证据填充 | T1–T7 | 测试、数据取证、验收记录 |

可并行：T2 与 T3；T7 的独立页面渲染可在 T6 工件契约冻结后与主流水线接入并行。主流水线、现有账本和共享类型由各自单一负责人编辑；不派两个任务同时修改 main.ts。每项按失败测试→最小实现→通过测试→审查推进。

## 周期 1：覆盖与事实基础（3–4 开发日）

### Task 1: 版本化覆盖清单

Create：`src/core-coverage/contracts.ts`、`src/core-coverage/registry.ts`、`config/core-coverage.json`、`tests/core-coverage-registry.test.ts`。

输入为既有 `CompanyProfile[]`；配置引用批准名单的 entityId。接口：

```ts
export type CoverageRegion = "china" | "north-america" | "other";
export type CoverageTier = "commercial" | "platform" | "strategic";
export interface CoverageMember {
  companyId: string;
  coverageRegion: CoverageRegion;
  tier: CoverageTier;
  reasonZh: string;
  ownerRole: "maintainer";
}
export interface CoverageVersion {
  schemaVersion: 1;
  version: string;
  effectiveFrom: string;
  members: CoverageMember[];
  previousVersion: string | null;
  changeReasonZh: string;
}
// registry.ts imports CompanyProfile from ../types.js.
export function validateCoverageVersion(value: unknown, companies: readonly CompanyProfile[]): asserts value is CoverageVersion;
export function selectCoverageVersion(versions: readonly CoverageVersion[], now: Date): CoverageVersion;
```

- [ ] 从已批准规格逐条录入 30 ID，首次版本待实施启用时填写真实生效日。保留每个历史版本，不重写 previousVersion。
- [ ] 写重复 ID、未知 ID、错误配额、未来版本未生效、缺中文理由的失败用例。例如从真实配置构造重复末项并断言拒绝：

```ts
const duplicate = { ...config, members: [...config.members.slice(0, 29), config.members[0]] };
assert.throws(() => validateCoverageVersion(duplicate, companies));
assert.doesNotThrow(() => validateCoverageVersion(config, companies));
```

- [ ] 运行 `pnpm exec tsx --test tests/core-coverage-registry.test.ts` 确认缺少实现时失败。
- [ ] 实现字段白名单、30 个唯一主体、两套配额、规范日期及版本引用校验；按 effectiveFrom 选最新已生效版本，没有有效版本时报告未启用而非生成假版本。
- [ ] 同命令通过，`pnpm run check`；独立审查配置不含未经证实的资本/部署事实。

### Task 2: 指定覆盖账本与身份审计

Modify：`src/company-claim-ledger.ts`、`src/company-entities.ts`（仅必要身份兼容）、`events/companies.json`（仅有来源的纠正）。Create：`tests/core-coverage-ledger.test.ts`、`review/core30-identity-audit.json`。

在 `CompanyClaimLedgerOptions` 增加 `coverageCompanyIds?: readonly string[]`；不传时保留旧 15 上限。传入时按名单选 30 个规范主体，忽略旧选分和旧 limit，不改变事件门槛。重复、未知 ID 报错。实验室可在覆盖账本有空 claims 和研究相关事实，不虚构企业融资。

- [ ] 写一个旧默认仍为 15、显式覆盖为 30 的失败测试：

```ts
const legacy = buildCompanyClaimLedger(companies, [], { now });
assert.equal(legacy.companies.length, 15);
const core = buildCompanyClaimLedger(companies, [], { now, coverageCompanyIds: config.members.map(m => m.companyId) });
assert.equal(core.companies.length, 30);
assert.equal(core.metrics.companiesWithEligibleEvents, 0);
```

- [ ] 运行 `pnpm exec tsx --test tests/core-coverage-ledger.test.ts tests/company-claim-ledger.test.ts` 确认新增测试失败。
- [ ] 实现选择分支，并确保实体归属仍按同一主体的规范事件过滤；新增母公司融资不落到子公司、TRI 不能被当作被投方的回归用例。
- [ ] 核查 30 主体的官方 URL、跨区、母子关系。审计文件每项保存 companyId、checkedAt、URL、可定位摘录、字段状态与缺口；官网首页存在不等于融资或部署获证实。
- [ ] 已核实身份才可形成公开覆盖卡；未完成核查仍占覆盖配置槽位，但对外只解释覆盖待核查，不传播未经验证实体属性。
- [ ] 同命令通过，并运行 `tests/company-entities.test.ts`、`tests/company-event-gold.test.ts`。保留旧 ID，禁止用编辑层级改写 entityType。

### Task 3: 回填进度与补证队列

Create：`src/core-coverage/backfill.ts`、`tests/core-coverage-backfill.test.ts`。Modify：`src/review-cases.ts`、`src/review-assignment.ts`（复用分派机制）。生成：`review/core30-backfill.json`，不公开内部候选。

```ts
export interface BackfillTask {
  taskId: string;
  companyId: string;
  field: "identity" | "capital" | "product" | "deployment";
  status: "pending" | "checked" | "blocked";
  reason: "none" | "missing-evidence" | "rate-limited" | "unavailable" | "ambiguous-entity";
  evidenceUrls: string[];
  firstSeenAt: string;
  lastActionAt: string | null;
}
export function buildBackfillTasks(coverage: CoverageVersion, previous: readonly BackfillTask[], now: Date): BackfillTask[];
```

- [ ] 测试同版本重跑 taskId/firstSeenAt 不变；有限容量无空闲负责人时保留 unassigned；不能将 blocked 自动标记 checked。
- [ ] 运行 `pnpm exec tsx --test tests/core-coverage-backfill.test.ts tests/review-assignment.test.ts` 获取失败证据。
- [ ] taskId 由覆盖版本、companyId、field 确定；保留旧处置记录。首批 10 主体按地区与层级交错选择；活跃优先任务最多 20，公开错误与撤回先于新发现。
- [ ] 复用 ReviewCase 与分派结构挂接任务，不引入第二个负责人系统。72 小时指标以首次有效处置计，不以任务创建或重复抓取计。
- [ ] 构造容量耗尽、断点恢复、跨天重跑、重复 URL 用例并通过；运行 `tests/review-cases.test.ts`、`tests/review-ledger-integration.test.ts`。

周期 1 交付：可校验的覆盖与账本、可恢复补证队列；真实证据补充由 T8 持续开展，代码通过与数据达标分别汇报。

## 周期 2：研究卡与纠错（3–4 开发日）

### Task 4: 日期窗口与历史事实投影

Create：`src/core-coverage/timeline.ts`、`tests/core-coverage-timeline.test.ts`。Consumes：现有 CompanyClaimLedger、EventRecord、LedgerField，T1 配置。

```ts
export function coverageWindows(now: Date): { backfillStart: string; currentStart: string; through: string };
export function inCoverageWindow(day: string, from: string, through: string): boolean;
export function needsCurrentStateReview(verifiedAt: string, now: Date): boolean;
```

- [ ] 先写自然日与月末测试：

```ts
assert.deepEqual(coverageWindows(new Date("2026-09-06T01:00:00Z")), {
  backfillStart: "2025-09-06", currentStart: "2026-06-09", through: "2026-09-06"
});
assert.equal(inCoverageWindow("unknown", "2026-06-09", "2026-09-06"), false);
assert.equal(coverageWindows(new Date("2024-02-29T01:00:00Z")).backfillStart, "2023-02-28");
```

- [ ] 运行 `pnpm exec tsx --test tests/core-coverage-timeline.test.ts` 确认失败。
- [ ] 转换到上海自然日后计算；回溯月份使用目标月末截断，拒绝未来/不可解析事件日期。90 天发生与90 天披露为独立集合。
- [ ] 历史融资投影以字段证据有效性决定是否显示，不能用 claim.freshness 自动删除。当前部署状态 30 天复核独立计算，标注过期但保留历史事实。
- [ ] 增加午夜时区、未知事件日期但披露日期已知、旧融资保留、来源撤回移除现行断言测试并通过。

### Task 5: 完整 Brief、分析依赖与更正

Create：`src/core-coverage/brief.ts`、`src/core-coverage/corrections.ts`、`tests/core-coverage-brief.test.ts`、`tests/core-coverage-corrections.test.ts`。Modify：T1 的 contracts.ts 由本任务唯一扩展。

```ts
export interface AnalysisStatement {
  id: string;
  template: "capital-resources" | "product-validation" | "deployment-validation";
  textZh: string;
  claimIds: string[];
  evidenceIds: string[];
  limitationZh: string;
  nextValidationZh: string;
  status: "valid" | "needs-review";
}
export interface CoverageBrief {
  companyId: string;
  completeness: "coverage-only" | "complete";
  analyses: AnalysisStatement[];
  knownClaimIds: string[];
  materialEventIds: string[];
  gapsZh: string[];
  lastMaterialChangeAt: string | "unknown";
}
// brief.ts imports CompanyProfile, EventRecord and CompanyClaimLedger.
export function buildCoverageBriefs(input: {
  coverage: CoverageVersion; companies: readonly CompanyProfile[];
  ledger: CompanyClaimLedger; events: readonly EventRecord[];
  analyses: readonly AnalysisStatement[]; now: Date;
}): CoverageBrief[];
export function revalidateAnalyses(analyses: readonly AnalysisStatement[], ledger: CompanyClaimLedger, events: readonly EventRecord[]): AnalysisStatement[];
```

- [ ] 创建“有身份无事件为 coverage-only、有合格事件但没有中文分析也不完整、仅部署事实也可完整”的失败用例，复用既有 ledger 测试中的规范事件构造方式。
- [ ] 运行 `pnpm exec tsx --test tests/core-coverage-brief.test.ts tests/core-coverage-corrections.test.ts` 确认失败。
- [ ] 输出覆盖全集，完整判定逐项依规格检查。每条分析只引用同主体、已核验字段及当前未撤回证据；候选/单一 B 不参与。
- [ ] 三种初始模板由事实填充，分别表达资金资源、发布能力、部署验证及局限；禁止无证据增加客户、收入、规模、因果或领先结论。自由生成文本保留内部待复核；没有模板事实就显示缺口。
- [ ] 撤回/冲突使关联分析变为 needs-review；已知字段和中文摘要重建。变化 ID 基于主体、规范字段、before/after；仅 verifiedAt 更新不生成变化。
- [ ] 测试一条资金证据撤回同时移除金额摘要和其分析，保留未受影响部署事实；历史 before/after 追加保留，重复重跑不追加。测试集团关联不继承融资、不同币种不聚合。
- [ ] 同命令通过；运行 `tests/facts-contract.test.ts`、`tests/company-ledger-validation.test.ts`。

周期 2 交付：内存和 fixture 的完整研究投影；真实证据达到至少 15/30 前不宣布内容验收完成。

## 周期 3：地图、统一发布与闭环（2–3 开发日）

### Task 6: 单份公开快照和主流水线接入

Create：`src/core-coverage/materialize.ts`、`tests/core-coverage-publication.test.ts`。Modify：`src/main.ts`、`src/validate-release.ts`、`scripts/stage-generated-publication.sh`、`tests/stage-publication.test.ts`。使用已有 FileTransaction，不能绕开 staging。

```ts
export interface CoreCoverageArtifact {
  schemaVersion: 1;
  coverage: CoverageVersion;
  generatedAt: string;
  briefs: CoverageBrief[];
  metrics: { coveredSubjects: number; completeBriefs: number; coverageRatio: number };
}
export function validateCoreCoverageArtifact(value: unknown): asserts value is CoreCoverageArtifact;
```

- [ ] 写 corrupted JSON、重复主体、统计与数组不符、内部字段泄露、撤回仍引用旧事实的失败测试。
- [ ] 运行 `pnpm exec tsx --test tests/core-coverage-publication.test.ts tests/stage-publication.test.ts`。
- [ ] 账本生成后、公开输出前构建 CoreCoverageArtifact；校验名单版本、身份、Brief 依赖和统计。coverageRatio=completeBriefs/30；coveredSubjects 只计已核实身份，不把配置行数冒充核查数。
- [ ] 使用同一事务写 `site/data/core-coverage.json`；历史覆盖版本和公开更正保存在 `events/core-coverage-history.json`，内部回填只在 review/。补齐发布白名单和 release 校验，拒绝部分镜像更新。
- [ ] 旧 decision-products 保留原 schema；Core30 展示不走旧 company-only/20 卡限制。对旧读者无新增必填字段。
- [ ] 注入交换失败确认旧工件组回滚；固定时钟两次生成字节一致；LLM/source 失败只保留仍有效内容，冲突已知时不能以 last-known-good 继续发布失效分析。
- [ ] 同命令通过，并运行 `tests/decision-products-pipeline.test.ts`、`tests/decision-products-retention.test.ts`。

### Task 7: 地图、公司 Brief、季度变化和镜像

Create：`site/core-coverage.js`、`site/core-coverage.html`、`src/core-coverage/render.ts`、`tests/core-coverage-render.test.ts`。Modify：`site/companies.html`、`site/app.js`、`site/styles.css`、`src/decision-products/markdown.ts`、`src/decision-products/subscriptions.ts`、`FACTS_POLICY.md`（新覆盖语义）。

- [ ] 首先写覆盖卡显示缺口、完整卡显示证据、缺失工件显示明确不可用、恶意文本转义、未知筛选参数忽略、统计一致的失败用例。
- [ ] 运行 `pnpm exec tsx --test tests/core-coverage-render.test.ts tests/site-render.test.ts`。
- [ ] 地图默认按稳定名称及 ID 排序；“最近实质变化”未知值置后。筛选 region/tier/route 不改变覆盖成员，不公开内部候选得分。
- [ ] 从同一公开工件渲染公司 Brief、12 月时间线、90 天发生/披露和季度成员变化。旧 companies.html 保留入口和旧锚点兼容；新页所有链接相对 site/ 可部署范围。
- [ ] 为 Core 30 提供独立 Feed 条目集合，复用订阅生成器安全链接和 XML 转义；只将合格实质变化入 Feed，不改变旧 Top Signals 门槛。Feed/Markdown 的事实 ID 必须存在于该轮快照。
- [ ] README 添加 Core 30 入口和覆盖/完整计数，使用生成器不直接改正文。未知资本显示“现有证据不足”，平台实验室不用创业融资文案。
- [ ] 同命令通过，并运行 `tests/site-ui.test.ts`、`tests/decision-products-subscriptions.test.ts`。浏览器检查桌面/移动、筛选、空状态、详情、季度历史和来源链接。

### Task 8: 真实回填、跨链路验收与交接

Create：`docs/superpowers/reports/2026-09-06-core30-acceptance.md`（完成时记录实际日期与提交）。Modify：真实证据进入现有候选→规范事件链路，不能手改生成页面。

- [ ] 身份逐条核查完成后，按 T3 三批执行 12 月回填：只保存可访问证据的定位摘录与字段；遇到缺证列明公司和阻塞原因，不填猜测数字。
- [ ] 每批报告覆盖数、完整 Brief 数、资本/部署已知字段、未知/冲突、地区与层级完成率。最终数据目标至少 15/30；首周期阶段目标至少 10 份证据输入或逐项阻塞。
- [ ] 数据审阅抽查全部已知融资字段、跨主体关系和每份分析的依赖。计入完整度前检查原文，不以测试 fixture 或生成摘要本身作证据。
- [ ] 执行 `pnpm run check`、`pnpm test`、`pnpm exec tsx --test tests/release-contract.test.ts tests/fixture-mode-cli.test.ts tests/stage-publication.test.ts`。失败按原因处理，不跳过已有失败以宣称全绿。
- [ ] 按 physical-ai-release-validation 技能在隔离目录做离线生成；固定同一输入和时钟两次检验幂等，再改变单一证据状态确认所有公共表面同步更正。验证旧链接仍可用。
- [ ] 文档中分开记录代码测试、真实数据覆盖、实际生成与线上验收。真实日报调用及发布只在授权范围执行；线上检查须核对运行 ID、提交、公开快照时间及实际页面，不能拿构建绿灯替代内容验收。
- [ ] 汇报尚未满足的数据门槛、来源限流和人工任务容量。维护者无空闲容量时标记 unassigned；不能因为有 ownerRole 就声称任务已经有人处理。

## 计划自检

规格第 3 节名单→T1/T2；第 4 节版本与时间→T1/T4；第 5 节更新与纠错→T3/T5/T6；第 6 节代码兼容→T2/T6/T7；第 8 节指标与测试→T6/T8。历史保存、未知语义、三层比较、跨地区口径和社区审批均纳入任务。没有更改研究 Passport 或新增推广工作。

本计划为本地开发文档，尚未执行代码任务，未提交或推送。
