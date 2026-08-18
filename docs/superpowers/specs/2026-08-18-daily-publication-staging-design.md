# 日报发布暂存边界设计

## 目标

修复日报生成和发布校验成功、但在 `git pull --rebase` 前因公开产物未全部暂存而失败的问题。发布步骤必须覆盖当前生成器声明的全部目录，并在遗漏发生时输出具体文件而不是模糊的 Git `exit 128`。

## 设计

- 新增单一脚本 `scripts/stage-generated-publication.sh`，集中维护日报可提交产物范围。
- 暂存现有日报目录，并将 `site/data` 与 `site/feeds` 作为完整发布目录处理，覆盖 Watchlist 变化页和订阅 Feed。
- 暂存后检查整个 CI 工作树：若仍有 tracked 修改或未忽略的 untracked 文件，列出路径并失败；这样未来新增生成产物时会在 rebase 前给出可行动诊断。
- GitHub Actions 只调用该脚本，不再复制一份容易过期的 `git add` 清单。

## 验证

- 在临时 Git 仓库运行真实脚本，证明 dashboard、Watchlist 变化页、Feed 与常规日报均进入 index，且工作树无未暂存内容。
- 注入未列入发布边界的新文件，证明脚本 fail closed 并打印文件路径。
- 保留工作流契约测试，确保 Actions 调用该脚本。
- 执行 TypeScript 检查、完整测试、发布校验、健康校验和两次真实 GitHub 日报运行。
