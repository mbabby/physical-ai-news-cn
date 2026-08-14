import { join } from "node:path";
import { derivePublication } from "../facts-contract.js";
import type { CompanyClaim, CompanyClaimLedger } from "../company-claim-ledger.js";
import type { FileTransaction } from "../runtime/storage.js";
import type { CompanyProfile, EventRecord, RuntimeStatus } from "../types.js";
import { validateCompanyThesisShape, type CompanyThesis } from "./contracts.js";
import type { ThesisGenerationResult } from "./generator.js";
import { selectLastKnownGood } from "./lifecycle.js";
import type { SelectedThesisSeed, SelectedWatchlistSeeds } from "./scoring.js";
import { validateThesisDraft } from "./validation.js";

const COOLDOWN_MS = 6 * 60 * 60 * 1_000;
const EXPIRY_MS = 60 * 24 * 60 * 60 * 1_000;
const CONFLICT_PATTERN = /冲突|矛盾|待复核|待识别|待核验|待确认|未确认|主体不明|归属不明|撤回|撤销|withdrawn|conflict|unverified/i;
const PROHIBITED_INVESTMENT_LANGUAGE = /买入|卖出|目标价|投资建议|建议配置|回报率|收益率|\bbuy\b|\bsell\b|target price|\breturns?\b/i;
const THESIS_KEYS = new Set([
  "thesisId", "companyId", "track", "lifecycle", "thesisVersion", "whyNow", "routeAndDependencies",
  "nextValidationPoints", "falsifiers", "factReferenceIds", "inferenceLabels", "confidence", "generatedAt",
  "expiresAt", "modelVersion", "promptVersion", "methodologyVersion",
]);

export interface WatchlistPreviewArtifact {
  schemaVersion: 1;
  generatedAt: string;
  theses: CompanyThesis[];
}

export interface WatchlistPreviewGenerator {
  generate(seed: SelectedThesisSeed): Promise<ThesisGenerationResult>;
  status(): RuntimeStatus;
}

export interface WatchlistPreviewInput {
  selected: SelectedWatchlistSeeds;
  companies: CompanyProfile[];
  canonicalEvents: EventRecord[];
  claimLedger?: CompanyClaimLedger;
  previous?: WatchlistPreviewArtifact;
  generator: WatchlistPreviewGenerator;
  now: Date;
}

export interface WatchlistPreviewResult {
  preview: WatchlistPreviewArtifact;
  markdown: string;
  status: RuntimeStatus;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function timestamp(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function activeThesis(thesis: CompanyThesis | undefined, nowMs: number): thesis is CompanyThesis {
  if (!thesis || thesis.lifecycle === "falsified" || thesis.lifecycle === "expired") return false;
  const generatedAt = timestamp(thesis.generatedAt);
  const expiresAt = timestamp(thesis.expiresAt);
  return generatedAt !== undefined && expiresAt !== undefined
    && expiresAt - generatedAt === EXPIRY_MS
    && expiresAt > nowMs;
}

function canonicalReferences(subject: Pick<EvidenceSubject, "factReferenceIds">, events: EventRecord[]): EventRecord[] | undefined {
  const byId = new Map(events.map((event) => [event.id, event]));
  const selected = subject.factReferenceIds.map((referenceId) => byId.get(referenceId));
  if (selected.some((event) => !event)) return undefined;
  return selected as EventRecord[];
}

interface EvidenceSubject {
  companyId: string;
  companyName: string;
  track: CompanyThesis["track"];
  factReferenceIds: string[];
}

type SensitiveField = "amount" | "valuation" | "customer" | "revenue" | "order";

function sensitiveFieldsInThesis(thesis: CompanyThesis, events: EventRecord[]): SensitiveField[] {
  const text = [
    thesis.whyNow,
    thesis.routeAndDependencies,
    ...thesis.nextValidationPoints.map((point) => point.text),
    ...thesis.falsifiers.map((item) => item.text),
  ].join(" ");
  const fields = new Set<SensitiveField>();
  const amounts = events.flatMap((event) => event.funding?.amount ? [event.funding.amount] : []);
  const valuations = events.flatMap((event) => event.funding?.valuation ? [event.funding.valuation] : []);
  const customers = events.flatMap((event) => event.productDeployment?.customers ?? []);
  const latinCustomerRelationship = /(?:向|为)\s*[A-Z][A-Za-z0-9-]*(?:\s+[A-Z][A-Za-z0-9-]*)*\s*(?:部署|交付|销售|提供|试点)|\b[A-Z][A-Za-z0-9-]*(?:\s+[A-Z][A-Za-z0-9-]*)*\s*(?:采用|订购|购买)/;
  const nonCustomerTargets = new Set(["后续", "未来", "实际", "真实", "规模化", "工厂", "现场"]);
  const chineseCustomerRelationship = [
    ...text.matchAll(/(?:向|为)\s*([\u3400-\u9fff]{2,16})(?=\s*(?:部署|交付|销售|提供|试点))/g),
    ...text.matchAll(/(?:^|[：，。；\s])([\u3400-\u9fff]{2,16})(?=\s*(?:采用|订购|购买))/g),
  ].some((match) => !nonCustomerTargets.has(match[1]!));
  if (/融资金额|funding amount|(?:融资|募资|融得|完成)[^。！？!?]{0,30}(?:元|美元|欧元|人民币)/i.test(text)
    || amounts.some((value) => text.includes(value))) fields.add("amount");
  if (/估值|valuation/i.test(text) || valuations.some((value) => text.includes(value))) fields.add("valuation");
  if (/客户|\bcustomer\b/i.test(text) || latinCustomerRelationship.test(text) || chineseCustomerRelationship
    || customers.some((value) => text.includes(value))) fields.add("customer");
  if (/收入|营收|revenue/i.test(text)) fields.add("revenue");
  if (/订单|\border(?:s|ed)?\b/i.test(text)) fields.add("order");
  return [...fields];
}

function claimEventIds(claim: CompanyClaim): string[] {
  return [...new Set(claim.evidenceIds.map((id) => id.replace(/:evidence:\d+$/, "")))];
}

function claimSupportsField(claim: CompanyClaim, field: SensitiveField): boolean {
  if (field === "amount" || field === "valuation") return claim.claimType === "funding";
  if (field === "customer") return ["pilot", "deployment", "commercialization"].includes(claim.claimType);
  return claim.claimType === "commercialization";
}

function eventContainsField(event: EventRecord, field: SensitiveField): boolean {
  if (field === "amount") return Boolean(event.funding?.amount);
  if (field === "valuation") return Boolean(event.funding?.valuation);
  if (field === "customer") return Boolean(event.productDeployment?.customers.length);
  const text = `${event.title} ${event.facts.join(" ")} ${event.productDeployment?.deployment ?? ""}`;
  return field === "revenue" ? /收入|营收|revenue/i.test(text) : /订单|order/i.test(text);
}

function priorSensitiveFieldsRemainVerified(thesis: CompanyThesis, events: EventRecord[], ledger?: CompanyClaimLedger): boolean {
  const eventById = new Map(events.map((event) => [event.id, event]));
  const selectedEvents = thesis.factReferenceIds.flatMap((referenceId) => {
    const event = eventById.get(referenceId);
    return event ? [event] : [];
  });
  const fields = sensitiveFieldsInThesis(thesis, selectedEvents);
  if (!fields.length) return true;
  const claims = ledger?.companies.find((entry) => entry.companyId === thesis.companyId)?.claims ?? [];
  const priorReferences = new Set(thesis.factReferenceIds);
  return fields.every((field) => claims.some((claim) => {
    const mappedEvents = claimEventIds(claim);
    return claim.evidenceState === "verified"
      && claim.value !== "unknown"
      && claim.freshness.state === "fresh"
      && !claim.unresolvedQuestions.some((question) => CONFLICT_PATTERN.test(question))
      && claimSupportsField(claim, field)
      && mappedEvents.length > 0
      && mappedEvents.every((eventId) => eventById.has(eventId))
      && mappedEvents.some((eventId) => {
        const event = eventById.get(eventId);
        return priorReferences.has(eventId) && Boolean(event && eventContainsField(event, field));
      });
  }));
}

function evidenceAllowsReferences(subject: EvidenceSubject, events: EventRecord[], ledger?: CompanyClaimLedger): boolean {
  const selected = canonicalReferences(subject, events);
  if (!selected || !selected.length) return false;
  for (const event of selected) {
    const lifecycle = event as EventRecord & { evidenceState?: "candidate" | "developing" | "confirmed" | "conflicted" | "rejected" | "withdrawn" };
    const state = derivePublication({ evidence: event.evidence, evidenceState: lifecycle.evidenceState }).evidenceState;
    if (event.primaryEntity !== subject.companyName || event.status === "待复核" || event.status === "已归档") return false;
    if (state === "conflicted" || state === "rejected" || state === "withdrawn") return false;
    if (subject.track === "validated-momentum" && state !== "confirmed") return false;
    if (event.funding?.entityStatus === "待识别" || event.evidence.some((item) => Boolean((item as typeof item & { withdrawn?: boolean }).withdrawn))) return false;
    if ([event.title, ...event.openQuestions].some((value) => CONFLICT_PATTERN.test(value))) return false;
  }
  const claims = ledger?.companies.find((entry) => entry.companyId === subject.companyId)?.claims ?? [];
  return claims.every((claim) => !claim.unresolvedQuestions.some((question) => CONFLICT_PATTERN.test(question)));
}

function evidenceAllowsPreview(seed: SelectedThesisSeed, events: EventRecord[], ledger?: CompanyClaimLedger): boolean {
  return !(seed.track === "validated-momentum" && seed.evidenceGrade === "B")
    && evidenceAllowsReferences(seed, events, ledger);
}

function evidenceAllowsPrior(
  thesis: CompanyThesis,
  companies: CompanyProfile[],
  events: EventRecord[],
  ledger?: CompanyClaimLedger,
): boolean {
  const company = companies.find((candidate) => candidate.entityId === thesis.companyId && candidate.entityType === "公司");
  return Boolean(company && evidenceAllowsReferences({
    companyId: thesis.companyId,
    companyName: company.name,
    track: thesis.track,
    factReferenceIds: thesis.factReferenceIds,
  }, events, ledger) && priorSensitiveFieldsRemainVerified(thesis, events, ledger));
}

function hasMaterialSeedChange(
  seed: SelectedThesisSeed,
  previous: CompanyThesis | undefined,
  events: EventRecord[],
): boolean {
  if (!previous || previous.track !== seed.track) return true;
  if ([...previous.factReferenceIds].sort().join("\0") !== [...seed.factReferenceIds].sort().join("\0")) return true;
  const previousAt = Date.parse(previous.generatedAt);
  if (!Number.isFinite(previousAt)) return true;
  const selected = canonicalReferences(seed, events) ?? [];
  if (selected.some((event) => {
    const changedAt = Date.parse(event.lastMaterialChangeAt ?? event.lastUpdatedAt);
    return Number.isFinite(changedAt) && changedAt > previousAt;
  })) return true;
  return false;
}

function sameTheses(left: CompanyThesis[], right: CompanyThesis[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sortedSelected(selected: SelectedWatchlistSeeds): SelectedThesisSeed[] {
  return [...selected.forwardRadar, ...selected.validatedMomentum]
    .sort((left, right) => left.track.localeCompare(right.track) || left.companyId.localeCompare(right.companyId));
}

export function validateWatchlistPreviewArtifact(value: unknown): value is WatchlistPreviewArtifact {
  if (!isObject(value) || Object.keys(value).some((key) => !["schemaVersion", "generatedAt", "theses"].includes(key))) return false;
  if (value.schemaVersion !== 1 || typeof value.generatedAt !== "string" || timestamp(value.generatedAt) === undefined || !Array.isArray(value.theses)) return false;
  const companyIds = new Set<string>();
  const thesisIds = new Set<string>();
  if (value.theses.length > 10) return false;
  for (const candidate of value.theses) {
    if (!isObject(candidate) || Object.keys(candidate).length !== THESIS_KEYS.size || Object.keys(candidate).some((key) => !THESIS_KEYS.has(key))) return false;
    if (!validateCompanyThesisShape(candidate) || candidate.lifecycle === "falsified" || candidate.lifecycle === "expired") return false;
    if (candidate.nextValidationPoints.some((point) => Object.keys(point).length !== 2 || Object.keys(point).some((key) => key !== "text" && key !== "dueAt"))) return false;
    if (candidate.falsifiers.some((item) => Object.keys(item).length !== 1 || Object.keys(item)[0] !== "text")) return false;
    if (companyIds.has(candidate.companyId) || thesisIds.has(candidate.thesisId)) return false;
    companyIds.add(candidate.companyId);
    thesisIds.add(candidate.thesisId);
    const generatedAt = timestamp(candidate.generatedAt);
    const expiresAt = timestamp(candidate.expiresAt);
    if (generatedAt === undefined || expiresAt === undefined || expiresAt - generatedAt !== EXPIRY_MS) return false;
    if (!candidate.whyNow.startsWith("AI 研究判断") || !candidate.routeAndDependencies.startsWith("AI 研究判断")) return false;
    if (PROHIBITED_INVESTMENT_LANGUAGE.test([
      candidate.whyNow, candidate.routeAndDependencies,
      ...candidate.nextValidationPoints.map((point) => point.text),
      ...candidate.falsifiers.map((item) => item.text),
    ].join("\n"))) return false;
  }
  return true;
}

export interface WatchlistPreviewReleaseInput {
  preview: WatchlistPreviewArtifact;
  markdown: string;
  manifestFinishedAt: string;
  manifestServices: RuntimeStatus[];
  archiveServices: RuntimeStatus[];
}

export function validateWatchlistPreviewRelease(input: WatchlistPreviewReleaseInput): void {
  if (input.markdown !== formatWatchlistPreviewMarkdown(input.preview)) {
    throw new Error("Watchlist Markdown 与 JSON 预览不一致");
  }
  const manifestStatus = input.manifestServices.find((status) => status.component === "Watchlist");
  const archiveStatus = input.archiveServices.find((status) => status.component === "Watchlist");
  const legacyEmptyBootstrap = input.preview.theses.length === 0
    && input.preview.generatedAt === input.manifestFinishedAt
    && !archiveStatus;
  if (!manifestStatus) {
    if (legacyEmptyBootstrap) return;
    throw new Error("运行清单缺少 Watchlist 状态");
  }
  if (!archiveStatus
    || archiveStatus.status !== manifestStatus.status
    || archiveStatus.attempted !== manifestStatus.attempted
    || archiveStatus.succeeded !== manifestStatus.succeeded
    || archiveStatus.failed !== manifestStatus.failed) {
    throw new Error("Watchlist 状态在运行清单与日报间不一致");
  }
  if (manifestStatus.attempted !== manifestStatus.succeeded + manifestStatus.failed) {
    throw new Error("Watchlist 尝试计数与成功、失败之和不一致");
  }
}

export function formatWatchlistPreviewMarkdown(preview: WatchlistPreviewArtifact): string {
  const track = (title: string, theses: CompanyThesis[]): string[] => [
    `## ${title}`, "",
    ...(theses.length ? theses.map((thesis) => [
      `### ${thesis.companyId} · v${thesis.thesisVersion}`,
      "",
      `- 生命周期：${thesis.lifecycle}`,
      `- ${thesis.whyNow}`,
      `- ${thesis.routeAndDependencies}`,
      `- 下一验证点：${thesis.nextValidationPoints.map((point) => `${point.text}（${point.dueAt}）`).join("；")}`,
      `- 反证条件：${thesis.falsifiers.map((item) => item.text).join("；")}`,
      `- 有效期至：${thesis.expiresAt}`,
      "",
    ]).flat() : ["- 本轮没有通过全部门禁的判断卡。", ""]),
  ];
  return [
    `# 双轨观察名单内部预览 · ${preview.generatedAt.slice(0, 10)}`,
    "",
    "仅供内部审阅；本文件不会被 README、Pages、Feed 或分享页消费。",
    "",
    ...track("前瞻雷达", preview.theses.filter((thesis) => thesis.track === "forward-radar")),
    ...track("验证动量", preview.theses.filter((thesis) => thesis.track === "validated-momentum")),
  ].join("\n");
}

export function stageWatchlistPreview(
  transaction: Pick<FileTransaction, "stage">,
  reviewDir: string,
  preview: WatchlistPreviewArtifact,
): void {
  transaction.stage(join(reviewDir, "watchlist-preview.json"), `${JSON.stringify(preview, null, 2)}\n`);
  transaction.stage(join(reviewDir, "watchlist-preview.md"), formatWatchlistPreviewMarkdown(preview));
}

export async function buildWatchlistPreview(input: WatchlistPreviewInput): Promise<WatchlistPreviewResult> {
  const nowMs = input.now.getTime();
  if (!Number.isFinite(nowMs)) throw new Error("观察名单预览时钟无效");
  const previousByCompany = new Map(input.previous?.theses.map((thesis) => [thesis.companyId, thesis]));
  const theses: CompanyThesis[] = [];
  let attempted = 0;
  let succeeded = 0;
  let failed = 0;
  let retained = 0;
  let excluded = 0;

  for (const seed of sortedSelected(input.selected)) {
    const previous = previousByCompany.get(seed.companyId);
    const activePrevious = activeThesis(previous, nowMs) ? previous : undefined;
    if (!evidenceAllowsPreview(seed, input.canonicalEvents, input.claimLedger)) {
      excluded += 1;
      continue;
    }
    if (activePrevious?.track === "validated-momentum" && seed.track === "forward-radar") {
      excluded += 1;
      continue;
    }
    const fallback = activePrevious
      && evidenceAllowsPrior(activePrevious, input.companies, input.canonicalEvents, input.claimLedger)
      ? activePrevious : undefined;
    if (!hasMaterialSeedChange(seed, fallback, input.canonicalEvents)) {
      if (fallback) { theses.push(fallback); retained += 1; }
      else excluded += 1;
      continue;
    }
    const priorGeneratedAt = fallback ? Date.parse(fallback.generatedAt) : undefined;
    if (priorGeneratedAt !== undefined && nowMs - priorGeneratedAt < COOLDOWN_MS) {
      theses.push(fallback!);
      retained += 1;
      continue;
    }

    attempted += 1;
    const generated = await input.generator.generate(seed);
    if (!generated.ok) {
      const selected = selectLastKnownGood(fallback, generated, undefined, input.now);
      if (selected) { theses.push(selected); retained += 1; }
      else excluded += 1;
      failed += 1;
      continue;
    }
    const validation = validateThesisDraft({
      draft: generated.draft,
      seed,
      companies: input.companies,
      canonicalEvents: input.canonicalEvents,
      claimLedger: input.claimLedger,
      priorThesis: fallback,
    });
    const selected = selectLastKnownGood(fallback, generated.draft, validation, input.now);
    if (validation.publishable && selected && selected !== fallback) {
      theses.push(selected);
      succeeded += 1;
    } else {
      if (selected) { theses.push(selected); retained += 1; }
      else excluded += 1;
      failed += 1;
    }
  }

  theses.sort((left, right) => left.track.localeCompare(right.track) || left.companyId.localeCompare(right.companyId));
  const preview = input.previous && sameTheses(theses, input.previous.theses)
    ? input.previous
    : { schemaVersion: 1 as const, generatedAt: input.now.toISOString(), theses };
  const generatorStatus = input.generator.status();
  const statusValue: RuntimeStatus["status"] = generatorStatus.status === "未配置" && attempted > 0
    ? "未配置" : failed > 0 || excluded > 0 ? "部分降级" : "成功";
  const status: RuntimeStatus = {
    component: "Watchlist",
    status: statusValue,
    attempted,
    succeeded,
    failed,
    detail: `生成 ${succeeded} 张新判断卡；保留 ${retained} 张上一有效版本；排除 ${excluded} 家。`,
  };
  return { preview, markdown: formatWatchlistPreviewMarkdown(preview), status };
}
