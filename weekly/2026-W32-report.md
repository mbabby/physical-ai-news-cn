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

- [借助缝线操作实现自主缝合中的柔性缝针拾取](https://arxiv.org/abs/2607.26337v1)：研究提出一种自主框架，以缝线作为辅助工具间接拾取缝针，避免器械与组织的不必要接触，即使缝针被遮挡或无法直接接近也能完成拾取。在 da Vinci Research Kit 上的多种真实环境实验表明，该框架在复杂缝线形态或缝针无法接近的情况下仍表现稳健。
- [DreamWAM：超越 RGB 未来预测的世界动作模型](https://arxiv.org/abs/2608.04996v1)：DreamWAM 将世界动作模型的未来预测从 RGB 扩展为外观、运动、几何与语义的结构化表征，训练时联合去噪，推理部署仅依赖 RGB。在 LIBERO、LIBERO-Plus 扰动及真实机器人操作上均超过 RGB 基线，真实场景平均成功率 74.4%，代码与模型已开源。
- [AtVLA：面向精细操控的自适应视觉细化](https://arxiv.org/abs/2608.02197v1)：研究在视觉编码器加入可学习寄存器token，并以动作不确定性触发局部高分辨率重编码来修正注意力。在 LIBERO、SimplerEnv 与单视角真机基准上，平均成功率由94.2%升至98.4%、真机由46.5%升至69.0%，计算仅约1.4-1.6倍。
- [PhyAI：边缘实时物理 AI 推理与云端可扩展 rollout 的统一引擎](https://arxiv.org/abs/2608.03682v2)：PhyAI 用单一运行时统一车载、边缘与云端部署，在同一套代码上运行 VLA 与 WAM 模型。其在 pi0、pi0.5、GR00T N1.7 等官方实现上取得 1.40x–4.65x 加速，并在 LIBERO 基准上给出分析，代码与基准已开源。

## 信源质量变化

- 已启用 0 个；观察 19 个；暂停 2 个；达到晋升条件 0 个。

## 项目指标

- 日报成功率：100%（8/8 个已归档运行）
- 首页有效条目：4；A/B 级证据比例：100%；公司档案覆盖：3 家。

## 待验证候选

- 有 3 条高质量候选停留在 Review 队列；它们不会进入首页或本周结论，欢迎补充官网、投资方公告、第二独立来源或论文元数据。

---

*GitHub Star、访问量与来源需要另行授权 GitHub Traffic API；未配置时不会以 0 展示。*
