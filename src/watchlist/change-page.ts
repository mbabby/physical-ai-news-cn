import { join } from "node:path";
import type { FileTransaction } from "../runtime/storage.js";
import { isCanonicalTimestamp, isValidIsoWeek, validateWatchlistSnapshotShape, type WatchlistSnapshot } from "./contracts.js";
import {
  assertNoPrivateWatchlistContent,
  validateWatchlistPublicViewShape,
  type WatchlistPublicCard,
  type WatchlistPublicEvidenceLink,
  type WatchlistPublicView,
} from "./public-view.js";

export type WatchlistPeriodChangeKind = "addition" | "strengthening" | "awaiting-validation" | "downgrade" | "exit" | "correction";

export interface WatchlistChangePageIdentity {
  week: string;
  snapshotVersion: number;
  generatedAt: string;
}

export interface WatchlistPeriodChange {
  companyId: string;
  companyName: string;
  kind: WatchlistPeriodChangeKind;
  whatChanged: string;
  why: string;
  evidenceLinks: WatchlistPublicEvidenceLink[];
}

export interface WatchlistChangePage {
  schemaVersion: 1;
  current: WatchlistChangePageIdentity;
  baseline: WatchlistChangePageIdentity | null;
  emptyBaseline: boolean;
  changes: WatchlistPeriodChange[];
}

export interface BuildWatchlistChangePageInput {
  current: WatchlistSnapshot;
  snapshots: WatchlistSnapshot[];
  views: WatchlistPublicView[];
}

export interface StageWatchlistChangePageInput {
  transaction: Pick<FileTransaction, "stage">;
  root: string;
  artifact: WatchlistChangePage;
}

const CHANGE_KINDS = new Set<WatchlistPeriodChangeKind>(["addition", "strengthening", "awaiting-validation", "downgrade", "exit", "correction"]);
const COMPANY_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function identity(snapshot: WatchlistSnapshot): WatchlistChangePageIdentity {
  return { week: snapshot.week, snapshotVersion: snapshot.snapshotVersion, generatedAt: snapshot.generatedAt };
}

function identityKey(value: WatchlistChangePageIdentity): string {
  return `${value.week}\0${String(value.snapshotVersion).padStart(12, "0")}`;
}

function sameIdentity(left: WatchlistChangePageIdentity, right: WatchlistChangePageIdentity): boolean {
  return left.week === right.week && left.snapshotVersion === right.snapshotVersion && left.generatedAt === right.generatedAt;
}

function snapshotBytes(snapshot: WatchlistSnapshot): string {
  return JSON.stringify(snapshot);
}

function viewIdentity(view: WatchlistPublicView): WatchlistChangePageIdentity {
  return { week: view.week, snapshotVersion: view.snapshotVersion, generatedAt: view.lastSuccessfulAt };
}

function safeEvidenceLinks(card: WatchlistPublicCard): WatchlistPublicEvidenceLink[] {
  const links = [...card.evidenceLinks].sort((left, right) => compareCodeUnits(`${left.eventId}\0${left.url}`, `${right.eventId}\0${right.url}`));
  if (!links.length) throw new Error(`Watchlist 变化缺少规范证据：${card.companyId}`);
  for (const evidence of links) {
    let url: URL;
    try {
      url = new URL(evidence.url);
    } catch {
      throw new Error(`Watchlist 变化证据链接不安全：${card.companyId}`);
    }
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) {
      throw new Error(`Watchlist 变化证据链接必须是规范 HTTPS URL：${card.companyId}`);
    }
  }
  return links.map((link) => ({ ...link }));
}

function publicValue(card: WatchlistPublicCard): string {
  const {
    thesisVersion: _thesisVersion,
    ...value
  } = card;
  return JSON.stringify(value);
}

function label(kind: WatchlistPeriodChangeKind): string {
  return {
    addition: "新进入名单",
    strengthening: "判断强化",
    "awaiting-validation": "转为等待验证",
    downgrade: "判断降级",
    exit: "退出名单",
    correction: "公开判断修正",
  }[kind];
}

function whatChanged(kind: WatchlistPeriodChangeKind, previous: WatchlistPublicCard | undefined, current: WatchlistPublicCard | undefined): string {
  const subject = current ?? previous;
  if (!subject) throw new Error("Watchlist 变化缺少公开公司");
  if (kind === "addition") return `${subject.companyName}：新进入名单，公开判断 ${subject.thesisId} v${subject.thesisVersion}。`;
  if (kind === "correction" && previous && current) {
    const before = `${previous.thesisId} v${previous.thesisVersion}`;
    const after = `${current.thesisId} v${current.thesisVersion}`;
    return before === after
      ? `${subject.companyName}：公开判断 ${after} 的可见事实已修正。`
      : `${subject.companyName}：公开判断由 ${before} 更新为 ${after}。`;
  }
  if (previous && current) return `${subject.companyName}：生命周期由“${previous.lifecycleLabel}”调整为“${current.lifecycleLabel}”，当前公开判断为 ${current.thesisId} v${current.thesisVersion}。`;
  return `${subject.companyName}：${label(kind)}。`;
}

function deriveKind(previous: WatchlistPublicCard | undefined, current: WatchlistPublicCard | undefined, previousIdentity: WatchlistChangePageIdentity, currentIdentity: WatchlistChangePageIdentity): WatchlistPeriodChangeKind | undefined {
  if (!previous && current) return "addition";
  if (previous && !current) return undefined;
  if (!previous || !current || publicValue(previous) === publicValue(current)) return undefined;
  if (previousIdentity.week === currentIdentity.week
    && (previous.thesisId !== current.thesisId || previous.thesisVersion !== current.thesisVersion)) return "correction";
  if (current.lifecycle === "strengthening") return "strengthening";
  if (current.lifecycle === "awaiting-validation") return "awaiting-validation";
  if (current.lifecycle === "downgraded") return "downgrade";
  return undefined;
}

function changeFor(previous: WatchlistPublicCard | undefined, current: WatchlistPublicCard | undefined, previousIdentity: WatchlistChangePageIdentity, currentIdentity: WatchlistChangePageIdentity): WatchlistPeriodChange | undefined {
  const kind = deriveKind(previous, current, previousIdentity, currentIdentity);
  if (!kind) return undefined;
  const subject = current ?? previous;
  if (!subject) return undefined;
  const evidenceLinks = safeEvidenceLinks(subject);
  return {
    companyId: subject.companyId,
    companyName: subject.companyName,
    kind,
    whatChanged: whatChanged(kind, previous, current),
    why: subject.whyNow,
    evidenceLinks,
  };
}

function indexedSnapshots(input: BuildWatchlistChangePageInput): WatchlistSnapshot[] {
  const byIdentity = new Map<string, WatchlistSnapshot>();
  for (const snapshot of [...input.snapshots, input.current]) {
    const key = identityKey(identity(snapshot));
    const prior = byIdentity.get(key);
    if (prior && snapshotBytes(prior) !== snapshotBytes(snapshot)) throw new Error(`Watchlist 不可变快照身份冲突：${key}`);
    byIdentity.set(key, snapshot);
  }
  const all = [...byIdentity.values()].sort((left, right) => compareCodeUnits(identityKey(identity(left)), identityKey(identity(right))));
  const currentKey = identityKey(identity(input.current));
  if (all.at(-1) && identityKey(identity(all.at(-1)!)) !== currentKey) {
    throw new Error("Watchlist 变化页只能以最新不可变快照作为 current");
  }
  return all;
}

function indexedViews(views: WatchlistPublicView[]): Map<string, WatchlistPublicView> {
  const result = new Map<string, WatchlistPublicView>();
  for (const view of views) {
    if (!validateWatchlistPublicViewShape(view)) throw new Error("Watchlist 变化页公开视图结构不合法");
    assertNoPrivateWatchlistContent(view);
    const key = identityKey(viewIdentity(view));
    const prior = result.get(key);
    if (prior && JSON.stringify(prior) !== JSON.stringify(view)) throw new Error(`Watchlist 变化页公开视图身份冲突：${key}`);
    result.set(key, view);
  }
  return result;
}

function assertExactSnapshotView(snapshot: WatchlistSnapshot, view: WatchlistPublicView): void {
  if (!validateWatchlistSnapshotShape(snapshot)) throw new Error("Watchlist 变化页不可变快照结构不合法");
  if (view.methodologyVersion !== snapshot.methodologyVersion) throw new Error("Watchlist 变化页公开视图与快照方法论不一致");
  const expected = new Map([
    ...snapshot.forwardRadar.map((entry) => [entry.companyId, `${entry.thesisId}\0${entry.thesisVersion}\0forward-radar`] as const),
    ...snapshot.validatedMomentum.map((entry) => [entry.companyId, `${entry.thesisId}\0${entry.thesisVersion}\0validated-momentum`] as const),
  ]);
  const actual = new Map([...view.forwardRadar, ...view.validatedMomentum]
    .map((card) => [card.companyId, `${card.thesisId}\0${card.thesisVersion}\0${card.track}`] as const));
  if (expected.size !== actual.size || [...expected].some(([companyId, thesis]) => actual.get(companyId) !== thesis)) {
    throw new Error("Watchlist 变化页公开视图没有引用快照的精确判断版本");
  }
}

/** Compare the current immutable snapshot only with its immediate immutable predecessor. */
export function buildWatchlistChangePage(input: BuildWatchlistChangePageInput): WatchlistChangePage {
  const snapshots = indexedSnapshots(input);
  const currentIdentity = identity(input.current);
  const currentKey = identityKey(currentIdentity);
  const currentIndex = snapshots.findIndex((snapshot) => identityKey(identity(snapshot)) === currentKey);
  if (currentIndex < 0) throw new Error("Watchlist 变化页缺少 current 不可变快照");
  const baselineSnapshot = currentIndex > 0 ? snapshots[currentIndex - 1] : undefined;
  const views = indexedViews(input.views);
  const currentView = views.get(currentKey);
  if (!currentView || !sameIdentity(viewIdentity(currentView), currentIdentity)) throw new Error("Watchlist 变化页缺少 current 公开视图");
  assertExactSnapshotView(input.current, currentView);
  if (!baselineSnapshot) {
    return { schemaVersion: 1, current: currentIdentity, baseline: null, emptyBaseline: true, changes: [] };
  }
  const baseline = identity(baselineSnapshot);
  const baselineView = views.get(identityKey(baseline));
  if (!baselineView || !sameIdentity(viewIdentity(baselineView), baseline)) throw new Error("Watchlist 变化页缺少相邻基线公开视图");
  assertExactSnapshotView(baselineSnapshot, baselineView);
  const previousCards = new Map([...baselineView.forwardRadar, ...baselineView.validatedMomentum].map((card) => [card.companyId, card]));
  const currentCards = new Map([...currentView.forwardRadar, ...currentView.validatedMomentum].map((card) => [card.companyId, card]));
  const companyIds = [...new Set([...previousCards.keys(), ...currentCards.keys()])].sort(compareCodeUnits);
  const changes = companyIds.map((companyId) => changeFor(previousCards.get(companyId), currentCards.get(companyId), baseline, currentIdentity))
    .filter((change): change is WatchlistPeriodChange => Boolean(change));
  const artifact: WatchlistChangePage = { schemaVersion: 1, current: currentIdentity, baseline, emptyBaseline: false, changes };
  validateWatchlistChangePage(artifact);
  return artifact;
}

/** Strict runtime boundary for the static, public period-change artifact. */
export function validateWatchlistChangePage(value: unknown): asserts value is WatchlistChangePage {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Watchlist 变化页工件结构不合法");
  const artifact = value as Record<string, unknown>;
  if (Object.keys(artifact).length !== 5 || !["schemaVersion", "current", "baseline", "emptyBaseline", "changes"].every((key) => key in artifact)
    || artifact.schemaVersion !== 1 || typeof artifact.emptyBaseline !== "boolean" || !Array.isArray(artifact.changes)) {
    throw new Error("Watchlist 变化页工件结构不合法");
  }
  const validIdentity = (candidate: unknown): candidate is WatchlistChangePageIdentity => candidate !== null && typeof candidate === "object" && !Array.isArray(candidate)
    && Object.keys(candidate).length === 3 && isValidIsoWeek((candidate as WatchlistChangePageIdentity).week)
    && Number.isInteger((candidate as WatchlistChangePageIdentity).snapshotVersion) && (candidate as WatchlistChangePageIdentity).snapshotVersion > 0
    && isCanonicalTimestamp((candidate as WatchlistChangePageIdentity).generatedAt);
  if (!validIdentity(artifact.current) || (artifact.baseline !== null && !validIdentity(artifact.baseline))) throw new Error("Watchlist 变化页快照身份不合法");
  if (artifact.emptyBaseline !== (artifact.baseline === null) || (artifact.emptyBaseline && artifact.changes.length)) throw new Error("Watchlist 变化页基线状态不合法");
  const companyIds = new Set<string>();
  for (const item of artifact.changes) {
    if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).length !== 6) throw new Error("Watchlist 变化项结构不合法");
    const change = item as WatchlistPeriodChange;
    if (!COMPANY_ID.test(change.companyId) || !change.companyName.trim() || !CHANGE_KINDS.has(change.kind)
      || !change.whatChanged.trim() || !change.why.trim() || !Array.isArray(change.evidenceLinks) || !change.evidenceLinks.length || companyIds.has(change.companyId)) {
      throw new Error("Watchlist 变化项结构不合法");
    }
    companyIds.add(change.companyId);
    safeEvidenceLinks({ evidenceLinks: change.evidenceLinks } as WatchlistPublicCard);
  }
  const ids = artifact.changes.map((item) => item.companyId);
  if (!ids.every((id, index) => index === 0 || ids[index - 1]! < id)) throw new Error("Watchlist 变化项未按稳定顺序排列");
  assertNoPrivateWatchlistContent(value);
}

/** Stage the public static page data alongside the rest of the daily Watchlist release. */
export function stageWatchlistChangePage(input: StageWatchlistChangePageInput): void {
  validateWatchlistChangePage(input.artifact);
  input.transaction.stage(join(input.root, "site", "data", "watchlist-changes.json"), `${JSON.stringify(input.artifact, null, 2)}\n`);
}
