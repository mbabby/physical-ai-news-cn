import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { CompanyClaimLedger } from "../company-claim-ledger.js";
import { validateLedgerField, type LedgerField } from "../ledger-contracts.js";
import { FileTransaction, isObject, readJsonStrict } from "../runtime/storage.js";
import { shanghaiDailyDate } from "../runtime/daily-date.js";
import type { CompanyProfile, EventRecord } from "../types.js";
import type { ReviewCaseSeed } from "../review-cases.js";
import { buildApprovedAnalysisTemplates, buildCoverageBriefs } from "./brief.js";
import { deriveCoverageCorrections } from "./corrections.js";
import type { CoverageBrief, CoverageCorrection, CoverageMember, CoverageVersion } from "./contracts.js";
import { selectCoverageVersion, validateCoverageVersion } from "./registry.js";
import { coverageWindows, type CoverageWindows } from "./timeline.js";
import { backfillTaskId, buildBackfillReviewCaseSeeds, buildBackfillTasks, reopenCheckedBackfillTasks, type BackfillTask, type BackfillPrioritySignal } from "./backfill.js";

export type PublicCoverageVersion = Omit<CoverageVersion, "members"> & { members: Omit<CoverageMember, "ownerRole">[] };
export interface CoreCoverageArtifact {
  schemaVersion: 1;
  coverage: PublicCoverageVersion;
  generatedAt: string;
  windows: CoverageWindows;
  subjects: Array<{ companyId: string; name: string; routes: CompanyProfile["routes"]; entityType: NonNullable<CompanyProfile["entityType"]> | "unknown"; officialUrl: string }>;
  briefs: CoverageBrief[];
  metrics: { coveredSubjects: number; completeBriefs: number; coverageRatio: number };
}
export interface CoreCoverageHistory {
  schemaVersion: 1;
  generatedAt: string;
  versions: PublicCoverageVersion[];
  snapshots: CoreCoverageArtifact[];
  corrections: CoverageCorrection[];
}
export type CoreCoveragePublicHistory = Omit<CoreCoverageHistory, "snapshots">;
export interface CoreBackfillCheckpoint {
  schemaVersion: 1;
  coverageVersion: string;
  generatedAt: string;
  tasks: BackfillTask[];
  archivedTasks: BackfillTask[];
}
export interface CoreCoverageState {
  coverage: CoverageVersion;
  tasks: BackfillTask[];
  archivedTasks: BackfillTask[];
  previousArtifact?: CoreCoverageArtifact;
  history?: CoreCoverageHistory;
}
export interface CoreCoverageInput {
  coverage: CoverageVersion;
  companies: CompanyProfile[];
  events: EventRecord[];
  ledger: CompanyClaimLedger;
  now: Date;
}
const fields = ["eventDate", "round", "amount", "valuation", "investors", "product", "customer", "deployment", "productionStage"];
const routes = ["数据与训练", "VLA 与具身模型", "世界模型与空间智能", "本体与硬件", "部署与商业化"];
const bytes = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
function requireThat(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(`Core 30 ${message}`); }
function exact(value: unknown, required: string[], optional: string[] = []): asserts value is Record<string, unknown> {
  requireThat(isObject(value) && required.every((key) => key in value) && Object.keys(value).every((key) => [...required, ...optional].includes(key)), "字段不合法（包含内部或未知字段）");
}
function text(value: unknown): asserts value is string { requireThat(typeof value === "string" && value.trim(), "文本不合法"); }
function list(value: unknown): asserts value is unknown[] { requireThat(Array.isArray(value), "数组不合法"); }
function strings(value: unknown): asserts value is string[] { list(value); value.forEach(text); requireThat(new Set(value).size === value.length, "重复 identity/证据"); }
function clock(value: unknown, unknownAllowed = false): void {
  if (unknownAllowed && value === "unknown") return;
  text(value);
  requireThat(/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) && Number.isFinite(Date.parse(value))
    && new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) === value.slice(0, 10), "时钟不合法");
}
function https(value: unknown): void { text(value); const url = new URL(value); requireThat(url.protocol === "https:" && !url.username && !url.password, "证据 URL 不合法"); }
function publicVersion(coverage: CoverageVersion): PublicCoverageVersion {
  return { ...coverage, members: coverage.members.map(({ ownerRole: _owner, ...member }) => ({ ...member })) };
}
function privateVersion(coverage: PublicCoverageVersion): CoverageVersion {
  return { ...coverage, members: coverage.members.map((member) => ({ ...member, ownerRole: "maintainer" })) };
}
function validatePublicVersion(value: unknown): asserts value is PublicCoverageVersion {
  exact(value, ["schemaVersion", "version", "effectiveFrom", "members", "previousVersion", "changeReasonZh"]);
  list(value.members);
  value.members.forEach((member) => exact(member, ["companyId", "coverageRegion", "tier", "reasonZh"]));
  const version = value as unknown as PublicCoverageVersion;
  validateCoverageVersion(privateVersion(version), version.members.map((member) => ({ entityId: member.companyId } as CompanyProfile)));
}
function field(value: unknown, known = false): void {
  exact(value, ["value", "status", "evidenceIds", "evidenceUrls", "observedAt", "verifiedAt"], ["conflictingValues"]);
  requireThat(typeof value.value === "string" || (Array.isArray(value.value) && value.value.every((item) => typeof item === "string")), "字段值必须为字符串或字符串数组");
  if (value.conflictingValues !== undefined) { list(value.conflictingValues); value.conflictingValues.forEach((item) => requireThat(typeof item === "string" || (Array.isArray(item) && item.every((part) => typeof part === "string")), "冲突字段值不合法")); }
  strings(value.evidenceIds); strings(value.evidenceUrls); value.evidenceUrls.forEach(https);
  clock(value.observedAt, true); clock(value.verifiedAt, true);
  validateLedgerField(value as unknown as LedgerField<unknown>);
  if (known) requireThat(value.status === "verified", "公开事实必须已核验");
}

/** Structural validation is strict at every public level; canonical validation below also rechecks live dependencies. */
export function validateCoreCoverageArtifact(value: unknown): asserts value is CoreCoverageArtifact {
  exact(value, ["schemaVersion", "coverage", "generatedAt", "windows", "subjects", "briefs", "metrics"]);
  requireThat(value.schemaVersion === 1, "schema 不合法"); clock(value.generatedAt); validatePublicVersion(value.coverage);
  requireThat(isDeepStrictEqual(value.windows, coverageWindows(new Date(value.generatedAt as string))), "上海时区窗口不一致");
  list(value.subjects); list(value.briefs); exact(value.metrics, ["coveredSubjects", "completeBriefs", "coverageRatio"]);
  const ids = value.coverage.members.map((member) => member.companyId);
  const seenClaims = new Set<string>(); const seenAnalyses = new Set<string>();
  for (const subject of value.subjects) {
    exact(subject, ["companyId", "name", "routes", "entityType", "officialUrl"]); text(subject.companyId); text(subject.name); strings(subject.routes);
    requireThat(subject.routes.every((route) => routes.includes(route)), "路线不合法");
    requireThat(["公司", "实验室", "开源组织", "投资机构", "unknown"].includes(subject.entityType as string), "主体类型不合法"); https(subject.officialUrl);
  }
  for (const brief of value.briefs) {
    exact(brief, ["companyId", "completeness", "analyses", "knownClaimIds", "materialEventIds", "gapsZh", "lastMaterialChangeAt", "positioningZh", "identityEvidence", "reviewIssues", "knownFacts", "summaryZh", "nextValidationZh"]);
    text(brief.companyId); text(brief.positioningZh); text(brief.summaryZh); strings(brief.knownClaimIds); strings(brief.materialEventIds); strings(brief.gapsZh); strings(brief.nextValidationZh); clock(brief.lastMaterialChangeAt, true);
    list(brief.identityEvidence); list(brief.reviewIssues); list(brief.knownFacts); list(brief.analyses);
    for (const proof of brief.identityEvidence) { exact(proof, ["link", "source", "checkedAt", "supports"]); https(proof.link); text(proof.source); text(proof.supports); clock(proof.checkedAt); }
    for (const issue of brief.reviewIssues) { exact(issue, ["claimId", "reason"], ["fieldPath"]); text(issue.claimId); requireThat(issue.reason === "conflict" || issue.reason === "withdrawn", "复核原因不合法"); requireThat(issue.fieldPath === undefined || fields.includes(issue.fieldPath as string), "复核字段不合法"); }
    for (const fact of brief.knownFacts) {
      exact(fact, ["claimId", "companyId", "claimType", "fields", "eventIds", "evidenceIds", "summaryZh", "occurredOn", "publishedOn", "date", "dateKind", "materialChangeAt", "needsReview"]);
      text(fact.claimId); requireThat(!seenClaims.has(fact.claimId), "重复 Claim"); seenClaims.add(fact.claimId);
      requireThat(fact.companyId === brief.companyId && ["funding", "product", "pilot", "deployment", "production", "commercialization", "research-team"].includes(fact.claimType as string), "事实主体/类型不合法");
      strings(fact.eventIds); strings(fact.evidenceIds); text(fact.summaryZh); requireThat(fact.eventIds.length === 1 && typeof fact.needsReview === "boolean", "事件绑定不合法");
      exact(fact.fields, [], fields); requireThat(Object.keys(fact.fields).length, "已知事实缺字段"); Object.values(fact.fields).forEach((item) => field(item, true));
      const evidence = [...new Set(Object.values(fact.fields).flatMap((item) => (item as LedgerField<unknown>).evidenceIds))].sort();
      requireThat(isDeepStrictEqual(evidence, [...fact.evidenceIds].sort()), "事实证据依赖不一致");
      clock(fact.occurredOn, true); clock(fact.publishedOn, true); clock(fact.date, true); clock(fact.materialChangeAt, true);
      const kind = fact.occurredOn !== "unknown" ? "occurred" : fact.publishedOn !== "unknown" ? "disclosed" : "unknown";
      requireThat(fact.dateKind === kind && fact.date === (kind === "occurred" ? fact.occurredOn : fact.publishedOn), "事件/披露日期混用");
    }
    const facts = brief.knownFacts as unknown as CoverageBrief["knownFacts"];
    requireThat(isDeepStrictEqual([...brief.knownClaimIds].sort(), facts.map((fact) => fact.claimId).sort()), "Claim 列表不一致");
    requireThat(isDeepStrictEqual([...brief.materialEventIds].sort(), [...new Set(facts.flatMap((fact) => fact.eventIds))].sort()), "事件列表不一致");
    const latestMaterialChange = facts.flatMap((fact) => fact.materialChangeAt === "unknown" ? [] : [fact.materialChangeAt]).sort().at(-1) ?? "unknown";
    requireThat(brief.lastMaterialChangeAt === latestMaterialChange, "实质变化时钟与事实不一致");
    for (const analysis of brief.analyses) {
      exact(analysis, ["id", "template", "textZh", "claimIds", "evidenceIds", "limitationZh", "nextValidationZh", "status"]);
      text(analysis.id); text(analysis.textZh); text(analysis.limitationZh); text(analysis.nextValidationZh); strings(analysis.claimIds); strings(analysis.evidenceIds);
      requireThat(!seenAnalyses.has(analysis.id), "重复分析"); seenAnalyses.add(analysis.id);
      requireThat(analysis.status === "valid" && ["capital-resources", "product-validation", "deployment-validation"].includes(analysis.template as string), "公开分析状态不合法");
      const knownClaimIds = brief.knownClaimIds as string[];
      const analysisClaimIds = analysis.claimIds;
      requireThat(analysisClaimIds.length && analysis.evidenceIds.length && analysisClaimIds.every((id) => knownClaimIds.includes(id)), "分析 Claim 依赖不合法");
      const evidence = new Set(facts.filter((fact) => analysisClaimIds.includes(fact.claimId)).flatMap((fact) => fact.evidenceIds));
      requireThat(analysis.evidenceIds.every((id) => evidence.has(id)), "分析证据依赖不合法");
    }
    const complete = brief.identityEvidence.length > 0 && facts.length > 0 && (brief.analyses as unknown as CoverageBrief["analyses"]).some((analysis) => facts.some((fact) => analysis.claimIds.includes(fact.claimId) && fact.date !== "unknown"));
    requireThat(brief.completeness === (complete ? "complete" : "coverage-only"), "Brief 完整度不一致");
  }
  const artifact = value as unknown as CoreCoverageArtifact;
  requireThat(isDeepStrictEqual(artifact.briefs.map((brief) => brief.companyId), ids) && isDeepStrictEqual(artifact.subjects.map((subject) => subject.companyId), ids), "主体数组与覆盖名单不一致");
  const coveredSubjects = artifact.briefs.filter((brief) => brief.identityEvidence.length).length;
  const completeBriefs = artifact.briefs.filter((brief) => brief.completeness === "complete").length;
  requireThat(isDeepStrictEqual(artifact.metrics, { coveredSubjects, completeBriefs, coverageRatio: completeBriefs / 30 }), "统计与数组不一致");
}

export function buildCoreCoverageArtifact(input: CoreCoverageInput): CoreCoverageArtifact {
  validateCoverageVersion(input.coverage, input.companies);
  requireThat(input.ledger.generatedAt === input.now.toISOString(), "账本时钟不一致");
  requireThat(new Set(input.companies.map((company) => company.entityId)).size === input.companies.length, "公司身份重复");
  const analyses = buildApprovedAnalysisTemplates(input);
  const briefs = buildCoverageBriefs({ ...input, analyses });
  const completeBriefs = briefs.filter((brief) => brief.completeness === "complete").length;
  const artifact: CoreCoverageArtifact = {
    schemaVersion: 1, coverage: publicVersion(input.coverage), generatedAt: input.now.toISOString(), windows: coverageWindows(input.now),
    subjects: input.coverage.members.map((member) => {
      const profile = input.companies.find((company) => company.entityId === member.companyId)!;
      return { companyId: member.companyId, name: profile.name, routes: [...new Set(profile.routes)].sort(), entityType: profile.entityType ?? "unknown", officialUrl: profile.officialUrl };
    }), briefs, metrics: { coveredSubjects: briefs.filter((brief) => brief.identityEvidence.length).length, completeBriefs, coverageRatio: completeBriefs / 30 },
  };
  validateCoreCoverageArtifact(artifact);
  return artifact;
}

export function validateCoreCoveragePublication(value: unknown, input: CoreCoverageInput): asserts value is CoreCoverageArtifact {
  validateCoreCoverageArtifact(value);
  requireThat(isDeepStrictEqual(value, buildCoreCoverageArtifact(input)), "公开快照与当前规范事实/身份/分析依赖不一致");
}

export function validateCoreCoverageHistory(value: unknown): asserts value is CoreCoverageHistory {
  exact(value, ["schemaVersion", "generatedAt", "versions", "snapshots", "corrections"]); requireThat(value.schemaVersion === 1, "历史 schema 不合法"); clock(value.generatedAt);
  list(value.versions); value.versions.forEach(validatePublicVersion); list(value.snapshots); list(value.corrections);
  requireThat(value.snapshots.length > 0, "历史快照不能为空");
  const versions: PublicCoverageVersion[] = []; let corrections: CoverageCorrection[] = []; let previous: CoreCoverageArtifact | undefined;
  for (const snapshot of value.snapshots) {
    validateCoreCoverageArtifact(snapshot);
    requireThat(!previous || snapshot.generatedAt >= previous.generatedAt, "历史时钟倒退");
    const version = versions.find((item) => item.version === snapshot.coverage.version);
    if (version) requireThat(isDeepStrictEqual(version, snapshot.coverage), "覆盖版本被静默改写");
    else { requireThat(snapshot.coverage.previousVersion === (versions.at(-1)?.version ?? null), "覆盖版本前序不一致"); versions.push(snapshot.coverage); }
    corrections = deriveCoverageCorrections({ previous: previous?.briefs.filter((brief) => snapshot.briefs.some((current) => current.companyId === brief.companyId)) ?? [], current: snapshot.briefs, previousCorrections: corrections, now: new Date(snapshot.generatedAt) });
    previous = snapshot;
  }
  requireThat(isDeepStrictEqual(value.versions, versions) && isDeepStrictEqual(value.corrections, corrections) && value.generatedAt === previous!.generatedAt, "历史版本/更正/生成时钟不一致");
}

export function buildCoreCoverageHistory(artifact: CoreCoverageArtifact, previous?: CoreCoverageHistory): CoreCoverageHistory {
  validateCoreCoverageArtifact(artifact); if (previous) validateCoreCoverageHistory(previous);
  const snapshots = [...(previous?.snapshots ?? [])];
  if (!isDeepStrictEqual(snapshots.at(-1), artifact)) snapshots.push(structuredClone(artifact));
  const versions = [...(previous?.versions ?? [])];
  if (!versions.some((version) => version.version === artifact.coverage.version)) versions.push(structuredClone(artifact.coverage));
  // Leaving an editorial cohort is not withdrawal of the subject's historical evidence.
  const priorBriefs = previous?.snapshots.at(-1)?.briefs.filter((brief) => artifact.briefs.some((current) => current.companyId === brief.companyId)) ?? [];
  const history: CoreCoverageHistory = { schemaVersion: 1, generatedAt: artifact.generatedAt, versions, snapshots, corrections: deriveCoverageCorrections({ previous: priorBriefs, current: artifact.briefs, previousCorrections: previous?.corrections, now: new Date(artifact.generatedAt) }) };
  validateCoreCoverageHistory(history); return history;
}

/** Public Pages projection has no historical snapshots or private checkpoint state. */
export function projectCoreCoveragePublicHistory(history: CoreCoverageHistory): CoreCoveragePublicHistory {
  validateCoreCoverageHistory(history);
  const { snapshots: _snapshots, ...publicHistory } = history;
  return structuredClone(publicHistory);
}

function validateTasks(value: unknown): asserts value is BackfillTask[] {
  list(value); const ids = new Set<string>();
  for (const task of value) {
    exact(task, ["taskId", "companyId", "field", "status", "reason", "evidenceUrls", "firstSeenAt", "lastActionAt"], ["dispositionHistory"]);
    text(task.taskId); text(task.companyId); requireThat(!ids.has(task.taskId), "重复回填任务"); ids.add(task.taskId);
    requireThat(["identity", "capital", "product", "deployment"].includes(task.field as string) && ["pending", "checked", "blocked"].includes(task.status as string) && ["none", "missing-evidence", "rate-limited", "unavailable", "ambiguous-entity"].includes(task.reason as string), "回填状态不合法");
    strings(task.evidenceUrls); task.evidenceUrls.forEach(https); clock(task.firstSeenAt); if (task.lastActionAt !== null) clock(task.lastActionAt);
    if (task.dispositionHistory !== undefined) {
      list(task.dispositionHistory);
      for (const entry of task.dispositionHistory) {
        exact(entry, ["status", "reason", "evidenceUrls", "lastActionAt", "reopenedAt", "signals"]);
        requireThat(entry.status === "checked" && ["none", "missing-evidence", "rate-limited", "unavailable", "ambiguous-entity"].includes(entry.reason as string), "旧处置不合法");
        strings(entry.evidenceUrls); entry.evidenceUrls.forEach(https); if (entry.lastActionAt !== null) clock(entry.lastActionAt);
        clock(entry.reopenedAt); list(entry.signals); requireThat(entry.signals.length > 0, "重开缺少更正信号");
        for (const signal of entry.signals) {
          exact(signal, ["taskId", "kind", "signalId"]); text(signal.signalId);
          requireThat(signal.taskId === task.taskId && ["public-error", "retraction"].includes(signal.kind as string), "重开信号不匹配");
        }
      }
    }
  }
}
function validateCheckpoint(value: unknown): asserts value is CoreBackfillCheckpoint {
  exact(value, ["schemaVersion", "coverageVersion", "generatedAt", "tasks", "archivedTasks"]); requireThat(value.schemaVersion === 1, "回填 schema 不合法"); text(value.coverageVersion); clock(value.generatedAt); validateTasks(value.tasks); validateTasks(value.archivedTasks); validateTasks([...value.tasks, ...value.archivedTasks]);
  requireThat(value.tasks.length === 120, "回填检查点必须为 120 项");
  value.tasks.forEach((task) => requireThat(task.taskId === backfillTaskId(value.coverageVersion as string, task.companyId, task.field), "回填任务版本不一致"));
}

/** No config (or a future version) is truly legacy mode. Research input files cannot activate publication. */
export async function loadCoreCoverageState(root: string, companies: CompanyProfile[], now: Date): Promise<CoreCoverageState | undefined> {
  const config = await readJsonStrict<CoverageVersion>(join(root, "config/core-coverage.json"), { optional: true, label: "Core 30 配置" });
  if (config === undefined) return undefined;
  validateCoverageVersion(config, companies);
  if (config.effectiveFrom > shanghaiDailyDate(now)) return undefined;
  const artifact = await readJsonStrict<CoreCoverageArtifact>(join(root, "site/data/core-coverage.json"), { optional: true });
  const history = await readJsonStrict<CoreCoverageHistory>(join(root, "events/core-coverage-history.json"), { optional: true });
  const publicHistory = await readJsonStrict<CoreCoveragePublicHistory>(join(root, "site/data/core-coverage-history.json"), { optional: true });
  const saved = await readJsonStrict<BackfillTask[] | CoreBackfillCheckpoint>(join(root, "review/core30-backfill.json"), { optional: true });
  // readJsonStrict returns undefined only for ENOENT. Existing JSON primitives are corrupt state, never a bootstrap signal.
  if (artifact !== undefined) validateCoreCoverageArtifact(artifact);
  if (history !== undefined) validateCoreCoverageHistory(history);
  if (saved !== undefined) { if (Array.isArray(saved)) validateTasks(saved); else validateCheckpoint(saved); }
  if (publicHistory !== undefined) {
    exact(publicHistory, ["schemaVersion", "generatedAt", "versions", "corrections"]);
    requireThat(history !== undefined, "公开历史缺少配套历史工件");
    requireThat(isDeepStrictEqual(publicHistory, projectCoreCoveragePublicHistory(history)), "公开历史镜像不一致");
  }
  const hasArtifact = artifact !== undefined;
  requireThat(hasArtifact === (history !== undefined) && hasArtifact === (publicHistory !== undefined) && hasArtifact === (saved !== undefined && !Array.isArray(saved)), "工件组不完整，必须配套发布快照、历史和检查点");
  if (artifact !== undefined && history !== undefined) { requireThat(isDeepStrictEqual(history.snapshots.at(-1), artifact), "公开快照与历史末版不一致"); requireThat(artifact.generatedAt <= now.toISOString(), "历史不能晚于当前时钟"); }
  const versions = (history?.versions ?? []).map(privateVersion);
  const existing = versions.find((version) => version.version === config.version);
  if (existing) requireThat(isDeepStrictEqual(existing, config), "已发布覆盖版本不得静默改写"); else versions.push(config);
  const coverage = selectCoverageVersion(versions, now);
  let tasks: BackfillTask[] = []; let archivedTasks: BackfillTask[] = [];
  if (Array.isArray(saved)) { tasks = saved; requireThat(tasks.length === 120 && tasks.every((task) => coverage.members.some((member) => member.companyId === task.companyId) && task.taskId === backfillTaskId(coverage.version, task.companyId, task.field)), "旧回填数组与名单不一致"); }
  else if (saved !== undefined) {
    tasks = saved.tasks; archivedTasks = saved.archivedTasks;
    if (artifact !== undefined) {
      requireThat(saved.generatedAt === artifact.generatedAt && saved.coverageVersion === artifact.coverage.version, "检查点与公开组时钟/版本不一致");
      requireThat(tasks.every((task) => artifact.coverage.members.some((member) => member.companyId === task.companyId)), "检查点存在名单外主体");
    }
    if (saved.coverageVersion !== coverage.version) { archivedTasks = [...archivedTasks, ...tasks]; tasks = []; }
  }
  return { coverage, tasks: buildBackfillTasks(coverage, tasks, now), archivedTasks, previousArtifact: artifact, history };
}

export function coreCoverageReviewSeeds(state: CoreCoverageState, artifact: CoreCoverageArtifact): ReviewCaseSeed[] {
  const signals: BackfillPrioritySignal[] = [];
  const fieldGroup = (field: string) => ["round", "amount", "valuation", "investors"].includes(field) ? "capital"
    : field === "product" ? "product" : ["deployment", "customer", "productionStage"].includes(field) ? "deployment" : undefined;
  const changes = deriveCoverageCorrections({ previous: state.previousArtifact?.briefs ?? [], current: artifact.briefs, now: new Date(artifact.generatedAt) });
  for (const change of changes) {
    const field = fieldGroup(change.fieldPath.split(".fields.")[1]);
    if (!field) continue;
    signals.push({ taskId: backfillTaskId(state.coverage.version, change.companyId, field), signalId: change.changeId,
      kind: change.reason === "conflict-detected" ? "public-error" : change.reason === "source-withdrawn" ? "retraction" : "new-finding" });
  }
  for (const brief of artifact.briefs) {
    for (const fact of brief.knownFacts.filter((fact) => state.previousArtifact && !state.previousArtifact.briefs.find((previous) => previous.companyId === brief.companyId)?.knownClaimIds.includes(fact.claimId))) {
      for (const field of Object.keys(fact.fields)) {
        const group = fieldGroup(field);
        if (group) signals.push({ taskId: backfillTaskId(state.coverage.version, brief.companyId, group), kind: "new-finding" });
      }
    }
  }
  state.tasks = reopenCheckedBackfillTasks(state.tasks, signals, new Date(artifact.generatedAt));
  // Keep a reopened correction urgent until disposition, including later cohorts/reruns.
  for (const task of state.tasks.filter((task) => task.status === "pending")) signals.push(...(task.dispositionHistory?.at(-1)?.signals ?? []));
  return buildBackfillReviewCaseSeeds(state.coverage, state.tasks, signals).map((seed, index) => ({ ...seed, sourcePriority: index }));
}

export function stageCoreCoverage(input: { root: string; transaction: Pick<FileTransaction, "stage">; artifact: CoreCoverageArtifact; state: CoreCoverageState }): void {
  validateCoreCoverageArtifact(input.artifact);
  requireThat(isDeepStrictEqual(publicVersion(input.state.coverage), input.artifact.coverage), "检查点覆盖名单不一致");
  const history = buildCoreCoverageHistory(input.artifact, input.state.history);
  const checkpoint: CoreBackfillCheckpoint = { schemaVersion: 1, generatedAt: input.artifact.generatedAt, coverageVersion: input.artifact.coverage.version, tasks: input.state.tasks, archivedTasks: input.state.archivedTasks };
  validateCheckpoint(checkpoint);
  input.transaction.stage(join(input.root, "site/data/core-coverage.json"), bytes(input.artifact));
  input.transaction.stage(join(input.root, "events/core-coverage-history.json"), bytes(history));
  input.transaction.stage(join(input.root, "site/data/core-coverage-history.json"), bytes(projectCoreCoveragePublicHistory(history)));
  input.transaction.stage(join(input.root, "review/core30-backfill.json"), bytes(checkpoint));
}

/** Release gate rejects orphan/stale groups in disabled mode, and re-materializes facts in active mode. */
export async function validateCoreCoverageRelease(root: string, companies: CompanyProfile[], events: EventRecord[], ledger: CompanyClaimLedger, now: Date): Promise<void> {
  const state = await loadCoreCoverageState(root, companies, now);
  if (state === undefined) {
    const artifact = await readJsonStrict(join(root, "site/data/core-coverage.json"), { optional: true });
    const history = await readJsonStrict(join(root, "events/core-coverage-history.json"), { optional: true });
    const publicHistory = await readJsonStrict(join(root, "site/data/core-coverage-history.json"), { optional: true });
    requireThat(artifact === undefined && history === undefined && publicHistory === undefined, "未启用配置却存在旧公开工件"); return;
  }
  requireThat(state.previousArtifact && state.history, "公开工件组不完整");
  validateCoreCoveragePublication(state.previousArtifact, { coverage: state.coverage, companies, events, ledger, now });
}
