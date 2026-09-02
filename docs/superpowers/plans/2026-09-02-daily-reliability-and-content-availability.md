# 日报按时性与内容可用性 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让日报在北京时间当天可检测、可恢复、可解释，并在 LLM 局部故障时保留严格且尽可能完整的公开内容。

**Architecture:** 纯函数先判定北京时间日报新鲜度，再由独立看门狗按受控恢复模式派发日报。摘要器把“提供方可用”和“文本可公开”分开统计，所有公开层仍复用唯一中文事实门槛。Dashboard 接收一个安全、聚合的健康投影，由前端明确展示状态。

**Tech Stack:** TypeScript、Node test runner、GitHub Actions、GitHub CLI、静态 GitHub Pages。

## Global Constraints

- 不降低 A 级或双独立 B 级公开证据门槛。
- 任何英文半成品、占位摘要、主体不明融资或候选内容不得进入公开层。
- 全部日期 SLA 按 `Asia/Shanghai` 和 09:20 计算；恢复派发时隙为 09:25。
- 恢复 workflow 只能派发、不能直接写内容；日报 workflow 是唯一日报写入者。
- 不记录或公开密钥、请求正文、候选 URL、原始错误或私有诊断。
- 保留用户的 `.DS_Store`，不修改历史 worktree。

---

### Task 1: 北京时间日报新鲜度与健康合同

**Files:**
- Modify: `src/runtime/health.ts`, `src/types.ts`, `src/validate-health.ts`
- Test: `tests/runtime-health.test.ts`

**Interfaces:**
- Produces `assessDailyPublicationFreshness(history, now)` with `pending | current | missing`。
- Extends `PipelineHealth` with the derived, credential-free freshness fields.

- [ ] **Step 1: Write failing tests** for 09:19 pending、09:20 missing、UTC/北京时间跨日、当日失败 run 不满足 SLA、当日成功 run 满足 SLA。
- [ ] **Step 2: Run `node --import tsx --test tests/runtime-health.test.ts`** and confirm the expected missing-export/incorrect-status failure.
- [ ] **Step 3: Implement only the pure timezone/freshness functions and health projection.** Keep historical gap and 36-hour logic intact.
- [ ] **Step 4: Make `validate:health` fail for `missing` after cutoff but pass for `pending` before cutoff.**
- [ ] **Step 5: Re-run the focused test** and commit `feat: add daily publication freshness SLA`.

### Task 2: 独立恢复看门狗与日报幂等启动

**Files:**
- Modify: `.github/workflows/pipeline-health.yml`, `.github/workflows/daily-digest.yml`
- Test: `tests/release-contract.test.ts`, `tests/pipeline-health-workflow.test.ts`

**Interfaces:**
- Recovery invokes `Daily physical AI digest` with `recovery=true` only at 01:25 UTC and only after a missing SLA result.
- Daily workflow treats an existing current-day receipt as a no-op for recovery runs.

- [ ] **Step 1: Write failing contract tests** that execute/read the workflow contract for recovery time, minimal permission, dispatch command, recovery input and daily no-op conditions.
- [ ] **Step 2: Run the focused workflow tests** and confirm required recovery behavior is absent.
- [ ] **Step 3: Add recovery input and receipt-aware no-op to daily workflow.** Preserve explicit forced manual work separately from recovery.
- [ ] **Step 4: Add 01:25 UTC recovery job to health workflow.** It must use `actions: write`, test freshness, avoid active duplicate runs, dispatch only once, and summarize action/outcome.
- [ ] **Step 5: Re-run focused contracts** and commit `feat: recover missing daily publication`.

### Task 3: LLM 完整性、分级故障和安全回退

**Files:**
- Modify: `src/summarize.ts`, `src/main.ts`, `src/publication.ts`
- Test: `tests/summarize.test.ts`, `tests/publication-robustness.test.ts`, relevant integration test

**Interfaces:**
- `CompatibleSummarizer` reports valid completions separately from provider errors and invalid model output.
- Bounded batches are used by industry, research and pulse lanes.

- [ ] **Step 1: Write failing tests** for title-only/placeholder response, no-excerpt skip, provider circuit behavior, bounded pulse calls, Chinese official fallback, and rejected English/nonofficial fallback.
- [ ] **Step 2: Run focused tests** and verify they fail for the intended behavior.
- [ ] **Step 3: Implement strict completion validation and provider-fault-only circuit counting.** Do not alter publication gates.
- [ ] **Step 4: Route pulse through cache/bounded batches and add deterministic high-confidence Chinese official fallback after LKG lookup.**
- [ ] **Step 5: Re-run focused tests** and commit `fix: harden summary availability without weakening gates`.

### Task 4: 公开状态投影、首页状态与候选实体卫生

**Files:**
- Modify: `src/site-data.ts`, `src/main.ts`, `site/index.html`, `site/app.js`, `site/styles.css`, candidate entity guard module
- Test: `tests/site-data.test.ts`, candidate/entity test, release validation test

**Interfaces:**
- Dashboard adds a public-safe health projection with no raw error/content fields.
- Homepage renders current/pending/missing state and explicit empty/degraded copy.

- [ ] **Step 1: Write failing tests** for safe health projection, no public candidate leak, explicit empty content state, and invalid entity candidates being quarantined.
- [ ] **Step 2: Run focused tests** and confirm failures describe missing projection/gate.
- [ ] **Step 3: Implement safe dashboard health data and frontend rendering.** The browser derives display freshness only from safe date/status fields.
- [ ] **Step 4: Implement minimal candidate entity admissibility guard and aggregate rejected count.** Do not delete historical records.
- [ ] **Step 5: Run focused tests** and commit `feat: expose publication freshness and candidate quality`.

### Task 5: 集成、发布与真实链路验证

**Files:**
- Modify: only generated artifacts produced by verified workflow execution
- Test: full repository suite and real Actions runs

- [ ] **Step 1: Run `pnpm check` and `pnpm test`** on the integrated branch.
- [ ] **Step 2: Run release validation** against generated artifacts and scan public JSON/Markdown for prohibited placeholder or candidate content.
- [ ] **Step 3: Merge/rebase safely, push after user-selected integration path, then manually run Daily workflow twice.**
- [ ] **Step 4: Verify both Daily and Pages workflows, Dashboard date, source/LLM/OpenAlex status, public gate and recovery-job summary.**
