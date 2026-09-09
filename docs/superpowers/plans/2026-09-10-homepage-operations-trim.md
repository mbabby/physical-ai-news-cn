# Homepage operations trim implementation plan

> Use subagent-driven-development for this single scoped task.

**Goal:** Remove operational promotion from the company-research homepage, retaining contribution and correction services.

**Architecture:** Presentation-only deletion plus optional DOM guards. No canonical data, pipeline, workflow, publication policy, or contributor attribution changes.

**Tech Stack:** Existing static HTML/JS and node:test.

## Global Constraints

- Remove homepage community panel, metrics, task list and flywheel; remove primary community nav.
- Keep a footer link labelled 提交证据 / 纠错 to contribute.html; contribution center and underlying collectors, metrics, credits and audit records remain.
- No changes to generated data, README, workflows, gates or dependencies. Preserve unrelated .DS_Store and AGENTS.md.
- Company, capital, routes, status and archive must continue rendering on missing, valid and malformed payloads.

### Task 1: Remove homepage operations without breaking shared rendering

Files: site/index.html, site/app.js, tests/site-ui.test.ts, tests/site-render.test.ts; only other directly affected tests if necessary.
Interfaces: existing loadCommunity/renderCommunity and contribute view share app.js. Homepage has no community mounts; contribution view still loads tasks and shows attribution.

- [ ] Add a failing real-app VM test using actual index IDs: call renderCommunity with valid and null data with metrics mounts absent, followed by company renderer, assert company/status render successfully. Add homepage footer-link and no community-primary-entry acceptance checks; preserve contribution-center real rendering coverage.
- [ ] Run `node --import tsx --test tests/site-ui.test.ts tests/site-render.test.ts` and record expected RED.
- [ ] Remove the full community section from index and its nav link. Insert `<a href="contribute.html">提交证据 / 纠错</a>` in footer.
- [ ] Guard metrics render and skip fetching community metrics when its mounts do not exist, while preserving contribution-center tasks and credits. Keep shared renderer functionality intact. No exception swallowing. If bootstrap signature changes, update VM harness extraction to exercise the real functions.
- [ ] Run focused tests, `pnpm run check`, `pnpm test`, `pnpm run validate:release`, `git diff --check`. Root owns real-browser and live acceptance. No live generation is necessary for presentation-only changes.
- [ ] Commit only task files and report RED/GREEN, counts and caveats. Do not push. Root reviews, merges and deploys with user authorization.

## Acceptance

Desktop/mobile homepage has no operational panel or broken nav; footer reaches functioning contribution center. No null-mount crash or unnecessary homepage community metrics request. Unchanged evidence generation and public archives remain available.
