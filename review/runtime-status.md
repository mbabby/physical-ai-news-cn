# 运行状态 · 2026-09-10

本文件用于排错，不是公开资讯内容。不会记录密钥、请求正文或模型供应商凭据。

## 信源

- 失败 · arXiv · Robotics：HTTP 429（请求频率受限）

## 服务

- LLM · **部分降级** · 请求 11，成功 5，失败 3。有效完成 5；无效模型输出 3；提供方失败 3；缓存命中 3；research 通道已熔断。
- OpenAlex · **部分降级** · 请求 36，成功 35，失败 1。部分论文元数据未能刷新，已保留原始来源数据。
- Watchlist · **部分降级** · 请求 2，成功 0，失败 2。生成 0 张新判断卡；保留 2 张上一有效版本；排除 2 家。 失败原因：invalid-shape 1，validation:unsupported-sentence-claim@falsifiers.0 1，validation:unsupported-sentence-claim@falsifiers.1 1，validation:unsupported-sentence-claim@falsifiers.2 1，validation:unsupported-sentence-claim@nextValidationPoints.1 1，validation:unsupported-sentence-claim@routeAndDependencies 1，validation:unsupported-sentence-claim@whyNow 1。
- GitHub · **成功** · 请求 1，成功 1，失败 0。社区证据 Issue 快照已刷新并通过严格校验。
- EvidenceRevalidation · **成功** · 请求 0，成功 0，失败 0。已采纳证据已完成受限复核；只有当前五项检查全部通过且匹配规范公开字段的记录可晋升。

## 提交

- 提交状态由 GitHub Actions 的“Commit updated digest”步骤报告；该步骤会同时提交日报、事件、页面数据与首页。