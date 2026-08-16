import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FileTransaction } from "../runtime/storage.js";
import { isObject } from "../runtime/storage.js";
import {
  isCanonicalTimestamp,
  validateCompanyThesisShape,
  validateWatchlistSnapshotShape,
  type CompanyThesis,
  type CompanyThesisArtifact,
  type WatchlistSnapshot,
  type WatchlistSnapshotEntry,
  type WatchlistTrack,
} from "./contracts.js";
import { assertNoPrivateWatchlistContent, isInternalCandidateIdentifier, validateWatchlistPublicViewShape, type WatchlistPublicCard, type WatchlistPublicView } from "./public-view.js";
import { snapshotPath } from "./snapshot.js";
import { stageWatchlistFeeds } from "./feeds.js";

export interface WatchlistReleaseValidationInput {
  snapshot: WatchlistSnapshot;
  theses: CompanyThesisArtifact;
  dashboard: unknown;
  readme: string;
  history?: WatchlistSnapshot[];
}

const PRIVATE_KEY = /(?:^|_)(?:internal|private|diagnostic|candidate|seed|draft)|(?:score|rank)$|sentenceCitations|holdReasons|failureReasons/i;
const PRIVATE_TEXT = /\b(?:score|rank)\b|分数|排名|内部诊断|候选(?:ID|标识)/i;

function exactKey(thesisId: string, thesisVersion: number): string {
  return `${thesisId}\0${thesisVersion}`;
}

function stableBytes(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

function sameSet(left: Iterable<string>, right: Iterable<string>): boolean {
  const a = sorted(left);
  const b = sorted(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function assertNoPrivateKeys(value: unknown, path: string): void {
  if (typeof value === "string" && isInternalCandidateIdentifier(value)) {
    throw new Error(`Watchlist 公开产物包含候选标识：${path}`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoPrivateKeys(item, `${path}[${index}]`));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (PRIVATE_KEY.test(key)) throw new Error(`Watchlist 公开产物包含私有诊断、候选标识、分数或排名字段：${path}.${key}`);
    assertNoPrivateKeys(child, `${path}.${key}`);
  }
}

function validateThesisArtifact(value: CompanyThesisArtifact): void {
  if (!isObject(value) || Object.keys(value).length !== 3
    || Object.keys(value).some((key) => key !== "schemaVersion" && key !== "generatedAt" && key !== "theses")
    || value.schemaVersion !== 1 || !isCanonicalTimestamp(value.generatedAt)
    || !Array.isArray(value.theses) || !value.theses.every(validateCompanyThesisShape)) {
    throw new Error("Watchlist 公开判断工件结构不合法");
  }
}

function publicView(value: unknown): WatchlistPublicView {
  if (!isObject(value) || !validateWatchlistPublicViewShape(value.watchlist)) {
    throw new Error("Watchlist dashboard 公开视图结构不合法");
  }
  return value.watchlist;
}

function entries(snapshot: WatchlistSnapshot): Array<WatchlistSnapshotEntry & { track: WatchlistTrack }> {
  return [
    ...snapshot.forwardRadar.map((entry) => ({ ...entry, track: "forward-radar" as const })),
    ...snapshot.validatedMomentum.map((entry) => ({ ...entry, track: "validated-momentum" as const })),
  ];
}

function cards(view: WatchlistPublicView): WatchlistPublicCard[] {
  return [...view.forwardRadar, ...view.validatedMomentum];
}

function readmeIdentity(readme: string): { week: string; version: number } | undefined {
  const match = /观察名单快照：(\d{4}-W\d{2}) · v(\d+)/.exec(readme);
  return match ? { week: match[1]!, version: Number(match[2]) } : undefined;
}

function readmeCompanyIds(readme: string): string[] {
  return [...readme.matchAll(/companies\.html#([^\s)]+)/g)].map((match) => {
    try { return decodeURIComponent(match[1]!); } catch { return match[1]!; }
  });
}

export async function validateCurrentWatchlistHistoryFiles(root: string, snapshot: WatchlistSnapshot): Promise<void> {
  const paths = snapshotPath(snapshot);
  const currentPath = join(root, paths.current);
  const historyPath = join(root, paths.history);
  let currentBytes: string;
  let historyBytes: string;
  try {
    currentBytes = await readFile(currentPath, "utf8");
  } catch (error) {
    throw new Error(`Watchlist 缺少 current 公开快照：${paths.current}`, { cause: error });
  }
  try {
    historyBytes = await readFile(historyPath, "utf8");
  } catch (error) {
    throw new Error(`Watchlist 缺少 current 对应的不可变历史：${paths.history}`, { cause: error });
  }
  if (currentBytes !== historyBytes) {
    throw new Error(`Watchlist current 与不可变历史字节不一致：${paths.history}`);
  }
}

export function validateWatchlistRelease(input: WatchlistReleaseValidationInput): void {
  assertNoPrivateKeys(input.snapshot, "snapshot");
  assertNoPrivateKeys(input.history ?? [], "history");
  assertNoPrivateKeys(input.theses, "theses");
  if (isObject(input.dashboard)) assertNoPrivateKeys(input.dashboard.watchlist, "dashboard.watchlist");
  assertNoPrivateWatchlistContent(input.snapshot);
  assertNoPrivateWatchlistContent(input.history ?? []);
  assertNoPrivateWatchlistContent(input.theses);
  if (isObject(input.dashboard)) assertNoPrivateWatchlistContent(input.dashboard.watchlist);
  const dashboardView = publicView(input.dashboard);
  if (PRIVATE_TEXT.test(input.readme)) throw new Error("Watchlist README 包含私有诊断、分数或排名");
  if (!validateWatchlistSnapshotShape(input.snapshot)) throw new Error("Watchlist 公开快照结构不合法");
  validateThesisArtifact(input.theses);

  const identity = readmeIdentity(input.readme);
  if (!identity || dashboardView.week !== input.snapshot.week || identity.week !== input.snapshot.week) {
    throw new Error("Watchlist 周在快照、dashboard 与 README 间不一致");
  }
  if (dashboardView.snapshotVersion !== input.snapshot.snapshotVersion || identity.version !== input.snapshot.snapshotVersion) {
    throw new Error("Watchlist 快照版本在 dashboard 与 README 间不一致");
  }
  if (dashboardView.methodologyVersion !== input.snapshot.methodologyVersion
    || dashboardView.lastSuccessfulAt !== input.snapshot.generatedAt
    || input.theses.generatedAt !== input.snapshot.generatedAt) {
    throw new Error("Watchlist 快照身份在公开产物间不一致");
  }

  const theses = new Map<string, CompanyThesis>();
  for (const thesis of input.theses.theses) {
    const key = exactKey(thesis.thesisId, thesis.thesisVersion);
    if (theses.has(key)) throw new Error(`Watchlist 公开判断版本重复：${thesis.thesisId}@${thesis.thesisVersion}`);
    theses.set(key, thesis);
  }
  const releaseSnapshots = [...(input.history ?? []), input.snapshot];
  const requiredThesisKeys = new Set(releaseSnapshots.flatMap((releaseSnapshot) => entries(releaseSnapshot)
    .map((entry) => exactKey(entry.thesisId, entry.thesisVersion))));
  if (!sameSet(theses.keys(), requiredThesisKeys)) {
    throw new Error("Watchlist 公开判断版本集合与 current/history 快照引用不一致");
  }
  for (const releaseSnapshot of releaseSnapshots) {
    if (!validateWatchlistSnapshotShape(releaseSnapshot)) throw new Error("Watchlist 历史快照结构不合法");
    const snapshotAt = Date.parse(releaseSnapshot.generatedAt);
    for (const entry of entries(releaseSnapshot)) {
      const selected = theses.get(exactKey(entry.thesisId, entry.thesisVersion));
      if (!selected || selected.companyId !== entry.companyId || selected.track !== entry.track) {
        throw new Error(`Watchlist 缺少匹配的判断版本：${entry.thesisId}@${entry.thesisVersion}`);
      }
      if (selected.methodologyVersion !== releaseSnapshot.methodologyVersion) {
        throw new Error(`Watchlist 判断方法论版本不一致：${entry.thesisId}@${entry.thesisVersion}`);
      }
      if (!selected.inferenceLabels.includes("AI 研究判断")) {
        throw new Error(`Watchlist 判断标签缺少“AI 研究判断”：${entry.thesisId}@${entry.thesisVersion}`);
      }
      if (selected.lifecycle === "falsified" || selected.lifecycle === "expired") {
        throw new Error(`Watchlist 判断不可公开：${entry.thesisId}@${entry.thesisVersion}`);
      }
      if (!Number.isFinite(Date.parse(selected.expiresAt)) || Date.parse(selected.expiresAt) <= snapshotAt) {
        throw new Error(`Watchlist 判断已过期：${entry.thesisId}@${entry.thesisVersion}`);
      }
    }
  }

  const selectedEntries = entries(input.snapshot);
  const publicCards = cards(dashboardView);
  for (const entry of selectedEntries) {
    const card = publicCards.find((item) => item.thesisId === entry.thesisId && item.thesisVersion === entry.thesisVersion);
    if (!card || card.companyId !== entry.companyId || card.track !== entry.track || card.group !== entry.group) {
      throw new Error(`Watchlist dashboard 缺少匹配的判断版本：${entry.thesisId}@${entry.thesisVersion}`);
    }
  }
  if (dashboardView.changes.length !== input.snapshot.changesSinceLastWeek.length
    || dashboardView.changes.some((change, index) => {
      const canonical = input.snapshot.changesSinceLastWeek[index];
      if (!canonical || change.companyId !== canonical.companyId || change.change !== canonical.change) return true;
      const currentCard = publicCards.find((card) => card.companyId === change.companyId);
      return Boolean(currentCard && currentCard.companyName !== change.companyName);
    })) {
    throw new Error("Watchlist dashboard 变更与快照 changesSinceLastWeek 不一致");
  }
  const companyIds = selectedEntries.map((entry) => entry.companyId);
  if (!sameSet(companyIds, dashboardView.companyIds)
    || !sameSet(companyIds, publicCards.map((card) => card.companyId))
    || !sameSet(companyIds, readmeCompanyIds(input.readme))) {
    throw new Error("Watchlist 公司集合在快照、dashboard 与 README 间不一致");
  }
  if (!input.readme.includes("AI 研究判断")
    || publicCards.some((card) => !card.whyNow.startsWith("AI 研究判断") || !card.routeAndDependencies.startsWith("AI 研究判断"))) {
    throw new Error("Watchlist 公开产物缺少可见的“AI 研究判断”披露");
  }
}

export interface MergeWatchlistThesisArtifactInput {
  snapshot: WatchlistSnapshot;
  histories: WatchlistSnapshot[];
  previous?: CompanyThesisArtifact;
  candidates: CompanyThesis[];
}

export function mergeWatchlistThesisArtifact(input: MergeWatchlistThesisArtifactInput): CompanyThesisArtifact {
  const available = new Map<string, CompanyThesis>();
  const add = (thesis: CompanyThesis): void => {
    const key = exactKey(thesis.thesisId, thesis.thesisVersion);
    const prior = available.get(key);
    if (prior && stableBytes(prior) !== stableBytes(thesis)) {
      throw new Error(`Watchlist 判断版本字节冲突：${thesis.thesisId}@${thesis.thesisVersion}`);
    }
    available.set(key, thesis);
  };
  input.previous?.theses.forEach(add);
  input.candidates.forEach(add);

  const required = new Map<string, WatchlistSnapshotEntry>();
  for (const snapshot of [...input.histories, input.snapshot]) {
    if (!validateWatchlistSnapshotShape(snapshot)) throw new Error("Watchlist 历史快照结构不合法");
    for (const entry of [...snapshot.forwardRadar, ...snapshot.validatedMomentum]) {
      required.set(exactKey(entry.thesisId, entry.thesisVersion), entry);
    }
  }
  const theses = [...required.entries()].map(([key, entry]) => {
    const selected = available.get(key);
    if (!selected || selected.companyId !== entry.companyId) {
      throw new Error(`Watchlist 缺少历史判断版本：${entry.thesisId}@${entry.thesisVersion}`);
    }
    return selected;
  }).sort((left, right) => left.thesisId.localeCompare(right.thesisId) || left.thesisVersion - right.thesisVersion);
  return { schemaVersion: 1, generatedAt: input.snapshot.generatedAt, theses };
}

export interface StageWatchlistReleaseInput extends WatchlistReleaseValidationInput {
  transaction: Pick<FileTransaction, "stage">;
  root: string;
  feeds: { baseUrl: string };
}

export async function stageWatchlistRelease(input: StageWatchlistReleaseInput): Promise<void> {
  validateWatchlistRelease(input);
  if (!input.feeds) throw new Error("Watchlist 发布订阅配置为必需；已停止 staging");
  const paths = snapshotPath(input.snapshot);
  const historyPath = join(input.root, paths.history);
  const historyBytes = stableBytes(input.snapshot);
  let existingHistory: string | undefined;
  try {
    existingHistory = await readFile(historyPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (existingHistory !== undefined && existingHistory !== historyBytes) {
    throw new Error(`Watchlist 历史快照字节冲突：${paths.history}`);
  }

  input.transaction.stage(join(input.root, paths.current), stableBytes(input.snapshot));
  input.transaction.stage(join(input.root, "watchlist", "theses.json"), stableBytes(input.theses));
  if (existingHistory === undefined) input.transaction.stage(historyPath, historyBytes);
  input.transaction.stage(join(input.root, "site", "data", "dashboard.json"), stableBytes(input.dashboard));
  input.transaction.stage(join(input.root, "README.md"), input.readme);
  stageWatchlistFeeds({ transaction: input.transaction, root: input.root, view: publicView(input.dashboard), baseUrl: input.feeds.baseUrl });
}
