# 物理 AI 资讯库

面向中文开发者的物理 AI / 具身智能资讯库：每日自动汇总产业动态，并沉淀经过人工审核的长期资源。

## 今日资讯

<!-- DAILY_DIGEST_START -->

### 最新日报 · 2026-08-01

过去 24 小时 · 3 条精选 · 投融资与产业动态优先

#### [Remotely controlled humanoid cleaning service](https://www.tau-robotics.com)

自动摘要失败：HTTP 400。请阅读原文。
*公司商业 · Hacker News · Robotics · 07-31 · #产业 · #humanoid*

#### [Americans worry robots will take jobs, but not theirs](https://www.semafor.com/article/07/31/2026/americans-worry-robots-will-take-jobs-but-not-theirs-survey-shows)

自动摘要失败：HTTP 400。请阅读原文。
*公司商业 · Hacker News · Robotics · 07-31 · #产业 · #robot*

#### [High school axes plans to deploy AI robot called Sally after ties to sex dolls](https://www.dailymail.com/news/article-16017467/humanoid-robot-teacher-new-york-axes-plan.html)

自动摘要失败：HTTP 400。请阅读原文。
*部署案例 · Hacker News · Humanoid · 07-31 · #落地 · #robot*



<!-- DAILY_DIGEST_END -->

自动关注产品发布、公司商业动态、落地部署与开源项目；研究和数据资讯作为补充。每天北京时间 08:30 自动运行，最多精选 10 条；请以原始来源为准。

## 本周人工精选

本栏目由维护者每周从日报中手工挑选，记录真正影响行业的发布、部署与开源进展。

- 2026-W31：仓库初始化，等待首轮审核。

## 常青资源

- [公司与团队](resources/companies.md)
- [模型与开源项目](resources/models-and-open-source.md)
- [机器人与硬件](resources/robots-and-hardware.md)
- [仿真与工具](resources/simulation-and-tools.md)
- [数据集与基准](resources/datasets-and-benchmarks.md)
- [学习资料与社区](resources/learning-and-community.md)

## 收录标准与投稿方式

收录对象必须与机器人、具身智能、人形机器人、物理世界模型、机器人学习或其产业落地直接相关；优先采用官方公告、项目发布页和可信技术媒体。我们只保存链接、元数据与简短摘要，不转载原文。

欢迎提交资讯源、资源条目和分类修正。请先阅读 [贡献指南](CONTRIBUTING.md)，再通过 Issue 或 PR 提交；每条内容需要原始链接、简短中文说明和所属分类。

## 本地运行

```bash
corepack enable
pnpm install --frozen-lockfile
LLM_API_KEY=... LLM_BASE_URL=https://your-compatible-api/v1 LLM_MODEL=... pnpm start
```

未配置模型时仍可抓取和生成日报，但将显示原文标题并标记为未生成中文摘要。

## 自动化配置

在 GitHub 仓库的 Actions Secrets / Variables 中配置 `LLM_API_KEY`、`LLM_BASE_URL` 和 `LLM_MODEL`。工作流支持定时运行与手动触发。
