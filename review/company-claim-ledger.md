# 重点公司决策档案（claim ledger）

`src/company-claim-ledger.ts` 提供一层纯函数物化视图：输入已有的 `events/companies.json` 实体图谱和 `events/index.json` 事件，不读取网络、不写文件、也不把公司简介当作融资或部署事实。

## 调用与范围

```ts
const ledger = buildCompanyClaimLedger(companies, eventStore.events, {
  now: new Date(),
  limit: 15,
});
```

首期硬上限为 15 家，即使调用方传入更大值也不会扩大。选择顺序固定为：可归属 A/B 级事件的类型权重与证据数、最新事件时间、`companyId`；同一输入在不同数组顺序下输出相同。该函数尚未接入日报写入路径，避免改变 `src/main.ts`、`src/site-data.ts` 的既有公开格式；接入时可将结果独立写为 `events/company-claim-ledger.json`。

## Claim 合同

每条 claim 都有以下字段：`companyId`、`claimType`（`funding`、`product`、`pilot`、`deployment`、`production`、`commercialization`、`research-team`）、`statement`、`value`、`evidenceIds`、`evidenceUrls`、`evidenceState`、`eventDate`、`verifiedAt`、`freshness`（TTL、状态、到期日）和 `unresolvedQuestions`。

- 仅主实体匹配且达到事实门槛的事件才产生 `verified` claim：产品/研究需要 A 级一手证据，融资、试点、部署、量产与商业化需要 A 级证据或两个独立 B 级报道；C/D 级线索及单个 B 级融资报道不会进入。
- 每家入选公司始终有一条 `funding` claim。没有可归属融资事件时它必须是 `value: "unknown"` 与 `evidenceState: "evidence_insufficient"`，语义是“当前事件视图未收录证据”，不是“没有融资”。
- `statement` 直接保留事件标题；`value` 仅来自已有结构化融资/产品字段，缺失就为 `unknown`，不从公司简介推断。
- `evidenceIds` 由 `eventId:evidence:序号` 稳定生成，证据按链接、来源排序；URL 原样保留以便追溯。

## 质量指标

返回的根级和公司级 `metrics` 均包含：

- `fieldCompletenessRate`：claim 必填字段的已填比例；`unknown` 与空证据数组按未填计算；
- `staleClaimCount` / `staleEvidenceCount`：已过 claim 类型 TTL 的 claim 和其证据数；融资 180 天、研究团队 365 天、量产/商业化 120 天、其余 90 天；
- `attributedEventCount`、`eligibleEventCount`、`eventCoverageRate`：主实体归属事件中满足 A/B 门槛的覆盖率。

这些指标描述当前数据可用性，不替代人工核验，也不用于补写缺失事实。
