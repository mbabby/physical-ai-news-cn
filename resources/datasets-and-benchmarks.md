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

- [BWM：面向机器人学习的低成本高保真世界模拟器](https://arxiv.org/abs/2607.29302v1) · arXiv · Robotics · 2026-07-31<br>BWM 是开源的低成本高保真世界模拟器，以动作条件化自回归预测未来观测，可扩充模仿学习数据并闭环评估策略，在 WorldArena 挑战赛中位列第一。

- [聚焦关键之处：视觉-语言-动作模型的自适应视觉细化](https://arxiv.org/abs/2608.02197v1) · arXiv · Robotics · 2026-08-03<br>AtVLA 向视觉编码器注入可学习寄存器 token 以消除注意力伪影，并按不确定度触发局部高分辨率细化，LIBERO 成功率由94.2%升至98.4%，真实场景由46.5%升至69.0%。

- [ReTouch：在线精调触觉预测赋能接触型灵巧操作](https://arxiv.org/abs/2608.01824v1) · arXiv · Robotics · 2026-08-03<br>ReTouch 将在线精调的触觉预测融入视觉语言动作模型，通过执行时反馈闭环修正动作，在真实机器人接触型操作任务中成功率较最强基线提升18.4至23.8个百分点。

- [WAM-Diff2：分层蒸馏将自回归VLA转化为高效扩散自动驾驶模型](https://arxiv.org/abs/2608.01035v1) · arXiv · Robotics · 2026-08-02<br>研究提出WAM-Diff2，通过三阶段分层蒸馏将自回归驾驶VLA转为多任务离散扩散模型。在驾驶理解、感知与规划基准上与自回归基线持平，解码提速2.8倍、结合系统优化达15.1倍。

- [PAC-MAN：面向人形机器人躲避球全身安全的感知感知 CBF-RL](https://arxiv.org/abs/2607.28623v1) · arXiv · Robotics · 2026-07-30<br>研究提出 PAC-MAN，将控制屏障安全约束与真实机载感知结合，实现人形机器人躲避球的全身规避，并用对抗运动先验规范规避反射。在任意连杆接触基准上接近特权状态基线，并零样本部署到真实 Unitree G1，投球躲避成功率 95%，还能借语义分割躲避不同的球。

- [RedFlow：把失败重定向为流匹配 VLA 策略的动作级纠正](https://arxiv.org/abs/2607.27782v1) · arXiv · Robotics · 2026-07-30<br>研究提出 RedFlow，用离线强化学习把失败经验转化为动作级纠正监督，微调流匹配 VLA 策略。在 LIBERO 基准与三项真实机器人任务上，成功率由 56.7% 升至 74.7%，训练样本较 PPO、GRPO、DDPO 约少一个数量级。

## 排序与收录

- 核心资源：先按行业影响与可复用性排序，再按类别组织。
- 自动更新：相关性、官方/开源信源等级、发布活跃度、发布时间四项综合排序。
- 仅保留可追溯链接；自动条目进入更新雷达，不会自动替换核心库。
