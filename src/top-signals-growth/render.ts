import {
  topSignalsContentSha256,
  validateTopSignalsDraft,
  type GrowthTopSignal,
  type TopSignalsDraft,
} from "./contracts.js";

export interface PublishedTopSignalsArtifact {
  schemaVersion: 1;
  experimentId: string;
  week: string;
  periodStart: string;
  periodEnd: string;
  signals: PublicGrowthTopSignal[];
  releaseUrl: string;
  publishedAt: string;
  contentSha256: string;
}

export type PublicGrowthTopSignal = Omit<GrowthTopSignal, "changedThisWeek" | "rankReasons" | "scoreBreakdown">;

function markdownText(value: string): string {
  return value.replace(/[\\`*_[\]<>]/g, "\\$&").replace(/\r?\n/g, " ");
}

function markdownUrl(value: string): string {
  return new URL(value).href.replace(/\\/g, "%5C").replace(/\(/g, "%28").replace(/\)/g, "%29");
}

function requireReleaseUrl(releaseUrl: string): void {
  try {
    const url = new URL(releaseUrl);
    if (!(["http:", "https:"].includes(url.protocol) && url.hostname && !url.username && !url.password)) throw new Error();
  } catch {
    throw new Error("Top Signals release URL must be an absolute HTTP(S) URL");
  }
}

function requireCanonicalTimestamp(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error("Top Signals publication timestamp must be canonical");
  }
}

function renderEvidence(signal: PublicGrowthTopSignal): string[] {
  return signal.evidence.map((item) => `  - [${markdownText(item.source)}（${item.grade}）](<${markdownUrl(item.url)}>)`);
}

function renderSignal(signal: PublicGrowthTopSignal, position: number): string {
  return [
    `<!-- top-signal:${signal.signalId} -->`,
    `## ${position}. ${markdownText(signal.titleZh)}`,
    `- 主体：${markdownText(signal.entityName)}`,
    `- 事件类型：${markdownText(signal.kind)}`,
    `- 事件日期：${markdownText(signal.occurredAt)}`,
    `- 核验日期：${markdownText(signal.verifiedAt)}`,
    `- 事实：${markdownText(signal.factsZh[0])} ${markdownText(signal.factsZh[1])}`,
    `- 为什么重要：${markdownText(signal.whyItMatters)}`,
    `- 下一验证点：${markdownText(signal.nextValidationPoint)}`,
    "- 证据：",
    ...renderEvidence(signal),
  ].join("\n");
}

/** Render the already canonical release order without selecting or sorting signals. */
export function renderTopSignalsRelease(draft: TopSignalsDraft): string {
  validateTopSignalsDraft(draft);
  const header = `# Physical AI 资本与产品部署 Top Signals · ${markdownText(draft.week)}\n\n周期：${markdownText(draft.periodStart)} 至 ${markdownText(draft.periodEnd)}`;
  const signals = draft.signals.map((signal, index) => renderSignal(signal, index + 1));
  return signals.length ? `${header}\n\n${signals.join("\n\n")}` : header;
}

/** Render the first three canonical signals for the README and retain their evidence detail. */
export function renderTopSignalsReadme(draft: TopSignalsDraft, releaseUrl: string): string {
  validateTopSignalsDraft(draft);
  return renderTopSignalsReadmeSignals(draft.signals, releaseUrl);
}

function renderTopSignalsReadmeSignals(signalsInput: PublicGrowthTopSignal[], releaseUrl: string): string {
  requireReleaseUrl(releaseUrl);
  const releaseLink = `[查看完整 Release](<${markdownUrl(releaseUrl)}>)`;
  const signals = signalsInput.slice(0, 3).map((signal, index) => renderSignal(signal, index + 1));
  if (signals.length === 0) return `> 本周暂无满足公开证据门槛的 Top Signals。\n\n${releaseLink}`;
  return [...signals, releaseLink].join("\n\n");
}

export function renderPublishedTopSignalsReadme(published: PublishedTopSignalsArtifact): string {
  return renderTopSignalsReadmeSignals(published.signals, published.releaseUrl);
}

export function publicGrowthTopSignal(signal: GrowthTopSignal): PublicGrowthTopSignal {
  const { changedThisWeek: _changedThisWeek, rankReasons: _rankReasons, scoreBreakdown: _scoreBreakdown, ...published } = signal;
  return {
    ...published,
    factsZh: [...published.factsZh],
    routes: [...published.routes],
    evidence: published.evidence.map((item) => ({ ...item })),
    impact: [...published.impact],
  };
}

/** Build the published JSON archive directly from the validated, canonical draft. */
export function renderTopSignalsArchive(
  draft: TopSignalsDraft,
  releaseUrl: string,
  publishedAt: string,
): PublishedTopSignalsArtifact {
  validateTopSignalsDraft(draft);
  requireReleaseUrl(releaseUrl);
  requireCanonicalTimestamp(publishedAt);
  return {
    schemaVersion: 1,
    experimentId: draft.experimentId,
    week: draft.week,
    periodStart: draft.periodStart,
    periodEnd: draft.periodEnd,
    signals: draft.signals.map(publicGrowthTopSignal),
    releaseUrl,
    publishedAt,
    contentSha256: topSignalsContentSha256(draft),
  };
}
