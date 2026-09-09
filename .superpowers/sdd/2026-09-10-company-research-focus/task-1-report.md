# Task 1 report: company-first public entry

## Status

Implemented on `codex/company-research-focus` without changing canonical data, gates, generator source, dependencies, or generated marker payloads. The homepage now presents company competition research for investment and strategy researchers, with research and historical resources retained as auxiliary archive material.

## Changes

- Removed the homepage research navigation, metric, monitoring lane, research graph, and resource strip; retained a modest footer link to `research.html`.
- Reworked the homepage to three metrics and two monitoring lanes, with a single-column mobile layout.
- Guarded optional research DOM writes in `site/app.js`, including malformed Decision Product handling; no global exception suppression was added.
- Repositioned Chinese and English project copy around company, capital, deployment, and route competition without real-time recommendation or completeness claims.
- Kept `research.html` as an auxiliary evidence/archive renderer and added full GitHub URLs for the former model, dataset, and simulation resource directories.
- Folded the generated README research block and historical resource directory under closed `<details>` sections. `RESEARCH_UPDATES_START/END` content matches baseline byte-for-byte.

## TDD evidence

RED (`node --import tsx --test tests/site-ui.test.ts`): 20 tests, 18 passed, 2 failed as expected. Failures proved the old homepage still mounted `#research` and that the real DOM harness did not yet observe absent research mounts.

GREEN:

- `node --import tsx --test tests/site-ui.test.ts`: 20/20 passed.
- `node --import tsx --test --test-name-pattern='one artifact drives JSON' tests/decision-products-pipeline.test.ts`: 1/1 passed after two real fixed-fixture generations, proving marker replacement remains within the closed auxiliary `<details>` and does not restore primary research navigation.
- Baseline/current extraction diff for `RESEARCH_UPDATES_START/END`: no differences.

## Final verification

- `pnpm run check`: passed (`tsc --noEmit`).
- `pnpm test`: 1027/1027 passed, 0 failed.
- `pnpm run validate:release`: passed for 2026-09-09; 6 public items; repository reports existing `degraded` runtime state.
- `git diff --check`: passed with no output.

The first sandboxed full-test and release-validation attempts could not create the local `tsx` IPC socket (`EPERM`); rerunning with permission succeeded. An intermediate full run exposed four fixture-root failures because the recognizer intentionally keys on the legacy title phrase; the final company-focused title retains that phrase and the final full suite is green without generator changes.
