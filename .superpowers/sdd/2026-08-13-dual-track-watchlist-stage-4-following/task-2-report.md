# Stage 4 Task 2 report — shareable account-free Watchlists

Status: complete

Implemented a stateless, shareable Watchlist configuration using only the current immutable `dashboard.watchlist` company IDs, current card route membership, and the fixed canonical route slug table. The browser renders accessible company and route selectors, clear/reset and copy-link controls, visible decoding/copy feedback, and preserves existing track/group order while filtering with the specified union semantics.

Safety and boundary checks:

- Configs encode only the canonical query string in `watch` then `routes` order; values are code-unit sorted, deduplicated and bounded to 30 companies / 10 routes.
- Decoding never evaluates URLs or HTML, accepts raw query strings and `URLSearchParams`-compatible values, and ignores malformed, unsafe, unknown, expired/no-longer-current, non-canonical, excessive and over-limit input with visible warnings.
- Copy URLs are built only from `window.location.origin + window.location.pathname`; no selection is persisted, and clipboard failures leave the view unchanged.
- The no-bundler browser implementation is parity-tested in a VM against the TypeScript implementation for canonical, malformed, non-canonical-route and HTML-payload fixtures.

Verification:

- `node --import tsx --test tests/watchlist-config.test.ts tests/site-ui.test.ts tests/watchlist-feeds.test.ts` — 18 passed.
- `pnpm run check` — passed.
- `pnpm test` — 439 passed.
- VM accessibility/self-check — passed through `tests/site-ui.test.ts` (semantic controls, live feedback, focus styling and 44px controls).

Concerns: none.

## Fix round 1/5

Status: fixed

- Root cause: the browser accepted any non-empty `companyIds` array and merged it into the selector catalog, unlike the serialized public-view contract.
- RED: VM regressions showed that extra, missing, duplicate and reordered `companyIds` still rendered public cards.
- GREEN: `validWatchlist` now requires the ordered, unique IDs of the current forward-radar and validated-momentum cards exactly; invalid data fails closed. `watchlistCatalog` now derives company IDs solely from cards.
- Regression checks: `node --import tsx --test tests/watchlist-config.test.ts tests/site-ui.test.ts` — 15 passed; `pnpm run check` — passed; `pnpm test` — 440 passed; `git diff --check` — passed.

Concerns: none.
