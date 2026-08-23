# Phase 2 双账本设计

## 1. 目标与边界

二期为第三期决策产品提供可追溯、可纠错的字段级事实底座：

- 完善融资/部署 `CompanyClaimLedger`；
- 新建 `BenchmarkResultLedger`；
- 每个关键字段必须明确为 `verified`、`developing`、`conflicted` 或 `unknown`；
- 每次实质纠错保留旧值、新值、原因、证据和发生时间；
- 缺少证据必须表达为 `unknown`，不能推导成“没有融资”“没有部署”或“没有结果”。

本期不实现 Top Signals、30 秒公司卡、Reproducibility Passport、订阅中心或新的公开排名。现有 README、Pages 与 Watchlist 继续使用兼容输出。

## 2. 共享字段证据契约

新增一个只负责账本基础类型和确定性纠错的模块。字段记录包含：

- `value`：规范值或 `unknown`；
- `status`：`verified | developing | conflicted | unknown`；
- `evidenceIds`、`evidenceUrls`：排序稳定的规范证据；
- `observedAt`、`verifiedAt`：未知时必须为 `unknown`；
- `conflictingValues`：仅在冲突时记录各来源支持的不同值。

共享纠错记录包含稳定 `correctionId`、账本类型、主体 ID、字段路径、旧字段、新字段、原因、证据 ID 和时间。原因限定为：

- `new-evidence`；
- `conflict-detected`；
- `conflict-resolved`；
- `source-withdrawn`；
- `metadata-correction`。

相同输入和固定时钟必须产生字节稳定的字段与纠错记录；仅验证时间变化不得制造纠错。

## 3. 融资/部署 Claim Ledger

保留现有 `CompanyClaim.value`、`evidenceState` 和消费者接口作为兼容投影，同时新增字段级 `fields`：

- 融资：`round`、`amount`、`valuation`、`investors`；
- 产品/部署：`product`、`customer`、`deployment`、`productionStage`；
- 公共字段：`eventDate`。

状态规则：

- A 级一手证据或两个独立 B 级证据支持相同值：`verified`；
- 单一 B 级证据：`developing`，不可进入现有 verified 兼容投影；
- 合格证据支持不同非空值：`conflicted`，公开兼容值为 `unknown`；
- 无可追溯值：`unknown`。

账本构建器读取上一版账本生成字段纠错。候选、发现源和未归属事件不能进入账本。公司简介、官网描述或投资方名单不能替代事件证据。

## 4. Benchmark Result Ledger

新增 `research/benchmark-result-ledger.json`，每个条目由规范论文 ID 与 benchmark 名称确定稳定 ID。输入只允许来自 `ResearchRecord` 和通过研究门禁的 `ResearchDecisionCard`。

字段包括：

- `benchmark`；
- `metric`；
- `result`；
- `baseline`；
- `delta`；
- `evaluationSetting`（`real-robot | simulation | mixed | unknown`）；
- `realRobotTrials`；
- `code`、`data`、`weights`。

首版只结构化原文或决策卡中能够逐字段绑定证据 URL 的值。不能从论文标题、相关工作、否定句或无证据标签推断结果。已撤稿、OpenAlex 身份歧义、研究卡不合格的论文不产生可验证 benchmark 条目；仍可保留带阻断原因的 `unknown` 记录供内部审查。

Benchmark 账本同样读取上一版生成纠错历史。arXiv 版本更新、OpenAlex 撤稿和结果字段修订必须可追踪；仅引用数变化不构成 benchmark 结果纠错。

## 5. 数据流与持久化

日报流程顺序：

1. 更新事件中心、研究池和研究决策卡；
2. 读取上一版两个账本；
3. 构建公司字段账本和 Benchmark Result Ledger；
4. 校验结构、证据引用、主体归属、研究身份和纠错连续性；
5. 通过现有 `FileTransaction` 与日报产物一起提交；
6. 输出内部质量指标，不把候选或冲突值投射到公开事实。

持久化文件：

- `events/company-claim-ledger.json`：升级后的公司账本；
- `research/benchmark-result-ledger.json`：Benchmark 账本；
- `review/dual-ledger-metrics.json`：完整率、冲突数、unknown 数、纠错数和证据覆盖率。

不新增数据库、网络 API 或第二套公司/论文身份系统。

## 6. 兼容与失败处理

- 现有 Watchlist 只消费公司账本的兼容 `verified` 投影；字段处于 `developing`、`conflicted` 或 `unknown` 时不得升级 Watchlist 事实。
- 旧账本没有 `fields` 或 `corrections` 时按迁移输入处理，不制造虚假历史。
- 上一版账本损坏时停止新账本发布并保留 last-known-good，不以空账本覆盖。
- 单个字段无法解析时只降级该字段；不能让一个缺失金额阻断已核验轮次。
- Benchmark 账本失败不得污染现有公开论文卡；发布校验失败时整个日报事务回滚。

## 7. 验收标准

- 公司账本覆盖 verified、developing、conflicted、unknown 四种字段状态；
- 融资金额冲突不会暴露任一值为已核验事实；
- 部署客户缺失不会被表达为“没有客户”；
- Benchmark 账本能记录具名 benchmark、结果/基线/delta、实机设置及复现资产，缺失字段为 unknown；
- 论文否定、相关工作引用、仿真-only 和撤稿场景不能产生错误 verified 字段；
- 新证据、冲突、冲突消解、证据撤回和元数据修正均有确定性纠错记录；
- 相同输入固定时钟连续构建两次字节一致；
- 完整类型检查、测试、发布校验和双次日报回归通过；
- 公开页面继续满足一期实体归属和研究门禁，不出现候选、冲突值或英文半成品。

