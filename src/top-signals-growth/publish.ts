import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { replacePublishedTopSignalsReadme } from "../decision-products/markdown.js";
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
import { evaluateTopSignalsGate, type TopSignalsGateReceipt } from "./gate.js";
import {
  renderTopSignalsArchive,
  renderTopSignalsReadme,
  renderTopSignalsRelease,
  type PublishedTopSignalsArtifact,
} from "./render.js";

const REPOSITORY_RELEASE_BASE = "https://github.com/mbabby/physical-ai-news-cn/releases/tag/";
const PUBLISHED_KEYS = [
  "schemaVersion", "experimentId", "week", "generatedAt", "periodStart", "periodEnd", "signals",
  "releaseUrl", "publishedAt", "contentSha256",
] as const;
const RECEIPT_KEYS = ["schemaVersion", "experimentId", "week", "contentSha256", "releaseUrl", "publishedAt"] as const;

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

function draftFromPublished(value: PublishedTopSignalsArtifact): TopSignalsDraft {
  return {
    schemaVersion: value.schemaVersion,
    experimentId: value.experimentId,
    week: value.week,
    generatedAt: value.generatedAt,
    periodStart: value.periodStart,
    periodEnd: value.periodEnd,
    signals: value.signals,
  };
}

export function validatePublishedTopSignalsArtifact(value: unknown): asserts value is PublishedTopSignalsArtifact {
  if (!exactKeys(value, PUBLISHED_KEYS)) throw new Error("Invalid published Top Signals artifact keys");
  const published = value as unknown as PublishedTopSignalsArtifact;
  const draft = draftFromPublished(published);
  validateTopSignalsDraft(draft);
  requireCanonicalReleaseUrl(published.releaseUrl, published.week);
  if (!canonicalTimestamp(published.publishedAt)) throw new Error("Invalid published Top Signals timestamp");
  if (published.contentSha256 !== topSignalsContentSha256(draft)) throw new Error("Published Top Signals content hash mismatch");
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

export async function prepareTopSignalsRelease(root: string, week: string, outDir: string): Promise<PreparedTopSignalsRelease> {
  const config = await loadGrowthExperimentConfig(root);
  if (week !== config.manualWeek && week !== config.automaticWeek) throw new Error(`Top Signals week is not configured: ${week}`);
  const draft = await readJsonStrict<TopSignalsDraft>(join(root, "review", "top-signals-drafts", `${week}.json`), {
    label: `Top Signals draft ${week}`,
    validate: strictDraft,
  });
  if (!draft || draft.week !== week || draft.experimentId !== config.experimentId) throw new Error(`Top Signals draft does not match requested week ${week}`);
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
  const draft = await readJsonStrict<TopSignalsDraft>(join(root, "review", "top-signals-drafts", `${week}.json`), { label: `Top Signals draft ${week}`, validate: strictDraft });
  const published = await readJsonStrict<PublishedTopSignalsArtifact>(join(root, "weekly", "top-signals", `${week}.json`), { label: `Top Signals archive ${week}`, validate: strictPublished });
  const latest = await readJsonStrict<PublishedTopSignalsArtifact>(join(root, "weekly", "top-signals", "latest.json"), { label: "Top Signals Latest", validate: strictPublished });
  const receipt = await readJsonStrict<TopSignalsPublicationReceipt>(join(root, "review", "top-signals-publication-receipt.json"), { label: "Top Signals publication receipt", validate: strictReceipt });
  if (!draft || !published || !latest || !receipt) throw new Error("Top Signals publication is incomplete");
  const expectedHash = topSignalsContentSha256(draft);
  if (draft.week !== week || published.week !== week || latest.week !== week || receipt.week !== week
    || published.contentSha256 !== expectedHash || latest.contentSha256 !== expectedHash || receipt.contentSha256 !== expectedHash
    || JSON.stringify(published) !== JSON.stringify(latest)) throw new Error("Top Signals publication surfaces do not match the canonical draft");
  if (await readFile(join(root, "weekly", "top-signals", `${week}.md`), "utf8") !== `${renderTopSignalsRelease(draft)}\n`) {
    throw new Error("Top Signals Markdown archive does not match the canonical draft");
  }
  const readme = await readFile(join(root, "README.md"), "utf8");
  if (!readme.includes(renderTopSignalsReadme(draft, published.releaseUrl))) throw new Error("README does not contain the canonical published Top Signals");
}
