# Task 6 Report: Unified Decision Product Publication

## Outcome

- Added one validated `DecisionProductArtifact` materializer that consumes the canonical event, dual-ledger, research-card, and public Watchlist inputs.
- Reused the artifact by identity and order for `decision-products.json`, dashboard compatibility projections, README markers, the seven decision feeds, homepage sections, and weekly/company/research share pages.
- Staged every new decision surface in the existing daily `FileTransaction`; an injected `all.xml` swap failure restores all prior decision-product bytes.
- Preserved legacy dashboard fields when no decision artifact is supplied. During daily generation, `topSignals`, `companyRadar`, and `research` are direct compatibility references to the artifact arrays and do not rank again.
- Added explicit browser invalid-data states, safe text/URL rendering, accessible evidence/details, and subscription navigation on all four product surfaces.

## TDD Evidence

RED was observed before implementation:

- `site/data/decision-products.json` was missing.
- `DashboardData` did not contain or project the artifact.
- README lacked the Decision Signals marker section.
- Product pages lacked subscription navigation.

GREEN verification:

```text
pnpm exec tsx --test tests/decision-products-pipeline.test.ts tests/site-data.test.ts tests/site-ui.test.ts tests/propagation-assets.test.ts
52 tests, 52 passed, 0 failed

pnpm run check
tsc --noEmit (exit 0)

pnpm test
608 tests, 608 passed, 0 failed

node --check site/app.js
node --check site/share-pages.js
git diff --check
all exited 0
```

The pipeline test performs two generations with the same fixed input and compares artifact, dashboard, README, manifest, and feed bytes. It also injects failure at `site/feeds/decision/all.xml` and verifies every captured decision surface remains byte-identical to the previous release.

## Self-review

- No new sorting exists in markdown, feed staging, dashboard projections, or browser rendering.
- The artifact validator runs before staging and the staged subscription catalog must exactly match the publication URLs.
- Browser rendering escapes all artifact text and admits only HTTP(S) links through `safeUrl()`.
- Browser renderers reject malformed artifacts as invalid rather than presenting them as empty.
- Timestamp-less company profiles are omitted from the product at orchestration time; company cards continue to require a canonical profile, claim, correction, or material-event timestamp and never use the generator clock.
- No database, account, email, analytics, candidate input, raw model output, or public numeric decision score was introduced.

## Independent review corrections

- Prevented the legacy radar renderer from overwriting the canonical five-answer homepage cards.
- Tightened both browser validators to fail closed on undeclared product keys, private score/rank fields, malformed URLs, and noncanonical timestamps.
- Normalized and escaped README Markdown destinations, including parentheses and backslashes.
- Preserved legacy dashboard consumers with order-preserving, score-free adapters carrying the artifact `signalId`, `cardId`, and `passportId`; no adapter sorts.
