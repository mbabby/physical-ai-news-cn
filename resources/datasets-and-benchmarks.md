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

- [PhyAI：边缘实时与云端可扩展的统一物理 AI 推理引擎](https://arxiv.org/abs/2608.03682v2) · arXiv · Robotics · 2026-08-04<br>构建统一推理引擎 PhyAI，以单一运行时经模型适配器在机载、边缘与云端多 GPU 上运行 VLA 与世界-动作模型。其较 pi0、GR00T N1.7 等官方实现提速 1.40–4.65 倍，在 LIBERO 套件上给出基准分析并开源代码。

- [BWM：面向机器人学习的低成本高保真世界模拟器](https://arxiv.org/abs/2607.29302v1) · arXiv · Robotics · 2026-07-31<br>BWM 是开源的低成本高保真世界模拟器，以动作条件化自回归预测未来观测，可扩充模仿学习数据并闭环评估策略，在 WorldArena 挑战赛中位列第一。

- [ω-0：实现人形机器人移动与操作并行的潜在预测世界动作模型](https://arxiv.org/abs/2608.06375v1) · arXiv · Robotics · 2026-08-06<br>提出 ω-0，一个全身潜在预测世界动作模型，直接由语言指令、视觉与本体状态生成可执行的全身动作隐变量。在 11 项真实家庭任务上，单一模型即优于模仿学习、VLA 与人形基线。

- [HiRoC：面向机器人操作的分层后训练框架](https://arxiv.org/abs/2608.05999v1) · arXiv · Robotics · 2026-08-06<br>研究提出分层后训练框架HiRoC，将高层任务规划与低层动作执行解耦，规划器生成子目标，执行器经子目标对齐后通过强化学习持续改进。在多个机器人操作基准上，HiRoC持续优于强基线。

- [SkillMemo：专家引导的技能记忆框架助力组合式具身操作](https://arxiv.org/abs/2608.05970v1) · arXiv · Robotics · 2026-08-06<br>SkillMemo通过专家引导的轨迹分割与技能级情景记忆，分解长程演示并检索可复用技能以改进动作预测。仿真基准与真实机器人操作实验显示，该方法持续提升DP和VLA骨干并达到领先性能。

- [JoyAI-RA 0.5：通过双重动作对齐扩展机器人操作学习](https://arxiv.org/abs/2608.05674v1) · arXiv · Robotics · 2026-08-06<br>提出通用VLWA框架JoyAI-RA 0.5，以隐式与显式双重动作对齐利用人类视频、仿真与机器人数据扩展操作学习。真实AgiBot基准上已见与未见任务均表现强劲，且随人类数据增加持续提升未见饱和。

- [BridgeVLA++：面向三维操作的数据高效、可泛化且记忆增强的视觉-语言-动作框架](https://arxiv.org/abs/2608.05042v1) · arXiv · Robotics · 2026-08-05<br>该工作为 BridgeVLA 增加统一时空记忆，以建模空间上下文与交互历史并保持数据效率和泛化。它在两个记忆依赖基准上达到最优，还支持双臂操作并经真实机器人平台验证。

- [聚焦关键之处：视觉-语言-动作模型的自适应视觉细化](https://arxiv.org/abs/2608.02197v1) · arXiv · Robotics · 2026-08-03<br>AtVLA 向视觉编码器注入可学习寄存器 token 以消除注意力伪影，并按不确定度触发局部高分辨率细化，LIBERO 成功率由94.2%升至98.4%，真实场景由46.5%升至69.0%。

## 排序与收录

- 核心资源：先按行业影响与可复用性排序，再按类别组织。
- 自动更新：相关性、官方/开源信源等级、发布活跃度、发布时间四项综合排序。
- 仅保留可追溯链接；自动条目进入更新雷达，不会自动替换核心库。
