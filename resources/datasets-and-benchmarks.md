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

- [OrthoSkillVLA：基于梯度引导技能子空间适配的持续技能学习](https://arxiv.org/abs/2608.19589v1) · arXiv · Robotics · 2026-08-20<br>OrthoSkillVLA 对 VLM 与动作头分别施加子空间约束，并引入特征感知 MoE 解码器为各技能分配专家，实现无需演示回放的持续技能学习。大量仿真与真实机器人实验及消融表明，该方法在学习新技能时能更好保留旧技能。

- [HiPHI：大规模高精度人体运动与物体交互基准数据集](https://arxiv.org/abs/2608.16222v1) · arXiv · Robotics · 2026-08-17<br>研究发布HiPHI数据集，以光学动捕采集600余小时亚毫米级精度的全身运动与物体交互数据。配套基准的分析显示其运动覆盖显著超过现有数据集并保持高保真交互质量。

- [NestDex：结合辅助遥操作与嵌套策略学习实现灵巧操作](https://arxiv.org/abs/2608.13362v1) · arXiv · Robotics · 2026-08-13<br>NestDex 提出嵌套策略学习框架，操作者借助已学习的手部技能与离合器辅助采集演示，再训练可独立部署的外部视觉运动策略。真实世界灵巧操作实验显示其提升了演示的可靠性与效率，支持有效的自主策略学习。

- [H2R-Bench：评测世界模型中人到机器人操作视频生成的基准](https://arxiv.org/abs/2608.13049v1) · arXiv · Robotics · 2026-08-13<br>提出 H2R-Bench，评测视频世界模型将第一视角人手操作演示转化为指定机器人本体操作视频的跨本体生成能力。对 11 个先进模型在 6 类操作任务与 2 种机器人本体上的评测表明，现有模型在本体一致性、功能交互和任务执行上仍明显不足。

## 排序与收录

- 核心资源：先按行业影响与可复用性排序，再按类别组织。
- 自动更新：相关性、官方/开源信源等级、发布活跃度、发布时间四项综合排序。
- 仅保留可追溯链接；自动条目进入更新雷达，不会自动替换核心库。
