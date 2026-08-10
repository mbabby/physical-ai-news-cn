# 研究决策卡 v2

`src/research-decision-card.ts` 将 `ResearchRecord` 物化为可审计的研究决策卡。它不请求网络、不生成或翻译新的技术事实；中文标题和两句简介只复用已通过公开门槛的 `titleZh`、`summaryZh`，技术字段只从原文标题、原文摘要及现有 OpenAlex 元数据提取。

## 接口

```ts
import { selectTopResearchDecisionCards } from "./src/research-decision-card.js";

const cards = selectTopResearchDecisionCards(registry.records, {
  now: new Date(),
  maxOpenAlexAgeDays: 30,
});
```

`materializeResearchDecisionCard(record)` 始终返回完整的 schema：每个事实字段要么附带 `evidenceUrls`，要么明确为 `"unknown"`。`fieldEvidence` 是按字段导出的 URL 索引；`completeness.completeOrUnknown` 只在每个字段满足“有证据的已知值 / 明确 unknown”时为真。

## Top 12 门槛与排序

`selectTopResearchDecisionCards` 先按稳定评分排序，再取最多 12 项。最终排序键是 `paperId`，因此输入顺序和重复运行不会改变结果。以下任一情况保留在物化结果的 `gates` 中，但不会进入 Top 12：

- 中文标题或两句事实简介不完整，或注册表状态为“待复核”；
- OpenAlex work 缺失、同一 workId 映射到不同论文记录（歧义），或检查时间超过 30 天；
- `ResearchRecord` 或 OpenAlex 标记为撤稿。

研究卡包含 `paperId / OpenAlex workId / arXiv version`、任务与具身形态、训练/数据规模、基准、基线/差值、实机试验数、代码/权重/数据/项目页/许可证、局限、复现成本等级、作者/实验室，以及 OpenAlex 状态。原文没有精确支持时，这些字段均为 `"unknown"`；复现成本只给 `low`、`medium`、`high` 或 `unknown`，不推算金额。
