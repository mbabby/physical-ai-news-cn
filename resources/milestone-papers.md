# 业界里程碑论文与精读

这不是一份“论文数量清单”，而是一张面向物理 AI 开发者的技术路线图。入选条件是：改变了机器人学习的数据、模型、控制或落地范式，并能帮助读者理解当前 VLA、世界模型与具身基础模型的来源。

每篇均按“摘要—为什么必读—里程碑原因”阅读；建议先读带 **核心** 标记的六篇。

## 1. 世界模型：让机器人先理解、再行动

### [World Models](https://arxiv.org/abs/1803.10122) · 2018

**作者：** David Ha、Jürgen Schmidhuber

**摘要：** 将智能体拆成视觉压缩器（VAE）、潜变量动力学模型（MDN-RNN）与控制器；控制器可在模型生成的“梦境”中被优化。

**为什么必读：** 它给出了今天“预测世界—规划动作”范式最直观的原型。读它能快速理解后续世界模型为什么强调表征、动力学与控制的解耦。

**里程碑原因：** 把环境建模从辅助模块提升为策略学习的训练场，为 Dreamer、视频世界模型和面向机器人的预测式控制提供了清晰框架。

### [DreamerV3: Mastering Diverse Domains through World Models](https://arxiv.org/abs/2301.04104) · 2023

**作者：** Danijar Hafner 等

**摘要：** 在同一套算法与超参数下，将循环状态空间模型、想象轨迹学习与 actor-critic 训练扩展到多类复杂领域。

**为什么必读：** 它是理解现代 latent world model 工程化做法的高质量入口：哪些组件稳定、如何在想象轨迹里更新策略、为什么归一化和尺度会决定泛化。

**里程碑原因：** 证明世界模型不只是某个环境上的技巧，而可以成为跨任务、跨领域的可复用学习范式。

## 2. VLA 与通用机器人策略：从单任务控制到基础模型

### [RT-1: Robotics Transformer for Real-World Control at Scale](https://arxiv.org/abs/2212.06817) · 2022 · **核心**

**作者：** Anthony Brohan 等（Google Robotics）

**摘要：** 用 Transformer 吸收真实机器人上收集的大规模、多任务数据，将视觉和指令映射为离散化动作 token，并系统评估数据量、模型容量和任务多样性对泛化的影响。

**为什么必读：** 这是“机器人也需要规模化数据与通用 Transformer”的分水岭。它具体回答了现实机器人数据该如何被一个统一策略模型消费。

**里程碑原因：** RT-1 将机器人控制从“为每项任务训练一个策略”推进到可规模化的通用策略路线，直接影响 RT-2、Open X 与后续 VLA 模型。

### [PaLM-E: An Embodied Multimodal Language Model](https://arxiv.org/abs/2303.03378) · 2023 · **核心**

**作者：** Danny Driess、Fei Xia 等（Google DeepMind）

**摘要：** 将图像、机器人状态等连续传感信息嵌入语言模型输入，与文本 token 交错训练，使同一模型同时承担具身推理、视觉问答、描述与机器人规划。

**为什么必读：** 它清楚展示“语言模型的知识”怎样被落到传感与动作空间；读完能理解 VLM/VLA 在机器人里不是简单的聊天接口。

**里程碑原因：** 把大模型、视觉、状态与机器人任务放进同一个多模态序列，奠定了具身多模态基础模型的设计语言。

### [Open X-Embodiment: Robotic Learning Datasets and RT-X Models](https://arxiv.org/abs/2310.08864) · 2023 · **核心**

**作者：** Open X-Embodiment Collaboration

**摘要：** 联合 21 家机构、22 种机器人，标准化汇集 527 项技能与 160,266 个任务，并训练 RT-X 展示跨机器人经验带来的正迁移。

**为什么必读：** 数据格式、跨本体训练与数据治理是物理 AI 落地的底座。这篇论文说明“更多数据”之外，异构机器人数据如何变得可联合训练。

**里程碑原因：** 它首次以开放协作方式把跨机器人数据与通用策略模型绑定，推动了 Open X 数据生态和跨平台 VLA 的共同语言。

### [$\pi_0$: A Vision-Language-Action Flow Model for General Robot Control](https://arxiv.org/abs/2410.24164) · 2024 · **核心**

**作者：** Kevin Black 等（Physical Intelligence）

**摘要：** 在预训练视觉语言模型上叠加 flow matching 动作生成，并以单臂、双臂和移动操作平台的多样化数据训练，覆盖零样本、语言指令和微调技能获取。

**为什么必读：** 它是观察“具身基础模型公司如何把 VLM 接到连续高自由度控制”最直接的论文案例，也展示了动作生成不必局限于自回归 token。

**里程碑原因：** 将 VLM 的互联网语义知识、流匹配控制与真实多平台数据合到一个策略中，是通用机器人控制从研究原型走向产业路线的重要信号。

## 3. 模仿学习与灵巧操作：从轨迹数据到可执行动作

### [Diffusion Policy: Visuomotor Policy Learning via Action Diffusion](https://arxiv.org/abs/2303.04137) · 2023 · **核心**

**作者：** Cheng Chi 等

**摘要：** 将机器人动作序列建模为条件扩散过程，通过迭代去噪生成多峰、连续的动作块，并在视觉运动控制任务上验证稳定性。

**为什么必读：** 当你看到机器人策略使用 diffusion / flow matching 时，这篇是最好的动作生成基础读物。它解释了为何多峰动作与时间相关轨迹不适合被简单回归平均掉。

**里程碑原因：** 它把生成式建模可靠地带进低层机器人控制，成为后续扩散策略、流匹配策略和 VLA 动作头的重要技术源头。

### [Mobile ALOHA: Learning Bimanual Mobile Manipulation with Low-Cost Whole-Body Teleoperation](https://arxiv.org/abs/2401.02117) · 2024 · **核心**

**作者：** Tony Zhao 等（Stanford）

**摘要：** 通过低成本全身遥操作采集移动双臂操作数据，并用行为克隆学习长时程家庭任务，覆盖开门、搬运与双手协作等场景。

**为什么必读：** 它把注意力拉回物理 AI 最稀缺的环节：高质量、可扩展的真实数据采集。对于要搭建数据飞轮的团队，硬件与遥操作设计比模型名称更有借鉴价值。

**里程碑原因：** 证明低成本遥操作与端到端策略可以获得高难度移动双臂能力，显著影响了后续灵巧操作数据采集和开放硬件实践。

## 建议阅读顺序

1. **入门全貌：** RT-1 → PaLM-E → Open X-Embodiment。
2. **想做通用 VLA：** Open X-Embodiment → $\pi_0$ → Diffusion Policy。
3. **想做数据/硬件闭环：** Mobile ALOHA → RT-1 → Open X-Embodiment。
4. **想做世界模型与规划：** World Models → DreamerV3，再结合 VLA 论文思考模型预测怎样服务真实控制。

> 维护原则：只收录有公开原文、对产业路线产生明确影响、且能用“摘要—必读理由—里程碑原因”说明其价值的论文。欢迎通过 PR 提交补充或修订。
