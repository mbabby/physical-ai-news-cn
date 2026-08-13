# 物理 AI 周报 · 2026-W33

> 截止 2026-08-13。只纳入主体明确、中文事实简介完整、且具 A/B 级非线索证据的公开条目。

## 新增事件

- **Toyota Research Institute** · [A3称2026年第二季度机器人需求跨行业增长](https://www.therobotreport.com/q2-2026-robotics-demand-increased-across-industries-reports-a3/)：A3报告称，2026年第二季度机器人需求跨行业上升，食品、电子和医疗订单抵消了汽车制造需求疲软。摘要未提供真实机器人、基准或开源证据。
- **Toyota Research Institute** · [Stratom 团队获美国陆军合同，开发 TALUS 自主后勤分发系统](https://www.therobotreport.com/strengthening-u-s-army-sustainment-talus-to-deliver-autonomous-distribution/)：Stratom 领导的团队赢得美国陆军合同，将开发面向对抗环境的 TALUS 自主后勤系统，以强化陆军的自主分发与保障能力。摘要未提供真实机器人、基准或开源证据。
- **Humanoid** · [3700亿美元之争：一体化设计助力人形机器人厂商赢得快速增长市场](https://www.therobotreport.com/the-370-billion-dollar-race-how-integrated-design-can-help-humanoid-manufacturers-succeed-in-a-rapidly-growing-market/)：文章探讨一体化设计如何帮助人形机器人制造商在预计3700亿美元的快速增长市场中取得成功。摘要未提供真实机器人、基准或开源证据。
- **NVIDIA** · [VicOne 基于 DEF CON 34 研究发布免费的 NVIDIA Isaac Sim 网络安全扩展](https://www.therobotreport.com/vicone-releases-free-nviida-isaac-sim-cybersecurity-extension-based-def-con-34-research/)：VicOne 推出免费的 Radeis Extension 扩展，让开发者能在 NVIDIA Isaac Sim 中于部署前测试机器人的网络安全性。摘要未提供真实机器人、基准或开源证据。

## 融资与并购

- 本周暂无满足公开门槛的融资或并购事件。

## 产品与部署

- **Toyota Research Institute** · [A3称2026年第二季度机器人需求跨行业增长](https://www.therobotreport.com/q2-2026-robotics-demand-increased-across-industries-reports-a3/)：A3报告称，2026年第二季度机器人需求跨行业上升，食品、电子和医疗订单抵消了汽车制造需求疲软。摘要未提供真实机器人、基准或开源证据。
- **Toyota Research Institute** · [Stratom 团队获美国陆军合同，开发 TALUS 自主后勤分发系统](https://www.therobotreport.com/strengthening-u-s-army-sustainment-talus-to-deliver-autonomous-distribution/)：Stratom 领导的团队赢得美国陆军合同，将开发面向对抗环境的 TALUS 自主后勤系统，以强化陆军的自主分发与保障能力。摘要未提供真实机器人、基准或开源证据。
- **Humanoid** · [3700亿美元之争：一体化设计助力人形机器人厂商赢得快速增长市场](https://www.therobotreport.com/the-370-billion-dollar-race-how-integrated-design-can-help-humanoid-manufacturers-succeed-in-a-rapidly-growing-market/)：文章探讨一体化设计如何帮助人形机器人制造商在预计3700亿美元的快速增长市场中取得成功。摘要未提供真实机器人、基准或开源证据。
- **NVIDIA** · [VicOne 基于 DEF CON 34 研究发布免费的 NVIDIA Isaac Sim 网络安全扩展](https://www.therobotreport.com/vicone-releases-free-nviida-isaac-sim-cybersecurity-extension-based-def-con-34-research/)：VicOne 推出免费的 Radeis Extension 扩展，让开发者能在 NVIDIA Isaac Sim 中于部署前测试机器人的网络安全性。摘要未提供真实机器人、基准或开源证据。

## 研究前沿

- [AtlasVLA：为视觉-语言-动作模型构建持久世界-自我状态建模](https://arxiv.org/abs/2608.06729v1)：该研究提出 AtlasVLA，以 4D 持久世界状态记忆与自我工作状态记忆的双记忆架构，让模型从反应式操作转向主动推理。在 LIBERO、RLBench 和真实基准上达到最优，仅用手腕相机即在 LIBERO-Long 提升 9.4%、真实长程任务提升 17.5%。
- [PhyAI：边缘实时与云端可扩展的统一物理 AI 推理引擎](https://arxiv.org/abs/2608.03682v2)：构建统一推理引擎 PhyAI，以单一运行时经模型适配器在机载、边缘与云端多 GPU 上运行 VLA 与世界-动作模型。其较 pi0、GR00T N1.7 等官方实现提速 1.40–4.65 倍，在 LIBERO 套件上给出基准分析并开源代码。
- [TEMPO：面向视觉-语言-动作模型的语义-动作解耦强化学习后训练框架](https://arxiv.org/abs/2608.07314v1)：提出TEMPO，冻结视觉-语言主干，以不同频率分别对语义投影层与动作专家进行强化学习更新，避免快速策略更新破坏高层语义表示。在CALVIN基准与真实操作任务上，其持续优于预训练最优VLA模型及强化学习后训练基线，并在两项真实任务上保持更高奖励。
- [CrossTracer：基于VLA推理与轨迹残差自适应的跨本体导航框架](https://arxiv.org/abs/2608.06688v1)：CrossTracer提出分层跨本体导航框架，以归一化像素轨迹为统一接口，由VL-Tracer生成初始轨迹、CE-Adapter按本体条件预测残差修正。该方法在NaviTrace基准以45.68分超越Gemini-2.5-Pro约28.1%，并在轮式与腿式机器人实机部署中提升导航成功率与执行效率。
- [ω-0：实现人形机器人移动与操作并行的潜在预测世界动作模型](https://arxiv.org/abs/2608.06375v1)：提出 ω-0，一个全身潜在预测世界动作模型，直接由语言指令、视觉与本体状态生成可执行的全身动作隐变量。在 11 项真实家庭任务上，单一模型即优于模仿学习、VLA 与人形基线。
- [HiRoC：面向机器人操作的分层后训练框架](https://arxiv.org/abs/2608.05999v1)：研究提出分层后训练框架HiRoC，将高层任务规划与低层动作执行解耦，规划器生成子目标，执行器经子目标对齐后通过强化学习持续改进。在多个机器人操作基准上，HiRoC持续优于强基线。

## 信源质量变化

- 已启用 11 个；观察 30 个；暂停 2 个；达到晋升条件 0 个。

## 项目指标

- 日历覆盖：13/30（43%）；已归档运行成功：13/13（100%）
- 首页有效条目：7；A/B 级证据比例：100%；公司档案覆盖：5 家。

## 待验证候选

- 有 18 条高质量候选停留在 Review 队列；它们不会进入首页或本周结论，欢迎补充官网、投资方公告、第二独立来源或论文元数据。

---

*GitHub Star、访问量与来源需要另行授权 GitHub Traffic API；未配置时不会以 0 展示。*
