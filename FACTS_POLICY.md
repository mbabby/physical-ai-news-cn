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

## Watchlist 公开方法与更正

Watchlist 只发布由当前不可变快照引用的公司判断、规范证据和固定技术路线。公司与路线订阅、首页、变化页和分享链接均读取这同一份公开快照；分享链接只能选择当前快照中的公司 ID 和固定路线，未知、过期或恶意值会被忽略并提示。

相邻快照之间的变化页只说明可由规范证据支持的新增、强化、降级、退出或更正，不展示内部候选、分数、排名、提示词或私有诊断。纠错和补证 Issue 是公开审阅入口，不会直接修改公开事实；被接受的证据仍须经过实体、事实与下一次发布门禁。

证据撤回、冲突或判断过期时，公开判断会降级、退出或保留更正记录，而不是静默覆盖历史。无法观测的访问、引荐、复制或分享数据明确标记为不可用并保留 `null`，绝不以零替代。任何发布失败都保留上一份通过校验的完整公开工件组。

## 公开语义与证据契约

机器可执行的契约位于 `src/facts-contract.ts`，是事件中心、候选核验和任何公开页面的共同边界。新记录使用以下稳定枚举；旧的中文 `ArticleKind` 会被兼容映射，未映射的类型保持 `unknown`，不得冒充确定语义。

- 事件类型：`funding`（融资）、`acquisition`（并购）、`product-release`（产品发布）、`demonstration`（演示）、`pilot`（试点）、`deployment`（部署）、`mass-production`（量产）、`commercialisation`（商业化）、`research-author-report`（研究作者报告）、`independent-replication`（独立复现）。作者报告只能表述作者报告的结果，不能写成独立复现。
- 证据状态：`candidate`、`developing`、`corroborated`、`confirmed`、`rejected`、`conflicted`、`withdrawn`。`confirmed` 的门槛仍是至少一项非发现层 A 级证据，或两项**独立来源**的非发现层 B 级证据；单一 B 级证据最高为 `developing`。
- 统一时间字段：`eventDate`、`publishedAt`、`firstSeenAt`、`verifiedAt`、`materiallyChangedAt`。缺失或无法解析的值显式为 `unknown`；绝不以抓取/运行时间补写，也不从页面发布时间推断事件发生日。旧字段 `occurredAt`、`lastEvidenceAt`、`lastVerifiedAt`、`lastMaterialChangeAt`、`lastUpdatedAt` 仅按其原有含义映射。

发现层（Google News、Hacker News、X 等，或注册表标为“仅作线索发现”的来源）可以留在内部候选和审计记录，但不能被选入 `publicEvidenceIds`，也不能单独让记录公开。公开边界应调用 `assertFacts`；仅需要展示降级状态时调用 `validateFacts` 或 `derivePublicFacts`，并将 `unknown` 原样保留。

## 双账本字段事实与纠错

`Company Claim Ledger` 把融资、产品、客户与部署拆成独立字段；`Benchmark Result Ledger` 把论文中的基准、指标、结果、基线、真实机器人试验与复现资产拆成独立字段。两个账本共用四种字段状态：`verified` 表示字段值已有满足门槛的直接证据，`developing` 表示有可追溯但尚未完成交叉核验的暂定值，`conflicted` 表示至少两项证据支持不同值，`unknown` 表示当前证据无法给出值。`unknown` 不代表没有、不存在或未融资，只表示不可由现有证据作出结论。

字段变化以 `new-evidence`、`conflict-detected`、`conflict-resolved`、`source-withdrawn` 或 `metadata-correction` 记录 before/after、证据和时间；仅核验时钟变化不得制造纠错记录。发现层证据不得进入已知字段。`Benchmark Result Ledger` 不构成论文排名或 SOTA 榜单，它只保存作者报告且可追溯的结构化实验事实；是否能独立复现仍需单独证据。

## Phase 3 决策产品公开语义

- **Top Signals** 只接收规范事件中心中具备一项非发现层 A 级证据，或至少两项来源与域名均独立的 B 级证据的事件。它展示已物化的证据理由与顺序，不在 README、Pages 或 Feed 中重新评分；当一周没有合格事件时，公开列表保持为空，不以候选线索补位。
- **30 秒公司卡** 逐字段投影 Company Claim Ledger。`unknown` 统一解释为“现有证据不足以得出结论”，不代表“没有融资”“没有产品”或“没有部署”；冲突字段不显示兼容值。卡片中的近期事件必须归属于同一个规范公司实体。
- **Research Passport** 不是论文质量榜单或独立复现证明。已知的基准、指标、结果、基线与差值只能来自 Benchmark Result Ledger 中同一论文、状态为 `verified` 且附直接证据的字段；缺失、含混、过期、撤稿或仅仿真的部分保持 `unknown` 或进入 limitations/gaps。
- **订阅中心** 仅提供 GitHub、静态 RSS 与 URL 分享入口，不收集邮箱、账户、点击、访问或个性化数据，不运行推荐后端。所有 Feed 保留共享工件中的身份与顺序。
- **更正** 从规范事件、字段账本或不可变 Watchlist 快照开始，经下一次完整发布重新物化到 JSON、dashboard、README 与 Feed。任何一个公开表面不一致都会阻止整组交换并保留上一版；不得直接手改某个镜像来“修正”事实。
