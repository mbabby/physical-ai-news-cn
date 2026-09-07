# Core 30 真实回填与跨链路验收

实际验收日期：**2026-09-07**。文件名沿用计划日期。基线提交 `3b18ccd0dbd2ba977b3b4a109de109be33ea4e31`；本轮为其上的未提交开发改动，无新增提交、推送、合并或上线。

## 结论与边界

**最终分支复审状态：本地交付通过。** 用户授权的日期专项已修复最后一个 P2：源日历日期在导入及规范迁移中保持 `YYYY-MM-DD`，不再伪造 UTC 零点。上海凌晨 01:00 的完整生成、普通无回执再生及回执重放均保留正确发生日/披露日，并形成完整 Brief；真实未来时间戳仍不符合日期门槛。独立复审 14/14 通过，无新增阻塞；根代理重新执行全量 **1004/1004**、TypeScript 与 diff 检查均通过。先前的撤回任务重新打开问题也已复审通过。代码和分支保留，未提交、合并、推送或发布；本地通过不代表线上验收。

日期修复后的真实 30 主体验收重新执行于 `/tmp/core30-batches.1OLoIm/acceptance-summary.json`，撤回副本 `/tmp/core30-withdrawal.iQqqSo`。结果仍为 30 个身份、16 个完整 Brief，9 文件在回执重放和普通再生间逐字节一致；撤回后 16→15，其余 29 主体不变，两份发布工件校验通过（离线 degraded）。下文保留此前各轮路径及测试记录以便审计。

本地代码及真实证据离线验收通过：30/30 主体有具名官方身份证据，16/30 完整 Brief（53.3%），达到至少 15/30 的数据目标。身份覆盖、完整研究与单字段已知数分别计量；不把覆盖配置的 30 行视为 30 份完整研究。

“完整”仅表示身份证据、至少一项直接核验字段和具明确事件/披露日期的批准分析满足当前契约，并非融资、产品、客户、部署全部已知。8 类字段 × 30 主体共 240 个槽位，33 已知、207 未知，0 已知冲突；未知不等于没有。法定主体、经营地区及集团关系的缺口仍保留，主页不被当作这些专项结论的证明。

首轮审阅修复后隔离实际生成保存在 `/tmp/core30-batches.w6s3Yp`，完整机器可读结果为其 `acceptance-summary.json`；陈旧审阅输入重放的单证据撤回副本 `/tmp/core30-withdrawal.ebGGZb`。最终两项修复另以原基线副本 `/tmp/core30-final-withdrawal.PLhtfJ` 验证不传审阅输入的普通撤回，结果为其 `final-fix-probe.json`。根代理浏览器验收使用 `/tmp/core30-acceptance.LLgZye/site`。没有手改工作树的规范 JSON、README 或生成页面来提高覆盖数；默认日报不自动消费私有审阅输入。

## 三批实际结果

按现有 T3 地区/层级轮转顺序，每批 10 个主体。每个主体均有身份证据输入，未采纳商业事件者逐项保留阻塞；初批不是以研究候选冒充商业事件。

| 批次 | 本批事件输入 / 完整 Brief | 累计身份 / 完整 Brief | 本批资本已知字段 | 本批产品已知字段 | 本批客户、部署、阶段已知字段 | 本批未知槽位 / 冲突 |
|---|---|---|---:|---:|---:|---|
| 1 | 7 / 7 | 10 / 7 | 7 | 3 | 2 | 68 / 0 |
| 2 | 4 / 4 | 20 / 11 | 5 | 2 | 1 | 72 / 0 |
| 3 | 5 / 5 | 30 / 16 | 4 | 2 | 7 | 67 / 0 |

批 1：Unitree、Figure、NEURA、NVIDIA、Google DeepMind、XPENG Robotics、Tesla、Agibot、Physical Intelligence、ANYbotics。Google DeepMind 保留研究候选；Tesla、Physical Intelligence 缺可采纳商业字段事件。

批 2：Meta、Toyota Research Institute、Galbot、Skild AI、Wandercraft、Hugging Face、Galaxea、Apptronik、PAL Robotics、Intrinsic。Meta 为伙伴主导原型；Intrinsic 为当前账本未支持的重组；其余未形成 Brief 者缺可采纳事件输入。

批 3：X Square Robot、Agility Robotics、Mentee Robotics、UBTECH、Dexterity、Fourier Intelligence、LimX Dynamics、EngineAI、Robotera、Deep Robotics。未形成 Brief 者仍缺当前可采纳事件输入，不从主页、旧标题或研究配额补数字。

| 累计批次 | 中国完整率 | 北美完整率 | 其他地区完整率 | 商业层完整率 | 平台层完整率 | 战略层完整率 |
|---|---|---|---|---|---|---|
| 1 | 3/12 | 2/12 | 2/6 | 5/22 | 1/5 | 1/3 |
| 2 | 3/12 | 5/12 | 3/6 | 8/22 | 2/5 | 1/3 |
| 3 | 6/12（50%） | 7/12（58.3%） | 3/6（50%） | 13/22（59.1%） | 2/5（40%） | 1/3（33.3%） |

最终身份完成率各地区、各层级均 100%。已知字段分别为：轮次 6、融资金额 6、估值 4、投资方 0、产品 7、客户 3、部署 5、验证阶段 2。验证阶段仅为 Agibot 官方量产下线和 Agility 官方明确成功试点；不把计划扩大部署视为量产。

## 一手映射与资金审阅

私有输入依次保留 `review/core30-identity-audit.json`、`review/core30-backfill-evidence.json` 候选及 `review/core30-reviewed-backfill.json` 显式审阅映射。后者只由操作者显式传给生成器，不能自动恢复已撤回或冲突的规范 URL。进入资本账本的全部已知字段均逐项来源审阅，不使用自动摘要当独立证明：

| 主体 / 原始来源 | 接受的资本字段 | 保留的限制 |
|---|---|---|
| [Figure](https://www.figure.ai/news/series-c) | Series C；>10 亿美元承诺资本；390 亿美元投后估值 | 不等于现金到账；估值另有正文第 15 行定位 |
| [Skild AI](https://www.skild.ai/blogs/series-c) | Series C；14 亿美元；>140 亿美元估值 | 公司披露；估值另有正文第 4 行定位 |
| [Apptronik](https://apptronik.com/news-collection/apptronik-closes-over-935-million-series-a) | 5.2 亿美元 Series A-X 扩展轮 | >9.35 亿是累计 Series A，不再当新一轮相加 |
| [LimX Dynamics](https://www.limxdynamics.com/en/news/BK000057) | 2 亿美元 Series B | 估值与投资方字段未知 |
| [XPENG Robotics](https://www.xpeng.com/pressroom/news/01a03797fccda01e0de68a02a256006a) | >9 亿美元已签股份购买协议、拟融资；>63 亿美元投后估值 | 未确认交割/到账；资金归机器人业务。正文第 21–22 行支持估值，后文 Upon closing 修饰控制权/并表，不错误套用为该估值的时间句 |
| [NEURA](https://neura-robotics.com/record-series-c/) | Series C；最高 14 亿美元 | 仅宣布的融资上限，不等于全额收到 |
| [X Square Robot](https://x2robot.com/en/news/6a44b3d9af85192fc0a3abd8) | 连续四轮最终 Series C；>28 亿美元估值 | 融资金额未知；来源另列 200 亿元人民币，不相加、不主张精确汇率 |

其余来源与字段：Unitree 官方公司时间线的 As2 产品；NVIDIA 官方开放人形机器人参考设计；Hugging Face LeRobot v0.5.0；ANYbotics 官方 EMEA 部署/电厂测试；Wandercraft–SAPA 计划部署合作；Dexterity–FedEx Hagerstown 部署；Agility–TMMC 成功试点后服务协议；Agibot 第 10,000 台通用机器人累计下线；UBTECH–Hitachi 现场测试。每项 URL、定位摘录、字段值和限制均在显式审阅输入中。

不采纳的额外字段：Dexterity Foresight/Mech 产品名没有本次独立定位摘录，因此不进入产品字段；NVIDIA 仅采用摘录直接支持的“开放人形机器人参考设计”，不扩大为已上市整机。Agibot 不等于 10,000 台 A3 售出/部署。身份审阅中的 Agibot 旧域名直接跳转及相同法定运营主体单独保留为显式迁移证据；不从集团继承融资。

日期仅 Unitree 2026-02-24、Agibot 2026-03-28 有明确发生日；其余 14 项保守保留发生日期未知。Unitree 页面发布时间未知，其余按审阅页面披露日期保留。七个资金页面的日期不被自动升级为实际融资发生日。全部首次回填 `lastMaterialChangeAt=unknown`；不让首次出现/运行时钟制造最新变化。因此 Core Feed **0 条**是合法结果，不补位。

审阅输入的 Sep7 时间证明该证据已经被观察并核验，故规范 `firstSeenAt` 与 `lastVerifiedAt` 都保留该有记录的审阅时间。Sep8 才首次导入时也不把核验时间冒充成 Sep8、不拿页面历史发布时间填首次观察。独立审阅提出此跨日情况后，已增加使用全部 16 项真实输入的次日首次生成与重放回归。

## 生成、幂等和纠错实测

固定时钟 `2026-09-07T01:00:00.000Z`，使用既有安装依赖及空采集器，阻断外部 fetch/DNS，移除服务凭据后恢复进程环境。运行态为 `degraded`：LLM/OpenAlex/GitHub 未配置、Watchlist 无模型而不生成新判断；并非生产服务健康证明。

- 三批均经普通事实门槛、公司/双账本、Core 工件与整组发布事务，而非改写公开镜像。
- 对 9 个文件比较 SHA-256：规范事件、规范公司、Company Claim Ledger、当前 Core、公开历史、内部历史、回填 checkpoint、Core Feed、README。相同审阅输入第二次生成及不传审阅输入的普通离线再生均逐字节一致。
- 撤回 XPENG 单条证据后再次传入陈旧审阅输入：规范 tombstone 留存，完整 Brief 16→15，README、dashboard、dossiers、route competition、Core Feed 不再保留相关正向事实；公开历史有 `source-withdrawn`，其余 29 主体已知事实逐项不变。
- 最终回归另从原始三批基线复制后撤回 XPENG 单条证据，**不传审阅输入**普通生成：只有已 checked 的 capital 任务重开为 pending，保留原处置、证据、动作时间和更正 ID；其余 119 个任务和 29 个主体已知事实不变。Core 活跃 seed 为 1，后续相同时钟普通再生的上述 9 文件加 review cases/assignments 共 11 文件逐字节一致，两次 `validateRelease` 均通过。旧更正不反复重开已处理任务；25 项紧急重开测试仍只输出 20 个活跃任务。
- 原目录和撤回复本 `validateRelease` 均通过：快照日期 2026-09-07、公开论文 6 条、运行状态 degraded。历史论文缓存不计入 16 个真实回填事件。
- 8 个既有 HTML 入口均保留：index、companies、research、subscribe、weekly、contribute、watchlist-changes 以及新增 Core 页。真实 IAB 检查由根代理记录，含三层分组、地区/资本筛选、XPENG 明确发生/披露区别、一手 HTTPS 链接、390/1440 宽度无横向溢出。资本数值补充字段标签后复测通过。

## 代码检查

- `node node_modules/typescript/bin/tsc --noEmit`：通过。
- `node --import tsx --test tests/**/*.test.ts`：最终两项修复后 **1002/1002 通过**，无失败、取消或跳过；日志 `/tmp/core30-final-full-suite.log`。相对首轮修复的 999 项新增 3 项测试：上海凌晨日期、紧急任务重开/处置保留、字段级公开冲突；既有完整生成测试增加无审阅输入撤回及幂等断言，不另计测试数。
- 最终扩展聚焦回归（backfill、publication、reviewed-ingest、corrections、review cases/assignment 及三项 release 合约文件）：**107/107 通过**，日志 `/tmp/core30-final-affected.log`；安装版 tsc 与 `git diff --check` 通过。日期回归确认 `2026-09-06T17:00:00Z` 时允许上海当天 `2026-09-07`，拒绝明天与畸形日期。
- `node --import tsx --test tests/release-contract.test.ts tests/fixture-mode-cli.test.ts tests/stage-publication.test.ts`：**26/26 通过**。
- 针对日期、事实门槛、审阅入口、渲染、事件中心、dashboard 的聚焦回归：69/69 通过。
- 新回归覆盖来源/主体拒绝、日期未知、显式 kind/旧别名、撤回/冲突不可被旧输入恢复、事务失败整组回滚、资金标签与 checkpoint。审阅修复后聚焦 58/58 通过，补测次日首次导入及单 B 拒绝、A 与独立 B+B 接受、发现层拒绝。最终结果日志分别在 `/tmp/core30-t8-full-suite-fix1.log`、`/tmp/core30-t8-release-tests.log`、`/tmp/core30-t8-real-acceptance-fix1.log`。
- `pnpm run check` 的环境包装器试图自动安装后以网络/非 TTY 错误中止，未完成安装；node_modules 符号链接保持原状。未声称 pnpm 命令成功，也未继续尝试 `pnpm test`/`pnpm exec`；使用上述已安装工具的等效命令完整执行检查。

## 容量、阻塞与交接

三批基线私有 checkpoint 为 50 checked、70 blocked、0 pending；blocked 是明确补证缺口，非无人需要处理。基线既有共享 review 队列共 40 项，20 assigned、20 unassigned，维护者容量 20/20 已满；基线本轮末无 Core 活跃 case。最终普通撤回探针则为 **49 checked、70 blocked、1 pending**，新增的 XPENG capital 紧急任务进入同一共享队列：41 项、20 assigned、21 unassigned，容量仍为 20/20。两组计数对应不同证据状态，不将撤回后的 15 份 Brief 或额外复核任务混入 16 份完整 Brief 的三批基线。70 个 Core blocked 项没有新增人工负责人，应视为未分配等待补证，不能因 `ownerRole=maintainer` 声称已有人处理。

14 个未完整主体：Galbot、Galaxea、Fourier Intelligence、EngineAI、Robotera、Deep Robotics、Physical Intelligence、Meta、Intrinsic、Tesla、Toyota Research Institute、Google DeepMind、PAL Robotics、Mentee Robotics。前三类特殊语义阻塞已单列；其余缺可采纳的本主体字段事件。没有为凑数调用第三方/社交线索、猜金额、填客户或改变研究 Passport。

来源可访问性由 2026-09-06/07 的一手源审阅记录支持；本轮离线验证没有实时采集请求，不能把 0 采集失败等同于没有限流。新来源不可达/限流时继续 blocked，禁止自动降门槛。

复现隔离三批：`node --import tsx .superpowers/sdd/2026-09-06-core30-investment-research/run-t8-acceptance.ts`（私有验收辅助脚本）。正式显式回填入口：`node --import tsx scripts/core30-reviewed-backfill.ts --output-root <已存在空隔离目录> --seed-root <仓库目录> --input review/core30-reviewed-backfill.json --now 2026-09-07T01:00:00.000Z`。随后不传 `--seed-root` 可重跑；不传 `--input` 即按已保存规范状态普通离线再生。未在工作树执行实数据生成，维护者可审阅后按同一事务入口完成交接，不手改生成 JSON。

线上验收：**未执行 / 未授权**。没有 production workflow run ID、新发布提交、Pages 部署或线上快照验收结论；本地构建绿灯不替代线上内容验收。根代理独立代码审阅及分支总审仍是交接流程的一部分。
