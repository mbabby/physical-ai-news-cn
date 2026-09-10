import type { WatchlistPublicCard, WatchlistPublicView } from "./public-view.js";

const GROUP_LABELS: Record<WatchlistPublicCard["group"], string> = {
  "priority-focus": "重点关注",
  "continued-observation": "持续观察",
};

function inline(value: string): string {
  return value.replace(/\s+/g, " ").trim().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/([\\`*_[\]#!|])/g, "\\$1");
}

function fragment(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function formatTrack(title: string, cards: WatchlistPublicCard[]): string[] {
  return [
    `### ${title}`,
    "",
    ...(cards.length ? cards.flatMap((card) => [
      "", `<a id="${fragment(card.companyId)}"></a>`, "",
      `- **[${inline(card.companyName)}](#${fragment(card.companyId)})** · ${GROUP_LABELS[card.group]} · ${inline(card.lifecycleLabel)}`,
      `  - 为什么现在值得看：${inline(card.whyNow)}`,
      `  - 技术路线：${card.routes.map(inline).join("；")}；依赖：${inline(card.routeAndDependencies)}`,
      `  - 资本：${inline(card.capital.summary)}`,
      ...card.nextValidationPoints.map((point) => `  - 下一验证：${inline(point.text)}（期限：${inline(point.dueAt)}）`),
      ...card.falsifiers.map((point) => `  - 证伪条件：${inline(point.text)}`),
      ...card.evidenceLinks.map((evidence) => `  - 证据：[${inline(evidence.title)} · ${inline(evidence.source)}](<${evidence.url}>)（${evidence.grade}）`),
    ]) : ["- 暂无达到公开门槛的公司。"]),
  ];
}

/** Render the compact README projection of an already-resolved public view. */
export function formatWatchlistReadme(view: WatchlistPublicView): string {
  return [
    `> 观察名单快照：${view.week} · v${view.snapshotVersion}`,
    "> 以下卡片均为 **AI 研究判断**，不是投资建议；事实与判断边界以公开证据和验证期限为准。",
    "",
    ...formatTrack("前瞻雷达", view.forwardRadar),
    "",
    ...formatTrack("验证动量", view.validatedMomentum),
  ].join("\n");
}
