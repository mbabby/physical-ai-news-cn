# 仿真与工具

> 面向物理 AI 从业者的仿真、训练、运行时与机器人软件栈资源库。核心资源按实用性与行业影响排序；“近期更新”每日从已验证日报和重点 GitHub Releases 自动汇总，滚动保留 30 天。

## 训练与仿真平台

- [NVIDIA Isaac Lab](https://isaac-sim.github.io/IsaacLab/)：GPU 加速的机器人学习、仿真与 sim-to-real 工作流。
- [MuJoCo](https://mujoco.org/)：高性能开源物理仿真器。
- [ManiSkill](https://github.com/haosulab/ManiSkill)：GPU 并行仿真、渲染和操作训练工具。
- [RoboCasa](https://github.com/robocasa/robocasa)：面向通用家庭机器人的大规模仿真环境。

## 运行时与工程工具

- [ROS 2](https://docs.ros.org/en/rolling/)：机器人中间件、消息通信与工程工具链。
- [Gazebo](https://gazebosim.org/)：与 ROS 深度集成的机器人仿真平台。

## 近期已验证更新（自动）

- [人形机器人持物平衡的质量权衡分析与搬举控制](https://arxiv.org/abs/2607.29625v1) · arXiv · Robotics · 2026-07-31<br>研究量化了物体质量对人形机器人平衡的非线性影响，构建平衡状态域并定义临界质量与转变质量，将其作为约束融入全身轨迹优化，在仿真与实验中实现稳定搬举。

- [Track4Action：将世界中心 3D 跟踪器蒸馏进视觉语言动作策略](https://arxiv.org/abs/2608.03727v1) · arXiv · Robotics · 2026-08-04<br>Track4Action 将冻结的世界中心 3D 跟踪器特征作为对齐监督蒸馏入 VLA 策略，部署时无需跟踪器；零样本 LIBERO-Plus 达 82.3%，RoboTwin 2.0 与真实双臂任务成功率均显著提升。

- [Bernoulli-Continuation Policy：让 VLA 自适应决定继续执行还是重新规划](https://arxiv.org/abs/2608.03483v1) · arXiv · Robotics · 2026-08-04<br>该研究提出 BCP，将执行时域选择分解为继续或重规划的决策序列，在冻结基础 VLA 的情况下提升 RoboTwin 2.0 与真实机器人的操作成功率，且开销可忽略。

- [RoboReact：从生成的第一视角视频蒸馏技能，实现可泛化全身操控](https://arxiv.org/abs/2608.03387v1) · arXiv · Robotics · 2026-08-04<br>RoboReact 仅凭单张第一视角 RGB-D 图像即可合成全身操控技能，结合深度 3D 重建与视觉语言模型闭环精调，无需遥操作即可跨物体泛化并抗扰恢复。

- [Multi-View Unified Camera Fields: Geometry-Shaped Action-Facing Representations for RGB-Only Multi-Camera VLA Policies](https://arxiv.org/abs/2608.01826v1) · arXiv · Robotics · 2026-08-03<br>暂未生成中文摘要，请阅读原文。

- [知道自己正在衰老的机器：硬件感知自主智能框架 AAAI](https://arxiv.org/abs/2607.28451v1) · arXiv · Robotics · 2026-07-30<br>新研究提出 AAAI 框架，将硬件健康融入推理、规划与任务执行，让自主系统感知自身衰老并自适应调整，延长寿命、提升安全性。

- [RoboBRIDGE：将策略桥接为稳健真实世界机器人智能体的模块化框架](https://arxiv.org/abs/2607.27881v1) · arXiv · Robotics · 2026-07-30<br>RoboBRIDGE以监控、感知、规划、控制与机器人接口五模块协同，为预训练VLA提供故障恢复与异步重规划，在多项基准和真实平台上优于独立策略及现有部署。

- [FoMo-FD：基于流匹配世界模型的手术机器人模仿策略故障检测](https://arxiv.org/abs/2607.27511v1) · arXiv · Robotics · 2026-07-29<br>FoMo-FD以流匹配世界模型学习正常视觉动态，无需失败样本即可检测异常，腕部相机视角下检出率达96.6%、误报率仅1.3%。

## 排序与收录

- 核心资源：先按行业影响与可复用性排序，再按类别组织。
- 自动更新：相关性、官方/开源信源等级、发布活跃度、发布时间四项综合排序。
- 仅保留可追溯链接；自动条目进入更新雷达，不会自动替换核心库。
