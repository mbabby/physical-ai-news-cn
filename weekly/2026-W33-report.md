# 物理 AI 周报 · 2026-W33

> 截止 2026-08-11。只纳入主体明确、中文事实简介完整、且具 A/B 级非线索证据的公开条目。

## 新增事件

- **NVIDIA** · [VicOne 基于 DEF CON 34 研究发布免费的 NVIDIA Isaac Sim 网络安全扩展](https://www.therobotreport.com/vicone-releases-free-nviida-isaac-sim-cybersecurity-extension-based-def-con-34-research/)：VicOne 推出免费的 Radeis Extension 扩展，让开发者能在 NVIDIA Isaac Sim 中于部署前测试机器人的网络安全性。摘要未提供真实机器人、基准或开源证据。

## 融资与并购

- 本周暂无满足公开门槛的融资或并购事件。

## 产品与部署

- **NVIDIA** · [VicOne 基于 DEF CON 34 研究发布免费的 NVIDIA Isaac Sim 网络安全扩展](https://www.therobotreport.com/vicone-releases-free-nviida-isaac-sim-cybersecurity-extension-based-def-con-34-research/)：VicOne 推出免费的 Radeis Extension 扩展，让开发者能在 NVIDIA Isaac Sim 中于部署前测试机器人的网络安全性。摘要未提供真实机器人、基准或开源证据。

## 研究前沿

- [SkillMemo：专家引导的技能记忆框架助力组合式具身操作](https://arxiv.org/abs/2608.05970v1)：SkillMemo通过专家引导的轨迹分割与技能级情景记忆，分解长程演示并检索可复用技能以改进动作预测。仿真基准与真实机器人操作实验显示，该方法持续提升DP和VLA骨干并达到领先性能。
- [PhyAI：边缘实时与云端可扩展的统一物理 AI 推理引擎](https://arxiv.org/abs/2608.03682v2)：构建统一推理引擎 PhyAI，以单一运行时经模型适配器在机载、边缘与云端多 GPU 上运行 VLA 与世界-动作模型。其较 pi0、GR00T N1.7 等官方实现提速 1.40–4.65 倍，在 LIBERO 套件上给出基准分析并开源代码。
- [DreamWAM：超越RGB未来预测的世界动作模型](https://arxiv.org/abs/2608.04996v1)：DreamWAM将未来预测从RGB空间重构为外观、运动、几何与语义的结构化表示，训练时联合建模而推理仅保留RGB分支。该方法在LIBERO与LIBERO-Plus扰动下均超越RGB基线，真实机器人操作平均成功率达74.4%，代码与模型已开源。
- [TEMPO：面向视觉-语言-动作模型的语义-动作解耦强化学习后训练框架](https://arxiv.org/abs/2608.07314v1)：提出TEMPO，冻结视觉-语言主干，以不同频率分别对语义投影层与动作专家进行强化学习更新，避免快速策略更新破坏高层语义表示。在CALVIN基准与真实操作任务上，其持续优于预训练最优VLA模型及强化学习后训练基线，并在两项真实任务上保持更高奖励。
- [AtlasVLA：为视觉-语言-动作模型构建持久世界-自我状态建模](https://arxiv.org/abs/2608.06729v1)：该研究提出 AtlasVLA，以 4D 持久世界状态记忆与自我工作状态记忆的双记忆架构，让模型从反应式操作转向主动推理。在 LIBERO、RLBench 和真实基准上达到最优，仅用手腕相机即在 LIBERO-Long 提升 9.4%、真实长程任务提升 17.5%。
- [ω-0：实现人形机器人移动与操作并行的潜在预测世界动作模型](https://arxiv.org/abs/2608.06375v1)：提出 ω-0，一个全身潜在预测世界动作模型，直接由语言指令、视觉与本体状态生成可执行的全身动作隐变量。在 11 项真实家庭任务上，单一模型即优于模仿学习、VLA 与人形基线。

## 信源质量变化

- 已启用 13 个；观察 28 个；暂停 2 个；达到晋升条件 1 个。

## 项目指标

- 日历覆盖：11/30（37%）；已归档运行成功：11/11（100%）
- 首页有效条目：4；A/B 级证据比例：100%；公司档案覆盖：3 家。

## 待验证候选

- 有 15 条高质量候选停留在 Review 队列；它们不会进入首页或本周结论，欢迎补充官网、投资方公告、第二独立来源或论文元数据。

---

*GitHub Star、访问量与来源需要另行授权 GitHub Traffic API；未配置时不会以 0 展示。*
