# Explainer timeout recovery

User approved the three-part repair: bounded recovery, explicit core-content failure, and reader-visible reasons. Implement in place on a repair branch; no provider, secret, schedule or publication gate changes.

1. Add failing regressions for transient failure followed by a valid candidate, two failed candidates stopping the batch, permanent authentication failure, and readable timeout reasons.
2. Preserve the existing two HTTP attempts per structured request. Retry only transient typed transport errors; normalize response-body timeouts too. Allow another candidate after transient exhaustion, capped at two failed candidates per run. Never retry rejected evidence or publish an unreviewed draft.
3. Add an optional allowlisted diagnostic reason to the public artifact, compatible with old snapshots. Validate it in TypeScript and browser, render fixed Chinese labels rather than provider error strings. Emit an Actions warning and precise service receipt on core-content failure without blocking valid archive publication.
4. Run affected tests, typecheck, full tests, release validation, and two isolated offline generations. Preserve original public data. Merge/push and live service execution require separate authorization.
