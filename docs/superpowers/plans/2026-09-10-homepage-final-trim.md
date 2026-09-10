# Final homepage reduction implementation plan

> Use subagent-driven-development for one presentation task. User explicitly delegated remaining deletion choices and authorized publishing in one batch.

**Goal:** Compact the company-research homepage without losing unique public information or hiding publication failure.

**Architecture:** Presentation deletion and optional DOM guards only. Keep verified/developing decision tiers, Watchlist, health status, archive and correction paths. Collapse supplemental industry/capital records rather than discard unique events.

**Tech Stack:** Existing static HTML/CSS/JS and node:test.

## Global Constraints

- No changes to generated data, generator, evidence policies, ranking, workflows, dependencies or README.
- Keep top-signals/developing evidence distinction and all current gates, Watchlist selection/config/deep links and legacy board fallback.
- Keep full publication-status with latest date and warnings; do not replace degraded/empty state with fabricated success or content.
- Keep all independent pages, canonical records, feed URLs, card IDs and correction links. Preserve unrelated .DS_Store/AGENTS.md.
- No removal of unique capital/industry events: retain existing feed render inside initially closed details; do not combine into topSignals or change publication gate.

### Task 1: Compact homepage and remove low-value scaffolding

Files: site/index.html, site/app.js, site/styles.css and directly affected UI/runtime tests (site-ui/site-render/propagation assets if necessary).

Interfaces: removed event-count/company-count/source-count and routes-grid mounts must be optional during render(data). updated stays as a truthful generation timestamp label, no perpetual '信号同步中' or pulse. Other views unchanged.

- [ ] Write failing runtime tests using actual homepage IDs: removal of metrics/routes does not throw for valid/missing/malformed data; status and Watchlist survive. Add DOM acceptance for a closed supplementary details wrapping both industry/capital mounts; real render shows a unique capital record not present in topSignals inside details. Keep normal feed behavior and evidence safety tests.
- [ ] Capture expected RED using focused node --import tsx --test tests.
- [ ] Replace giant hero with compact company-research header (one h1, one short factual description). Use homepage-specific CSS class and scoped overrides, not global hero rules affecting archives. Remove hero-actions duplicate CTA and terminal syncing animation, retain updated generation date. Existing decision head weekly link is the single summary CTA; rename it '查看完整简报 ↗'. Keep primary company/subscription navigation.
- [ ] Remove homepage metrics section and static routes section/nav target. Add secondary footer link '历史技术路线档案' to https://github.com/mbabby/physical-ai-news-cn/blob/main/resources/industry-landscape-and-tech-routes.md. Company directory route filters remain unchanged and company navigation remains.
- [ ] Move the existing supplemental signal-section into a closed details element labelled '更多产业与资本记录'. Keep both feed IDs and current notes/data unmodified. Style summary with clear affordance, keyboard focus and >=44px tap target. No duplicate feed data sources or ranking changes.
- [ ] Guard stats/routes DOM writes including invalid payload flow; remove calls only made redundant by deletions, do not broad-refactor shared app.js. Preserve updated/status render and no false all-clear.
- [ ] Cache-version homepage app.js and styles.css for changed DOM/style. Test scripts still boot real app and guard absent nodes. Use realistic test mount absence; retain coverage of archives/subscriptions/contribute.
- [ ] Run focused tests, pnpm run check, pnpm test, pnpm run validate:release, git diff --check. No live generation or canonical writes. Root real browser: desktop/mobile compact header, supplements closed by default/open expose unique capital card, Watchlist and footer paths work.
- [ ] Commit task files only; report red/green/counts/caveats to task scratch, no push. Root task/final review then authorized merge and Pages deploy.

## Acceptance

Default homepage hierarchy is compact identity/status, decision signals, company Watchlist, optional supplemental records. No giant hero/metrics/static route cards/repeated CTA. All preserved facts reachable and status remains honest. Tests and deployed behavior verified.
