import type { DailyPublicationFreshness, PipelineHealth, RunHistory, RunManifest } from "../types.js";
import { shanghaiDateTime } from "./daily-date.js";

const DAY_MS = 24 * 60 * 60 * 1_000;
const DAILY_PUBLICATION_CUTOFF_HOUR = 9;
const DAILY_PUBLICATION_CUTOFF_MINUTE = 20;

export interface HistoryContinuityIssue {
  kind: "duplicate" | "order" | "gap";
  message: string;
}

function isPublished(run: RunManifest): boolean {
  return run.status !== "failed" && run.quality.publicIndustryItems + run.quality.publicResearchItems > 0;
}

export function assessDailyPublicationFreshness(history: RunHistory, now: Date): DailyPublicationFreshness {
  const currentTime = shanghaiDateTime(now);
  const publicationDue = currentTime.hour > DAILY_PUBLICATION_CUTOFF_HOUR
    || (currentTime.hour === DAILY_PUBLICATION_CUTOFF_HOUR && currentTime.minute >= DAILY_PUBLICATION_CUTOFF_MINUTE);
  const runs = [...history.runs].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));
  const latestPublished = runs.find(isPublished);
  const latestPublishedDate = latestPublished?.date ?? "";
  const hasCurrentPublication = runs.some((run) => isPublished(run) && run.date === currentTime.date);

  return {
    expectedDate: currentTime.date,
    latestPublishedDate,
    state: hasCurrentPublication ? "current" : publicationDue ? "missing" : "pending",
    publicationDue,
  };
}

export function updateRunHistory(previous: RunHistory | undefined, current: RunManifest, limit = 30): RunHistory {
  const byId = new Map((previous?.runs ?? []).map((run) => [run.runId, run]));
  byId.set(current.runId, current);
  const runs = [...byId.values()]
    .sort((a, b) => b.finishedAt.localeCompare(a.finishedAt))
    .slice(0, Math.max(1, limit));
  return { schemaVersion: 1, updatedAt: current.finishedAt, runs };
}

export function buildPipelineHealth(history: RunHistory, now: Date, recentLimit = 7): PipelineHealth {
  const runs = [...history.runs].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));
  if (!runs.length) throw new Error("运行历史为空，无法计算流水线健康度");
  const latest = runs[0];
  const recent = runs.slice(0, Math.max(1, recentLimit));
  const successful = recent.filter(isPublished).length;
  let consecutiveSuccessfulPublications = 0;
  for (const run of runs) {
    if (!isPublished(run)) break;
    consecutiveSuccessfulPublications += 1;
  }
  const ageMs = now.getTime() - Date.parse(latest.finishedAt);
  const stale = !Number.isFinite(ageMs) || ageMs > 36 * 60 * 60 * 1_000;
  const reasons: string[] = [];
  if (stale) reasons.push("最近一次成功发布已超过 36 小时");
  if (latest.status === "degraded") reasons.push("最近一次运行存在外部服务或信源降级");
  if (!isPublished(latest)) reasons.push("最近一次运行没有产生可公开内容");
  if (recent.length >= 3 && successful / recent.length < 0.8) reasons.push("最近运行成功发布率低于 80%");
  reasons.push(...inspectHistoryContinuity(history).filter((issue) => issue.kind === "gap").map((issue) => issue.message));
  const latestPublicItems = latest.quality.publicIndustryItems + latest.quality.publicResearchItems;
  const dailyPublicationFreshness = assessDailyPublicationFreshness(history, now);
  return {
    schemaVersion: 1,
    checkedAt: now.toISOString(),
    status: stale ? "stale" : reasons.length ? "degraded" : "healthy",
    latestRunId: latest.runId,
    latestDate: latest.date,
    consecutiveSuccessfulPublications,
    recentRunCount: recent.length,
    recentSuccessRate: recent.length ? Number((successful / recent.length).toFixed(4)) : 0,
    latestPublicItems,
    dailyPublicationFreshness,
    reasons,
  };
}

export function inspectHistoryContinuity(history: RunHistory): HistoryContinuityIssue[] {
  const issues: HistoryContinuityIssue[] = [];
  const ids = history.runs.map((run) => run.runId);
  if (new Set(ids).size !== ids.length) issues.push({ kind: "duplicate", message: "运行历史含重复 runId" });
  for (let index = 1; index < history.runs.length; index += 1) {
    const previous = Date.parse(history.runs[index - 1].finishedAt);
    const current = Date.parse(history.runs[index].finishedAt);
    if (!Number.isFinite(previous) || !Number.isFinite(current) || previous < current) {
      issues.push({ kind: "order", message: "运行历史没有按完成时间倒序排列" });
      break;
    }
  }
  const dates = [...new Set(history.runs.map((run) => run.date))].sort();
  for (let index = 1; index < dates.length; index += 1) {
    const gap = (Date.parse(`${dates[index]}T00:00:00Z`) - Date.parse(`${dates[index - 1]}T00:00:00Z`)) / DAY_MS;
    if (gap > 1) issues.push({ kind: "gap", message: `运行历史存在 ${gap - 1} 天空档：${dates[index - 1]} → ${dates[index]}` });
  }
  return issues;
}

export const validateHistoryContinuity = (history: RunHistory): string[] => inspectHistoryContinuity(history).map((issue) => issue.message);

/** Missing calendar days are an observable health degradation, not structural
 * corruption. Blocking a later valid publication would make a single outage
 * permanently prevent recovery. */
export const blockingHistoryContinuityErrors = (history: RunHistory): string[] => inspectHistoryContinuity(history)
  .filter((issue) => issue.kind !== "gap")
  .map((issue) => issue.message);

export function validatePipelineHealthArtifact(history: RunHistory, artifact: PipelineHealth): string[] {
  if (!Number.isFinite(Date.parse(artifact.checkedAt))) return ["流水线健康状态检查时间无效"];
  const latest = history.runs[0];
  if (!latest || history.updatedAt !== latest.finishedAt) return ["运行历史更新时间没有绑定最新运行"];
  if (artifact.checkedAt !== history.updatedAt) return ["流水线健康状态检查时间没有绑定最新运行"];
  const expected = buildPipelineHealth(history, new Date(artifact.checkedAt));
  const scalarKeys = [
    "schemaVersion",
    "checkedAt",
    "status",
    "latestRunId",
    "latestDate",
    "consecutiveSuccessfulPublications",
    "recentRunCount",
    "recentSuccessRate",
    "latestPublicItems",
  ] as const;
  const differs = scalarKeys.some((key) => artifact[key] !== expected[key])
    || JSON.stringify(artifact.dailyPublicationFreshness) !== JSON.stringify(expected.dailyPublicationFreshness)
    || JSON.stringify(artifact.reasons) !== JSON.stringify(expected.reasons);
  return differs ? ["流水线健康状态没有由运行历史正确派生"] : [];
}
