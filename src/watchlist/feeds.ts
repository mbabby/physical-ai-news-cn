import { join } from "node:path";
import type { FileTransaction } from "../runtime/storage.js";
import type { TechnicalRoute } from "../types.js";
import { assertNoPrivateWatchlistContent, validateWatchlistPublicViewShape, type WatchlistPublicCard, type WatchlistPublicChange, type WatchlistPublicView } from "./public-view.js";
import { CANONICAL_ROUTES, routeSlug } from "./routes.js";

const COMPANY_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface FeedItem {
  order: string;
  title: string;
  link: string;
  guid: string;
  description: string;
}

export interface WatchlistFeedManifest {
  schemaVersion: 1;
  snapshotWeek: string;
  snapshotVersion: number;
  companyFeedIds: string[];
  companyFeeds: Array<{ companyId: string; path: string }>;
  routeFeeds: Array<{ route: TechnicalRoute; slug: string; path: string }>;
}

export interface StageWatchlistFeedsInput {
  transaction: Pick<FileTransaction, "stage">;
  root: string;
  view: WatchlistPublicView;
  baseUrl: string;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function escapeXml(value: string): string {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint !== 0x9 && codePoint !== 0xA && codePoint !== 0xD
      && (codePoint < 0x20 || codePoint > 0xD7FF && codePoint < 0xE000 || codePoint > 0xFFFD && codePoint < 0x10000 || codePoint > 0x10FFFF)) {
      throw new Error("Feed XML 包含不合法字符");
    }
  }
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function assertPublicView(view: WatchlistPublicView): void {
  if (!validateWatchlistPublicViewShape(view)) throw new Error("Watchlist Feed 公开视图结构不合法");
  assertNoPrivateWatchlistContent(view);
  for (const card of [...view.forwardRadar, ...view.validatedMomentum]) assertCompanyId(card.companyId);
  for (const change of view.changes) assertCompanyId(change.companyId);
}

function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Watchlist Feed Pages 基址必须是 HTTPS URL");
  }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.search || url.hash) {
    throw new Error("Watchlist Feed Pages 基址必须是 HTTPS URL");
  }
  return url.toString().replace(/\/$/, "");
}

function assertCompanyId(companyId: string): void {
  if (!COMPANY_ID.test(companyId) || /^candidate-/i.test(companyId)) throw new Error(`Watchlist Feed 公司标识不合法：${companyId}`);
}

function assertEvidenceUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Watchlist Feed 证据链接不安全");
  }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password) throw new Error("Watchlist Feed 证据链接不安全");
}

function fragment(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function companyLink(baseUrl: string, companyId: string): string {
  return `${baseUrl}/companies.html#${fragment(companyId)}`;
}

function snapshotLink(baseUrl: string, view: WatchlistPublicView): string {
  return `${baseUrl}/#watchlist-${fragment(view.week)}-v${view.snapshotVersion}`;
}

function cardFor(view: WatchlistPublicView, companyId: string): WatchlistPublicCard | undefined {
  return [...view.forwardRadar, ...view.validatedMomentum].find((card) => card.companyId === companyId);
}

function changesFor(view: WatchlistPublicView, companyId: string): WatchlistPublicChange[] {
  return view.changes.filter((change) => change.companyId === companyId).sort((left, right) => compareCodeUnits(left.change, right.change));
}

function thesisItem(view: WatchlistPublicView, card: WatchlistPublicCard, baseUrl: string): FeedItem {
  const validation = card.nextValidationPoints
    .map((point) => `${point.dueAt}：${point.text}`)
    .sort(compareCodeUnits)
    .join("；");
  const falsifiers = card.falsifiers.map((item) => item.text).sort(compareCodeUnits).join("；");
  return {
    order: `${card.companyId}\0thesis\0${card.thesisId}\0${card.thesisVersion}`,
    title: `${card.companyName} · ${card.lifecycleLabel}`,
    link: companyLink(baseUrl, card.companyId),
    guid: `urn:physical-ai-watchlist:thesis:${encodeURIComponent(card.thesisId)}:v${card.thesisVersion}`,
    description: `观察名单快照：${view.week} · v${view.snapshotVersion}。${card.whyNow} ${card.routeAndDependencies}。下一验证点：${validation}。反证条件：${falsifiers}。`,
  };
}

function evidenceItems(card: WatchlistPublicCard): FeedItem[] {
  return [...card.evidenceLinks]
    .sort((left, right) => compareCodeUnits(`${left.eventId}\0${left.url}`, `${right.eventId}\0${right.url}`))
    .map((evidence) => {
      assertEvidenceUrl(evidence.url);
      return {
        order: `${card.companyId}\0evidence\0${evidence.eventId}\0${evidence.url}`,
        title: `${card.companyName} · 验证证据：${evidence.title}`,
        link: evidence.url,
        guid: `urn:physical-ai-watchlist:evidence:${encodeURIComponent(card.thesisId)}:v${card.thesisVersion}:${encodeURIComponent(evidence.eventId)}:${encodeURIComponent(evidence.url)}`,
        description: `${evidence.source} · ${evidence.grade} 级公开证据。关联判断：${card.thesisId} v${card.thesisVersion}。`,
      };
    });
}

const CHANGE_LABELS: Record<WatchlistPublicChange["change"], string> = {
  added: "新进入",
  strengthened: "判断强化",
  downgraded: "判断降级",
  exited: "已退出",
};

function changeItems(view: WatchlistPublicView, companyId: string, baseUrl: string): FeedItem[] {
  return changesFor(view, companyId).map((change) => ({
    order: `${companyId}\0change\0${change.change}`,
    title: `${change.companyName} · ${CHANGE_LABELS[change.change]}`,
    link: cardFor(view, companyId) ? companyLink(baseUrl, companyId) : snapshotLink(baseUrl, view),
    guid: `urn:physical-ai-watchlist:change:${view.week}:v${view.snapshotVersion}:${companyId}:${change.change}`,
    description: `观察名单快照：${view.week} · v${view.snapshotVersion}。公开名单变化：${CHANGE_LABELS[change.change]}。`,
  }));
}

function rss(title: string, link: string, description: string, items: FeedItem[]): string {
  const entries = [...items].sort((left, right) => compareCodeUnits(left.order, right.order));
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    "  <channel>",
    `    <title>${escapeXml(title)}</title>`,
    `    <link>${escapeXml(link)}</link>`,
    `    <description>${escapeXml(description)}</description>`,
    ...entries.flatMap((item) => [
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

function companyFeedIds(view: WatchlistPublicView): string[] {
  return [...new Set([
    ...view.companyIds,
    ...view.changes.filter((change) => change.change === "exited" || change.change === "downgraded").map((change) => change.companyId),
  ])].sort(compareCodeUnits);
}

/** Build the current public company's RSS 2.0 feed from the single public view. */
export function buildCompanyFeed(view: WatchlistPublicView, companyId: string, baseUrl: string): string {
  assertPublicView(view);
  assertCompanyId(companyId);
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (!companyFeedIds(view).includes(companyId)) throw new Error(`Watchlist Feed 公司不在当前公开快照：${companyId}`);
  const card = cardFor(view, companyId);
  const name = card?.companyName ?? changesFor(view, companyId)[0]?.companyName;
  if (!name) throw new Error(`Watchlist Feed 缺少公开公司名称：${companyId}`);
  const items = [
    ...(card ? [thesisItem(view, card, normalizedBaseUrl), ...evidenceItems(card)] : []),
    ...changeItems(view, companyId, normalizedBaseUrl),
  ];
  return rss(`${name} · Watchlist`, companyLink(normalizedBaseUrl, companyId), `观察名单快照：${view.week} · v${view.snapshotVersion}。本 Feed 仅包含当前公开判断、验证证据与公开变化。`, items);
}

/** Build one fixed canonical technical-route RSS 2.0 feed from the public view. */
export function buildRouteFeed(view: WatchlistPublicView, route: TechnicalRoute, baseUrl: string): string {
  assertPublicView(view);
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const slug = routeSlug(route);
  const cards = [...view.forwardRadar, ...view.validatedMomentum].filter((card) => card.routes.includes(route));
  const items = cards.flatMap((card) => [thesisItem(view, card, normalizedBaseUrl), ...evidenceItems(card), ...changeItems(view, card.companyId, normalizedBaseUrl)]);
  const description = cards.length
    ? `观察名单快照：${view.week} · v${view.snapshotVersion}。本 Feed 仅包含当前公开判断、验证证据与公开变化。`
    : `观察名单快照：${view.week} · v${view.snapshotVersion}。暂无公开公司。`;
  return rss(`${route} · Watchlist`, `${normalizedBaseUrl}/#watchlist-route-${slug}`, description, items);
}

function manifest(view: WatchlistPublicView): WatchlistFeedManifest {
  const ids = companyFeedIds(view);
  return {
    schemaVersion: 1,
    snapshotWeek: view.week,
    snapshotVersion: view.snapshotVersion,
    companyFeedIds: ids,
    companyFeeds: ids.map((companyId) => ({ companyId, path: `feeds/companies/${companyId}.xml` })),
    routeFeeds: CANONICAL_ROUTES.map(({ route, slug }) => ({ route, slug, path: `feeds/routes/${slug}.xml` })),
  };
}

/** Stage every current feed and its authoritative manifest into the daily transaction. */
export function stageWatchlistFeeds(input: StageWatchlistFeedsInput): void {
  assertPublicView(input.view);
  const normalizedBaseUrl = normalizeBaseUrl(input.baseUrl);
  const output = manifest(input.view);
  for (const companyId of output.companyFeedIds) {
    input.transaction.stage(join(input.root, "site", "feeds", "companies", `${companyId}.xml`), buildCompanyFeed(input.view, companyId, normalizedBaseUrl));
  }
  for (const { route, slug } of CANONICAL_ROUTES) {
    input.transaction.stage(join(input.root, "site", "feeds", "routes", `${slug}.xml`), buildRouteFeed(input.view, route, normalizedBaseUrl));
  }
  input.transaction.stage(join(input.root, "site", "feeds", "manifest.json"), `${JSON.stringify(output, null, 2)}\n`);
}
