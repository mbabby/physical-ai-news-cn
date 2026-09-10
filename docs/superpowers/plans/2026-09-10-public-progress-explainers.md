# Public Progress Explainers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Explain recent Physical AI changes to non-specialists through at most three grounded Chinese cards, shared by homepage and README.

**Architecture:** Introduce one versioned projection over current public canonical records. Drafting and semantic review are separate bounded model calls; deterministic validation, dependency fingerprints, retention and transaction checks surround them. The existing archives, ledgers and collection pipeline remain authoritative.

**Tech Stack:** Existing TypeScript/Node 24, pnpm 11.9.0, node:test/tsx, static HTML/CSS/ES modules; no added dependencies.

## Global Constraints

- Specification: `docs/superpowers/specs/2026-09-10-public-progress-explainers-design.md` is approved.
- 产品展示名称：**物理 AI 进展解读**；英文：**Physical AI Explained**。仓库名称、地址及既有资料链接不变。
- 价值主张：**看懂机器人与物理 AI：现在能做什么，最近进步在哪，还有什么没解决。**
- 首页主线为“近期值得理解的变化”，最多三篇，允许零篇。
- 公开产物路径为 `site/data/progress-explainers.json`，采用 `schemaVersion: 1`。
- 主导航保留“近期解读”和“资料库”；旧地址保持有效。README 核心阅读区与首页共享解读身份、内容和顺序。
- 复用已有模型客户端、凭据和超时/预算约束，不新增服务商、Secret 或改变现有运行默认值。
- 撤回、冲突、失效身份和被移除证据优先于保留上一版。
- 本次授权本地开发与验证，不自动合并、推送、调用真实生成或部署。
- Preserve `.DS_Store`, untracked `AGENTS.md`, historical worktrees and existing canonical/public snapshots. Use isolated fixture outputs for generation.

---

### Task 1: Grounded explainer contracts, generation and retention

**Files:**
- Create: `src/progress-explainers/contracts.ts`, `canonical.ts`, `draft.ts`, `validate.ts`, `materialize.ts`, `markdown.ts`.
- Modify: `src/summarize.ts` (shared bounded structured completion method only).
- Test: `tests/progress-explainers.test.ts`, `tests/progress-explainers-model.test.ts`, `tests/helpers/progress-explainers.ts`.

**Interfaces:**
- Consumes existing `EventRecord[]`, `CompanyProfile[]`, `ResearchRecord[]`, `ResearchDecisionCard[]`, `BenchmarkResultLedger`, public facts helpers and `LlmSettings`.
- `buildExplainerSources(input: {events: EventRecord[]; companies: CompanyProfile[]; researchRecords: ResearchRecord[]; researchDecisionCards: ResearchDecisionCard[]; benchmarkResultLedger: BenchmarkResultLedger}): ExplainerSource[]`.
- `ExplainerSource`: `canonicalId`, `kind: 'event'|'research'`, `revision` (current canonical dependency fingerprint), `entityNames: string[]`, `eventDate`, `publishedAt`, `materiallyChangedAt` (date strings or `'unknown'`), `facts: Array<{factId:string;text:string;evidenceIds:string[]}>`, `evidence: Array<{evidenceId:string;url:string;source:string}>`, `contexts: string[]`, optional structured comparable baseline.
- `ExplainerDraft`: `titleZh`, `factsZh:[string,string]`, `changeZh`, `meaningZh`, `limitationsZh:string[]`, optional `backgroundZh`, optional `comparison:{beforeZh:string;afterZh:string;task:string;conditions:string}`, `contexts:string[]`, `fieldRefs:Record<string,string[]>` (fact IDs; include every narrative field and array element).
- `ProgressExplainerCard` extends draft with `id`, `revision`, `canonicalId`, `sourceRevision`, `kind`, resolved `evidence`, `eventDate`, `publishedAt`, `materiallyChangedAt`, `checkedAt`, `historical:boolean`.
- `ProgressExplainersArtifact`: `schemaVersion:1`, `generatedAt`, `lastContentUpdatedAt:string|null`, `checkedAt`, `status:'updated'|'no-new-content'|'constrained'|'unavailable'`, `cards:ProgressExplainerCard[]`.
- `ExplainerModel.completeJson(system:string,input:unknown):Promise<unknown>` is implemented using existing `CompatibleSummarizer` runtime (add method without changing summary defaults). Builder takes dependency injection for fixture tests, never treats caller draft as reviewed.
- `buildProgressExplainers(input:{sources:ExplainerSource[];now:Date;previous?:ProgressExplainersArtifact;model?:ExplainerModel;upstreamConstrained?:boolean}):Promise<{artifact:ProgressExplainersArtifact;report:ExplainerRunReport}>`.
- `ExplainerRunReport`: counts `requestsSucceeded`, `structureRejected`, `evidenceRejected`, `semanticRejected`, `timedOut`, `failed`, `retained`, `removed`; rejected drafts remain internal only, no raw response or secrets in logs.
- `validateProgressExplainersArtifact(value:unknown):asserts value is ProgressExplainersArtifact`; `validateExplainerDependencies(artifact:ProgressExplainersArtifact,sources:ExplainerSource[]):void`; `renderProgressExplainersMarkdown(artifact:ProgressExplainersArtifact):string`; `replaceProgressExplainersReadme(readme:string,artifact:ProgressExplainersArtifact):string` uses `PROGRESS_EXPLAINERS:START/END` markers.

- [ ] **Step 1: Establish failing behavioral tests** using real public fixture records. Draft/model doubles only replace network boundaries; source conversion and all validators execute normally. Test two valid factual sentences, author-report research without fake company, exact IDs/order, invalid identity, withdrawn/discovery/conflicted evidence, duplicate versions, unknown dates, English/placeholder/generic meaning, unsupported number/entity, unmatched baseline and context escalation. A literal valid fixture uses a lab reporting a gripper trial; do not invent production news.

```ts
test('withdrawal wins over model outage', async () => {
  const previous = validPreviousArtifact();
  const result = await buildProgressExplainers({sources:[], previous, now:new Date('2026-09-10T00:00:00Z'), model:failingModel()});
  assert.deepEqual(result.artifact.cards, []);
  assert.equal(result.artifact.status, 'unavailable');
  assert.equal(result.report.removed, 1);
});
```

- [ ] **Step 2: Run RED:** `pnpm exec tsx --test tests/progress-explainers.test.ts tests/progress-explainers-model.test.ts`; record failures attributable to missing behavior.
- [ ] **Step 3: Implement contract and current-source adapter.** Reuse canonical publication/research eligibility, ownership and ledger validation, stable evidence identities. Fingerprint all narrative dependencies including identity, facts, evidence text/status and comparable fields. Material timestamp never uses ingestion/check clocks. Include all valid sources for retention; apply 30-day selection window in builder, not adapter.

```ts
const recent = sources.filter(s => inLookback(s.eventDate !== 'unknown' ? s.eventDate : s.publishedAt, now, 30));
const retained = previous?.cards.filter(card => currentSources.get(card.canonicalId)?.revision === card.sourceRevision) ?? [];
```

- [ ] **Step 4: Implement bounded draft + independent review.** Structured prompt treats supplied text as untrusted data, requests IDs not URLs. Resolve links from canonical sources. Require Chinese/nonempty fields, exactly two factual sentences, per-field references and evidence-backed numbers/entities; compare only compatible baseline. Semantic review must return explicit field verdicts for every field (facts/interpretation/limitations/context/comparison), reject missing/negative/unavailable verdicts. No model approval bypasses deterministic checks. Reuse existing 30s attempt timeout and two-attempt maximum; stop new explainer requests after provider circuit failure, cap selection at three candidates per run and preserve any enclosing remaining budget. Avoid refactoring existing summary logic beyond extracting its reusable transport if necessary.

```ts
if (!structural.ok || !grounding.ok) return rejected;
const review = await reviewDraft(model, source, draft);
if (!review.approved || requiredFields.some(key => review.fields[key] !== true)) return rejected;
```

- [ ] **Step 5: Implement deterministic selection, revision and retention.** Sort eligible items by verified material-change date (known event/disclosure fallback) descending then canonical ID; deduplicate before model calls. Unchanged valid old cards need no new model review; unchanged rerun keeps card ID/revision/content and last-content timestamp. Any dependency change requires new review or removal. Safe historical retention is clearly marked and original dates unchanged. Differentiate no eligible input, model constraint and no safe content. Strict runtime artifact validation rejects extra private/model fields and malformed dates/IDs/links.
- [ ] **Step 6: Render escaped Markdown** from artifact only, with all fields, expandable background/evidence, historical/date/status text; replacement refuses duplicate/unbalanced markers and preserves unrelated generated blocks.
- [ ] **Step 7: Run GREEN** focused tests and `pnpm run check`; run full suite before commit, record baseline failures separately. Commit only task files; report RED/GREEN evidence and interfaces in ignored task report.

### Task 2: Transactional pipeline, runtime status and publication validation

**Files:**
- Create: `src/progress-explainers/publication.ts`, `tests/progress-explainers-publication.test.ts`.
- Modify: `src/main.ts`, `src/validate-release.ts`, `scripts/stage-generated-publication.sh`, relevant `tests/fixture-mode-cli.test.ts`, `tests/stage-publication.test.ts`, `tests/release-contract.test.ts`.

**Interfaces:**
- Consumes all Task 1 APIs verbatim.
- `stageProgressExplainers(input:{root:string;transaction:FileTransaction;artifact:ProgressExplainersArtifact;readme:string;sources:ExplainerSource[]}):string` stages JSON and returns README projection; does not commit transaction separately.
- `validateProgressExplainersPublication(input:{artifact:unknown;readme:string;sources:ExplainerSource[];expectedGeneratedAt?:string}):void` verifies schema/current dependencies/time and exact Markdown projection/order.
- Internal report: `review/progress-explainers-run.json`; public artifact contains no drafts/provider details.

- [ ] **Step 1: Write failing real transaction tests** for consistent group success, JSON/README disagreement, removed source despite prior model failure, invalid old artifact, and refusal to stage incomplete groups.

```ts
test('rejects README from a different artifact', () => {
  assert.throws(() => validateProgressExplainersPublication({artifact:validArtifact(),readme:'<!-- PROGRESS_EXPLAINERS:START -->\nstale\n<!-- PROGRESS_EXPLAINERS:END -->',sources:validSources()}));
});
```

- [ ] **Step 2: Run RED:** `pnpm exec tsx --test tests/progress-explainers-publication.test.ts`.
- [ ] **Step 3: Connect only current public sources** after canonical ledgers/research have been materialized. Load previous artifact defensively, call builder with existing summarizer (fixture injection uses deterministic network substitute in test utilities), expose runtime status alongside LLM/OpenAlex without hiding their degradation. Prepare safe removals before model work. Stage JSON and README in existing `FileTransaction`; known withdrawal with exchange failure must throw and report blocking generation status. Do not claim failed exchange removed online content.

```ts
const sources = buildExplainerSources(canonicalInputs);
const result = await buildProgressExplainers({sources, now, previous, model:explainerModel, upstreamConstrained});
const readme = stageProgressExplainers({root:outputRoot,transaction,artifact:result.artifact,readme:coreReadme,sources});
```

- [ ] **Step 4: Extend release validator and shell allowlist/group gate.** Rebuild current sources from the same canonical inputs used at generation, verify dependencies and README projection, forbid missing or mismatched new artifact on new homepage. Preserve backward compatibility for archived old-layout fixture snapshots, not a production missing-artifact bypass. Include report in generated staging if existing review reports are staged. Update fixture README identity guard to recognize new brand while retaining legitimate old fixtures.
- [ ] **Step 5: Verify two complete isolated fixture runs.** Use `mktemp -d /tmp/physical-ai-explainers.XXXXXX` and CLI `pnpm start -- --fixture --output-root "$fixture_dir"`; compare IDs/revisions and README order/content across both runs, validate the output root using existing release CLI root option (inspect its argument contract). If fixture has zero eligible reviewed content, test zero honestly and cover nonempty two-run behavior in injected full-generation integration test. Never hardcode fixture success in production validators.
- [ ] **Step 6: Run GREEN:** targeted publication/fixture/staging/release tests, `pnpm run check`, then full suite before commit. Commit task files and report commands, outputs, both fixture paths/results and any pre-existing snapshot degradation.

### Task 3: Accessible reading homepage, library and project positioning

**Files:**
- Create: `site/progress-explainers.js`, `tests/progress-explainers-render.test.ts`.
- Modify: `site/index.html`, `site/app.js`, `site/styles.css`, `README.md`, `README.en.md`, `assets/social-preview.svg`, `FACTS_POLICY.md`; affected homepage/README tests only.

**Interfaces:**
- Consumes `ProgressExplainersArtifact` JSON unchanged; no frontend sorting, scoring, drafting or dashboard news fallback.
- `renderProgressExplainers(artifact:unknown):string` in `site/progress-explainers.js` returns escaped accessible HTML or explicit unavailable state for malformed input.
- Homepage `#progress-explainers` is the single card mount; main navigation points at `#briefing` and `#library`. Preserve legacy anchors under library as appropriate.

- [ ] **Step 1: Add failing render tests** exercising exported renderer output for literal card order/identity/content, HTML injection escaping, missing/malformed artifact, 0 cards, historical dates, distinct four states, facts vs interpretation/limitations, expandable evidence and unknown dates. Use existing DOM-test dependency only if installed; otherwise exercise renderer directly and browser QA.

```ts
test('never turns an unavailable artifact into candidate news', () => {
  const html = renderProgressExplainers(null);
  assert.match(html, /暂不可用|加载失败/);
  assert.doesNotMatch(html, /data-explainer-id=/);
});
```

- [ ] **Step 2: Run RED:** `pnpm exec tsx --test tests/progress-explainers-render.test.ts`.
- [ ] **Step 3: Implement semantic card HTML** with title, exactly two facts, change, explicitly labelled 解读, limitations, optional details for background/evidence and dated provenance. Use text escaping, safe HTTP(S) links, keyboard details/focus, readable ≥16px body and ≥44px principal touch targets. Keep existing design palette without noisy new effects. Show artifact health and separate check/content time; no made-up time on fetch failure.
- [ ] **Step 4: Replace main reading path.** Existing company/investment/watchlist controls move into library details/links, old files and anchors stay valid. Homepage fetches new artifact independently of archived dashboard; dashboard failure must not erase valid explainers. Archive initialization runs only when needed and cannot overwrite main cards. Add cache revision to changed assets while preserving research page compatibility.
- [ ] **Step 5: Update README/en and policies.** New value proposition and reading marker at top. Fold all seven old generated marker blocks into clearly labelled library sections without deleting content. Empty initial explainer block must honestly indicate not yet generated; generate local matching zero artifact only via current canonical builder, never invent cards. Scope old ranking rules to archived products. Public evidence review is assistive, not guaranteed truth. Social SVG uses new identity, preserve existing geometry/accessibility.
- [ ] **Step 6: Run GREEN** render + affected tests, typecheck/full suite and release validation. Test desktop and 390px browser using approved CUA browser tools against local server; inspect readable facts/details/evidence links, zero horizontal overflow and network/error fallback. Do not alter live website or browser credential stores. Record real-reader comprehension study as not conducted, not simulated by agents.
- [ ] **Step 7: Commit and report.** Include changed file list, tests and browser evidence. Final controller performs whole-branch review and fresh verification; no merge/push without explicit user request.

## Plan self-review

- Coverage: Task 1 owns content safety/semantic review/retention; Task 2 owns shared transactional consistency and real generation; Task 3 owns cognition-first reading and archive preservation.
- Interfaces are declared once in Task 1 and consumed unchanged; helpers in example tests are test-only fixtures implemented beside tests.
- No production news backfill, additional workflow permissions, provider changes, growth tooling or reader-study claims.
