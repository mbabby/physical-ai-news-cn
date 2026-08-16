import type { TechnicalRoute } from "../types.js";

export const CANONICAL_ROUTES = [
  { slug: "data-and-training", route: "数据与训练" },
  { slug: "vla-and-embodied-models", route: "VLA 与具身模型" },
  { slug: "world-models-and-spatial-intelligence", route: "世界模型与空间智能" },
  { slug: "embodiment-and-hardware", route: "本体与硬件" },
  { slug: "deployment-and-commercialization", route: "部署与商业化" },
] as const satisfies ReadonlyArray<{ slug: string; route: TechnicalRoute }>;

export type TechnicalRouteSlug = typeof CANONICAL_ROUTES[number]["slug"];

const ROUTE_TO_SLUG = new Map<TechnicalRoute, TechnicalRouteSlug>(CANONICAL_ROUTES.map(({ route, slug }) => [route, slug]));

export function isTechnicalRoute(value: unknown): value is TechnicalRoute {
  return typeof value === "string" && ROUTE_TO_SLUG.has(value as TechnicalRoute);
}

export function routeSlug(route: TechnicalRoute): TechnicalRouteSlug {
  const slug = ROUTE_TO_SLUG.get(route);
  if (!slug) throw new Error(`未知 Watchlist 技术路线：${route}`);
  return slug;
}
