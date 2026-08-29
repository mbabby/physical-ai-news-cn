# Phase 4 Attribution Identity Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove ambiguous contribution-event identities without weakening the append-only ledger or its last-known-good fallback.

**Architecture:** Encode contribution identity fields as one canonical JSON tuple before SHA-256 hashing, so every field boundary is explicit. Preserve the existing lifecycle and last-known-good semantics; metadata-only inactivity handling remains a documented non-blocking follow-up because changing it would alter legacy fallback projections.

**Tech Stack:** TypeScript, Node.js `crypto`, Node test runner, pnpm.

## Global Constraints

- New contribution IDs must be deterministic and unambiguous across every valid input tuple.
- Existing checked-in contribution and accepted-evidence ledgers are empty, so no ambiguous legacy ID is accepted or grandfathered.
- Validators must recompute the same canonical identity independently from artifact fields.
- No network calls, GitHub Issue mutation, workflow dispatch, Pages deployment, merge, or push.

---

### Task 1: Canonical contribution identity

**Files:**
- Modify: `src/community-evidence/contracts.ts`
- Test: `tests/community-evidence-contracts.test.ts`

**Interfaces:**
- Consumes: `{ taskId, issueNumber, contributor, evidenceUrl, state, occurredAt }`.
- Produces: `buildContributionEventId(input): string`, SHA-256 over `JSON.stringify([taskId, issueNumber, contributor, evidenceUrl, state, occurredAt])`.

- [x] **Step 1: Write a failing collision regression**

Assert that otherwise-identical tuples `(issueNumber=1, contributor="23")` and `(issueNumber=12, contributor="3")` produce different IDs, and that both accepted/contribution validators reject an ID copied from the other tuple.

- [x] **Step 2: Run the focused contract test and observe the collision failure**

Run: `node --import tsx --test tests/community-evidence-contracts.test.ts`

- [x] **Step 3: Use a canonical JSON tuple as the hash preimage**

Replace raw concatenation with `JSON.stringify([...])`; update the literal expected digest in the stable-ID contract test.

- [x] **Step 4: Re-run the focused test**

Run: `node --import tsx --test tests/community-evidence-contracts.test.ts`

### Task 2: Compatibility and release verification

**Files:**
- Modify only tests whose independent expected-ID encoder or timestamp fixture intentionally describes the stable identity contract.

- [x] **Step 1: Update the independent expected-ID encoder to the canonical tuple**

Keep expected values independent from `buildContributionEventId`; do not replace them with calls to the production function.

- [x] **Step 2: Remove accidental hash-order dependencies from lifecycle fixtures**

Where a reacceptance must append after a terminal event, give it a strictly later timestamp rather than relying on lexicographic hash order.

- [x] **Step 3: Run focused and full verification**

Run: `node --import tsx --test tests/community-evidence-task-ledger.test.ts tests/community-evidence-contracts.test.ts`, `pnpm run check`, `pnpm test`, `CI=true pnpm run validate:release`, and `git diff --check`.
