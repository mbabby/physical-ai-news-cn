import type { ProgressExplainersArtifact } from "./contracts.js";

const escapeMarkdown = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function renderProgressExplainersMarkdown(artifact: ProgressExplainersArtifact): string {
  const lines = [`## 进展解释器`, "", `状态：${artifact.status}；检查时间：${artifact.checkedAt}`];
  for (const card of artifact.cards) {
    lines.push(
      "",
      `### ${escapeMarkdown(card.titleZh)}${card.historical ? "（历史）" : ""}`,
      "",
      `日期：${escapeMarkdown(card.eventDate)}；披露：${escapeMarkdown(card.publishedAt)}；实质更新：${escapeMarkdown(card.materiallyChangedAt)}`,
      "",
      `- ${escapeMarkdown(card.factsZh[0])}`,
      `- ${escapeMarkdown(card.factsZh[1])}`,
      "",
      `**变化：** ${escapeMarkdown(card.changeZh)}`,
      "",
      `**意义：** ${escapeMarkdown(card.meaningZh)}`,
      "",
      `**适用情境：** ${card.contexts.map(escapeMarkdown).join("；") || "未明确"}`,
      "",
      `**局限：** ${card.limitationsZh.map(escapeMarkdown).join("；")}`,
    );
    if (card.comparison) lines.push("", `**对比：** ${escapeMarkdown(card.comparison.beforeZh)} → ${escapeMarkdown(card.comparison.afterZh)}（${escapeMarkdown(card.comparison.task)}；${escapeMarkdown(card.comparison.conditions)}）`);
    if (card.backgroundZh) lines.push("", "<details><summary>背景</summary>", "", escapeMarkdown(card.backgroundZh), "</details>");
    lines.push("", "<details><summary>证据</summary>", "", ...card.evidence.map((item) => `- [${escapeMarkdown(item.source)}](${item.url})`), "</details>");
  }
  return `${lines.join("\n")}\n`;
}

export function replaceProgressExplainersReadme(readme: string, artifact: ProgressExplainersArtifact): string {
  const start = "<!-- PROGRESS_EXPLAINERS:START -->";
  const end = "<!-- PROGRESS_EXPLAINERS:END -->";
  if (readme.split(start).length !== 2 || readme.split(end).length !== 2 || readme.indexOf(start) > readme.indexOf(end)) throw new Error("progress explainer marker duplicate or unbalanced");
  return `${readme.slice(0, readme.indexOf(start))}${start}\n${renderProgressExplainersMarkdown(artifact)}${end}${readme.slice(readme.indexOf(end) + end.length)}`;
}
