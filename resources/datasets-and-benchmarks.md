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

- [PhyAI：边缘实时物理 AI 推理与云端可扩展 rollout 的统一引擎](https://arxiv.org/abs/2608.03682v2) · arXiv · Robotics · 2026-08-04<br>PhyAI 用单一运行时统一车载、边缘与云端部署，在同一套代码上运行 VLA 与 WAM 模型。其在 pi0、pi0.5、GR00T N1.7 等官方实现上取得 1.40x–4.65x 加速，并在 LIBERO 基准上给出分析，代码与基准已开源。

- [BWM：面向机器人学习的低成本高保真世界模拟器](https://arxiv.org/abs/2607.29302v1) · arXiv · Robotics · 2026-07-31<br>BWM 是开源的低成本高保真世界模拟器，以动作条件化自回归预测未来观测，可扩充模仿学习数据并闭环评估策略，在 WorldArena 挑战赛中位列第一。

- [AtVLA：面向精细操控的自适应视觉细化](https://arxiv.org/abs/2608.02197v1) · arXiv · Robotics · 2026-08-03<br>研究在视觉编码器加入可学习寄存器token，并以动作不确定性触发局部高分辨率重编码来修正注意力。在 LIBERO、SimplerEnv 与单视角真机基准上，平均成功率由94.2%升至98.4%、真机由46.5%升至69.0%，计算仅约1.4-1.6倍。

- [ReTouch：在线精调触觉预测赋能接触型灵巧操作](https://arxiv.org/abs/2608.01824v1) · arXiv · Robotics · 2026-08-03<br>ReTouch 将在线精调的触觉预测融入视觉语言动作模型，通过执行时反馈闭环修正动作，在真实机器人接触型操作任务中成功率较最强基线提升18.4至23.8个百分点。

- [WAM-Diff2：以分层自回归到扩散蒸馏实现高效自动驾驶VLA模型](https://arxiv.org/abs/2608.01035v1) · arXiv · Robotics · 2026-08-02<br>WAM-Diff2通过三阶段分层蒸馏将自回归VLA模型转为并行离散扩散模型，在保持性能的同时缓解曝光偏差，解码提速2.8倍，结合系统优化最高加速15.1倍。

- [PAC-MAN：结合机载感知的 CBF-RL 人形机器人全身安全躲避球框架](https://arxiv.org/abs/2607.28623v1) · arXiv · Robotics · 2026-07-30<br>该框架将控制屏障安全与机载感知结合，仅凭头部相机的分割深度即可躲避来球，在 Unitree G1 上零样本部署，真实环境成功率达 95%。

- [RedFlow：将失败经验重定向为动作级纠正的流匹配 VLA 策略](https://arxiv.org/abs/2607.27782v1) · arXiv · Robotics · 2026-07-30<br>RedFlow 是面向流匹配 VLA 策略的细粒度离线强化学习框架，将失败经验转化为动作级纠正监督。在 LIBERO 基准和三项真实任务中，成功率从 56.7% 提升至 74.7%。

## 排序与收录

- 核心资源：先按行业影响与可复用性排序，再按类别组织。
- 自动更新：相关性、官方/开源信源等级、发布活跃度、发布时间四项综合排序。
- 仅保留可追溯链接；自动条目进入更新雷达，不会自动替换核心库。
