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

- [利用缝线操控实现自主缝合中的缝针拾取](https://arxiv.org/abs/2607.26337v1) · arXiv · Robotics · 2026-07-28<br>该自主缝合框架以缝线为辅助间接拾取缝针，避免器械接触组织，即使缝针被遮挡也能完成抓取，并在 da Vinci Research Kit 多种真实条件下验证表现稳健。

- [知道自己正在衰老的机器：硬件感知自主智能框架 AAAI](https://arxiv.org/abs/2607.28451v1) · arXiv · Robotics · 2026-07-30<br>新研究提出 AAAI 框架，将硬件健康融入推理、规划与任务执行，让自主系统感知自身衰老并自适应调整，延长寿命、提升安全性。

- [面向协作机器人的目标导向语义通信演示](https://arxiv.org/abs/2607.28256v1) · arXiv · Robotics · 2026-07-30<br>论文展示机器人与边缘端语义通信测试平台：机器人端用VQ-VAE令牌压缩图像，边缘端重建并结合深度、位姿生成语义地图，实现42.67倍压缩。

- [RoboBRIDGE：将策略桥接为稳健真实世界机器人智能体的模块化框架](https://arxiv.org/abs/2607.27881v1) · arXiv · Robotics · 2026-07-30<br>RoboBRIDGE 以五个协同模块将预训练 VLA 编排为稳健机器人智能体，实现故障恢复与异步重规划，在多基准及真实平台表现更优。

- [FoMo-FD：基于流匹配世界模型的手术机器人模仿策略故障检测](https://arxiv.org/abs/2607.27511v1) · arXiv · Robotics · 2026-07-29<br>FoMo-FD以流匹配世界模型学习正常视觉动态，无需失败样本即可检测异常，腕部相机视角下检出率达96.6%、误报率仅1.3%。

## 排序与收录

- 核心资源：先按行业影响与可复用性排序，再按类别组织。
- 自动更新：相关性、官方/开源信源等级、发布活跃度、发布时间四项综合排序。
- 仅保留可追溯链接；自动条目进入更新雷达，不会自动替换核心库。
