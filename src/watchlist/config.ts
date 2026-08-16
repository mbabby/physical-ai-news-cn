import { CANONICAL_ROUTES } from "./routes.js";

const MAX_COMPANIES = 30;
const MAX_ROUTES = 10;
const MAX_QUERY_LENGTH = 2048;
const CANONICAL_ROUTE_SLUGS = new Set<string>(CANONICAL_ROUTES.map(({ slug }) => slug));

export type WatchlistConfig = {
  companyIds: string[];
  routes: string[];
};

export type WatchlistConfigCatalog = {
  companyIds: readonly string[];
  routes: readonly string[];
};

export type WatchlistConfigResult = {
  config: WatchlistConfig;
  warnings: string[];
};

const unsafeValue = (value: string) => value.length === 0
  || value !== value.trim()
  || /[\u0000-\u001F\u007F<>"'&]/.test(value);

const stableUnique = (values: readonly unknown[]) => [...new Set(values.filter((value): value is string => typeof value === "string" && !unsafeValue(value)))].sort();

function safelyDecode(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value.replace(/\+/g, " "));
    return unsafeValue(decoded) ? null : decoded;
  } catch {
    return null;
  }
}

function inputQuery(value: string | URLSearchParams | { toString(): string }): string | null {
  try {
    const query = typeof value === "string" ? value.replace(/^\?/, "") : value.toString();
    return query.length <= MAX_QUERY_LENGTH ? query : null;
  } catch {
    return null;
  }
}

function valuesFor(query: string, name: "watch" | "routes", warnings: string[]): string[] {
  const values: string[] = [];
  for (const pair of query.split("&")) {
    const separator = pair.indexOf("=");
    const rawName = separator === -1 ? pair : pair.slice(0, separator);
    const rawValue = separator === -1 ? "" : pair.slice(separator + 1);
    const decodedName = safelyDecode(rawName);
    if (decodedName !== name) continue;
    if (rawValue === "") continue;
    const decodedValue = safelyDecode(rawValue);
    if (decodedValue === null) {
      warnings.push("已忽略无效的观察名单配置值");
      continue;
    }
    for (const rawItem of decodedValue.split(",")) {
      if (rawItem === "") continue;
      if (unsafeValue(rawItem)) warnings.push("已忽略无效的观察名单配置值");
      else values.push(rawItem);
    }
  }
  return values;
}

/** Encodes only a query string, never an origin, path, or user-supplied URL. */
export function encodeWatchlistConfig(config: Partial<WatchlistConfig>): string {
  const companies = stableUnique(Array.isArray(config.companyIds) ? config.companyIds : []);
  const routes = stableUnique(Array.isArray(config.routes) ? config.routes : []);
  const parts: string[] = [];
  if (companies.length) parts.push(`watch=${companies.slice(0, MAX_COMPANIES).map(encodeURIComponent).join(",")}`);
  if (routes.length) parts.push(`routes=${routes.slice(0, MAX_ROUTES).map(encodeURIComponent).join(",")}`);
  return parts.join("&");
}

/**
 * Decodes only named query parameters against the current public Watchlist catalog.
 * It deliberately accepts no full URL and retains no caller state.
 */
export function decodeWatchlistConfig(
  value: string | URLSearchParams | { toString(): string },
  catalog: WatchlistConfigCatalog,
): WatchlistConfigResult {
  const query = inputQuery(value);
  if (query === null) return { config: { companyIds: [], routes: [] }, warnings: ["观察名单配置过长，已忽略"] };

  const warnings: string[] = [];
  if (/%(?![0-9a-fA-F]{2})/.test(query)) warnings.push("已忽略无效的观察名单配置值");
  const companyCatalog = new Set(stableUnique(catalog.companyIds));
  const routeCatalog = new Set(stableUnique(catalog.routes));
  const requestedCompanies = stableUnique(valuesFor(query, "watch", warnings));
  const requestedRoutes = stableUnique(valuesFor(query, "routes", warnings));

  const validCompanies = requestedCompanies.filter((companyId) => companyCatalog.has(companyId));
  const missingCompanies = requestedCompanies.filter((companyId) => !companyCatalog.has(companyId));
  if (missingCompanies.length) warnings.push(`已忽略未知或已退出当前观察名单的公司：${missingCompanies.join("、")}`);
  if (validCompanies.length > MAX_COMPANIES) warnings.push(`公司选择超过 ${MAX_COMPANIES} 个上限，已忽略其余项目`);

  const validRoutes = requestedRoutes.filter((slug) => CANONICAL_ROUTE_SLUGS.has(slug) && routeCatalog.has(slug));
  const missingRoutes = requestedRoutes.filter((slug) => !CANONICAL_ROUTE_SLUGS.has(slug) || !routeCatalog.has(slug));
  if (missingRoutes.length) warnings.push(`已忽略未知技术路线：${missingRoutes.join("、")}`);
  if (validRoutes.length > MAX_ROUTES) warnings.push(`路线选择超过 ${MAX_ROUTES} 个上限，已忽略其余项目`);

  return {
    config: { companyIds: validCompanies.slice(0, MAX_COMPANIES), routes: validRoutes.slice(0, MAX_ROUTES) },
    warnings,
  };
}
