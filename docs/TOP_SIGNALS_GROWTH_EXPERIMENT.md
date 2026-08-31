# Top Signals 两周增长实验维护手册

本手册适用于 `github-top-signals-2026-08`：实验窗口为 2026-08-31 至 2026-09-13，人工期为 `2026-W36`，自动期为 `2026-W37`。它只覆盖 GitHub Release、README、仓库归档和合规的 GitHub 价值贡献；不创建或使用外部社交账号、邮件列表或第二套事实库。

实验成功的判定是：Star 从基线 1 达到至少 11，且有至少 3 位不同外部用户作出有效的公开引用。Clone 是运行诊断，不是用户或增长指标；GitHub Traffic 不可取得时应保留为 `unknown`，不得写为 0。

## 发布前共通要求

- 只从 `review/top-signals-drafts/<week>.json` 的已核验草稿发布。每期为 3–5 条，绝不以低质量条目补足 5 条。
- 每条必须符合既有公开证据门槛：一项非发现层 A 级证据，或两项来源及域名独立的 B 级证据。主体、日期、类型、中文摘要和证据必须完整；冲突、撤回、暂停信源、占位或推测性表述会阻断发布。
- Release 是当期权威分享版本。只有 GitHub Release 创建或更新成功并取得其规范 URL 后，才可原子写入公开归档、Latest 和 README；不得手工编辑这些公开镜像。
- 发布或推送前取得维护者的明确授权。准备、校验和演练命令只生成或校验本地工件；它们本身不授权创建 Release、推送或触发生产工作流。

在仓库根目录运行准备与校验：

```bash
pnpm top-signals:prepare -- --week 2026-W36 --out /tmp/top-signals-W36
jq -r '.contentSha256' /tmp/top-signals-W36/gate.json
pnpm top-signals:prepare -- --week 2026-W37 --out /tmp/top-signals-W37
pnpm top-signals:validate -- --week 2026-W36
pnpm run validate:release
```

`prepare` 会读取该周 Review 草稿及（若存在）审批文件，在调用者给出的 `--out` 目录写入 Release 说明和 `gate.json`。若门禁为 `blocked`，它会以稳定原因非零退出；先解决原因，绝不能绕过退出状态继续创建 Release。保留 `gate.json`、准备输出和待发布的草稿，作为本期的审计证据。

在任何发布候选进入人工检查点前，还应执行：

```bash
pnpm run check
pnpm test
pnpm run validate:release
pnpm run validate:health
```

`validate:health` 可以报告既有历史缺口为 degraded；这不允许忽略畸形的 Top Signals 工件或 `validate:release` 失败。

## W36：人工审批发布

W36 必须经过内容绑定的人工审批。维护者先审阅本期草稿、准备输出中的 Release 文本、`gate.json` 的 `contentSha256`、证据链接和将要变更的文件，然后才在下列**准确路径**创建审批文件：

```text
review/top-signals-approvals/2026-W36.json
```

审批 JSON 必须只有以下字段，且时间使用毫秒精度的 UTC ISO-8601 格式：

```json
{
  "schemaVersion": 1,
  "experimentId": "github-top-signals-2026-08",
  "week": "2026-W36",
  "contentSha256": "<来自 gate.json 的 64 位小写 SHA-256>",
  "approvedBy": "<维护者 GitHub 登录名>",
  "approvedAt": "2026-09-03T10:10:00.000Z"
}
```

审批绑定的是草稿的规范内容：`schemaVersion`、实验 ID、周次、周期边界和所有信号；生成时间不参与哈希。因此在内容未变时重试不会使审批失效。任何信号、顺序、日期、证据 URL 或其他被哈希内容的一字节改动都会产生不同的 `contentSha256`，原审批必须视为失效并重新人工审阅。不得复制旧周的审批，也不得把不匹配的审批当作“近似批准”。

审批文件写入后，重新执行同一条 W36 `prepare` 命令并确认 `gate.json` 显示 `status: "publishable"`、`mode: "manual"`，同时只记录该审批者和批准时间。没有这些结果不得进行 Release 操作。

## W37：自动门禁发布

W37 没有人工审批替代自动门禁。计划的周发布工作流保留 `workflow_dispatch` 用于 W36，并在周四 13:00 UTC 调度 W37。自动门禁要求至少 3 条合格信号；3–5 条才可发布。少于 3 条、任何结构/证据合同失败或任何发布校验失败时，只保留 Review 草稿和门禁原因，不创建公开 Release，也不更新 README、Latest 或公开归档。

获准的工作流顺序固定如下：先准备并通过门禁，使用稳定标签 `top-signals-$WEEK` 创建或编辑 GitHub Release（并标为 latest），取得 GitHub 返回的规范 Release URL，随后才执行公开物化、发布校验与限定文件提交。Release 失败时，上一期 Latest 和 README 必须保持不变；README 写入失败时 Release 仍可有效，但状态必须报告为 degraded，不能声称完整发布成功。

## 重试、幂等与回滚

- 固定输入和固定时钟的草稿必须字节一致。演练时应在两个临时输出根生成草稿并比较 `review/top-signals-drafts`；差异是发布阻断项。
- 重试只能更新尚未发布的 Review 草稿，或编辑同一周期的稳定 Release 标签。相同 W37 内容重复发布必须得到同一标签和相同公开字节，不得新建重复 Release。
- 发布采用 Release-first 事务。公开物化包含 `weekly/top-signals/<week>.json`、`weekly/top-signals/<week>.md`、`weekly/top-signals/latest.json`、`review/top-signals-publication-receipt.json` 和 README；它们必须一起通过校验。不要单独手改任一文件来“修复”漂移。
- 若发布、README 更新或校验失败，停止后续动作，保存草稿、`gate.json`、日志和失败原因，保留最后一组通过校验的公开输出。修复根因后从 `prepare` 重新开始；内容变更时 W36 必须取得新的哈希绑定审批。

## GitHub 外部互动与引用复核

实验只允许 GitHub 原生、与当前讨论直接相关的价值贡献。整个两周实验最多选择 6 个高度相关的外部互动机会；这是一项项目总上限，不是每个维护者各 6 次。维护者逐条手工执行，并先检查目标仓库规则、是否欢迎推荐以及讨论是否相关。不得自动发评论、Issue 或 PR，不得重复评论、批量低质量 PR、主动索要 Star，且只能链接对应证据条目或当期 Release，不能统一导向首页。

每次外部互动应使用清楚的关系披露，例如：

> 披露：我是 `physical-ai-news-cn` 的维护者。本回复仅补充与当前讨论直接相关、可核验的事实；相关证据条目／当期 Release 在此链接中。

按语境补充事实、复现结果、纠错或结构化资料；如果规则禁止推广、没有邀请或不相关，则不发布。

自动搜索得到的引用只是候选，绝不自动计入 KPI。维护者要逐条确认 URL 为公开外部位置、作者确为外部用户、内容确实主动引用项目/某期 Release/单条证据，且不是项目所有者、机器人、项目内 URL、重复 URL 或同一作者的重复记录。通过后才编辑 `review/top-signals-reference-decisions.json`：

```json
{
  "schemaVersion": 1,
  "decisions": [
    {
      "url": "https://github.com/example/project/issues/42",
      "author": "external-user",
      "reviewedBy": "maintainer-login",
      "reviewedAt": "2026-09-08T09:30:00.000Z",
      "reason": "external-user-reference"
    }
  ]
}
```

每位通过复核的外部作者只计一次。身份无法确认的候选留在候选层，不计 KPI。

## 演练与发布检查点

在授权真实发布前，使用隔离的临时根和 fixture 完成演练，而不修改生产公开工件。演练必须证明：W36 无审批会阻断；匹配审批可通过；草稿一字节变化会阻断；W37 有 3–5 条合格信号可通过；W37 只有 2 条会保留 Review 并阻断；相同 W37 发布两次保持同一标签和相同字节。

提交或推送前向维护者出示 W36 草稿 Markdown、内容 SHA-256、门禁凭据、精确变更文件列表、完整测试计数、`validate:release` 和 `validate:health` 输出。获得明确批准后，W36 Release 仍是日报草稿生成后的独立人工动作。

## 实验结束

在第 12–14 天运行增长快照并复核所有引用决定，记录 Star 净增长、有效外部作者数及公开链接、两期 Release 访问差异、人工与自动门禁的失败项差异，以及访问或引用最高的信号类型。不可取得的流量字段写为 `unknown`。

结论必须明确且不改变证据标准：同时达到 Star 至少 11 和至少 3 位不同外部作者为“成功”；仅达到一项为“部分成功”，保留内容能力并先复盘渠道或定位；两项都未达到为“失败”，停止新增增长功能并重新验证目标用户与价值主张。无论结论为何，都不得以增加内容数量、降低证据门槛或批量推广补足指标。
