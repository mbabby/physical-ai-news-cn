import type { ProgressExplainersArtifact } from "./contracts.js";
import { markdownDestination } from "../markdown.js";

const escapeMarkdown = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/([\\`*_[\]#!|])/g, "\\$1").replace(/\r?\n/g, " ");

export function renderProgressExplainersMarkdown(artifact: ProgressExplainersArtifact): string {
  const states = { updated: "有新解读", "no-new-content": "本轮无新内容", constrained: "本轮受限", unavailable: "暂不可用" };
  const date = (value: string) => value === "unknown" ? "未知" : escapeMarkdown(value);
  const lines = [`## 近期解读`, "", `状态：${states[artifact.status]}；内容更新：${artifact.lastContentUpdatedAt ?? "尚未生成"}`];
  for (const card of artifact.cards) {
    lines.push(
      "",
      `### ${escapeMarkdown(card.titleZh)}${card.historical ? "（历史）" : ""}`,
      "",
      `${escapeMarkdown(card.factsZh[0])} ${escapeMarkdown(card.factsZh[1])} ${escapeMarkdown(card.changeZh)}`,
      "",
      `**解读：** ${escapeMarkdown(card.meaningZh)}`,
      "",
      `**局限：** ${card.limitationsZh.map(escapeMarkdown).join("；")}`,
      "", "<details><summary>背景与证据</summary>", "",
      `事件日期：${date(card.eventDate)}；披露日期：${date(card.publishedAt)}；实质变化：${date(card.materiallyChangedAt)}；卡片检查：${date(card.checkedAt)}`,
      "", `**适用情境：** ${card.contexts.map(escapeMarkdown).join("；") || "未明确"}`,
    );
    if (card.comparison) lines.push("", `**对比：** ${escapeMarkdown(card.comparison.beforeZh)} → ${escapeMarkdown(card.comparison.afterZh)}（${escapeMarkdown(card.comparison.task)}；${escapeMarkdown(card.comparison.conditions)}）`);
    if (card.backgroundZh) lines.push("", escapeMarkdown(card.backgroundZh));
    lines.push("", ...card.evidence.map((item) => `- [${escapeMarkdown(item.source)}](${markdownDestination(item.url)})`), "", "</details>");
  }
  lines.push("", "<details><summary>解读检查记录</summary>", "", `最近检查：${artifact.checkedAt}`, "", "公开证据复核是辅助检查，不保证绝对正确；解读不是新增事实。没有合格内容不代表领域没有进展。", "", "</details>");
  return `${lines.join("\n")}\n`;
}

export function replaceProgressExplainersReadme(readme: string, artifact: ProgressExplainersArtifact): string {
  const start = "<!-- PROGRESS_EXPLAINERS:START -->";
  const end = "<!-- PROGRESS_EXPLAINERS:END -->";
  if (readme.split(start).length !== 2 || readme.split(end).length !== 2 || readme.indexOf(start) > readme.indexOf(end)) throw new Error("progress explainer marker duplicate or unbalanced");
  return `${readme.slice(0, readme.indexOf(start))}${start}\n${renderProgressExplainersMarkdown(artifact)}${end}${readme.slice(readme.indexOf(end) + end.length)}`;
}
