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
41 tests, 41 passed, 0 failed

pnpm run check
tsc --noEmit (exit 0)

pnpm test
610 tests, 610 passed, 0 failed

node --check site/decision-products-validator.js
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
- Consolidated browser validation in `site/decision-products-validator.js`; both renderers use the same recursive exact-schema implementation for nested objects, arrays, enums, stable IDs, canonical dates/timestamps, URLs, evidence semantics, and private/candidate boundaries.
- Normalized and escaped README Markdown destinations, including parentheses and backslashes.
- Preserved legacy dashboard consumers with order-preserving, score-free adapters carrying the artifact `signalId`, `cardId`, and `passportId`; no adapter sorts.

## Final last-known-good correction

- `generateDaily()` now strict-loads the prior `site/data/decision-products.json` before building the next artifact. A malformed, candidate-bearing, or private prior artifact fails closed before publication.
- Current Top Signals remain current-only and may be empty. Company cards and Research Passports merge per canonical identity: current canonical items keep their builder order and priority, then independently revalidated missing prior identities fill remaining space within the existing 20/6 caps. Retained item timestamps are copied unchanged; the generator clock is used only for the new artifact and subscriptions.
- Retained company cards must still match a current canonical company entity, profile, route, Watchlist projection, event ownership, public evidence lifecycle, and live Claim Ledger evidence. Withdrawals, conflicts, later corrections, unsupported known evidence, ownership changes, and candidate/private data remove the item.
- Retained Passports require the current canonical paper/source, non-retracted status, fresh non-retracted OpenAlex metadata, a current eligible decision card with the same canonical paper/work ownership, and current Benchmark Ledger support for every known benchmark/result/asset value. A missing current card, work-ID change, retraction, stale metadata, missing ownership, or unsupported known evidence removes the item.
- OpenAlex work ownership is normalized once for both the production research selector and Passport retention (`W…` and `https://openalex.org/W…` resolve identically). Retention recomputes ambiguity across every current research record and rejects missing, invalid-domain, mismatched, or non-unique work ownership even when the affected current decision card is absent.
- The orchestration marks Passport projection degraded only when a strict prior artifact exists, current eligible research cards remain, and LLM/OpenAlex runtime status is degraded. This preserves last-known-good projection bytes without treating card absence as identity evidence; standalone release reconstruction derives the same state from the run manifest.
- The two-run regression starts with a generated non-empty company card and Passport, then supplies sparse/degraded inputs and proves both identities and their material timestamps survive while Top Signals stays empty. Same-count identity replacement, withdrawal, retraction, entity-type change, unsupported Benchmark data, candidate/private prior data, and receipt-stage rollback are covered separately.

## Durable OpenAlex identity correction

- `ReproducibilityPassport.authority.openAlexWorkId` is now a required public source identity containing only the canonical OpenAlex work ID (`W…`). The strict TypeScript and shared browser contracts require the exact field and reject legacy Phase 3 artifacts that omit it, URLs in place of IDs, noncanonical IDs, and undeclared authority data.
- The Passport builder copies the identity only from the canonical OpenAlex record selected for the current eligible research card. The UI renders it through the existing safe URL/text helpers; no private, candidate, score, or receipt fact was introduced.
- Retention now requires the stored prior work ID to equal both the unique current normalized OpenAlex record identity and the current eligible decision-card identity. Consequently a prior W1 Passport is dropped when the current paper resolves to W2 even during an explicitly degraded Passport projection, while W1 remains retainable when current card and record ownership still prove W1.
- Regression coverage includes TypeScript/browser contract mutations, W1-to-W2 replacement with a valid current card, same-W1 degraded retention, duplicate current work IDs, ownership normalization, and release reconstruction fixtures carrying the exact public identity.

Focused verification for this correction:

```text
decision-product contracts/passports/retention/pipeline/release/research/UI/publication robustness:
90 passed, 0 failed
full suite: 626 passed, 0 failed
pnpm run check: exit 0
node --check site/decision-products-validator.js site/app.js site/share-pages.js: all exit 0
git diff --check: exit 0
```
