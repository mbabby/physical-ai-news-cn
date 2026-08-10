# 研究 → 产业关系边

`src/research-industry-relations.ts` 是独立的审计模块：它接收 `ResearchRecord` 或 `Article`、`CompanyEntity` 或 `CompanyProfile`，以及人工/抓取器提供的**显式**关系证据候选，输出具有稳定 ID 的关系边。它尚未接入首页、研究页、公司页或主运行流程。

## 支持的关系和方向

所有边的 `direction` 为 `research_to_industry`，并包含 `paperId`、`companyId`、证据 URL/来源/等级/发布日期、`verifiedAt`、TTL 新鲜度和待解问题。对于尚无 `entityId` 的旧 `CompanyProfile`，可通过 `researchIndustryCompanyId(profile)` 获得由官网 URL（回退为名称）派生的稳定 `companyId`。

- `company_official_reference`
- `author_or_lab_affiliation`
- `code_or_model_adoption`
- `joint_project_or_release`
- `independent_reproduction_or_deployment`

可选的 `route_adjacency` 仅是导航提示。它的 `relationState` 固定为 `adjacent`，不含证明，永远不会被 `selectTopResearchIndustryEdges` 选中，也绝不能表述为采用、部署或已核验关系。共享技术路线本身不会自动生成任何强边。

## 证据与状态

`visibility: "discovery"`（或已知 `sourceTier: "线索发现层"`）的候选被强制保留在 `discoveryEvidence` 供内部审阅，不进入 `evidence` / `evidenceUrls`，也不能使边升级或公开。公开证据遵循事实策略：一项 A 级，或两项按 URL 域名（无有效 URL 时按来源名）区分的独立 B 级，才是 `verified`；单一 B 级最多为 `developing`。其他公开证据为 `candidate`。显式否决为 `rejected`；同时出现公开支持与反驳证据、或显式冲突决定，为 `conflicted`。

`verifiedAt` 仅在已核验时取支持证据的最新发布日期；其他状态为 `unknown`，绝不以运行时间代填。关系 ID 只由论文、公司和关系类型派生，因此证据补充不会造成 ID 漂移。重复候选按 URL、来源、等级、立场和可见性去重。

## 新鲜度、指标与 Top 20

不同关系按 120–365 天 TTL 计算 `fresh` / `stale` / `unknown`（路线相邻为 30 天且始终未知）。结果的 `metrics` 提供输入/去重、未知实体、发现层、各状态、过期、公开证据和强边计数。`selectTopResearchIndustryEdges(edges, 20)` 固定上限 20，只返回 `verified` 且有公开证据的非 `route_adjacency` 边，并按公开支持证据强度、核验日期、稳定 ID 排序。
