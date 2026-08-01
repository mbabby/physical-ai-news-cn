# 奠基视频、演讲与博客

这不是泛机器人视频清单，而是帮助理解物理 AI 技术转折点的精选材料。每项都优先选择作者、研究机构或项目团队的一手表达；演讲用于建立直觉，博客与论文页用于回到技术细节。

## 先看这 6 项

| 材料 | 类型 | 为什么值得看 |
| --- | --- | --- |
| [World Models：Can agents learn inside of their own dreams?](https://worldmodels.github.io/) | 交互式论文页 + 演讲 | 以最直观的方式讲清“学会预测世界，再在想象中训练控制器”的原型。 |
| [A Generalist Agent（Gato）](https://deepmind.google/blog/a-generalist-agent/) | DeepMind 博客 | 早期清楚地提出：同一网络可以跨任务、跨模态、跨本体输出不同类型的动作。 |
| [Gemini Robotics：Bringing AI to the physical world](https://www.youtube.com/watch?v=4MvGnmmP3c0) | 官方 YouTube | 观看 VLA 如何把视觉、语言与机器人动作放进一个可演示的系统。 |
| [Gemini Robotics 与 Gemini Robotics-ER](https://deepmind.google/blog/gemini-robotics-brings-ai-into-the-physical-world/) | 官方技术博客 | 适合补足视频背后的模型定位：通用动作与具身推理各自负责什么。 |
| [π0：Our First Generalist Policy](https://www.physicalintelligence.company/blog/pi0) | Physical Intelligence 博客 | 从产业团队视角理解 VLM、跨本体数据与 flow matching 如何组合成通用机器人策略。 |
| [How AI will step off the screen and into the real world](https://www.ted.com/talks/daniela_rus_how_ai_will_step_off_the_screen_and_into_the_real_world) | Daniela Rus · TED2024 | 用非论文语言解释 AI 从屏幕走向物理世界时，感知、控制与可靠性为何缺一不可。 |

## 按主题深入

### 1. 世界模型：机器如何形成“物理直觉”

- [World Models](https://worldmodels.github.io/) · **论文页 / 演讲**
  先看示意图和演讲，再读论文。它是理解 Dreamer、视频世界模型与“想象中训练”最好的视觉入口。
- [Why Robots Need to Make their own Experiences](https://www.ted.com/talks/oliver_groth_why_robots_need_to_make_their_own_experiences) · **Oliver Groth · TEDx**
  用 Jenga 解释机器人为何需要通过交互形成直觉，适合在阅读世界模型论文前建立问题意识。

### 2. 通用策略：从单任务机器人到可迁移能力

- [A Generalist Agent（Gato）](https://deepmind.google/blog/a-generalist-agent/) · **Google DeepMind 博客**
  关注它的统一 token 序列思路：文本、图像、按键与关节力矩都可以成为同一模型的条件和输出。
- [π0：Our First Generalist Policy](https://www.physicalintelligence.company/blog/pi0) · **Physical Intelligence 博客**
  建议结合文中的数据混合图与真实任务视频阅读；重点是理解“预训练 + 跨本体数据 + 高质量后训练”的分工。

### 3. VLA：语言、视觉和动作如何接在一起

- [Gemini Robotics：Bringing AI to the physical world](https://www.youtube.com/watch?v=4MvGnmmP3c0) · **Google DeepMind · YouTube**
  适合作为快速总览：视频展示了 VLA 的交互性、灵巧性与新场景泛化目标。
- [Gemini Robotics 与 Gemini Robotics-ER](https://deepmind.google/blog/gemini-robotics-brings-ai-into-the-physical-world/) · **Google DeepMind 博客**
  看完视频后读这篇，区分“直接产生动作的模型”和“为机器人提供具身推理的模型”。

### 4. 物理智能与人机协作：为什么机器人问题不同于纯数字 AI

- [Robots with Physical Intelligence](https://www.ted.com/talks/sangbae_kim_robots_with_physical_intelligence) · **Sangbae Kim · TEDxMIT**
  从身体、接触与运动的角度解释“物理智能”为什么比纯认知任务更难；适合硬件、控制和人形机器人方向。
- [Robots — from programming to learning](https://www.ted.com/talks/torsten_kroger_robots_from_programming_to_learning) · **Torsten Kröger · TEDxKIT**
  解释机器人为何从确定性编程转向数据驱动学习，是连接传统机器人学与现代具身学习的好入口。

## 推荐观看顺序

1. **30 分钟建立全貌：** Daniela Rus TED → Gemini Robotics 视频。
2. **理解技术主线：** World Models → Gato → π0 博客。
3. **理解实体约束：** Sangbae Kim TEDx → Torsten Kröger TEDx。
4. **回到可复现证据：** 对照阅读 [业界里程碑论文与精读](milestone-papers.md) 中对应的 World Models、RT-1、PaLM-E、Open X-Embodiment 与 π0。

> 维护原则：优先收录一手材料、能解释技术范式变化、且在今天仍有阅读价值的内容。TED/TEDx 用于建立概念与问题意识，不作为技术结论的唯一依据。
