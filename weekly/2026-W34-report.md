# 物理 AI 周报 · 2026-W34

> 截止 2026-08-23。只纳入主体明确、中文事实简介完整、且具 A/B 级非线索证据的公开条目。

## 新增事件

- **Humanoid** · [Schaeffler 计划 2027 年量产人形机器人用减速器](https://www.therobotreport.com/schaeffler-plans-to-mass-manufacture-gearboxes-for-humanoids-in-2027/)：Schaeffler 正采用成型技术制造谐波减速器，以实现此类核心部件的规模化量产。摘要未提供真实机器人、基准或开源证据。
- **Humanoid** · [Kollmorgen 将在 RoboBusiness 逐关节解析人形机器人运动](https://www.therobotreport.com/kollmorgen-give-joint-by-joint-guide-humanoid-motion-robobusiness/)：Kollmorgen 将在 RoboBusiness 发表演讲，逐关节解析人形机器人各身体部位的运动需求与量产挑战。摘要未提供真实机器人、基准或开源证据。
- **宇树科技** · [Unitree Robotics 上市对人形机器人行业意味着什么](https://www.therobotreport.com/what-does-unitree-robotics-ipo-mean-for-humanoid-industry/)：文章探讨了 Unitree Robotics 完成 IPO 的意义，并追问哪些人形机器人公司会跟进上市。摘要未提供真实机器人、基准或开源证据。
- **Toyota Research Institute** · [Kollmorgen：工业系统如何在不提高复杂度的情况下实现高电压](https://www.therobotreport.com/how-achieve-high-voltage-industrial-systems-without-high-complexity/)：Kollmorgen 讨论了让电压系统紧密贴合具体应用需求、同时充分利用既有基础设施的重要性。摘要未提供真实机器人、基准或开源证据。
- **Humanoid** · [Unichem 收购 Loomia，加速进军人形机器人“皮肤”市场](https://www.therobotreport.com/unichem-acquires-loomia-accelerate-entry-humanoid-skin-market/)：Unichem 收购 Loomia，并与 R&Y 合作开发面向汽车与机器人应用的触觉传感器，以加快进入人形机器人“皮肤”市场。摘要未提供真实机器人、基准或开源证据。

## 融资与并购

- 本周暂无满足公开门槛的融资或并购事件。

## 产品与部署

- **Humanoid** · [Schaeffler 计划 2027 年量产人形机器人用减速器](https://www.therobotreport.com/schaeffler-plans-to-mass-manufacture-gearboxes-for-humanoids-in-2027/)：Schaeffler 正采用成型技术制造谐波减速器，以实现此类核心部件的规模化量产。摘要未提供真实机器人、基准或开源证据。
- **Humanoid** · [Kollmorgen 将在 RoboBusiness 逐关节解析人形机器人运动](https://www.therobotreport.com/kollmorgen-give-joint-by-joint-guide-humanoid-motion-robobusiness/)：Kollmorgen 将在 RoboBusiness 发表演讲，逐关节解析人形机器人各身体部位的运动需求与量产挑战。摘要未提供真实机器人、基准或开源证据。
- **宇树科技** · [Unitree Robotics 上市对人形机器人行业意味着什么](https://www.therobotreport.com/what-does-unitree-robotics-ipo-mean-for-humanoid-industry/)：文章探讨了 Unitree Robotics 完成 IPO 的意义，并追问哪些人形机器人公司会跟进上市。摘要未提供真实机器人、基准或开源证据。
- **Toyota Research Institute** · [Kollmorgen：工业系统如何在不提高复杂度的情况下实现高电压](https://www.therobotreport.com/how-achieve-high-voltage-industrial-systems-without-high-complexity/)：Kollmorgen 讨论了让电压系统紧密贴合具体应用需求、同时充分利用既有基础设施的重要性。摘要未提供真实机器人、基准或开源证据。
- **Humanoid** · [Unichem 收购 Loomia，加速进军人形机器人“皮肤”市场](https://www.therobotreport.com/unichem-acquires-loomia-accelerate-entry-humanoid-skin-market/)：Unichem 收购 Loomia，并与 R&Y 合作开发面向汽车与机器人应用的触觉传感器，以加快进入人形机器人“皮肤”市场。摘要未提供真实机器人、基准或开源证据。

## 研究前沿

- [HiPHI：大规模高精度人体运动与物体交互基准数据集](https://arxiv.org/abs/2608.16222v1)：研究发布HiPHI数据集，以光学动捕采集600余小时亚毫米级精度的全身运动与物体交互数据。配套基准的分析显示其运动覆盖显著超过现有数据集并保持高保真交互质量。
- [LAWM-3D：从人类视频学习三维感知潜在动作，构建可泛化机器人世界模型](https://arxiv.org/abs/2608.05706v1)：LAWM-3D以多视角统一动作标记、几何对齐和RGB-D重建，从人类视频学习三维感知潜在动作。实验显示其生成质量、物理一致性和泛化能力达到SOTA，但摘要未提供真实机器人、具体基准或开源证据。
- [PhyAI：边缘实时与云端可扩展的统一物理 AI 推理引擎](https://arxiv.org/abs/2608.03682v2)：构建统一推理引擎 PhyAI，以单一运行时经模型适配器在机载、边缘与云端多 GPU 上运行 VLA 与世界-动作模型。其较 pi0、GR00T N1.7 等官方实现提速 1.40–4.65 倍，在 LIBERO 套件上给出基准分析并开源代码。
- [AtlasVLA：为视觉-语言-动作模型构建持久世界-自我状态建模](https://arxiv.org/abs/2608.06729v1)：该研究提出 AtlasVLA，以 4D 持久世界状态记忆与自我工作状态记忆的双记忆架构，让模型从反应式操作转向主动推理。在 LIBERO、RLBench 和真实基准上达到最优，仅用手腕相机即在 LIBERO-Long 提升 9.4%、真实长程任务提升 17.5%。
- [HumanoidVLN：面向多种人形机器人形态的物理仿真视觉语言导航基准](https://arxiv.org/abs/2608.12860v1)：研究提出基于 Isaac Sim 的 HumanoidVLN 仿真器与基准，支持四种人形机器人并生成 933 条带多风格指令的导航任务。四模型基准测试中 JanusVLN 成功率最高达 43.55%，且与 Unitree G1 的 20 组真机实验误差高度相关，代码与数据将开源。
- [TEMPO：面向视觉-语言-动作模型的语义-动作解耦强化学习后训练框架](https://arxiv.org/abs/2608.07314v1)：提出TEMPO，冻结视觉-语言主干，以不同频率分别对语义投影层与动作专家进行强化学习更新，避免快速策略更新破坏高层语义表示。在CALVIN基准与真实操作任务上，其持续优于预训练最优VLA模型及强化学习后训练基线，并在两项真实任务上保持更高奖励。

## 信源质量变化

- 已启用 13 个；观察 27 个；暂停 3 个；达到晋升条件 2 个。

## 项目指标

- 日历覆盖：21/30（70%）；已归档运行成功：21/21（100%）
- 首页有效条目：12；A/B 级证据比例：100%；公司档案覆盖：6 家。

## 待验证候选

- 有 29 条高质量候选停留在 Review 队列；它们不会进入首页或本周结论，欢迎补充官网、投资方公告、第二独立来源或论文元数据。

---

*GitHub Star、访问量与来源需要另行授权 GitHub Traffic API；未配置时不会以 0 展示。*
