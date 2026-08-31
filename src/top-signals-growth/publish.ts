import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  DECISION_SIGNALS_END,
  DECISION_SIGNALS_START,
  replacePublishedTopSignalsReadme,
} from "../decision-products/markdown.js";
import {
  validateDecisionProductArtifact,
  validateTopSignalSource,
  type DecisionProductArtifact,
  type DecisionTopSignal,
} from "../decision-products/contracts.js";
import { FileTransaction, readJsonStrict } from "../runtime/storage.js";
import {
  loadGrowthExperimentConfig,
  topSignalsContentSha256,
  validateTopSignalsApproval,
  validateTopSignalsDraft,
  validateGrowthExperimentConfig,
  type GrowthExperimentConfig,
  type TopSignalsApproval,
  type TopSignalsDraft,
} from "./contracts.js";
import { evaluateTopSignalsGate, validateTopSignalsGateReceipt, type TopSignalsGateReceipt } from "./gate.js";
import {
  renderTopSignalsArchive,
  renderTopSignalsReadme,
  renderTopSignalsRelease,
  type PublicGrowthTopSignal,
  type PublishedTopSignalsArtifact,
} from "./render.js";

const REPOSITORY_RELEASE_BASE = "https://github.com/mbabby/physical-ai-news-cn/releases/tag/";
const PUBLISHED_KEYS = [
  "schemaVersion", "experimentId", "week", "periodStart", "periodEnd", "signals",
  "releaseUrl", "publishedAt", "contentSha256",
] as const;
const PUBLIC_SIGNAL_KEYS = [
  "signalId", "eventId", "entityId", "entityName", "titleZh", "factsZh", "kind", "routes",
  "occurredAt", "verifiedAt", "evidenceState", "evidence", "impact", "whyItMatters", "nextValidationPoint",
] as const;
const RECEIPT_KEYS = ["schemaVersion", "experimentId", "week", "contentSha256", "releaseUrl", "publishedAt"] as const;
const PRIVATE_PUBLIC_TEXT = /(?:internal|private|selection|momentum)[ _-]?(?:score|rank)\b|内部(?:分数|排名|诊断)|私有(?:分数|排名)/i;

export interface TopSignalsPublicationReceipt {
  schemaVersion: 1;
  experimentId: string;
  week: string;
  contentSha256: string;
  releaseUrl: string;
  publishedAt: string;
}

export interface PreparedTopSignalsRelease {
  draft: TopSignalsDraft;
  gate: TopSignalsGateReceipt;
}

export type TopSignalsReleaseRun = { run: true; week: string } | { run: false; week: null };

export class TopSignalsGateBlockedError extends Error {
  constructor(readonly gate: TopSignalsGateReceipt) {
    super(`Top Signals publication blocked:\n- ${gate.reasons.join("\n- ")}`);
    this.name = "TopSignalsGateBlockedError";
  }
}

function exactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && JSON.stringify(Object.keys(value as Record<string, unknown>).sort()) === JSON.stringify([...keys].sort());
}

function canonicalTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function canonicalDate(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))
    && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

function expectedReleaseUrl(week: string): string {
  return `${REPOSITORY_RELEASE_BASE}top-signals-${week}`;
}

function requireCanonicalReleaseUrl(releaseUrl: string, week: string): void {
  if (releaseUrl !== expectedReleaseUrl(week)) {
    throw new Error(`Top Signals canonical Release URL must be ${expectedReleaseUrl(week)}`);
  }
}

export function resolveTopSignalsReleaseRun(input: {
  eventName: string;
  requestedWeek?: string;
  today: string;
  config: GrowthExperimentConfig;
}): TopSignalsReleaseRun {
  validateGrowthExperimentConfig(input.config);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.today) || new Date(`${input.today}T00:00:00.000Z`).toISOString().slice(0, 10) !== input.today) {
    throw new Error("Top Signals release trigger requires a canonical UTC date");
  }
  if (input.eventName === "workflow_dispatch") {
    if (input.requestedWeek !== input.config.manualWeek) throw new Error(`Manual Top Signals dispatch is restricted to ${input.config.manualWeek}`);
    return { run: true, week: input.config.manualWeek };
  }
  if (input.eventName !== "schedule") throw new Error(`Unsupported Top Signals release event: ${input.eventName}`);
  const automaticDate = new Date(`${input.config.endDate}T00:00:00.000Z`);
  automaticDate.setUTCDate(automaticDate.getUTCDate() - 3);
  return input.today === automaticDate.toISOString().slice(0, 10)
    ? { run: true, week: input.config.automaticWeek }
    : { run: false, week: null };
}

function scanPublicBoundary(value: unknown, path: string): void {
  if (typeof value === "string") {
    if (PRIVATE_PUBLIC_TEXT.test(value)) throw new Error(`Top Signals public output contains private diagnostics at ${path}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanPublicBoundary(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (/(?:^|_)(?:review|draft|candidate|rawModelOutput)|(?:score|rank)(?:Breakdown)?$/i.test(key)) {
      throw new Error(`Top Signals public output contains private key at ${path}.${key}`);
    }
    scanPublicBoundary(nested, `${path}.${key}`);
  }
}

function validatePublicTopSignal(value: unknown, path: string): asserts value is PublicGrowthTopSignal {
  if (!exactKeys(value, PUBLIC_SIGNAL_KEYS)) throw new Error(`Invalid published Top Signals signal keys at ${path}`);
  const signal = value as unknown as PublicGrowthTopSignal;
  const { nextValidationPoint: _nextValidationPoint, ...publicDecisionSignal } = signal;
  const decisionSignal: DecisionTopSignal = {
    ...publicDecisionSignal,
    changedThisWeek: false,
    rankReasons: ["公开证据完整"],
  };
  validateTopSignalSource(decisionSignal);
  if (typeof signal.nextValidationPoint !== "string" || !signal.nextValidationPoint.trim()) {
    throw new Error(`Invalid published Top Signals next validation point at ${path}`);
  }
  scanPublicBoundary(signal, path);
}

export function validatePublishedTopSignalsArtifact(value: unknown): asserts value is PublishedTopSignalsArtifact {
  if (!exactKeys(value, PUBLISHED_KEYS)) throw new Error("Invalid published Top Signals artifact keys");
  const published = value as unknown as PublishedTopSignalsArtifact;
  if (published.schemaVersion !== 1 || published.experimentId !== "github-top-signals-2026-08"
    || !["2026-W36", "2026-W37"].includes(published.week) || !canonicalDate(published.periodStart)
    || !canonicalDate(published.periodEnd) || published.periodStart > published.periodEnd
    || published.periodStart < "2026-08-31" || published.periodEnd > "2026-09-13" || !Array.isArray(published.signals)
    || !/^[a-f0-9]{64}$/.test(published.contentSha256)) {
    throw new Error("Invalid published Top Signals artifact");
  }
  published.signals.forEach((signal, index) => validatePublicTopSignal(signal, `published.signals[${index}]`));
  if (new Set(published.signals.map((signal) => signal.signalId)).size !== published.signals.length) {
    throw new Error("Published Top Signals signal IDs must be unique");
  }
  requireCanonicalReleaseUrl(published.releaseUrl, published.week);
  if (!canonicalTimestamp(published.publishedAt)) throw new Error("Invalid published Top Signals timestamp");
  scanPublicBoundary(published, "published");
}

export interface ValidatePublishedTopSignalsInput {
  draft: unknown;
  gate: unknown | null;
  published: unknown | null;
  latest: unknown | null;
  readme: string;
  markdown?: string;
  decisionProducts?: unknown;
}

function decisionSignalFromGrowth(signal: TopSignalsDraft["signals"][number]): DecisionTopSignal {
  const { nextValidationPoint: _nextValidationPoint, scoreBreakdown: _scoreBreakdown, ...decisionSignal } = signal;
  return decisionSignal;
}

function validateDecisionProductBinding(draft: TopSignalsDraft, value: unknown): void {
  validateDecisionProductArtifact(value);
  const artifact = value as DecisionProductArtifact;
  const currentById = new Map(artifact.topSignals.map((signal) => [signal.signalId, signal]));
  for (const signal of draft.signals) {
    const current = currentById.get(signal.signalId);
    if (!current || !isDeepStrictEqual(current, decisionSignalFromGrowth(signal))) {
      throw new Error(`Top Signals draft is not bound to the current canonical Decision Product: ${signal.signalId}`);
    }
  }
}

function requireExactReadmeSection(readme: string, expected: string): void {
  const start = readme.indexOf(DECISION_SIGNALS_START);
  const end = readme.indexOf(DECISION_SIGNALS_END);
  if (start < 0 || end < start
    || readme.indexOf(DECISION_SIGNALS_START, start + 1) >= 0
    || readme.indexOf(DECISION_SIGNALS_END, end + 1) >= 0
    || readme.slice(start, end + DECISION_SIGNALS_END.length) !== `${DECISION_SIGNALS_START}\n\n${expected}\n\n${DECISION_SIGNALS_END}`) {
    throw new Error("README Top Signals section does not exactly match the canonical draft");
  }
}

/** Rebuild and bind every Top Signals public surface from one strict Review draft. */
export function validatePublishedTopSignals(input: ValidatePublishedTopSignalsInput): void {
  validateTopSignalsDraft(input.draft);
  const draft = input.draft as TopSignalsDraft;
  if (input.decisionProducts !== undefined) validateDecisionProductBinding(draft, input.decisionProducts);

  if (input.latest === null) {
    if (input.published !== null || input.gate !== null) throw new Error("Top Signals publication is incomplete without Latest");
    return;
  }
  if (input.published === null || input.gate === null) throw new Error("Top Signals publication is incomplete");

  validateTopSignalsGateReceipt(input.gate);
  validatePublishedTopSignalsArtifact(input.published);
  validatePublishedTopSignalsArtifact(input.latest);
  const gate = input.gate as TopSignalsGateReceipt;
  const published = input.published as PublishedTopSignalsArtifact;
  const latest = input.latest as PublishedTopSignalsArtifact;
  const contentSha256 = topSignalsContentSha256(draft);
  const expectedMode = draft.week === "2026-W36" ? "manual" : "automatic";

  if (gate.experimentId !== draft.experimentId || gate.week !== draft.week || gate.contentSha256 !== contentSha256
    || gate.mode !== expectedMode || (expectedMode === "manual" && gate.approval === null)
    || (expectedMode === "automatic" && draft.signals.length < 3)
    || gate.status !== "publishable" || gate.reasons.length !== 0) {
    throw new Error("Top Signals publication gate is not publishable for the canonical draft");
  }
  const expectedPublished = renderTopSignalsArchive(draft, published.releaseUrl, published.publishedAt);
  if (!isDeepStrictEqual(published, expectedPublished)) {
    throw new Error("Published Top Signals archive does not exactly match the canonical draft");
  }
  if (!isDeepStrictEqual(latest, published)) {
    throw new Error("Top Signals Latest does not exactly match the published archive");
  }
  if (published.contentSha256 !== contentSha256) throw new Error("Published Top Signals content hash mismatch");
  if (input.markdown !== undefined && input.markdown !== `${renderTopSignalsRelease(draft)}\n`) {
    throw new Error("Top Signals Markdown archive does not exactly match the canonical draft");
  }
  requireExactReadmeSection(input.readme, renderTopSignalsReadme(draft, published.releaseUrl));
}

export function validateTopSignalsPublicationReceipt(value: unknown): asserts value is TopSignalsPublicationReceipt {
  if (!exactKeys(value, RECEIPT_KEYS)) throw new Error("Invalid Top Signals publication receipt keys");
  const receipt = value as unknown as TopSignalsPublicationReceipt;
  if (receipt.schemaVersion !== 1 || typeof receipt.experimentId !== "string" || typeof receipt.week !== "string"
    || typeof receipt.contentSha256 !== "string" || !/^[a-f0-9]{64}$/.test(receipt.contentSha256)
    || !canonicalTimestamp(receipt.publishedAt)) throw new Error("Invalid Top Signals publication receipt");
  requireCanonicalReleaseUrl(receipt.releaseUrl, receipt.week);
}

function strictDraft(value: unknown): value is TopSignalsDraft {
  try { validateTopSignalsDraft(value); return true; }
  catch { return false; }
}

function strictApproval(value: unknown): value is TopSignalsApproval {
  try { validateTopSignalsApproval(value); return true; }
  catch { return false; }
}

function strictPublished(value: unknown): value is PublishedTopSignalsArtifact {
  try { validatePublishedTopSignalsArtifact(value); return true; }
  catch { return false; }
}

function strictReceipt(value: unknown): value is TopSignalsPublicationReceipt {
  try { validateTopSignalsPublicationReceipt(value); return true; }
  catch { return false; }
}

function strictDecisionProducts(value: unknown): value is DecisionProductArtifact {
  try { validateDecisionProductArtifact(value); return true; }
  catch { return false; }
}

export async function prepareTopSignalsRelease(root: string, week: string, outDir: string): Promise<PreparedTopSignalsRelease> {
  const config = await loadGrowthExperimentConfig(root);
  if (week !== config.manualWeek && week !== config.automaticWeek) throw new Error(`Top Signals week is not configured: ${week}`);
  const draft = await readJsonStrict<TopSignalsDraft>(join(root, "review", "top-signals-drafts", `${week}.json`), {
    label: `Top Signals draft ${week}`,
    validate: strictDraft,
  });
  if (!draft || draft.week !== week || draft.experimentId !== config.experimentId) throw new Error(`Top Signals draft does not match requested week ${week}`);
  const decisionProducts = await readJsonStrict<DecisionProductArtifact>(join(root, "site", "data", "decision-products.json"), {
    label: "current canonical Decision Product",
    validate: strictDecisionProducts,
  });
  if (!decisionProducts) throw new Error("Current canonical Decision Product is missing");
  validatePublishedTopSignals({ draft, gate: null, published: null, latest: null, readme: "", decisionProducts });
  const approval = await readJsonStrict<TopSignalsApproval>(join(root, "review", "top-signals-approvals", `${week}.json`), {
    optional: true,
    label: `Top Signals approval ${week}`,
    validate: strictApproval,
  });
  const gate = evaluateTopSignalsGate({ draft, config, approval });
  await mkdir(outDir, { recursive: true });
  await Promise.all([
    writeFile(join(outDir, "notes.md"), `${renderTopSignalsRelease(draft)}\n`, "utf8"),
    writeFile(join(outDir, "gate.json"), `${JSON.stringify(gate, null, 2)}\n`, "utf8"),
  ]);
  if (gate.status === "blocked") throw new TopSignalsGateBlockedError(gate);
  return { draft, gate };
}

export async function publishTopSignalsRelease(input: {
  root: string;
  draft: TopSignalsDraft;
  releaseUrl: string;
  publishedAt: string;
  transaction?: FileTransaction;
}): Promise<PublishedTopSignalsArtifact> {
  validateTopSignalsDraft(input.draft);
  requireCanonicalReleaseUrl(input.releaseUrl, input.draft.week);
  const [existingArchive, existingLatest] = await Promise.all([
    readJsonStrict<PublishedTopSignalsArtifact>(join(input.root, "weekly", "top-signals", `${input.draft.week}.json`), {
      optional: true,
      label: `existing Top Signals archive ${input.draft.week}`,
      validate: strictPublished,
    }),
    readJsonStrict<PublishedTopSignalsArtifact>(join(input.root, "weekly", "top-signals", "latest.json"), {
      optional: true,
      label: "existing Top Signals Latest",
      validate: strictPublished,
    }),
  ]);
  const requestedHash = topSignalsContentSha256(input.draft);
  if (existingArchive) {
    if (!existingLatest || existingLatest.week !== input.draft.week || existingArchive.contentSha256 !== requestedHash
      || existingArchive.releaseUrl !== input.releaseUrl) {
      throw new Error(`Top Signals week ${input.draft.week} is already published and cannot be replaced`);
    }
    await validateTopSignalsPublication(input.root, input.draft.week);
    return existingArchive;
  }
  if (existingLatest?.week === input.draft.week) throw new Error(`Top Signals week ${input.draft.week} has an incomplete existing publication`);
  if (existingLatest && existingLatest.week > input.draft.week) throw new Error(`Top Signals week ${input.draft.week} is older than the current published week`);
  const published = renderTopSignalsArchive(input.draft, input.releaseUrl, input.publishedAt);
  validatePublishedTopSignalsArtifact(published);
  const receipt: TopSignalsPublicationReceipt = {
    schemaVersion: 1,
    experimentId: input.draft.experimentId,
    week: input.draft.week,
    contentSha256: published.contentSha256,
    releaseUrl: input.releaseUrl,
    publishedAt: input.publishedAt,
  };
  validateTopSignalsPublicationReceipt(receipt);
  const readmePath = join(input.root, "README.md");
  const readme = replacePublishedTopSignalsReadme(await readFile(readmePath, "utf8"), published);
  const transaction = input.transaction ?? new FileTransaction(`top-signals-${input.draft.week}`);
  const json = `${JSON.stringify(published, null, 2)}\n`;
  transaction.stage(join(input.root, "weekly", "top-signals", `${input.draft.week}.json`), json);
  transaction.stage(join(input.root, "weekly", "top-signals", `${input.draft.week}.md`), `${renderTopSignalsRelease(input.draft)}\n`);
  transaction.stage(join(input.root, "weekly", "top-signals", "latest.json"), json);
  transaction.stage(join(input.root, "review", "top-signals-publication-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  transaction.stage(readmePath, readme);
  await transaction.commit();
  return published;
}

export async function validateTopSignalsPublication(root: string, week: string): Promise<void> {
  const [config, draft, decisionProducts, latest, readme] = await Promise.all([
    loadGrowthExperimentConfig(root),
    readJsonStrict<TopSignalsDraft>(join(root, "review", "top-signals-drafts", `${week}.json`), { label: `Top Signals draft ${week}`, validate: strictDraft }),
    readJsonStrict<DecisionProductArtifact>(join(root, "site", "data", "decision-products.json"), { label: "current canonical Decision Product", validate: strictDecisionProducts }),
    readJsonStrict<PublishedTopSignalsArtifact>(join(root, "weekly", "top-signals", "latest.json"), { optional: true, label: "Top Signals Latest", validate: strictPublished }),
    readFile(join(root, "README.md"), "utf8"),
  ]);
  if (!draft || !decisionProducts || draft.week !== week || draft.experimentId !== config.experimentId) {
    throw new Error(`Top Signals draft does not match requested week ${week}`);
  }
  if (!latest) {
    validatePublishedTopSignals({ draft, gate: null, published: null, latest: null, readme, decisionProducts });
    return;
  }
  if (latest.week !== week) throw new Error(`Top Signals Latest week ${latest.week} does not match requested week ${week}`);
  const [published, receipt, approval, markdown] = await Promise.all([
    readJsonStrict<PublishedTopSignalsArtifact>(join(root, "weekly", "top-signals", `${week}.json`), { label: `Top Signals archive ${week}`, validate: strictPublished }),
    readJsonStrict<TopSignalsPublicationReceipt>(join(root, "review", "top-signals-publication-receipt.json"), { label: "Top Signals publication receipt", validate: strictReceipt }),
    readJsonStrict<TopSignalsApproval>(join(root, "review", "top-signals-approvals", `${week}.json`), { optional: true, label: `Top Signals approval ${week}`, validate: strictApproval }),
    readFile(join(root, "weekly", "top-signals", `${week}.md`), "utf8"),
  ]);
  if (!published || !receipt) throw new Error("Top Signals publication is incomplete");
  const gate = evaluateTopSignalsGate({ draft, config, approval });
  validatePublishedTopSignals({ draft, gate, published, latest, markdown, readme, decisionProducts });
  if (receipt.experimentId !== published.experimentId || receipt.week !== published.week
    || receipt.contentSha256 !== published.contentSha256 || receipt.releaseUrl !== published.releaseUrl
    || receipt.publishedAt !== published.publishedAt) {
    throw new Error("Top Signals publication receipt does not exactly match the published archive");
  }
}
