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

- [BWM：低成本高保真的机器人学习世界模拟器](https://arxiv.org/abs/2607.29302v1) · arXiv · Robotics · 2026-07-31<br>BWM 是开源低成本高保真世界模拟器，结合动作条件自回归预测未来观测，可用作数据引擎与策略评估器，在 WorldArena 挑战赛总排名第一，模型与代码已开源。

- [WCM: A World Critic Model for Vision-Language-Action Reinforcement Learning](https://arxiv.org/abs/2607.29613v1) · arXiv · Robotics · 2026-07-31<br>暂未生成中文摘要，请阅读原文。

- [PAC-MAN：结合机载感知的 CBF-RL 人形机器人全身安全躲避球框架](https://arxiv.org/abs/2607.28623v1) · arXiv · Robotics · 2026-07-30<br>该框架将控制屏障安全与机载感知结合，仅凭头部相机的分割深度即可躲避来球，在 Unitree G1 上零样本部署，真实环境成功率达 95%。

- [RedFlow：将失败重定向为动作级纠正的流匹配 VLA 策略](https://arxiv.org/abs/2607.27782v1) · arXiv · Robotics · 2026-07-30<br>RedFlow 是面向流匹配 VLA 策略的细粒度离线强化学习框架，把失败经验转为动作级纠正监督，在 LIBERO 及真实任务上优于基线，真实成功率由 56.7% 提升至 74.7%。

## 排序与收录

- 核心资源：先按行业影响与可复用性排序，再按类别组织。
- 自动更新：相关性、官方/开源信源等级、发布活跃度、发布时间四项综合排序。
- 仅保留可追溯链接；自动条目进入更新雷达，不会自动替换核心库。
