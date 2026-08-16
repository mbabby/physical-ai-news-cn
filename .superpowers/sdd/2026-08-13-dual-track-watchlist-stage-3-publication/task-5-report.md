# Stage 3 Task 5 report — Watchlist release consistency

## Status

降级但可用。Task 5 的发布门禁、单事务发布、不可变历史、故障回滚与 GitHub 工作流已经实现并通过本地验证。仓库最新运行清单仍标记为 `degraded`，原因是既有 2026-08-16 运行中 LLM 10 次请求有 2 次失败，以及 Watchlist 本轮没有产生公开卡；这不是本次本地验证引入的新失败。

## Implementation

- 新增 `src/watchlist/release-validation.ts`，暴露 `validateWatchlistRelease({ snapshot, theses, dashboard, readme })`，并支持可选历史快照的完整引用检查。
- 门禁拒绝周/版本/公司集合错配、断裂的精确 thesis 引用、方法论错配、终止或在快照时点已过期的 thesis、缺失的 `AI 研究判断` 披露，以及 Watchlist 子树中的 candidate ID、score/rank 和私有诊断字段。
- `mergeWatchlistThesisArtifact` 只保留 current 与全部 immutable history 精确引用的 `(thesisId, thesisVersion)`；同一精确版本的不同字节硬失败。
- `stageWatchlistRelease` 在任何 stage 之前完成跨产物校验与历史碰撞检查，然后把 `watchlist/current.json`、`watchlist/theses.json`、新 history、`site/data/dashboard.json` 与 `README.md` 放入现有 `FileTransaction`。已存在的同字节 history 是幂等 no-op，异字节 history 在 commit 前失败。
- `src/main.ts` 不再读取上一轮 public view。它从本轮已校验 preview 在内存中构建 snapshot、public theses 和唯一 public view，并用该对象生成 dashboard 与 README，避免一轮滞后。
- `src/runtime/validation.ts` 把 Watchlist 门禁纳入总发布质量门槛；`src/validate-release.ts` 校验 current、theses、全部 history、dashboard、README 和内部 preview/runtime receipts。
- 日报工作流提交整个公开 `watchlist/`，并报告 week、snapshot version、前瞻雷达卡数和验证动量卡数。
- 周报工作流只解析 `watchlist/current.json`，要求对应 immutable history 与 current 字节一致，要求周报周次相同，并用 `brief-<week>-v<version>` 发布及报告精确身份；不再按文件名字典序选择报告。
- 引导公开空快照 `2026-W33 · v1`，current 与 history 字节相同。README 保持静态可见的 `AI 研究判断` 披露；Task 4 UI 文件与语义未修改。

## TDD evidence

第一轮 RED：

- `tests/watchlist-release-validation.test.ts` 首次运行因 `src/watchlist/release-validation.ts` 不存在而失败。
- 加入最小 API 骨架后，10/10 行为测试均以预期的“未实现”原因失败，覆盖周/版本/集合错配、泄漏、终止/过期、披露、无写入失败、故障回滚、history 碰撞和 thesis 历史保留。

第二轮 RED：

- `tests/release-contract.test.ts` 4 项失败，分别证明日报工作流、release validator、同轮 public view 和周报 snapshot 解析尚未接入。
- README 空快照披露测试先失败，再加入静态披露后通过。
- candidate ID 值泄漏回归先以“判断版本断裂”失败，再增加 candidate ID 早期门禁后通过。

GREEN：

- Task 5 聚焦门禁 10/10 通过，包括 invalid-stage 零写入、`failAfterSwaps: 3` 全组回滚、异字节 history 碰撞、同字节 history 幂等及两轮连续事务字节稳定。
- 聚焦集成测试 23/23 通过。
- 全量测试 419/419 通过。

## Required verification

- `pnpm run check`：通过。
- `pnpm test`：419 passed，0 failed。
- `pnpm run validate:release`：通过；2026-08-16 公开 6 条，运行状态 degraded。
- `pnpm run validate:health`：通过；状态 degraded，最近成功率 100%，连续成功发布 30 次；唯一原因是最近运行存在外部服务或信源降级。
- GitHub Actions YAML 由 Ruby Psych 成功解析。
- `git diff --check`：通过。

## Two deterministic local cycles

未访问真实外网、未调用真实 LLM/OpenAlex。连续执行两轮本地 Watchlist 事务测试和 `validate:release`：两轮均 10/10 通过，release validation 均通过，公开文件前后 SHA-256 完全一致：

- `watchlist/current.json`: `2ecc73e8570fe38b82344fbba6e8e595ea0f06107833e5d90d37e921e65cc067`
- `watchlist/theses.json`: `131413150b136e927bbcb50a82e9179e933bb553e4f1d3b475743c6a51fd7c7d`
- `watchlist/history/2026-W33-v1.json`: `2ecc73e8570fe38b82344fbba6e8e595ea0f06107833e5d90d37e921e65cc067`
- `site/data/dashboard.json`: `01df755fc3516d9804fc3c50ba9c2e358a078e9a9d0b97ffe9c82ebfc4018d50`
- `README.md`: `4613f19ad4f9e17a87694dc35a4f46e09a7071bde925a68f53fc448b1bc3b121`

## Physical AI release validation

- 测试：通过。
- 公开门槛：通过。Watchlist current/history/dashboard/README 的 week=`2026-W33`、version=`1`、公司集合均为空且一致；current 与 history 字节一致；公开 Watchlist 子树无 candidate ID、score/rank、终止/过期卡或 `watchlist-preview` 泄漏。
- 信源：既有最新运行记录 0 个失败信源；本任务未真实抓取。
- LLM：既有运行部分降级（8/10 成功）；本任务按约束未调用真实 LLM。
- OpenAlex：既有运行成功（36/36）；本任务按约束未调用真实 OpenAlex。
- 提交：本任务使用提交信息 `feat: enforce watchlist release consistency`；最终 handoff 返回提交哈希。
- Pages：未触发、未部署；任务明确禁止 deploy。工作流契约与 YAML 语法已验证。
- 首页日期/身份：dashboard 生成时间与最新运行日期均为 2026-08-16；Watchlist README/dashboard/current 均为 2026-W33 v1。

## Concerns

- 本地验收严格遵守“禁止真实外网/真实 LLM”，因此信源、LLM、OpenAlex 和 Pages 仅验证既有 receipts、降级语义与工作流契约，没有真实触发远端运行或部署。
- 公开 dashboard 仍保留 Task 4 之前就存在的非 Watchlist 排序字段；Task 5 只对 `dashboard.watchlist` 和 Watchlist JSON/README 投影实施 score/rank 泄漏门禁，以避免改写 Task 4 的兼容 UI。
