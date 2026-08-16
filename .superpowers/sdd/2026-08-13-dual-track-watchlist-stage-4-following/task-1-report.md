# Stage 4 Task 1 Report — Company and Route Feeds

## Scope delivered

- Added `src/watchlist/routes.ts` as the sole canonical mapping for the five fixed route names and slugs.
- Extended `WatchlistPublicCard` with deterministic, nonempty, code-unit-sorted and deduplicated routes copied from `CompanyProfile.routes`; public, release, and browser validators reject malformed route collections.
- Added RSS 2.0 company and route feed builders in `src/watchlist/feeds.ts`. They consume only `WatchlistPublicView`, escape XML text/attributes, reject XML 1.0-invalid characters and unsafe URLs, use deterministic code-unit ordering and stable thesis/evidence/change GUIDs, and expose snapshot week/version metadata without a generated timestamp.
- Added the authoritative `site/feeds/manifest.json` shape with snapshot identity, company-feed IDs/paths, and all five canonical route-feed slugs/paths. Empty snapshots stage zero company feeds and five empty route feeds.
- Staged feeds and manifest through `stageWatchlistRelease` into the existing daily `FileTransaction`; `src/main.ts` supplies the repository Pages base URL through that same release transaction.
- Added public-boundary rejection for candidate IDs and private diagnostic/score/rank text before release or feed publication. Feed emitters only serialize approved card/change/evidence fields, so unknown fields such as private source text are rejected by the strict public-view shape.

## TDD record

1. **RED:** `node --import tsx --test tests/watchlist-public-view.test.ts` failed because public cards had no `routes`; **GREEN:** canonical profile routes were added and the public-view suite passed.
2. **RED:** `node --import tsx --test tests/watchlist-feeds.test.ts` failed because the feed module was absent; **GREEN:** RSS builders and transaction staging made all feed tests pass.
3. **RED:** browser validation accepted cards with empty routes; **GREEN:** both browser validators reject them and `tests/site-ui.test.ts` passed.
4. **RED:** feeds accepted `candidate-*` thesis IDs, private score text, and XML-invalid characters; **GREEN:** shared public-boundary checks and XML 1.0 character validation made the regression tests pass.
5. **RED:** release staging only contained five Stage 3 files when feeds were requested; **GREEN:** feed staging now happens within `stageWatchlistRelease`, with a twelve-file release-transaction integration assertion.
6. **Review fix RED:** non-hexadecimal and separator/case-variant candidate namespace values could reach a Feed, and a valid release could omit feeds; **GREEN:** the shared public boundary rejects reserved `candidate` identifiers while preserving normal prose, and release staging requires feeds before staging any file.
7. **Review fix RED:** manifest completeness had no focused validation path; **GREEN:** manifest validation rejects missing route paths and wrong feed paths, while the transaction test proves every listed path is staged.

## Verification

- `node --import tsx --test tests/watchlist-feeds.test.ts tests/watchlist-public-view.test.ts tests/watchlist-release-validation.test.ts tests/site-ui.test.ts` — passed.
- `pnpm run check` — passed.
- `pnpm test` — passed: 431 tests.
- `git diff --check` — passed.
- Read-only review completed after fixes: no remaining critical or important findings.

## Scope boundaries

No shareable configuration, Issues workflow, change page, metrics, deployment, push, or external network activity was added.
