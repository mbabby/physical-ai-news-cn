# Company directory focus implementation plan

> Use subagent-driven-development for the single migration task.

**Goal:** Shorten the homepage by moving full company browsing to companies.html while keeping homepage Watchlist and all public evidence.

**Architecture:** Static presentation migration only. Homepage no longer mounts company-radar or its filters; companies.html renders all already-public cards with route/region/capital-status filters, using existing contract validation. No data generation or ranking changes.

**Tech Stack:** Existing static HTML/JS/CSS and node:test VM runtime coverage.

## Global Constraints

- Keep homepage confirmed/developing signals, Watchlist, legacy board fallback, capital/industry lanes, routes, status, correction and research archive links.
- Remove homepage full company cards and route/region/status controls. Keep their company-query capability in companies.html.
- Company directory shows all public cards, not an arbitrary first 18; preserve existing order (decision product array order, legacy momentum sort), card IDs, safe evidence URLs and unknown states.
- Invalid decisionProducts must fail closed; never fallback to legacy to bypass validation. Do not mix unverified records into public directory.
- No canonical data, pipeline, ranking, workflow, README, policy or dependency changes. Preserve unrelated .DS_Store and AGENTS.md.
- Public wording: 全部公司档案 and 核心研究覆盖 replace 旧公司卡/Watchlist and Core 30 shorthand in the touched navigation; preserve URLs.

### Task 1: Move full directory and filtering off homepage

Files: site/index.html, site/app.js, site/companies.html, site/share-pages.js, site/core-coverage.html navigation copy; directly affected tests (tests/site-ui.test.ts and relevant existing share render tests). CSS only if needed for existing radar-controls reuse.

Interfaces: app render(data) must tolerate absent company-radar/filter mounts across valid, missing and invalid decisionProducts; renderCompanySection/Watchlist remains. share-pages companies(data) owns full directory and filter events. Filter choices derive from public rendered records only; combine filters by AND and empty selection means all. Capital status uses existing structured state/ evidence semantics, never guesses from summary text; inspect validated card fields before mapping. Default order unchanged by filtering; reset returns all.

- [ ] Add failing tests using real index IDs: homepage lacks directory/filter mounts but valid, fallback and malformed renders do not throw; Watchlist/status still render, no dangling primary link.
- [ ] Add runtime company-page tests with >18 legacy records and valid decision cards: all display, route/region/status filters combine correctly, reset restores order, unknown stays unknown, malicious labels/URLs escaped, invalid decision payload remains blocked. Preserve stable card ID links and contract tests.
- [ ] Run focused node --import tsx --test commands and record RED before production changes.
- [ ] Remove homepage radar-controls and company-radar; guard their render/setup and invalid-data writes. Keep Watchlist config controls. Add clearly named directory and coverage links, preserve #companies.
- [ ] On companies.html add reusable existing radar-controls UI with accessible labels and reset, plus a dedicated directory result mount; keep existing card evidence content and render validation. Remove legacy slice(0,18), attach listeners once, rerender only directory results so controls retain focus. In decision mode derive filter options from validated cards and keep canonical array ordering.
- [ ] Remove old-version wording from touched company/coverage navigation. Bump homepage app.js query and companies share-pages.js query for cache-safe changed DOM.
- [ ] Run focused tests, pnpm run check, pnpm test, pnpm run validate:release, git diff --check. No live generation needed; no canonical writes.
- [ ] Commit task files only; detailed red/green report to task scratch. No push. Root owns reviews, desktop/mobile UI/filter QA, main merge and authorized Pages release.

## Acceptance

Homepage has no full company list/filter while Watchlist remains. Directory retains all public cards, evidence and functioning filters, handles invalid/missing/empty data safely. Existing card deep links work. All affected tests pass and live deployment is verified.
