# Stage 3 Task 4 report — Pages dual-track Watchlist

## Outcome

- Added semantic homepage mounts `company-watchlist`, `watchlist-forward`, `watchlist-momentum`, and `watchlist-changes` before the legacy company boards.
- A present, valid `dashboard.watchlist` renders the two public tracks with `重点关注` before `持续观察`, lifecycle and weekly-change labels, why-now, route/dependencies, next validation points and due dates, falsifiers, capital evidence, accessible canonical evidence links, a static `AI 研究判断` label, and honest `week` / `snapshotVersion` / `lastSuccessfulAt` identity.
- A missing `watchlist` keeps the existing homepage `companyBoards` and company share-page `companyRadar` compatibility paths. A malformed present value displays an explicit contract-error state and never masquerades as a valid empty snapshot.
- The company share page renders Watchlist tracks and changes before the retained company dossiers. In Watchlist mode the dossiers do not display momentum scores; absent mode retains the existing scored radar page.
- Public rendering selects fields explicitly, reuses `safe` / `safeUrl`, escapes dynamic attributes, and never renders Watchlist `score`, `rank`, or private diagnostic fields.
- `site/companies.html` was reviewed and did not require a mount change; its existing `#share-content` root remains the correct compatibility boundary.

## TDD evidence

1. Added static/runtime UI contract tests before product edits. Initial RED run: 1 passed, 5 failed for the missing mounts, renderer, share hierarchy, and styles.
2. Added a nested malformed-contract case after self-review. RED run: 5 passed, 1 failed because a string snapshot version and incomplete card were accepted.
3. Implemented strict public-view/card/change validation in both browser entry points. Final focused run: 6 passed, 0 failed.

The tests execute the real browser scripts in a dependency-free VM harness and cover valid, intentionally empty, malformed, and absent Watchlist inputs; safe URL/text/attribute handling; accessible evidence labels; private-field exclusion; group order; compatibility fallback; long Chinese copy; focus CSS; and the 390px breakpoint.

## Verification

- `pnpm exec tsx --test tests/site-ui.test.ts` — 6 passed, 0 failed.
- `pnpm test` — 407 passed, 0 failed.
- `pnpm check` — passed (`tsc --noEmit`).
- `node --check site/app.js` — passed.
- `node --check site/share-pages.js` — passed.
- `git diff --check` — passed.
- Task 4 diff contains only `site/index.html`, `site/app.js`, `site/share-pages.js`, `site/styles.css`, `tests/site-ui.test.ts`, and this report.

## Visual and accessibility QA

Used a localhost preview copied to a temporary directory with a representative public Watchlist fixture; no checked-in dashboard artifact was changed.

- 1440 × 1000: 3 cards and both tracks rendered, document width remained 1440/1440, the first card had no internal overflow, last-known-good identity was visible, and no score/rank text appeared.
- 390 × 844: Watchlist grid collapsed to one 334px column, root width remained within the 366px content area, document horizontal overflow was false, and long Chinese copy wrapped without clipping.
- Canonical evidence links had a 44px minimum target, `tabIndex` 0, an accessible name containing company/event/source/grade, and a keyboard-focused computed outline of 3px solid high-contrast yellow.
- The temporary server, preview directory, viewport override, and browser tab were cleaned up after inspection.

## Review

A read-only reviewer found one Important issue in the first implementation: shallow validation allowed nested malformed cards to look like a successful snapshot. A new failing regression case was added, both renderers were changed to validate the complete public card/change boundary, and re-review found no remaining Critical or Important issues. Reviewer verdict: ready within Task 4 scope.

## Non-blocking contract gap

`WatchlistPublicCard` does not expose thesis `expiresAt` or `inferenceLabels`. Task 4 therefore does not invent either field: it displays the static `AI 研究判断` disclosure, public `nextValidationPoints[].dueAt` as `验证期限`, and `lastSuccessfulAt` snapshot identity. A true thesis-expiry label would require an explicit future public-contract change.
