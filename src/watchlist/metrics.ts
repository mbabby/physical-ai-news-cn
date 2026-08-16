import { join } from "node:path";
import type { FileTransaction } from "../runtime/storage.js";
import { validateCompanyThesisShape, validateWatchlistSnapshotShape, type CompanyThesis, type CompanyThesisArtifact, type WatchlistSnapshot, type WatchlistSnapshotEntry } from "./contracts.js";
import { validateWatchlistChangePage, type WatchlistChangePage } from "./change-page.js";
import { validateWatchlistFeedManifest, type WatchlistFeedManifest } from "./feeds.js";
import { validateWatchlistPublicViewShape, type WatchlistPublicCard, type WatchlistPublicView } from "./public-view.js";

export interface WatchlistRate {
  numerator: number;
  denominator: number;
  value: number | null;
}

export interface UnavailableObservation {
  status: "unavailable";
  value: null;
}

export interface UnavailableRate extends WatchlistRate {
  status: "unavailable";
}

export interface WatchlistMetrics {
  schemaVersion: 1;
  snapshot: { week: string; snapshotVersion: number; generatedAt: string };
  productQuality: {
    publicationSuccess: WatchlistRate;
    citationCoverage: WatchlistRate;
    identityMismatches: WatchlistRate;
    conflictLeakage: WatchlistRate;
    takedownLatency: UnavailableObservation;
    expiredCurrentResidue: WatchlistRate;
    crossSurfaceConsistency: WatchlistRate;
    eligibleCompanyCount: number;
    evidenceExpansion: number;
    feedCounts: { companies: number; routes: number; total: number };
    corrections: number;
    validationPointHitRate: UnavailableRate;
  };
  following: {
    visitors: UnavailableObservation;
    referrers: UnavailableObservation;
    copyEvents: UnavailableObservation;
    shareEvents: UnavailableObservation;
  };
}

export interface BuildWatchlistMetricsInput {
  snapshot: WatchlistSnapshot;
  theses: CompanyThesisArtifact;
  view: WatchlistPublicView;
  changePage: WatchlistChangePage;
  feeds: WatchlistFeedManifest;
  readme: string;
}

export interface StageWatchlistMetricsInput {
  transaction: Pick<FileTransaction, "stage">;
  root: string;
  metrics: WatchlistMetrics;
}

function rate(numerator: number, denominator: number): WatchlistRate {
  return { numerator, denominator, value: denominator === 0 ? null : numerator / denominator };
}

function unavailable(): UnavailableObservation {
  return { status: "unavailable", value: null };
}

function selection(snapshot: WatchlistSnapshot): Array<WatchlistSnapshotEntry & { track: "forward-radar" | "validated-momentum" }> {
  return [
    ...snapshot.forwardRadar.map((entry) => ({ ...entry, track: "forward-radar" as const })),
    ...snapshot.validatedMomentum.map((entry) => ({ ...entry, track: "validated-momentum" as const })),
  ];
}

function thesisKey(thesisId: string, thesisVersion: number): string {
  return `${thesisId}\0${thesisVersion}`;
}

function cards(view: WatchlistPublicView): WatchlistPublicCard[] {
  return [...view.forwardRadar, ...view.validatedMomentum];
}

function assertCanonicalInput(input: BuildWatchlistMetricsInput): CompanyThesis[] {
  if (!validateWatchlistSnapshotShape(input.snapshot)) throw new Error("Watchlist 指标缺少有效公开快照");
  if (!input.theses || input.theses.schemaVersion !== 1 || input.theses.generatedAt !== input.snapshot.generatedAt
    || !Array.isArray(input.theses.theses) || !input.theses.theses.every(validateCompanyThesisShape)) {
    throw new Error("Watchlist 指标缺少有效公开判断工件");
  }
  if (!validateWatchlistPublicViewShape(input.view)) throw new Error("Watchlist 指标缺少有效公开视图");
  validateWatchlistChangePage(input.changePage);
  validateWatchlistFeedManifest(input.view, input.feeds);
  if (input.view.week !== input.snapshot.week || input.view.snapshotVersion !== input.snapshot.snapshotVersion
    || input.view.methodologyVersion !== input.snapshot.methodologyVersion || input.view.lastSuccessfulAt !== input.snapshot.generatedAt) {
    throw new Error("Watchlist 指标公开视图与快照身份不一致");
  }
  if (input.changePage.current.week !== input.snapshot.week || input.changePage.current.snapshotVersion !== input.snapshot.snapshotVersion
    || input.changePage.current.generatedAt !== input.snapshot.generatedAt) {
    throw new Error("Watchlist 指标变化页与快照身份不一致");
  }
  if (!input.readme.includes(`观察名单快照：${input.snapshot.week} · v${input.snapshot.snapshotVersion}`)) {
    throw new Error("Watchlist 指标 README 与快照身份不一致");
  }

  const byThesis = new Map<string, CompanyThesis>();
  for (const thesis of input.theses.theses) {
    const key = thesisKey(thesis.thesisId, thesis.thesisVersion);
    if (byThesis.has(key)) throw new Error(`Watchlist 指标公开判断版本重复：${key}`);
    byThesis.set(key, thesis);
  }
  const byCompany = new Map(cards(input.view).map((card) => [card.companyId, card]));
  const selected = selection(input.snapshot);
  if (selected.length !== byCompany.size || selected.length !== input.view.companyIds.length) {
    throw new Error("Watchlist 指标公开公司集合不一致");
  }
  const currentTheses = selected.map((entry) => {
    const thesis = byThesis.get(thesisKey(entry.thesisId, entry.thesisVersion));
    const card = byCompany.get(entry.companyId);
    if (!thesis || !card || thesis.companyId !== entry.companyId || thesis.track !== entry.track
      || card.thesisId !== entry.thesisId || card.thesisVersion !== entry.thesisVersion || card.track !== entry.track
      || !input.view.companyIds.includes(entry.companyId) || !input.readme.includes(`#${entry.companyId}`)) {
      throw new Error(`Watchlist 指标发现跨表身份不一致：${entry.companyId}`);
    }
    return thesis;
  });
  return currentTheses;
}

/** Build deterministic quality metrics only from already-public canonical Watchlist artifacts. */
export function buildWatchlistMetrics(input: BuildWatchlistMetricsInput): WatchlistMetrics {
  const currentTheses = assertCanonicalInput(input);
  const denominator = currentTheses.length;
  const cited = currentTheses.filter((thesis) => thesis.factReferenceIds.length > 0).length;
  const expired = currentTheses.filter((thesis) => Date.parse(thesis.expiresAt) <= Date.parse(input.snapshot.generatedAt)).length;
  const conflicting = cards(input.view).filter((card) => /冲突|矛盾|主体待识别|主体不明|归属不明/i.test(`${card.whyNow}\n${card.routeAndDependencies}`)).length;
  const factReferences = new Set(currentTheses.flatMap((thesis) => thesis.factReferenceIds)).size;
  const corrections = input.changePage.changes.filter((change) => change.kind === "correction").length;
  const totalFeeds = input.feeds.companyFeeds.length + input.feeds.routeFeeds.length;
  return {
    schemaVersion: 1,
    snapshot: { week: input.snapshot.week, snapshotVersion: input.snapshot.snapshotVersion, generatedAt: input.snapshot.generatedAt },
    productQuality: {
      publicationSuccess: rate(1, 1),
      citationCoverage: rate(cited, denominator),
      identityMismatches: rate(0, denominator),
      conflictLeakage: rate(conflicting, denominator),
      takedownLatency: unavailable(),
      expiredCurrentResidue: rate(expired, denominator),
      crossSurfaceConsistency: rate(1, 1),
      eligibleCompanyCount: denominator,
      evidenceExpansion: factReferences,
      feedCounts: { companies: input.feeds.companyFeeds.length, routes: input.feeds.routeFeeds.length, total: totalFeeds },
      corrections,
      validationPointHitRate: { status: "unavailable", ...rate(0, 0) },
    },
    following: { visitors: unavailable(), referrers: unavailable(), copyEvents: unavailable(), shareEvents: unavailable() },
  };
}

function isRate(value: unknown): value is WatchlistRate {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Number.isInteger((value as WatchlistRate).numerator) && (value as WatchlistRate).numerator >= 0
    && Number.isInteger((value as WatchlistRate).denominator) && (value as WatchlistRate).denominator >= 0
    && ((value as WatchlistRate).denominator === 0 ? (value as WatchlistRate).value === null
      : typeof (value as WatchlistRate).value === "number" && Number.isFinite((value as WatchlistRate).value));
}

/** Runtime boundary for the checked-in public metrics artifact. */
export function validateWatchlistMetrics(value: unknown): asserts value is WatchlistMetrics {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Watchlist 指标结构不合法");
  const metrics = value as WatchlistMetrics;
  const quality = metrics.productQuality;
  if (metrics.schemaVersion !== 1 || !metrics.snapshot || !quality || !metrics.following
    || !isRate(quality.publicationSuccess) || !isRate(quality.citationCoverage) || !isRate(quality.identityMismatches)
    || !isRate(quality.conflictLeakage) || !isRate(quality.expiredCurrentResidue) || !isRate(quality.crossSurfaceConsistency)
    || !isRate(quality.validationPointHitRate) || quality.validationPointHitRate.status !== "unavailable") {
    throw new Error("Watchlist 指标结构不合法");
  }
  const unavailableValues = [quality.takedownLatency, metrics.following.visitors, metrics.following.referrers, metrics.following.copyEvents, metrics.following.shareEvents];
  if (unavailableValues.some((item) => !item || item.status !== "unavailable" || item.value !== null)) throw new Error("Watchlist 指标缺失观察值必须明确不可用");
  if (!Number.isInteger(quality.eligibleCompanyCount) || quality.eligibleCompanyCount < 0
    || !Number.isInteger(quality.evidenceExpansion) || quality.evidenceExpansion < 0
    || !Number.isInteger(quality.corrections) || quality.corrections < 0
    || !quality.feedCounts || ![quality.feedCounts.companies, quality.feedCounts.routes, quality.feedCounts.total].every((count) => Number.isInteger(count) && count >= 0)
    || quality.feedCounts.total !== quality.feedCounts.companies + quality.feedCounts.routes) {
    throw new Error("Watchlist 指标结构不合法");
  }
}

/** Stage metrics in the same rollback-capable daily transaction as all public Watchlist artifacts. */
export function stageWatchlistMetrics(input: StageWatchlistMetricsInput): void {
  validateWatchlistMetrics(input.metrics);
  input.transaction.stage(join(input.root, "metrics", "watchlist.json"), `${JSON.stringify(input.metrics, null, 2)}\n`);
}
