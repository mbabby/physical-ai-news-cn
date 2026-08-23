# Phase 1 Trust Foundation Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task.

**Goal:** Prevent false company attribution and unsupported research claims from reaching public surfaces, with deterministic offline gold-set regression tests.

**Architecture:** Introduce one strict entity-attribution contract shared by ingestion and migration, and one research eligibility contract shared by registry, decision cards, dashboard, README, and release validation. Ambiguous records remain review candidates; public output is an explicit projection of eligible records only.

**Tech Stack:** TypeScript, Node test runner, JSON fixtures, pnpm, GitHub Actions.

---

### Task 1: Strict company attribution contract

**Files:**
- Modify: `src/event-center.ts`
- Reuse: `src/candidate-verification.ts`
- Test: `tests/event-center.test.ts`
- Create: `tests/fixtures/company-event-gold-v1.json`
- Create: `tests/company-event-gold.test.ts`

1. Add failing tests for generic `humanoid`, short alias `TRI`, mentioned-company-first titles, unknown subjects, and historical sticky misattribution.
2. Define structured attribution output: canonical subject, mentioned entities, confidence, method, and review reason.
3. Match exact normalized names/domains and boundary-safe aliases only after extracting the grammatical title subject; prohibit generic aliases and substring matching.
4. Re-resolve stored events from source title/evidence instead of trusting `primaryEntity`; ambiguous subjects leave public stores.
5. Add 20 deterministic offline gold cases and require exact attribution/disposition results.

### Task 2: Existing-event audit and correction migration

**Files:**
- Modify: `src/event-center.ts`
- Modify: `events/index.json` only through the generator/migration path
- Test: `tests/event-anomalies.test.ts`
- Test: `tests/company-event-gold.test.ts`

1. Add failing regression tests for Schaeffler, Kollmorgen, VicOne, generic market commentary, and multi-company roundups.
2. Ensure corrections preserve evidence and occurrence timestamps while removing review/drop records from public company, route, funding, and deployment surfaces.
3. Make migration idempotent and expose stable reason codes for held records.

### Task 3: Evidence-backed research claims

**Files:**
- Modify: `src/research-registry.ts`
- Modify: `src/research-decision-card.ts`
- Modify: `src/event-center.ts`
- Test: `tests/research-registry.test.ts`
- Test: `tests/research-decision-card.test.ts`
- Create: `tests/fixtures/research-gold-v1.json`
- Create: `tests/research-gold.test.ts`

1. Add failing tests for negation, simulation-only evidence, future artifact releases, related-work mentions, and LAWM-3D.
2. Model each important research claim as `verified`, `announced`, `contradicted`, or `unknown`, with source field, URL, excerpt, and polarity.
3. Derive display tags and decision-card statements only from verified claims; citations alone cannot create milestone status.
4. Add 20 offline gold cases and require zero false positives for trusted tags and exact publication eligibility.

### Task 4: Bind research gates to publication

**Files:**
- Modify: `src/runtime/validation.ts`
- Modify: `src/main.ts`
- Modify: `src/site-data.ts`
- Modify: `src/validate-release.ts`
- Test: `tests/publication-robustness.test.ts`
- Test: `tests/site-data.test.ts`

1. Add failing tests for missing/mismatched decision cards, stale or ambiguous OpenAlex identity, contradictory claims, incomplete cards, and stale fallback bypasses.
2. Make research eligibility the single authorization source for README, dashboard, archives, and Top Research.
3. Validate one-to-one registry/card identity, claim consistency, eligibility, policy version, and generation freshness before publication.

### Task 5: Release verification

**Files:**
- Modify only if required by tests: release workflow and validation scripts.

1. Run focused gold-set and publication tests.
2. Run `pnpm run check`, `pnpm test`, `pnpm run validate:release`, `pnpm run validate:health`, and `git diff --check`.
3. Obtain independent code review and fix all correctness findings.
4. Merge to `main`, push, run two consecutive manual daily workflows, and verify Pages plus watchdog.

