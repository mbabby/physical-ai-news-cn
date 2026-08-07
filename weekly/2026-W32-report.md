# 物理 AI 周报 · 2026-W32

> 截止 2026-08-07。只纳入主体明确、中文事实简介完整、且具 A/B 级非线索证据的公开条目。

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

- [DreamWAM：超越RGB未来预测的世界动作模型](https://arxiv.org/abs/2608.04996v1)：DreamWAM将未来预测重构为超越RGB的结构化世界建模，联合预测外观、运动、几何与语义状态，推理时仅保留RGB部署。在LIBERO、LIBERO-Plus扰动及真实世界操作任务上均超过RGB基线，代码与模型已开源。
- [PAC-MAN：面向人形机器人躲避球全身安全的感知感知 CBF-RL](https://arxiv.org/abs/2607.28623v1)：研究提出 PAC-MAN，将控制屏障安全约束与真实机载感知结合，实现人形机器人躲避球的全身规避，并用对抗运动先验规范规避反射。在任意连杆接触基准上接近特权状态基线，并零样本部署到真实 Unitree G1，投球躲避成功率 95%，还能借语义分割躲避不同的球。
- [WAM-Diff2：分层蒸馏将自回归VLA转化为高效扩散自动驾驶模型](https://arxiv.org/abs/2608.01035v1)：研究提出WAM-Diff2，通过三阶段分层蒸馏将自回归驾驶VLA转为多任务离散扩散模型。在驾驶理解、感知与规划基准上与自回归基线持平，解码提速2.8倍、结合系统优化达15.1倍。
- [RedFlow：把失败重定向为流匹配 VLA 策略的动作级纠正](https://arxiv.org/abs/2607.27782v1)：研究提出 RedFlow，用离线强化学习把失败经验转化为动作级纠正监督，微调流匹配 VLA 策略。在 LIBERO 基准与三项真实机器人任务上，成功率由 56.7% 升至 74.7%，训练样本较 PPO、GRPO、DDPO 约少一个数量级。
- [权重还是技能？机器人学习技术综述](https://arxiv.org/abs/2608.01851v1)：该综述以"权重对技能"为轴线梳理机器人学习领域，按自我改进程度对代码即策略方法进行分类，并考察了六个技术族的77个代表性系统。摘要未提供真实机器人、基准或开源证据。

## 信源质量变化

- 已启用 0 个；观察 19 个；暂停 2 个；达到晋升条件 0 个。

## 项目指标

- 日报成功率：100%（7/7 个已归档运行）
- 首页有效条目：4；A/B 级证据比例：100%；公司档案覆盖：3 家。

## 待验证候选

- 有 3 条高质量候选停留在 Review 队列；它们不会进入首页或本周结论，欢迎补充官网、投资方公告、第二独立来源或论文元数据。

---

*GitHub Star、访问量与来源需要另行授权 GitHub Traffic API；未配置时不会以 0 展示。*
