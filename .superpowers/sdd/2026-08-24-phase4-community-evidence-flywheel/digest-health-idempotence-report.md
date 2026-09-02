# Digest Health Idempotence Fix Report

## Delivered

- An unavailable GitHub snapshot with a complete prior projection and zero accepted evidence now records `EvidenceRevalidation` as successful with coherent zero counters. Nonempty accepted evidence retains the existing partial-degradation behavior.
- Public `publicationHealth` now contains only the safe nonnegative aggregate `sourceFailureCount`; the homepage shows `信源失败 N` only when its normalized count is positive.
- Only services reporting `部分降级` appear in public `degradedComponents`. `未配置` services no longer create a public degradation signal.
- The fixed-input rerun contract remains byte- and semantically idempotent. LKG fault assertions now permit only the current run's safe `publicationHealth` delta, requiring every other public artifact and dashboard field to remain unchanged.

## Verification

- Targeted community-evidence, site-data, homepage UI, and daily Watchlist release integration tests: 63 passed.
- Full suite via the local `tsx` binary: 865 passed.
- Typecheck: `tsc --noEmit` passed.
- `git diff --check` passed.

## Scope

No push, merge, or external publication was performed.
