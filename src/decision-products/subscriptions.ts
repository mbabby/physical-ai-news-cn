import { join } from "node:path";
import type { FileTransaction } from "../runtime/storage.js";
import type { TechnicalRoute } from "../types.js";
import { assertNoPrivateWatchlistContent, validateWatchlistPublicViewShape, type WatchlistPublicChange, type WatchlistPublicView } from "../watchlist/public-view.js";
import { CANONICAL_ROUTES, isTechnicalRoute, routeSlug } from "../watchlist/routes.js";
import { validateDecisionProductArtifact, type DecisionProductArtifact, type DecisionTopSignal, type SubscriptionCatalog } from "./contracts.js";

export type DecisionFeedRoute = "all" | TechnicalRoute | "watchlist";

export interface SubscriptionUrls {
  repositoryUrl: string;
  pagesUrl: string;
}

export interface DecisionFeedOptions extends SubscriptionUrls {
  watchlist: WatchlistPublicView;
}

export interface StageDecisionFeedsInput extends DecisionFeedOptions {
  root: string;
  transaction: Pick<FileTransaction, "stage">;
  artifact: DecisionProductArtifact;
}

export interface DecisionFeedManifest {
  schemaVersion: 1;
  generatedAt: string;
  feeds: Array<{ subscriptionId: string; route: DecisionFeedRoute; path: string }>;
}

interface FeedItem {
  title: string;
  link: string;
  guid: string;
  description: string;
}

const CHANGE_LABELS: Record<WatchlistPublicChange["change"], string> = {
  added: "新进入",
  strengthened: "判断强化",
  downgraded: "判断降级",
  exited: "已退出",
};
const PUBLIC_COMPANY_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function normalizeHttpsBase(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label}必须是 HTTPS URL`);
  }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.search || url.hash) {
    throw new Error(`${label}必须是无认证、查询或片段的 HTTPS URL`);
  }
  return url.toString().replace(/\/+$/, "");
}

function assertWatchlist(view: WatchlistPublicView): void {
  if (!validateWatchlistPublicViewShape(view)) throw new Error("Decision Feed Watchlist 公开视图结构不合法");
  assertNoPrivateWatchlistContent(view);
  for (const companyId of [...view.companyIds, ...view.changes.map((change) => change.companyId)]) {
    if (!PUBLIC_COMPANY_ID.test(companyId)) throw new Error(`Decision Feed Watchlist 公司标识不合法：${companyId}`);
  }
}

function assertXmlCharacters(value: string): void {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint !== 0x9 && codePoint !== 0xA && codePoint !== 0xD
      && (codePoint < 0x20 || codePoint > 0xD7FF && codePoint < 0xE000 || codePoint > 0xFFFD && codePoint < 0x10000 || codePoint > 0x10FFFF)) {
      throw new Error("Decision Feed XML 包含不合法字符");
    }
  }
}

function escapeXml(value: string): string {
  assertXmlCharacters(value);
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&apos;");
}

function signalLink(pagesUrl: string, signal: DecisionTopSignal): string {
  return `${pagesUrl}/?signal=${encodeURIComponent(signal.signalId)}&source=rss`;
}

function signalDescription(signal: DecisionTopSignal): string {
  return `规范事件：${signal.eventId}。${signal.factsZh.join(" ")} ${signal.whyItMatters} 证据状态：${signal.evidenceState === "official" ? "官方一手" : "独立 B+B"}。`;
}

function signalItems(artifact: DecisionProductArtifact, route: "all" | TechnicalRoute, pagesUrl: string): FeedItem[] {
  return artifact.topSignals
    .filter((signal) => route === "all" || signal.routes.includes(route))
    .map((signal) => ({
      title: `${signal.titleZh} · ${signal.entityName}`,
      link: signalLink(pagesUrl, signal),
      guid: route === "all"
        ? `urn:physical-ai:signal:${signal.signalId}`
        : `urn:physical-ai:route:${routeSlug(route)}:${signal.signalId}`,
      description: signalDescription(signal),
    }));
}

function watchlistItems(view: WatchlistPublicView, pagesUrl: string): FeedItem[] {
  return view.changes.map((change) => ({
    title: `${change.companyName} · ${CHANGE_LABELS[change.change]}`,
    link: `${pagesUrl}/#company-watchlist`,
    guid: `urn:physical-ai:watchlist:${view.week}:v${view.snapshotVersion}:${change.companyId}:${change.change}`,
    description: `观察名单快照：${view.week} · v${view.snapshotVersion}。公司标识：${change.companyId}。公开名单变化：${CHANGE_LABELS[change.change]}。`,
  }));
}

function rss(title: string, link: string, description: string, items: FeedItem[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    "  <channel>",
    `    <title>${escapeXml(title)}</title>`,
    `    <link>${escapeXml(link)}</link>`,
    `    <description>${escapeXml(description)}</description>`,
    ...items.flatMap((item) => [
      "    <item>",
      `      <title>${escapeXml(item.title)}</title>`,
      `      <link>${escapeXml(item.link)}</link>`,
      `      <guid isPermaLink="false">${escapeXml(item.guid)}</guid>`,
      `      <description>${escapeXml(item.description)}</description>`,
      "    </item>",
    ]),
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}

function feedPath(route: DecisionFeedRoute): string {
  if (route === "all" || route === "watchlist") return `feeds/decision/${route}.xml`;
  return `feeds/decision/${routeSlug(route)}.xml`;
}

function feedSubscriptionId(route: DecisionFeedRoute): string {
  if (route === "all" || route === "watchlist") return `feed-${route}`;
  return `feed-${routeSlug(route)}`;
}

const FEED_ROUTES: readonly DecisionFeedRoute[] = ["all", ...CANONICAL_ROUTES.map(({ route }) => route), "watchlist"];

export function buildSubscriptionCatalog(artifact: DecisionProductArtifact, urls: SubscriptionUrls): SubscriptionCatalog {
  validateDecisionProductArtifact(artifact);
  const repositoryUrl = normalizeHttpsBase(urls.repositoryUrl, "订阅仓库基址");
  const pagesUrl = normalizeHttpsBase(urls.pagesUrl, "订阅 Pages 基址");
  return {
    generatedAt: artifact.generatedAt,
    entries: [
      { subscriptionId: "github-watch", label: "GitHub Watch", description: "关注仓库活动通知。", cadence: "daily", format: "github", url: `${repositoryUrl}/subscription`, route: "all" },
      { subscriptionId: "github-releases", label: "GitHub Releases", description: "关注稳定版本发布。", cadence: "weekly", format: "github", url: `${repositoryUrl}/releases`, route: "all" },
      { subscriptionId: "feed-all", label: "全部 Top Signals", description: "每周证据门槛后的全部决策信号。", cadence: "weekly", format: "rss", url: `${pagesUrl}/${feedPath("all")}`, route: "all" },
      ...CANONICAL_ROUTES.map(({ route, slug }) => ({
        subscriptionId: `feed-${slug}`,
        label: `${route} Feed`,
        description: `${route}路线的每周决策信号。`,
        cadence: "weekly" as const,
        format: "rss" as const,
        url: `${pagesUrl}/feeds/decision/${slug}.xml`,
        route,
      })),
      { subscriptionId: "feed-watchlist", label: "Watchlist 变化", description: "公开观察名单的周期变化。", cadence: "weekly", format: "rss", url: `${pagesUrl}/${feedPath("watchlist")}`, route: "watchlist" },
    ],
  };
}

/** Render in the artifact/public-view order; this layer never re-scores or sorts. */
export function renderDecisionFeed(artifact: DecisionProductArtifact, route: DecisionFeedRoute, options: DecisionFeedOptions): string {
  validateDecisionProductArtifact(artifact);
  const pagesUrl = normalizeHttpsBase(options.pagesUrl, "Decision Feed Pages 基址");
  normalizeHttpsBase(options.repositoryUrl, "Decision Feed 仓库基址");
  assertWatchlist(options.watchlist);
  if (route !== "all" && route !== "watchlist" && !isTechnicalRoute(route)) throw new Error("Decision Feed 路线不在固定目录中");
  if (route === "watchlist") {
    return rss("Physical AI Watchlist 变化", `${pagesUrl}/#company-watchlist`, `公开观察名单变化；快照 ${options.watchlist.week} · v${options.watchlist.snapshotVersion}。`, watchlistItems(options.watchlist, pagesUrl));
  }
  const label = route === "all" ? "全部 Top Signals" : route;
  return rss(`Physical AI · ${label}`, `${pagesUrl}/`, "仅包含通过公开证据门槛的每周决策信号；不包含候选项或私有排序。", signalItems(artifact, route, pagesUrl));
}

export function buildDecisionFeedManifest(artifact: DecisionProductArtifact): DecisionFeedManifest {
  validateDecisionProductArtifact(artifact);
  return {
    schemaVersion: 1,
    generatedAt: artifact.generatedAt,
    feeds: FEED_ROUTES.map((route) => ({ subscriptionId: feedSubscriptionId(route), route, path: feedPath(route) })),
  };
}

/** Validate every byte first so malformed input cannot partially populate a transaction. */
export function stageDecisionFeeds(input: StageDecisionFeedsInput): void {
  const catalog = buildSubscriptionCatalog(input.artifact, input);
  const manifest = buildDecisionFeedManifest(input.artifact);
  const expectedFeedEntries = catalog.entries.filter((entry) => entry.format === "rss");
  if (expectedFeedEntries.length !== manifest.feeds.length
    || expectedFeedEntries.some((entry, index) => entry.subscriptionId !== manifest.feeds[index]!.subscriptionId)) {
    throw new Error("Decision Feed manifest 与订阅目录不一致");
  }
  const files = manifest.feeds.map((feed) => ({
    path: join(input.root, "site", feed.path),
    content: renderDecisionFeed(input.artifact, feed.route, input),
  }));
  const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`;
  for (const file of files) input.transaction.stage(file.path, file.content);
  input.transaction.stage(join(input.root, "site", "feeds", "decision", "manifest.json"), manifestBytes);
}
