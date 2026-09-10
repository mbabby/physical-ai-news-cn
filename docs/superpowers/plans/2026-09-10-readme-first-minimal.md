# README-first Minimal Reading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make README the complete primary reading surface and simplify all eight existing pages without changing evidence or publication semantics.

**Architecture:** Reformat existing validated projections rather than introducing a new model, ranking system or data store. Preserve transaction/marker contracts and existing page routing, use one shared neutral stylesheet, and test both data projection and actual reading behavior.

**Tech Stack:** Node 24, pnpm 11.9.0, TypeScript/node:test, existing static HTML/CSS/JS and native details; no added dependencies.

## Global Constraints

- Approved spec: `docs/superpowers/specs/2026-09-10-readme-first-minimal-design.md`.
- Exact title: 物理 AI 进展解读. Exact value: 看懂机器人与物理 AI：现在能做什么，最近进步在哪，还有什么没解决。
- README is primary; no new pages/routes. All eight existing pages are in scope, not only the homepage.
- Preserve canonical facts, ranking, IDs, evidence gates, unknown values, withdrawal priority, failure retention and separate check/content clocks. No live generation, secret/provider/schedule changes, merge/push/deploy in this task.
- Preserve unrelated `.DS_Store`, `AGENTS.md`, historical data and other worktrees. Same-directory feature branch per existing preference.
- Use installed pinned runner: `node /Users/lijie/.npm/_npx/f444441de2b6bbff/node_modules/pnpm/bin/pnpm.cjs` (PINNED below). tsx tests need approved IPC permissions. Real generated JSON must remain byte-identical during layout migration; README may be reprojected offline from it.

### Task 1: Complete, compact README with durable generation

**Files:**
- Modify: `README.md`, `README.en.md`, `src/progress-explainers/markdown.ts`.
- Modify as required for inline public summaries: `src/watchlist/markdown.ts`, `src/core-coverage/render.ts`, `src/event-center.ts`, `src/main.ts`, and their narrowly affected publication validators/tests.
- Create: `tests/readme-first.test.ts`; reuse `tests/helpers/progress-explainers.ts`.
- Test: `tests/progress-explainers.test.ts`, `tests/progress-explainers-publication.test.ts`, `tests/fixture-mode-cli.test.ts`, `tests/release-contract.test.ts`, relevant watchlist/core/event/propagation tests.

**Interfaces:**
- Consume existing `ProgressExplainersArtifact`, `WatchlistPublicView`, `CoreCoverageArtifact`, public company events and public research records.
- Preserve `renderProgressExplainersMarkdown(artifact): string` and `replaceProgressExplainersReadme(readme, artifact): string`; existing `formatWatchlistReadme`, `formatCoreCoverageReadme`, `formatCompanyRadar`, `formatResearchCards` remain their same signature. No new public JSON schema.
- Produce current README whose marker blocks remain valid under all existing generation/release paths, with literal fields/evidence included rather than link-only company Briefs.

- [ ] Add failing behavior tests. Example (adapt helper to its actual export):

```ts
const artifact = previousArtifact();
const text = renderProgressExplainersMarkdown(artifact);
assert.ok(text.includes(artifact.cards[0]!.factsZh[0]));
assert.ok(text.includes(artifact.cards[0]!.factsZh[1]));
assert.match(text, /<summary>背景与证据<\/summary>/);
assert.ok(text.indexOf(artifact.cards[0]!.meaningZh) < text.indexOf('<details>'));
assert.ok(text.indexOf(artifact.cards[0]!.evidence[0]!.url) > text.indexOf('<details>'));
```

Add independent literal expectations for complete public company facts/evidence rendered inline rather than a Pages-only Brief link; unknown fields remain unknown, candidate/private fields absent. Test preserved order and all optional background/comparison/contexts/date fields, safe Markdown for untrusted model text and evidence labels, four states, and marker replacement twice without duplication.
- [ ] Run `PINNED exec tsx --test tests/readme-first.test.ts`, record expected RED assertions before implementation.
- [ ] Compact explainer rendering: title, two original fact sentences plus change paragraph, short labelled interpretation/limitations paragraph, one details per card for background/evidence/contexts/all dates/comparison. One short status with true content date; operational clock can appear in a lower collapsed section. Keep malformed-state rejection at existing boundaries.

```ts
// Preserve values verbatim (with Markdown escaping), not fresh AI wording.
lines.push(`### ${escapeMarkdown(card.titleZh)}`, '',
  `${escapeMarkdown(card.factsZh[0])} ${escapeMarkdown(card.factsZh[1])} ${escapeMarkdown(card.changeZh)}`, '',
  `**解读：** ${escapeMarkdown(card.meaningZh)}`, '',
  `**局限：** ${card.limitationsZh.map(escapeMarkdown).join('；')}`, '',
  '<details><summary>背景与证据</summary>', '');
```

- [ ] Reorganize README into title/value then explainer marker, then sibling disclosures 公司进展 / 研究论文 / 技术背景 / 更新与纠错. Preserve each existing marker once, move operational/ranking legacy content below reading. Remove primary Pages navigation. Inline current public company evidence and summaries using existing validated projections, not raw candidates; public research already has full Chinese summaries. Technical background may explain the current public contexts using curated existing source-backed material, with explicit sources; do not dump all historical resources or invent empty filler. English overview becomes optional inline text/compatible file, not a required next page. Optional historical/source/Issue links remain.
- [ ] Update the responsible generator wherever it emits Pages-only reading dependencies so the next daily run preserves inline content. Update exact-projection validators with their shared renderer, never weaken evidence/identity/receipt checks. Reproject only README from checked-in artifacts via ignored one-off script if needed; do not change JSON/receipts or run live generation. If a current-data projector cannot be reconstructed safely, report the exact blocker before touching data.
- [ ] GREEN focused tests, `PINNED run check`, `PINNED test`, `PINNED run validate:release`, `git diff --check`. Run two isolated `node --import tsx src/main.ts -- --fixture --output-root <mktemp-directory>` generations, validate each using exported `validateRelease(root)`, compare README/JSON byte stability. Retain paths in report; no generated fixture in public checkout.
- [ ] Commit owned files only. Full report with RED/GREEN, projection migration sources and isolated output paths in plan scratch; root task reviewer verifies diff. No page CSS/HTML changes in this task.

### Task 2: Minimal reading redesign across existing eight pages

**Files:**
- Modify: `site/styles.css`, `site/index.html`, `site/companies.html`, `site/core-coverage.html`, `site/research.html`, `site/weekly.html`, `site/watchlist-changes.html`, `site/subscribe.html`, `site/contribute.html`.
- Modify narrowly when generated display needs cleanup: `site/progress-explainers.js`, `site/app.js`, `site/share-pages.js`, existing page-specific JS. Preserve exported interfaces and query/deep-link behavior.
- Tests: `tests/progress-explainers-render.test.ts`, existing site DOM/UI and page-specific interaction tests; create `tests/minimal-pages.test.ts` for actual renderer/mount behavior where needed.

**Interfaces:**
- Consume unchanged validated JSONs and page data-view/mount contracts. Keep `renderProgressExplainers(value): string`, independent artifact fetch and lazy archive behavior.
- Produce same pages/URLs/anchors/interactions with shared neutral reading treatment. README stays the primary entry, with explicit link from every existing page. No new routes, dependencies, editing pipeline or separately authored explanations.

- [ ] Add failing tests for compact runtime-rendered explainer (literal facts/meaning/limitations before one evidence details, clocks preserved, no data loss), actual current page mounts and existing filter/expand/error/subscribe interactions using existing DOM harnesses. Example:

```ts
const html = renderProgressExplainers(previousArtifact());
assert.match(html, /<summary>背景与证据<\/summary>/);
assert.ok(html.indexOf('披露未说明其他物体或环境中的表现。') < html.indexOf('<details'));
assert.ok(html.includes('https://'));
```

Derive literal expected values independently; do not replace runtime tests with source-contains-CSS assertions. Browser computed style and screenshots are the visual gate.
- [ ] Run targeted tests RED; remove decorative DOM (grid-glow, brand-dot, duplicate English eyebrow/header slogans) from all eight pages without removing semantic state badges, facts or mount IDs. Use one ordinary title and brief relevant description per page, preserving disclaimer boundaries without repetition. Keep original forms/selects and links functional.
- [ ] Simplify existing shared stylesheet using readable scoped edits, not a universal `* !important` reset. Plain light background/dark text and neutral system-dark adaptation; no gradients, glow, large shadows or decorative grids on active surfaces. Regular system font, 16px main body, main h1 roughly 28–36px, line-height >=1.6 for reading, compact headers, visible focus, 44px principal controls, columns collapse at390px. Retain colored status meaning only where it communicates a state, not neon ornament. Audit hard-coded dark colors on generated cards/drawers/forms so neutral background doesn't make content invisible.

```css
/* Use existing shared tokens; these values illustrate the required neutral range. */
:root { --bg:#fff; --ink:#202124; --muted:#606770; --line:#d8dee4; }
body { background:var(--bg); color:var(--ink); font-family:system-ui,sans-serif; }
```

- [ ] Compact HTML explainers to parallel Task1 paragraph reading while preserving labelled meaning/limitations, contexts and evidence in details; no reranking or interpretation rewrite. Initial/failed status is one short visible message, not large panel. Important service failure summary remains visible with diagnostic detail below.
- [ ] Bump all eight pages' shared stylesheet and changed module cache keys. Preserve existing URLs/hash/query shares; ensure fallback errors retain actual dates and don't claim updates. Update affected tests semantically rather than deleting assertions of safety.
- [ ] GREEN focused tests, check, full suite, release validator, diff check. Prepare ignored labelled nonempty and failure preview fixtures using real renderers only where actual snapshot is empty; no production fixture hooks. Root browser-QA owns CUA: all eight actual pages at1280/390px, no overflow, forms/filter and evidence keyboard/expand, plain backgrounds, light/dark contrast. Report exact preview paths and any untested cases.
- [ ] Commit owned files and report; root task review then single whole-branch review, fixes and fresh verification. No merge/push/live generation.

## Controller acceptance

- [ ] Each task reviewed against its brief plus global constraints; review fixes go to original implementer.
- [ ] Root fresh full tests/check/release, two isolated CLI receipts and byte comparison, eight-page visual/interaction matrix.
- [ ] Verify no new HTML routes, no data/receipt mutations, no unrelated tracked changes. Report existing upstream degradation honestly and separate offline success from live unrun checks.
- [ ] Present local delivery and integration choice. Real-reader comprehension study is not replaced by agent QA.
