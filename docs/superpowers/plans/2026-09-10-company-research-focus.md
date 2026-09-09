# Company research focus implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Remove independent paper/resource navigation from the main product while preserving evidence, archives and historical links.

**Architecture:** Change public presentation only. Company, capital and competitive changes remain the primary homepage/README story. Existing research generation, publication validation, JSON/feeds and research.html remain intact; README generated research stays inside a closed auxiliary details block so daily regeneration cannot restore a primary research channel.

**Tech Stack:** Existing static HTML/CSS/JavaScript, TypeScript generator and node:test. No dependencies.

## Global Constraints

- Do not delete historical data, evidence, resource files or research.html; preserve existing subscriptions and public contracts.
- Do not weaken publication/retraction/Chinese-copy gates, alter schedules, add a ranking system or expand scope to other strategic deletions.
- Preserve unrelated .DS_Store and AGENTS.md. Commit only task files; root owns merge/push/deploy.
- Main homepage must not render independent paper lists or resource radar. Optional removed DOM mounts must not crash rendering (including invalid payload path).
- Existing research links must remain reachable through a secondary archive entry; research may support company analysis only with existing evidence, never invented links.

### Task 1: Narrow the public entry without breaking evidence continuity

**Files:** site/index.html, site/app.js, site/styles.css if grid needs adapting; README.md, README.en.md, site/research.html; tests/site-ui.test.ts plus focused existing README/generation contract tests as necessary. Do not change canonical data files.

**Interfaces:** app.js render(data) still consumes the same dashboard and decisionProducts contracts. Optional research mounts may be absent. README RESEARCH_UPDATES_START/END remain intact inside closed details.

- [ ] Write a failing runtime test in tests/site-ui.test.ts: construct homepage DOM mounts from actual index IDs, missing research/research-graph-grid/research-count returns null; render a valid dashboard, an absent decision product fallback, and malformed decisionProducts. Company/capital/health still render and no exception occurs. Primary nav cannot target an absent section; retained archive link targets an existing page.
- [ ] Run `node --import tsx --test tests/site-ui.test.ts`, capture expected RED before changes. Update old mount-presence assertions only for deliberately removed public sections, preserving all unrelated safety assertions.
- [ ] Remove primary research nav, research metric, research lane, standalone research graph, and resources section from homepage. Keep a modest footer auxiliary archive link to research.html. Change positioning copy to company competition research for investment/strategy researchers, not real-time recommendations or global completeness claims. Adapt two-column monitor/three-metric layout with existing CSS conventions.
- [ ] Guard remaining app.js calls/writes to removed mounts with presence checks, including malformed decision product branch; do not hide existing exceptions globally. No duplicate research list via another homepage section.
- [ ] README: remove primary research/milestone shortcuts and separate researcher journey. Fold generated paper section and historical resource directory under closed `<details>` labelled auxiliary evidence/history; retain marker content byte-for-byte. Reword Chinese/English positioning consistently. research.html explains its secondary evidence/archive role without claiming unverified company relations, retains renderer and old links.
- [ ] Add generation regression proving replacing research marker content leaves it within closed details and does not restore primary navigation. Use existing real readme update/fixture integration boundary, no mocked generator assertion.
- [ ] Run focused UI/readme contracts, full tests, typecheck, validate:release and git diff --check. Do not weaken historical data validations to pass.
- [ ] Commit scoped changes, write report including red/green logs and test totals. Root independently checks real browser and reviews before publishing.

## Release acceptance

- Static homepage works on desktop and mobile, no research/resource primary entry, archive accessible and company content intact.
- Main branch push triggers Pages; verify public HTML reflects new navigation, archived research endpoint still loads.
- No changed generator source is expected; if source must change, root will additionally require two real daily runs before declaring full pipeline acceptance.
