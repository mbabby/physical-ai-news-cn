# 物理 AI 周报 · 2026-W32

> 截止 2026-08-08。只纳入主体明确、中文事实简介完整、且具 A/B 级非线索证据的公开条目。

## 新增事件

- **Google DeepMind** · [谷歌 DeepMind 推出 Gemini Robotics 2，强化自适应机器人能力](https://spectrum.ieee.org/video-robot-gemini2-ai-robot)：Gemini Robotics ER 2 可帮助机器人推理、协作并解决现实世界任务，在视频理解、工具编排与多机器人协作方面实现跨越式进步，面向机器人应用。
- **NVIDIA** · [日本机器人与制造业领军企业基于NVIDIA Cosmos推进物理AI前沿](https://nvidianews.nvidia.com/news/japans-robotics-and-manufacturing-leaders-build-on-nvidia-cosmos-to-advance-physical-ai-frontier)：英伟达宣布，日本物理AI领军企业正基于其Cosmos、Isaac、Metropolis和Jetson平台，加速在制造、出行、基础设施及机器人领域部署智能机器。
- **Agility Robotics** · [人形机器人公司Agility Robotics将借SPAC上市，CEO称短期内不会承诺机器人进入家庭](https://techcrunch.com/2026/07/05/this-humanoid-robotics-company-is-going-public-but-its-ceo-isnt-promising-a-robot-in-your-home-anytime-soon/)：Agility Robotics计划通过SPAC上市。与其他追逐高估值的人形机器人初创公司不同，该公司押注执行力，其CEO表示近期不会承诺让机器人走进家庭。
- **Agility Robotics** · [Agility Robotics 在特斯拉“后院”插上旗帜](https://techcrunch.com/2026/07/17/agility-robotics-plants-its-flag-in-teslas-backyard/)：机器人公司 Agility Robotics 正在美国加利福尼亚州弗里蒙特开设一座新的训练中心，专门用于训练其 Digit 机器人。

## 融资与并购

- 本周暂无满足公开门槛的融资或并购事件。

## 产品与部署

- **Google DeepMind** · [谷歌 DeepMind 推出 Gemini Robotics 2，强化自适应机器人能力](https://spectrum.ieee.org/video-robot-gemini2-ai-robot)：Gemini Robotics ER 2 可帮助机器人推理、协作并解决现实世界任务，在视频理解、工具编排与多机器人协作方面实现跨越式进步，面向机器人应用。
- **NVIDIA** · [日本机器人与制造业领军企业基于NVIDIA Cosmos推进物理AI前沿](https://nvidianews.nvidia.com/news/japans-robotics-and-manufacturing-leaders-build-on-nvidia-cosmos-to-advance-physical-ai-frontier)：英伟达宣布，日本物理AI领军企业正基于其Cosmos、Isaac、Metropolis和Jetson平台，加速在制造、出行、基础设施及机器人领域部署智能机器。
- **Agility Robotics** · [人形机器人公司Agility Robotics将借SPAC上市，CEO称短期内不会承诺机器人进入家庭](https://techcrunch.com/2026/07/05/this-humanoid-robotics-company-is-going-public-but-its-ceo-isnt-promising-a-robot-in-your-home-anytime-soon/)：Agility Robotics计划通过SPAC上市。与其他追逐高估值的人形机器人初创公司不同，该公司押注执行力，其CEO表示近期不会承诺让机器人走进家庭。
- **Agility Robotics** · [Agility Robotics 在特斯拉“后院”插上旗帜](https://techcrunch.com/2026/07/17/agility-robotics-plants-its-flag-in-teslas-backyard/)：机器人公司 Agility Robotics 正在美国加利福尼亚州弗里蒙特开设一座新的训练中心，专门用于训练其 Digit 机器人。

## 研究前沿

- [超越扁平策略：面向机器人操作具身智能体的分层后训练](https://arxiv.org/abs/2608.05999v1)：研究提出分层后训练框架HiRoC，解耦高层任务规划与低层动作执行，规划器生成子目标，执行器对齐后经强化学习持续改进。在多个机器人操作基准上，其表现持续优于强基线。
- [GAUGE：衡量物理仿真引擎与视频世界模型物理保真度的测量基准](https://arxiv.org/abs/2608.05948v1)：提出GAUGE基准，以真实轨迹与标定物理元数据，联合诊断数值仿真器与视频世界模型对真实物理的复现与偏离。对Isaac Sim、Genesis、Newton及6个图生视频模型的评测显示，冲击接触、布料快速运动与体积形变偏差最大。
- [BridgeVLA++：带时空记忆的数据高效 3D 视觉语言动作框架](https://arxiv.org/abs/2608.05042v1)：该研究在 BridgeVLA 上加入统一时空记忆架构，以建模持久空间上下文与时间交互历史。该框架在两个记忆依赖基准上达到最优，并在真实机器人平台与双臂操作中得到验证。
- [PAC-MAN：感知感知的CBF-RL框架实现人形机器人躲避球全身安全](https://arxiv.org/abs/2607.28623v1)：研究提出感知感知的PAC-MAN框架，将控制屏障安全与机载深度感知结合，实现人形机器人全身躲避来球。该策略在Unitree G1上零样本真机部署，成功躲避95%的投球。
- [RedFlow：将失败经验重定向为动作级纠正的流匹配 VLA 策略](https://arxiv.org/abs/2607.27782v1)：RedFlow 是面向流匹配 VLA 策略的细粒度离线强化学习框架，将失败经验转化为动作级纠正监督。在 LIBERO 基准和三项真实任务中，成功率从 56.7% 提升至 74.7%。

## 信源质量变化

- 已启用 12 个；观察 10 个；暂停 2 个；达到晋升条件 1 个。

## 项目指标

- 日报成功率：100%（8/8 个已归档运行）
- 首页有效条目：4；A/B 级证据比例：100%；公司档案覆盖：3 家。

## 待验证候选

- 有 7 条高质量候选停留在 Review 队列；它们不会进入首页或本周结论，欢迎补充官网、投资方公告、第二独立来源或论文元数据。

---

*GitHub Star、访问量与来源需要另行授权 GitHub Traffic API；未配置时不会以 0 展示。*
