import { validateDecisionProductArtifact, type DecisionProductArtifact } from "./contracts.js";

export const DECISION_SIGNALS_START = "<!-- DECISION_SIGNALS_START -->";
export const DECISION_SIGNALS_END = "<!-- DECISION_SIGNALS_END -->";

function markdownText(value: string): string {
  return value.replace(/[\\`*_[\]<>]/g, "\\$&").replace(/\r?\n/g, " ");
}

function markdownUrl(value: string): string {
  return new URL(value).href.replace(/\\/g, "%5C").replace(/\(/g, "%28").replace(/\)/g, "%29");
}

/** Render only the already ordered artifact. This layer never filters or ranks. */
export function formatDecisionProductReadme(artifact: DecisionProductArtifact): string {
  validateDecisionProductArtifact(artifact);
  if (artifact.topSignals.length === 0) return "> 本周暂无满足公开证据门槛的 Top Signals。";
  return artifact.topSignals.map((signal) => [
    `<!-- decision-signal:${signal.signalId} -->`,
    `- **${markdownText(signal.titleZh)}** · ${markdownText(signal.entityName)} · ${markdownText(signal.rankReasons.join(" / "))} · [证据](<${markdownUrl(signal.evidence[0]!.url)}>)`,
  ].join("\n")).join("\n");
}

export function replaceDecisionProductReadme(readme: string, artifact: DecisionProductArtifact): string {
  const start = readme.indexOf(DECISION_SIGNALS_START);
  const end = readme.indexOf(DECISION_SIGNALS_END);
  if (start < 0 || end < start || readme.indexOf(DECISION_SIGNALS_START, start + 1) >= 0 || readme.indexOf(DECISION_SIGNALS_END, end + 1) >= 0) {
    throw new Error("README 缺少唯一的 Decision Signals 占位标记");
  }
  const content = formatDecisionProductReadme(artifact);
  return `${readme.slice(0, start)}${DECISION_SIGNALS_START}\n\n${content}\n\n${readme.slice(end)}`;
}
