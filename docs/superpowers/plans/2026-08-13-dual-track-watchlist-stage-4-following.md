# Dual-Track Watchlist Stage 4: Following and Community Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add account-free company and route following, shareable watchlist configurations, evidence-review Issues, period-delta pages, and measurable product feedback loops.

**Architecture:** Static configuration URLs encode only public company/route IDs. Feed and share renderers consume the same `WatchlistPublicView` and canonical facts as Pages. GitHub Issues remain the only write path; submissions enter review and cannot alter public artifacts. Metrics are aggregate, privacy-safe, and separate repository growth from product quality.

**Tech Stack:** TypeScript, RSS 2.0/Atom XML, static HTML/JavaScript, GitHub Issue templates/actions, JSON metrics, Node tests.

## Global Constraints

- No login, database, private portfolio, returns tracking, team permissions, private notes, email, or instant-message push.
- Configurations may contain only canonical public company IDs and route names.
- Feeds and share pages must identify the snapshot week/version they consume.
- Issue creation never publishes evidence directly.
- Product metrics never represent missing GitHub traffic as zero.

---

### Task 1: Generate company and route feeds from the public view

**Files:**
- Create: `src/watchlist/feeds.ts`
- Test: `tests/watchlist-feeds.test.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Produces `buildCompanyFeed(view, companyId, baseUrl): string` and `buildRouteFeed(view, route, baseUrl): string`.
- Writes `site/feeds/companies/<companyId>.xml` and `site/feeds/routes/<route-slug>.xml`.

- [ ] **Step 1: Write failing XML and consistency tests**

Assert valid escaped XML, absolute links, stable GUIDs derived from thesis ID/version, snapshot identity metadata, no candidate items, and idempotent output order.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm test -- tests/watchlist-feeds.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement feed builders and stage outputs**

Include current thesis, lifecycle changes, new validation evidence, and correction notices. Do not include full source text or exact scores.

- [ ] **Step 4: Run and commit**

Run: `pnpm test -- tests/watchlist-feeds.test.ts && pnpm run check`

```bash
git add src/watchlist/feeds.ts src/main.ts tests/watchlist-feeds.test.ts site/feeds
git commit -m "feat: publish company and route feeds"
```

### Task 2: Add a shareable account-free Watchlist configuration

**Files:**
- Create: `src/watchlist/config.ts`
- Test: `tests/watchlist-config.test.ts`
- Modify: `site/index.html`
- Modify: `site/app.js`
- Modify: `site/styles.css`

**Interfaces:**
- Produces `encodeWatchlistConfig(config): string` and `decodeWatchlistConfig(value, catalog): WatchlistConfigResult`.
- Browser URL: `?watch=company-a,company-b&routes=vla-and-embodied-models` with sorted, deduplicated IDs.

- [ ] **Step 1: Write failing canonicalization and abuse tests**

Test unknown IDs, duplicate IDs, over-limit inputs, malformed encoding, HTML payloads, stable order, and round trips. Limit to 30 companies and 10 routes.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm test -- tests/watchlist-config.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement pure encoding and browser controls**

Unknown IDs are ignored with a visible warning; no arbitrary URL is decoded or rendered. Add select/copy-link controls and filtered rendering without persisting user state.

- [ ] **Step 4: Run UI tests and commit**

Run: `pnpm test -- tests/watchlist-config.test.ts tests/site-ui.test.ts`

```bash
git add src/watchlist/config.ts site/index.html site/app.js site/styles.css tests/watchlist-config.test.ts tests/site-ui.test.ts
git commit -m "feat: share account-free watchlists"
```

### Task 3: Materialize correction and evidence-review Issues

**Files:**
- Create: `.github/ISSUE_TEMPLATE/watchlist-evidence.yml`
- Create: `.github/ISSUE_TEMPLATE/watchlist-correction.yml`
- Modify: `src/project-insights.ts`
- Modify: `.github/workflows/materialize-review-issues.yml`
- Test: `tests/watchlist-review-issues.test.ts`

**Interfaces:**
- Produces issue seeds keyed by `thesisId`, `companyId`, missing evidence type, and snapshot version.

- [ ] **Step 1: Write failing review-boundary tests**

Assert templates request original URL, affected fact, company ID, event date, and explanation; seeded issues carry `evidence-review` plus `needs-evidence` or `correction`; accepted evidence still requires canonical promotion before publication.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm test -- tests/watchlist-review-issues.test.ts tests/contributor-flywheel.test.ts`

Expected: FAIL.

- [ ] **Step 3: Add templates and deterministic seeds**

Issue bodies must include hidden stable seed IDs to avoid duplicates. Do not grant workflow write access beyond Issues and existing content permissions.

- [ ] **Step 4: Run and commit**

Run: `pnpm test -- tests/watchlist-review-issues.test.ts tests/contributor-flywheel.test.ts`

```bash
git add .github/ISSUE_TEMPLATE/watchlist-evidence.yml .github/ISSUE_TEMPLATE/watchlist-correction.yml .github/workflows/materialize-review-issues.yml src/project-insights.ts tests/watchlist-review-issues.test.ts tests/contributor-flywheel.test.ts
git commit -m "feat: route watchlist evidence through review"
```

### Task 4: Publish a since-last-period change page

**Files:**
- Create: `src/watchlist/change-page.ts`
- Test: `tests/watchlist-change-page.test.ts`
- Modify: `src/main.ts`
- Create: `site/watchlist-changes.html`
- Modify: `site/share-pages.js`

**Interfaces:**
- Produces a view with additions, strengthening, awaiting validation, downgrades, exits, corrections, and evidence links between two adjacent snapshot versions.

- [ ] **Step 1: Write failing delta tests**

Test every lifecycle delta, a first-snapshot empty baseline, correction-only version changes, and exclusion of internal score changes.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm test -- tests/watchlist-change-page.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement deterministic delta rendering**

Write `site/data/watchlist-changes.json` and render it from the static page. Each change must say what changed, why, and which canonical evidence supports it.

- [ ] **Step 4: Run and commit**

Run: `pnpm test -- tests/watchlist-change-page.test.ts tests/site-ui.test.ts`

```bash
git add src/watchlist/change-page.ts src/main.ts site/watchlist-changes.html site/share-pages.js site/data/watchlist-changes.json tests/watchlist-change-page.test.ts
git commit -m "feat: explain watchlist changes by period"
```

### Task 5: Add product-quality and following metrics

**Files:**
- Create: `src/watchlist/metrics.ts`
- Test: `tests/watchlist-metrics.test.ts`
- Modify: `src/main.ts`
- Modify: `scripts/community-metrics.mjs`
- Modify: `metrics/weekly.json`

**Interfaces:**
- Produces `metrics/watchlist.json` with publication success, citation coverage, identity mismatches, conflict leakage, takedown latency, expiry residue, cross-surface consistency, eligible-company count, evidence expansion, copy/share events where observable, feed counts, corrections, and validation-point hit rate.

- [ ] **Step 1: Write failing unknown-data tests**

Assert unavailable visitor/referrer/copy data is `null` with a status, not zero; repository Stars are separate from quality metrics; and all rates expose numerator and denominator.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm test -- tests/watchlist-metrics.test.ts tests/community-metrics.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement aggregate metrics**

Derive quality metrics from checked-in manifests, snapshots, thesis history, issues, and feeds. Do not introduce third-party analytics in this stage.

- [ ] **Step 4: Run and commit**

Run: `pnpm test -- tests/watchlist-metrics.test.ts tests/community-metrics.test.ts && pnpm run check`

```bash
git add src/watchlist/metrics.ts src/main.ts scripts/community-metrics.mjs tests/watchlist-metrics.test.ts tests/community-metrics.test.ts metrics/watchlist.json metrics/weekly.json
git commit -m "feat: measure watchlist quality and following"
```

### Task 6: Final end-to-end release and rollback verification

**Files:**
- Modify: `src/validate-release.ts`
- Modify: `tests/release-contract.test.ts`
- Modify: `FACTS_POLICY.md`
- Modify: `CONTRIBUTING.md`

- [ ] **Step 1: Extend release checks**

Require feed/snapshot identity agreement, valid configs, no unresolved Issue seed in public artifacts, no expired current thesis, and metrics/schema validity.

- [ ] **Step 2: Run two complete fixed-input generations**

Run: `pnpm run check && pnpm test && pnpm run validate:release && pnpm run validate:health`

Run the generator twice with the same fixed fixtures and clock. Expected: second run changes no snapshot, feed GUID, thesis version, or share-page payload.

- [ ] **Step 3: Run fault injection**

Simulate LLM outage, corrupt prior JSON, invalid company ID, evidence withdrawal, source timeout, and transaction swap failure. Expected: public outputs retain the last valid snapshot and the run reports a precise degraded/failed status.

- [ ] **Step 4: Run the physical-ai release-validation skill**

Follow `/Users/lijie/.codex/skills/physical-ai-release-validation/SKILL.md` completely, including post-push GitHub Actions and Pages checks when publishing is authorized.

- [ ] **Step 5: Commit final validation/docs**

```bash
git add src/validate-release.ts tests/release-contract.test.ts FACTS_POLICY.md CONTRIBUTING.md
git commit -m "docs: publish watchlist evidence methodology"
```

### Stage 4 acceptance gate

- [ ] Company and route feeds match the current snapshot and contain stable IDs.
- [ ] Shareable configs reject unknown or malicious values and require no account.
- [ ] Community submissions enter review only and cannot modify public truth.
- [ ] The period-change page explains every current snapshot delta.
- [ ] Product metrics preserve unknown values and keep Stars separate.
- [ ] Two consecutive full runs and all fault-injection cases preserve last-known-good behavior.
