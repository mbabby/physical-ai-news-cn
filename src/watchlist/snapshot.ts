import { isCanonicalTimestamp, isValidIsoWeek, validateWatchlistSnapshotShape } from "./contracts.js";
import type {
  CompanyThesis,
  WatchlistChange,
  WatchlistPublicGroup,
  WatchlistSnapshot,
  WatchlistSnapshotEntry,
  WatchlistTrack,
} from "./contracts.js";

const ACTIVE_LIFECYCLES = new Set(["new", "strengthening", "awaiting-validation", "downgraded"]);
const CONTINUED_LIFECYCLES = new Set(["awaiting-validation", "downgraded"]);
const TRACK_LIMIT = 5;
const CONTINUED_LIMIT = 2;
const ROUTE_SHARE_LIMIT = 0.4;

export interface BuildWatchlistSnapshotInput {
  theses: CompanyThesis[];
  previous?: WatchlistSnapshot;
  previousWeekBaseline?: WatchlistSnapshot;
  week: string;
  methodologyVersion: string;
  generatedAt: string;
  primaryRouteByCompanyId: Record<string, string>;
  routeShareExceptionReason?: string;
}

export interface WatchlistSnapshotPaths {
  current: "watchlist/current.json";
  history: string;
}

function assertInput(input: BuildWatchlistSnapshotInput): number {
  const generatedAt = Date.parse(input.generatedAt);
  if (!isValidIsoWeek(input.week)) throw new Error("Watchlist 快照周格式无效");
  if (!input.methodologyVersion.trim()) throw new Error("Watchlist 快照缺少方法论版本");
  if (!isCanonicalTimestamp(input.generatedAt) || !Number.isFinite(generatedAt)) throw new Error("Watchlist 快照时间无效");
  if (input.previousWeekBaseline?.week !== undefined && input.previousWeekBaseline.week !== priorIsoWeek(input.week)) {
    throw new Error("Watchlist 同周修订基线必须是目标周的紧邻前一周");
  }
  return generatedAt;
}

function priorIsoWeek(week: string): string {
  const year = Number(week.slice(0, 4));
  const weekNumber = Number(week.slice(-2));
  if (weekNumber > 1) return `${week.slice(0, 4)}-W${String(weekNumber - 1).padStart(2, "0")}`;
  const priorYear = String(year - 1).padStart(4, "0");
  return `${priorYear}-W${isValidIsoWeek(`${priorYear}-W53`) ? "53" : "52"}`;
}

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function groupOf(thesis: CompanyThesis): WatchlistPublicGroup {
  return CONTINUED_LIFECYCLES.has(thesis.lifecycle) ? "continued-observation" : "priority-focus";
}

function candidateOrder(left: CompanyThesis, right: CompanyThesis): number {
  const leftGroup = groupOf(left) === "priority-focus" ? 0 : 1;
  const rightGroup = groupOf(right) === "priority-focus" ? 0 : 1;
  return leftGroup - rightGroup
    || right.thesisVersion - left.thesisVersion
    || Date.parse(right.generatedAt) - Date.parse(left.generatedAt)
    || codeUnitCompare(left.companyId, right.companyId)
    || codeUnitCompare(left.thesisId, right.thesisId);
}

function selectCanonicalTheses(theses: CompanyThesis[], nowMs: number): CompanyThesis[] {
  const byCompany = new Map<string, CompanyThesis>();
  for (const thesis of theses) {
    if (!ACTIVE_LIFECYCLES.has(thesis.lifecycle) || Date.parse(thesis.expiresAt) <= nowMs) continue;
    const previous = byCompany.get(thesis.companyId);
    if (!previous
      || (previous.track === "forward-radar" && thesis.track === "validated-momentum")
      || (previous.track === thesis.track && candidateOrder(thesis, previous) < 0)) {
      byCompany.set(thesis.companyId, thesis);
    }
  }
  return [...byCompany.values()];
}

function selectTrack(theses: CompanyThesis[], track: WatchlistTrack): CompanyThesis[] {
  const candidates = theses.filter((thesis) => thesis.track === track).sort(candidateOrder);
  let continued = 0;
  return candidates.filter((thesis) => {
    if (groupOf(thesis) !== "continued-observation") return true;
    continued += 1;
    return continued <= CONTINUED_LIMIT;
  }).slice(0, TRACK_LIMIT);
}

function entryOf(thesis: CompanyThesis): WatchlistSnapshotEntry {
  return {
    companyId: thesis.companyId,
    thesisId: thesis.thesisId,
    thesisVersion: thesis.thesisVersion,
    group: groupOf(thesis),
  };
}

function entryMap(snapshot: WatchlistSnapshot | undefined): Map<string, WatchlistSnapshotEntry> {
  return new Map(snapshot ? [...snapshot.forwardRadar, ...snapshot.validatedMomentum].map((entry) => [entry.companyId, entry]) : []);
}

function changes(previous: WatchlistSnapshot | undefined, current: CompanyThesis[]): Array<{ companyId: string; change: WatchlistChange }> {
  const prior = entryMap(previous);
  const next = new Map(current.map((thesis) => [thesis.companyId, thesis]));
  const result: Array<{ companyId: string; change: WatchlistChange }> = [];
  for (const thesis of current) {
    const old = prior.get(thesis.companyId);
    if (!old) result.push({ companyId: thesis.companyId, change: "added" });
    else if (thesis.thesisVersion > old.thesisVersion) {
      result.push({ companyId: thesis.companyId, change: thesis.lifecycle === "downgraded" ? "downgraded" : "strengthened" });
    }
  }
  for (const companyId of prior.keys()) if (!next.has(companyId)) result.push({ companyId, change: "exited" });
  return result.sort((left, right) => codeUnitCompare(left.companyId, right.companyId) || codeUnitCompare(left.change, right.change));
}

function routeException(
  theses: CompanyThesis[],
  routes: Record<string, string>,
  reason: string | undefined,
): WatchlistSnapshot["routeShareException"] {
  if (!theses.length) return undefined;
  const counts = new Map<string, number>();
  for (const thesis of theses) {
    const route = routes[thesis.companyId]?.trim();
    if (!route) throw new Error(`Watchlist 快照缺少公司 ${thesis.companyId} 的主路线`);
    counts.set(route, (counts.get(route) ?? 0) + 1);
  }
  const [route, count] = [...counts.entries()].sort((left, right) => right[1] - left[1] || codeUnitCompare(left[0], right[0]))[0]!;
  const share = count / theses.length;
  if (share <= ROUTE_SHARE_LIMIT) return undefined;
  if (!reason?.trim()) throw new Error("Watchlist 路线集中度超过 40%，必须记录路线集中度例外原因");
  return { route, share, reason: reason.trim() };
}

function stableIdentity(snapshot: WatchlistSnapshot): string {
  return JSON.stringify({
    week: snapshot.week,
    methodologyVersion: snapshot.methodologyVersion,
    forwardRadar: snapshot.forwardRadar,
    validatedMomentum: snapshot.validatedMomentum,
    changesSinceLastWeek: snapshot.changesSinceLastWeek,
    routeShareException: snapshot.routeShareException ?? null,
  });
}

export function buildWatchlistSnapshot(input: BuildWatchlistSnapshotInput): WatchlistSnapshot {
  const nowMs = assertInput(input);
  const canonical = selectCanonicalTheses(input.theses, nowMs);
  const forward = selectTrack(canonical, "forward-radar");
  const momentum = selectTrack(canonical, "validated-momentum");
  const selected = [...forward, ...momentum];
  const selectedThesisIds = selected.map((thesis) => thesis.thesisId);
  if (new Set(selectedThesisIds).size !== selectedThesisIds.length) throw new Error("Watchlist 快照选择的 thesisId 重复");
  const sameWeekRevision = input.previous?.week === input.week;
  const baseline = input.previousWeekBaseline ?? (sameWeekRevision ? undefined : input.previous);
  const snapshot: WatchlistSnapshot = {
    week: input.week,
    snapshotVersion: input.previous?.week === input.week ? input.previous.snapshotVersion + 1 : 1,
    methodologyVersion: input.methodologyVersion,
    generatedAt: input.generatedAt,
    forwardRadar: forward.map(entryOf),
    validatedMomentum: momentum.map(entryOf),
    changesSinceLastWeek: baseline
      ? changes(baseline, selected)
      : input.previous?.changesSinceLastWeek ?? [],
  };
  const exception = routeException(selected, input.primaryRouteByCompanyId, input.routeShareExceptionReason);
  if (exception) snapshot.routeShareException = exception;
  if (input.previous?.week === input.week && stableIdentity(input.previous) === stableIdentity(snapshot)) return input.previous;
  if (sameWeekRevision && !baseline) throw new Error("Watchlist 同周修订缺少上一周基线");
  if (!validateWatchlistSnapshotShape(snapshot)) throw new Error("Watchlist 快照不符合公开契约");
  return snapshot;
}

export function snapshotPath(snapshot: WatchlistSnapshot): WatchlistSnapshotPaths {
  return {
    current: "watchlist/current.json",
    history: `watchlist/history/${snapshot.week}-v${snapshot.snapshotVersion}.json`,
  };
}
