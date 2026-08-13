# Dual-Track Company Watchlist Implementation Index

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved dual-track company watchlist without destabilizing the existing daily intelligence pipeline.

**Architecture:** Four sequential release gates preserve one public truth source. Stage 1 creates review-only contracts and migrations; Stage 2 adds AI generation and deterministic gates while remaining private; Stage 3 switches all public consumers to an immutable snapshot; Stage 4 adds following, community review, and metrics.

**Tech Stack:** TypeScript, Node.js 24, pnpm, Git JSON artifacts, GitHub Actions/Issues/Pages, OpenAI-compatible LLM, static HTML/CSS/JavaScript.

## Global Constraints

- Approved design: `docs/superpowers/specs/2026-08-13-dual-track-company-watchlist-design.md`.
- Execute stages strictly in order; do not start a later stage before the preceding acceptance gate passes.
- Use a dedicated git worktree at execution time.
- Use TDD for every task and run the Physical AI release-validation skill whenever daily generation, release validation, README, Pages, or Actions change.
- Never push or deploy without explicit user authorization.
- Preserve `.DS_Store` and unrelated user changes.

---

## Sequential plans

- [ ] **Stage 1 — Contracts and migration:** `docs/superpowers/plans/2026-08-13-dual-track-watchlist-stage-1-contracts.md`
- [ ] **Stage 2 — AI generation and quality gates:** `docs/superpowers/plans/2026-08-13-dual-track-watchlist-stage-2-generation.md`
- [ ] **Stage 3 — Unified snapshot publication:** `docs/superpowers/plans/2026-08-13-dual-track-watchlist-stage-3-publication.md`
- [ ] **Stage 4 — Following and community loop:** `docs/superpowers/plans/2026-08-13-dual-track-watchlist-stage-4-following.md`

## Release checkpoints

1. After Stage 1, only `review/watchlist-*.json` changes; public artifacts do not.
2. After Stage 2, a human-readable internal preview exists and all blocked drafts have explicit reasons; public artifacts still do not change.
3. After Stage 3, README, dashboard, Pages, share pages, and release exports consume one immutable snapshot and pass cross-surface consistency checks.
4. After Stage 4, feeds, configuration links, correction Issues, period deltas, and metrics consume the same public view and pass rollback tests.

## Design coverage map

- Design §§1–5 (goals, tracks, quotas, cards): Stages 1–2 contracts, seeds, scoring, generation, and validation.
- Design §§6–7 (four layers and automatic publication): Stages 1–3 contracts, lifecycle, snapshot, public adapter, and release gate.
- Design §§8–10 (cadence, lifecycle, correction): Stage 2 lifecycle/cooldown and Stage 3 immutable versions/rollback; Stage 4 correction Issues.
- Design §§11–12 (public product and Watchlist): Stage 3 README/Pages/share rendering and Stage 4 feeds/configuration/change page.
- Design §§13–16 (stack, metrics, risk, delivery): all stages retain the Git-native stack; Stage 4 metrics; every stage has fault, consistency, and last-known-good gates.

## Final definition of done

- [ ] Automatic publication success is at least 95% over the evaluation window.
- [ ] Public thesis citation coverage is 100%.
- [ ] Canonical company identity mismatches and key-field conflict leakage are zero.
- [ ] Severe corrections are removable within 30 minutes.
- [ ] Expired or falsified theses do not remain current.
- [ ] README, Pages, share pages, feeds, and weekly release report 100% snapshot consistency.
- [ ] Failure and fault-injection runs preserve the last-known-good public version.
