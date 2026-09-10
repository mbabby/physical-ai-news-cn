# Task 1 report: native README and readable evidence presentation

## Result

- Replaced the README hero/badge/navigation wall with one native H1, one-sentence purpose, three primary links, and an honest Beijing-time schedule note.
- Put verified weekly conclusions and events first, followed by company/watchlist material; folded Core 30, operational status, supplemental research, and collaboration/history without hiding the live Actions/health link.
- Kept all seven generated marker pairs exactly once and byte-identical to the task base: PROJECT_STATUS, CORE_COVERAGE, DECISION_SIGNALS, EVENT_CENTER, WATCHLIST, COMPANY_RADAR, and RESEARCH_UPDATES.
- Unified the current Chinese/English product name, homepage title/headline, and social preview; retained descriptive standalone page names.
- Added screen-only, view-scoped 16px research body/definition typography, 12px evidence/source/status labels, and warning-amber developing-card presentation. Existing print, focus, mobile, and 44px target rules remain intact.
- Updated stylesheet cache keys on homepage, company directory, and Core 30. The fixture checkout guard recognizes both the new product name and historical fixture names; generation and publication behavior are unchanged.

## Tests and evidence

- Baseline focused tests: 30/30 passed.
- Red: the first full suite after the product rename failed 4 fixture-mode tests because the fixture identity guard required the old README title.
- Green: fixture/README/Core focused regression passed 24/24 after the compatibility guard update; full suite passed 1036/1036.
- `pnpm run check`: passed.
- `pnpm run validate:release`: passed for 2026-09-10 with 7 public items; reported the existing honest `degraded` runtime state.
- `git diff --check`: passed.
- Browser QA by root: desktop first viewport and 390px homepage/company/Core views had no horizontal overflow; body text reached 16px and labels 12px; status date remained visible. Final developing-badge selector was adjusted against the observed DOM to use amber without changing evidence-state data.

## Scope and concerns

- No live or fixture publication generation was run as a smoke test; only fixture-mode regression tests used isolated temporary roots.
- No generated marker content, workflows, schedules, runtime settings, canonical data, release gates, or historical hero asset were changed.
- Release validation truthfully remains `degraded`; this task does not alter or conceal operational health.
