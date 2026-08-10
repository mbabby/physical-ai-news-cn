# 事实与更新规则

## 首页排序

先过滤弱相关、缺少事实简介或仅有 C/D 级证据的条目；金融市场流水、股票及泛机器人收购不进入首页。产业事件按 **影响力 40% + 信源权威性 30% + 时效性 20% + 多源佐证 10%** 排序，并分为「本期关键进展」与「最新动态」。融资优先公司级融资/并购和金额、投资方均可追溯的事件；论文优先真实机器人结果、基准、代码或数据集齐全且对 VLA、世界模型、操作等核心问题有贡献的工作。

本库将新闻、观点与长期知识分开维护。任何事件均保存原始证据、首次出现、最后更新和最后核验时间；后续报道追加到同一事件时间线，不静默覆盖历史。

## 证据等级

- **A｜一手确证**：官方发布、产品页、GitHub Release、论文原文、监管文件或完整官方演讲。
- **B｜可靠报道**：可追溯的行业媒体，用于补充投融资、客户和部署信息。
- **C｜人物观点**：本人公开帖子、博客或演讲，只证明其观点。
- **D｜候选线索**：社区转述或未经证实的内容，不进入首页事件卡。

## 发布门槛

- 投融资、订单、量产与部署：至少一份 A 级证据，或两份独立 B 级证据。
- 产品、开源、模型更新：官方发布或 GitHub Release 可确认“已发布”。
- SOTA：必须说明任务、基准、指标和论文/代码；默认视为作者报告，除非有独立复现。
- 演示视频：仅标记为能力演示，不自动推断可靠部署或商业化。

发现冲突证据时，事件转为“待复核”；更正保留在时间线中。

## 公开语义与证据契约

机器可执行的契约位于 `src/facts-contract.ts`，是事件中心、候选核验和任何公开页面的共同边界。新记录使用以下稳定枚举；旧的中文 `ArticleKind` 会被兼容映射，未映射的类型保持 `unknown`，不得冒充确定语义。

- 事件类型：`funding`（融资）、`acquisition`（并购）、`product-release`（产品发布）、`demonstration`（演示）、`pilot`（试点）、`deployment`（部署）、`mass-production`（量产）、`commercialisation`（商业化）、`research-author-report`（研究作者报告）、`independent-replication`（独立复现）。作者报告只能表述作者报告的结果，不能写成独立复现。
- 证据状态：`candidate`、`developing`、`corroborated`、`confirmed`、`rejected`、`conflicted`、`withdrawn`。`confirmed` 的门槛仍是至少一项非发现层 A 级证据，或两项**独立来源**的非发现层 B 级证据；单一 B 级证据最高为 `developing`。
- 统一时间字段：`eventDate`、`publishedAt`、`firstSeenAt`、`verifiedAt`、`materiallyChangedAt`。缺失或无法解析的值显式为 `unknown`；绝不以抓取/运行时间补写，也不从页面发布时间推断事件发生日。旧字段 `occurredAt`、`lastEvidenceAt`、`lastVerifiedAt`、`lastMaterialChangeAt`、`lastUpdatedAt` 仅按其原有含义映射。

发现层（Google News、Hacker News、X 等，或注册表标为“仅作线索发现”的来源）可以留在内部候选和审计记录，但不能被选入 `publicEvidenceIds`，也不能单独让记录公开。公开边界应调用 `assertFacts`；仅需要展示降级状态时调用 `validateFacts` 或 `derivePublicFacts`，并将 `unknown` 原样保留。
