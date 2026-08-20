# 数据集与基准

> 面向物理 AI 从业者的真实数据、任务基准与可复现实验资源库。核心资源按实用性与行业影响排序；“近期更新”每日从已验证日报和重点 GitHub Releases 自动汇总，滚动保留 30 天。

## 通用真实数据

- [Open X-Embodiment](https://robotics-transformer-x.github.io/)：跨机构、跨本体的开放机器人数据生态。
- [DROID](https://droid-dataset.github.io/)：大规模真实世界机器人操作数据集。
- [BridgeData V2](https://rail-berkeley.github.io/bridgedata/)：面向跨场景泛化操作学习的数据集。

## 任务基准

- [LIBERO](https://libero-project.github.io/)：终身机器人学习与迁移能力基准。
- [RoboCasa](https://robocasa.ai/)：家庭环境长程操作的仿真数据与评测基准。
- [ManiSkill](https://github.com/haosulab/ManiSkill)：GPU 并行操作任务、数据和评测框架。

## 近期已验证更新（自动）

- [HumanoidVLN：面向多种人形机器人形态的物理仿真视觉语言导航基准](https://arxiv.org/abs/2608.12860v1) · arXiv · Robotics · 2026-08-13<br>研究提出基于 Isaac Sim 的 HumanoidVLN 仿真器与基准，支持四种人形机器人并生成 933 条带多风格指令的导航任务。四模型基准测试中 JanusVLN 成功率最高达 43.55%，且与 Unitree G1 的 20 组真机实验误差高度相关，代码与数据将开源。

- [HiPHI：大规模高精度人体运动与物体交互基准数据集](https://arxiv.org/abs/2608.16222v1) · arXiv · Robotics · 2026-08-17<br>研究发布HiPHI数据集，以光学动捕采集600余小时亚毫米级精度的全身运动与物体交互数据。配套基准的分析显示其运动覆盖显著超过现有数据集并保持高保真交互质量。

- [PhyAI：边缘实时与云端可扩展的统一物理 AI 推理引擎](https://arxiv.org/abs/2608.03682v2) · arXiv · Robotics · 2026-08-04<br>构建统一推理引擎 PhyAI，以单一运行时经模型适配器在机载、边缘与云端多 GPU 上运行 VLA 与世界-动作模型。其较 pi0、GR00T N1.7 等官方实现提速 1.40–4.65 倍，在 LIBERO 套件上给出基准分析并开源代码。

- [BWM：面向机器人学习的低成本高保真世界模拟器](https://arxiv.org/abs/2607.29302v1) · arXiv · Robotics · 2026-07-31<br>BWM 是开源的低成本高保真世界模拟器，以动作条件化自回归预测未来观测，可扩充模仿学习数据并闭环评估策略，在 WorldArena 挑战赛中位列第一。

- [TEMPO：面向视觉-语言-动作模型的语义-动作解耦强化学习后训练框架](https://arxiv.org/abs/2608.07314v1) · arXiv · Robotics · 2026-08-07<br>提出TEMPO，冻结视觉-语言主干，以不同频率分别对语义投影层与动作专家进行强化学习更新，避免快速策略更新破坏高层语义表示。在CALVIN基准与真实操作任务上，其持续优于预训练最优VLA模型及强化学习后训练基线，并在两项真实任务上保持更高奖励。

- [AtlasVLA：为视觉-语言-动作模型构建持久世界-自我状态建模](https://arxiv.org/abs/2608.06729v1) · arXiv · Robotics · 2026-08-07<br>该研究提出 AtlasVLA，以 4D 持久世界状态记忆与自我工作状态记忆的双记忆架构，让模型从反应式操作转向主动推理。在 LIBERO、RLBench 和真实基准上达到最优，仅用手腕相机即在 LIBERO-Long 提升 9.4%、真实长程任务提升 17.5%。

- [CrossTracer：基于VLA推理与轨迹残差自适应的跨本体导航框架](https://arxiv.org/abs/2608.06688v1) · arXiv · Robotics · 2026-08-07<br>CrossTracer提出分层跨本体导航框架，以归一化像素轨迹为统一接口，由VL-Tracer生成初始轨迹、CE-Adapter按本体条件预测残差修正。该方法在NaviTrace基准以45.68分超越Gemini-2.5-Pro约28.1%，并在轮式与腿式机器人实机部署中提升导航成功率与执行效率。

- [ω-0：实现人形机器人移动与操作并行的潜在预测世界动作模型](https://arxiv.org/abs/2608.06375v1) · arXiv · Robotics · 2026-08-06<br>提出 ω-0，一个全身潜在预测世界动作模型，直接由语言指令、视觉与本体状态生成可执行的全身动作隐变量。在 11 项真实家庭任务上，单一模型即优于模仿学习、VLA 与人形基线。

## 排序与收录

- 核心资源：先按行业影响与可复用性排序，再按类别组织。
- 自动更新：相关性、官方/开源信源等级、发布活跃度、发布时间四项综合排序。
- 仅保留可追溯链接；自动条目进入更新雷达，不会自动替换核心库。
