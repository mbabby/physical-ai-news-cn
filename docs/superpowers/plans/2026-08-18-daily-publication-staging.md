# Daily Publication Staging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every generated publication artifact is staged before the daily workflow rebases and pushes.

**Architecture:** Put the generated-path allowlist and dirty-worktree diagnostic in one executable shell boundary. The GitHub workflow delegates staging to that boundary, while an integration test executes it in a temporary Git repository.

**Tech Stack:** Bash, Git, GitHub Actions YAML, Node.js test runner, TypeScript.

## Global Constraints

- Preserve the candidate/public evidence gates.
- Do not stage secrets, dependency directories, or arbitrary ignored files.
- Keep `.DS_Store` untouched.
- A generated path omitted from the allowlist must fail before rebase with its path in the diagnostic.

---

### Task 1: Executable staging boundary

**Files:**
- Create: `scripts/stage-generated-publication.sh`
- Create: `tests/stage-publication.test.ts`
- Modify: `tests/release-contract.test.ts`
- Modify: `.github/workflows/daily-digest.yml`

**Interfaces:**
- Consumes: a clean Git checkout after the daily transaction writes publication artifacts.
- Produces: a Git index containing all declared publication outputs, or a non-zero diagnostic listing omitted paths.

- [ ] **Step 1: Write the failing integration and workflow contract tests**
- [ ] **Step 2: Run the focused tests and confirm failure because the staging script is absent**
- [ ] **Step 3: Implement the minimal staging script and delegate to it from the workflow**
- [ ] **Step 4: Run focused tests, type checking, the full suite, release validation, and health validation**
- [ ] **Step 5: Commit, push, trigger two daily runs, and verify Pages deployment**
