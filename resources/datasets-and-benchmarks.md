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

- [PhyAI：边缘实时、云端可扩展的统一物理 AI 推理引擎](https://arxiv.org/abs/2608.03682v1) · arXiv · Robotics · 2026-08-04<br>研究者构建了物理 AI 推理引擎 PhyAI，以单一运行时在机载、边缘与云端部署中运行 VLA 和世界-动作模型。其在 pi0.5、GR00T N1.7 等模型上较官方实现提速 1.40 至 4.65 倍，并提供 LIBERO 基准结果与开源代码。

- [BWM: A Low-Cost High-Fidelity World Simulator for Robot Learning](https://arxiv.org/abs/2607.29302v1) · arXiv · Robotics · 2026-07-31<br>暂未生成中文摘要，请阅读原文。

- [Ego2Robot: Scalable Robot Data Synthesis from Egocentric Human Data](https://arxiv.org/abs/2608.02580v1) · arXiv · Robotics · 2026-08-03<br>暂未生成中文摘要，请阅读原文。

- [聚焦关键之处：视觉-语言-动作模型的自适应视觉细化](https://arxiv.org/abs/2608.02197v1) · arXiv · Robotics · 2026-08-03<br>AtVLA 向视觉编码器注入可学习寄存器 token 以消除注意力伪影，并按不确定度触发局部高分辨率细化，LIBERO 成功率由94.2%升至98.4%，真实场景由46.5%升至69.0%。

- [ReTouch: Empowering Contact-Rich Dexterous Manipulation with Online-Refined Tactile Prediction](https://arxiv.org/abs/2608.01824v1) · arXiv · Robotics · 2026-08-03<br>暂未生成中文摘要，请阅读原文。

- [WAM-Diff2：面向高效自动驾驶视觉语言动作模型的分层蒸馏框架](https://arxiv.org/abs/2608.01035v1) · arXiv · Robotics · 2026-08-02<br>WAM-Diff2 通过渐进式块适配、块级蒸馏和跨尺度蒸馏，将自回归自动驾驶 VLA 转为多任务离散扩散模型。多项驾驶理解、感知与规划基准显示其性能与自回归基线相当，并实现 2.8 倍解码加速。

- [WCM: A World Critic Model for Vision-Language-Action Reinforcement Learning](https://arxiv.org/abs/2607.29613v1) · arXiv · Robotics · 2026-07-31<br>暂未生成中文摘要，请阅读原文。

- [PAC-MAN: Perception-Aware CBF-RL for Whole-Body Safety in Humanoid Dodgeball](https://arxiv.org/abs/2607.28623v1) · arXiv · Robotics · 2026-07-30<br>暂未生成中文摘要，请阅读原文。

## 排序与收录

- 核心资源：先按行业影响与可复用性排序，再按类别组织。
- 自动更新：相关性、官方/开源信源等级、发布活跃度、发布时间四项综合排序。
- 仅保留可追溯链接；自动条目进入更新雷达，不会自动替换核心库。
