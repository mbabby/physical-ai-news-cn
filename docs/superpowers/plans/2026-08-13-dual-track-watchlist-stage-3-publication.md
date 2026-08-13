# Dual-Track Watchlist Stage 3: Unified Snapshot Publication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish immutable weekly watchlist snapshots and make README, Pages, share pages, and feed-ready exports consume that single versioned truth source.

**Architecture:** A snapshot builder resolves validated thesis references into an immutable weekly release. A public-view adapter is the only place allowed to join snapshot references with thesis and canonical facts. Existing dashboard fields remain during a compatibility window, but all watchlist UI and README sections read the same adapter output. Publication validation blocks cross-surface drift and retains the last valid snapshot on failure.

**Tech Stack:** TypeScript, JSON snapshots, static GitHub Pages JavaScript/CSS, GitHub Actions, `node:test` and checked-in artifact tests.

## Global Constraints

- Snapshots contain references and change metadata, not copied canonical facts.
- Current and historic snapshots are immutable; corrections create a new `snapshotVersion`.
- README, Pages, share pages, and exports must report the same week and snapshot version.
- Public grouping is `重点关注` / `持续观察`; exact scores and ranks are private.
- Forward and momentum are mutually exclusive per company.
- Route share normally stays at or below 40%; exceptions require a recorded reason.
- A failed publication must not overwrite the last-known-good snapshot.

---

### Task 1: Build deterministic immutable weekly snapshots

**Files:**
- Create: `src/watchlist/snapshot.ts`
- Test: `tests/watchlist-snapshot.test.ts`

**Interfaces:**
- Consumes: validated current theses, prior snapshot, ISO week, methodology version.
- Produces: `buildWatchlistSnapshot(input): WatchlistSnapshot` and `snapshotPath(snapshot): string`.

- [ ] **Step 1: Write failing immutability and delta tests**

Test stable reruns, version increments on correction, add/strengthen/downgrade/exit deltas, mutual exclusion, maximum ten entries, maximum two `持续观察` entries per track, and route-share exception recording.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm test -- tests/watchlist-snapshot.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement snapshot construction**

Return the snapshot and its target paths: `watchlist/current.json` and `watchlist/history/<week>-v<version>.json`. Task 5 performs both writes in the existing transaction only after release validation. If the content hash is unchanged, return the prior snapshot unchanged. Never stage a replacement for an existing history file.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm test -- tests/watchlist-snapshot.test.ts && pnpm run check`

```bash
git add src/watchlist/snapshot.ts tests/watchlist-snapshot.test.ts
git commit -m "feat: build immutable watchlist snapshots"
```

### Task 2: Create the single public watchlist view adapter

**Files:**
- Create: `src/watchlist/public-view.ts`
- Test: `tests/watchlist-public-view.test.ts`

**Interfaces:**
- Consumes: snapshot, thesis artifact, companies, event store.
- Produces: `buildWatchlistPublicView(input): WatchlistPublicView` with resolved cards, `companyIds`, evidence links, track groups, lifecycle labels, change list, week, versions, and `lastSuccessfulAt`.

- [ ] **Step 1: Write failing evidence-resolution tests**

Assert every public fact link resolves to the canonical event evidence, missing references block the whole view, falsified/expired theses cannot resolve, and unknown funding stays `证据不足（不代表未融资）`.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm test -- tests/watchlist-public-view.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement one join boundary**

The adapter must be pure and deterministic. It may expose `internalScore` only in an internal diagnostic type, never in `WatchlistPublicView`. Render company names from `CompanyProfile.name` without translating them.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm test -- tests/watchlist-public-view.test.ts`

```bash
git add src/watchlist/public-view.ts tests/watchlist-public-view.test.ts
git commit -m "feat: resolve public watchlist view"
```

### Task 3: Extend dashboard data and README from the same view

**Files:**
- Modify: `src/site-data.ts`
- Create: `src/watchlist/markdown.ts`
- Modify: `src/main.ts`
- Modify: `README.md`
- Test: `tests/watchlist-publication.test.ts`
- Modify: `tests/site-data.test.ts`

**Interfaces:**
- Adds `watchlist?: WatchlistPublicView` to `DashboardData`.
- Produces `formatWatchlistReadme(view): string` and README markers `<!-- WATCHLIST_START -->` / `<!-- WATCHLIST_END -->`.

- [ ] **Step 1: Write failing cross-surface tests**

```ts
test("README and dashboard expose one snapshot identity", () => {
  assert.match(readme, new RegExp(`${dashboard.watchlist.week}.*v${dashboard.watchlist.snapshotVersion}`));
  assert.equal(readmeCompanyIds.sort().join(","), dashboard.watchlist.companyIds.sort().join(","));
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm test -- tests/watchlist-publication.test.ts tests/site-data.test.ts`

Expected: FAIL.

- [ ] **Step 3: Add the compatibility field and README section**

Keep `companyBoards` and `companyRadar` for one release so existing share pages do not break. Add `watchlist` from the public adapter and render a compact README summary: week/version, two tracks, why-now sentence, lifecycle, and independent share link. Do not duplicate full cards.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm test -- tests/watchlist-publication.test.ts tests/site-data.test.ts tests/propagation-assets.test.ts`

```bash
git add src/site-data.ts src/watchlist/markdown.ts src/main.ts README.md tests/watchlist-publication.test.ts tests/site-data.test.ts tests/propagation-assets.test.ts
git commit -m "feat: expose unified watchlist publication"
```

### Task 4: Render the two-track list and company history on Pages

**Files:**
- Modify: `site/index.html`
- Modify: `site/companies.html`
- Modify: `site/app.js`
- Modify: `site/share-pages.js`
- Modify: `site/styles.css`
- Test: `tests/site-ui.test.ts`

**Interfaces:**
- Consumes only `dashboard.watchlist` for the new two-track component.
- Produces semantic track sections, compact cards, change badges, evidence links, validation points, falsifiers, expiry, and AI labels.

- [ ] **Step 1: Write failing static UI contract tests**

Assert IDs `watchlist-forward`, `watchlist-momentum`, and `watchlist-changes`; visible `AI 研究判断`; no score/rank labels; accessible link text; mobile styles; and fallback to the previous company-board view only when `watchlist` is absent.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm test -- tests/site-ui.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement progressive enhancement**

Use escaped text and `safeUrl` helpers already present in `site/app.js`. Show `重点关注` before `持续观察`; show `为什么现在值得看`, `下一验证点`, and `反证条件`; keep exact scores private. Company page must show current thesis and transition history before the existing dossier.

- [ ] **Step 4: Run UI tests and local inspection**

Run: `pnpm test -- tests/site-ui.test.ts && pnpm run check`

Open `site/index.html` and `site/companies.html` locally; verify 1440px and 390px widths, keyboard focus, long Chinese titles, missing optional funding, and last-known-good banner.

- [ ] **Step 5: Commit**

```bash
git add site/index.html site/companies.html site/app.js site/share-pages.js site/styles.css tests/site-ui.test.ts
git commit -m "feat: present dual-track company watchlist"
```

### Task 5: Add cross-artifact publication validation and workflow rollback

**Files:**
- Create: `src/watchlist/release-validation.ts`
- Modify: `src/validate-release.ts`
- Modify: `src/runtime/validation.ts`
- Modify: `.github/workflows/daily-digest.yml`
- Modify: `.github/workflows/weekly-release.yml`
- Test: `tests/watchlist-release-validation.test.ts`
- Modify: `tests/release-contract.test.ts`

**Interfaces:**
- Produces `validateWatchlistRelease({ snapshot, theses, dashboard, readme }): void`.

- [ ] **Step 1: Write failing drift and rollback tests**

Test week mismatch, version mismatch, company-set mismatch, broken thesis reference, exposed score, expired thesis, missing AI label, and a staged invalid snapshot leaving `watchlist/current.json` unchanged.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm test -- tests/watchlist-release-validation.test.ts tests/release-contract.test.ts`

Expected: FAIL.

- [ ] **Step 3: Add the release gate before transaction commit**

Validate staged strings/objects before `FileTransaction.commit()`, then stage current and the new immutable history file in that same transaction. Refuse publication if the history target already exists with different content. The weekly workflow must publish the immutable snapshot version referenced by current, not simply the lexicographically newest report. Report snapshot week/version and card counts in `$GITHUB_STEP_SUMMARY`.

- [ ] **Step 4: Run all validation and the release skill**

Run: `pnpm run check && pnpm test && pnpm run validate:release && pnpm run validate:health`

Then follow `/Users/lijie/.codex/skills/physical-ai-release-validation/SKILL.md`, including two consecutive generation/validation cycles and post-publish artifact checks.

- [ ] **Step 5: Commit**

```bash
git add src/watchlist/release-validation.ts src/validate-release.ts src/runtime/validation.ts .github/workflows/daily-digest.yml .github/workflows/weekly-release.yml tests/watchlist-release-validation.test.ts tests/release-contract.test.ts
git commit -m "feat: enforce watchlist release consistency"
```

### Stage 3 acceptance gate

- [ ] README, dashboard, main Pages view, company share page, and weekly release expose the same snapshot identity and company set.
- [ ] Two consecutive valid runs are idempotent.
- [ ] A deliberately broken snapshot fails before commit and preserves all last-known-good public files.
- [ ] Historic snapshot files are unchanged by correction or rerun.
- [ ] Candidate IDs, exact scores, ranks, falsified cards, and expired cards do not appear in public artifacts.
