# Research visual unification implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. User approved design and direct merge/publication; no further confirmation needed.

**Goal:** Make GitHub README a concise native research brief and align Pages evidence typography without changing facts or gates.

**Architecture:** Preserve all generated marker pairs and their contents; reorder/static wrappers only. GitHub keeps native light/dark presentation; Pages keeps its existing dark theme. No new dependency or component framework.

**Tech Stack:** Markdown, SVG, HTML/CSS, Node/TypeScript tests.

## Global Constraints

- Product name: 物理 AI 公司竞争情报; English: Physical AI Company Intelligence.
- Preserve canonical data, dates, workflows, runtime settings, publication gates and historical assets.
- Use current checkout feature branch, matching previous task; preserve untracked AGENTS.md and .DS_Store.
- Latest README and Pages have different publication scopes: explain them explicitly, do not fabricate agreement or promote candidates.
- No GIF, screenshot wall, new features, or image-contained essential reading text.

### Task 1: Native README and readable evidence presentation

**Files:** README.md, README.en.md, assets/social-preview.svg, site/index.html, site/styles.css; directly affected tests only. Other site HTML titles may change for product naming consistency, not page-specific headings. Leave historical asset physical-ai-hero.svg intact but remove README embedding.

- [ ] Read existing README generation consumers and tests. Baseline affected tests.
- [ ] Preserve each existing START/END marker exactly once. Order README: one H1 and one-sentence purpose; three left-aligned native links (今日简报 to Pages root, 公司研究 to companies.html, 本周重点 to weekly.html); honest schedule note (计划北京时间每日08:30运行，实际完成可能延迟，以页面生成时间及Actions为准); 产业进展 with existing DECISION_SIGNALS and EVENT_CENTER; company/watchlist sections; folded Core coverage and health/status; folded supplemental research and collaboration/history. Keep section anchors used by existing links.
- [ ] Remove duplicate introductory tables/navigation, Star persuasion paragraph and top badge wall. Keep Actions/license/contribution links lower down. Keep a visible concise link to actual update/health status, even while folding detailed PROJECT_STATUS; do not hide freshness or imply healthy operation.
- [ ] Explain under 产业进展 that README lists verified events/weekly conclusions; Pages also has clearly labeled single-source developing leads. Do not alter generated event contents to force them equal. Do not hardcode daily counts.
- [ ] Unify product naming in current README/English/site document title/main headline/social preview; social preview audience becomes investment/strategy researchers. Keep standalone section/page names (company directory, subscription) descriptive. Remove exact-time guarantee in English too.
- [ ] Add narrowly scoped CSS after existing overrides: active homepage/companies/core research reading paragraphs and definitions at least 16px, evidence/source/status labels at least 12px, developing cards use existing warning amber semantics instead of purple. Preserve literal evidence labels, 44px targets, visible focus, mobile stacking and print styles. Do not blanket change all small text or archive layout.
- [ ] For real renderer behavior affected, add/adjust behavioral tests first and observe failure. Human prose edits alone need no new constant-string snapshot tests. Run existing README regeneration tests proving wrappers and markers survive rerender; add a small regression only if existing tests lack wrapper preservation.
- [ ] Run focused tests, pnpm run check, pnpm test, pnpm run validate:release, git diff --check. Do not run live generation for visual-only edits; recent two real runs already completed and generation behavior is unchanged.
- [ ] Commit scoped files and report test results. Root checks desktop/mobile layout, GitHub native rendering after push, feature links, content/status preservation; independent task and final review precede authorized merge/push/Pages validation.
