import { join } from "node:path";
import { isObject, readJsonStrict } from "../runtime/storage.js";
import type { CompanyProfile, EventRecord } from "../types.js";
import {
  isCanonicalTimestamp,
  validateCompanyThesisShape,
  validateWatchlistSnapshotShape,
  type CompanyThesisArtifact,
  type WatchlistSnapshot,
} from "./contracts.js";
import { buildWatchlistPublicView, type WatchlistPublicView } from "./public-view.js";

function validateCompanyThesisArtifact(value: unknown): value is CompanyThesisArtifact {
  if (!isObject(value) || Object.keys(value).length !== 3
    || Object.keys(value).some((key) => key !== "schemaVersion" && key !== "generatedAt" && key !== "theses")) return false;
  return value.schemaVersion === 1 && isCanonicalTimestamp(value.generatedAt)
    && Array.isArray(value.theses) && value.theses.every(validateCompanyThesisShape);
}

/**
 * Read only the staged public Watchlist inputs. Missing inputs preserve the
 * legacy surfaces; partial or corrupt state blocks publication.
 */
export async function loadWatchlistPublicView(root: string, companies: CompanyProfile[], events: EventRecord[]): Promise<WatchlistPublicView | undefined> {
  const watchlistDir = join(root, "watchlist");
  const [snapshot, thesisArtifact] = await Promise.all([
    readJsonStrict<WatchlistSnapshot>(join(watchlistDir, "current.json"), {
      optional: true, label: "公开 Watchlist 快照", validate: validateWatchlistSnapshotShape,
    }),
    readJsonStrict<CompanyThesisArtifact>(join(watchlistDir, "theses.json"), {
      optional: true, label: "公开 Watchlist 判断", validate: validateCompanyThesisArtifact,
    }),
  ]);
  if (snapshot === undefined && thesisArtifact === undefined) return undefined;
  if (snapshot === undefined || thesisArtifact === undefined) {
    throw new Error("Watchlist 公开工件不完整；已停止发布且保留上一版。");
  }
  return buildWatchlistPublicView({ snapshot, thesisArtifact, companies, events });
}
