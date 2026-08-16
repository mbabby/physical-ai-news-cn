import type { WatchlistPublicCard, WatchlistPublicView } from "./public-view.js";

const COMPANY_SHARE_PAGE = "https://mbabby.github.io/physical-ai-news-cn/companies.html";
const GROUP_LABELS: Record<WatchlistPublicCard["group"], string> = {
  "priority-focus": "重点关注",
  "continued-observation": "持续观察",
};

function inline(value: string): string {
  return value.replace(/\s+/g, " ").trim().replace(/([\\\[\]])/g, "\\$1");
}

function fragment(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function formatTrack(title: string, cards: WatchlistPublicCard[]): string[] {
  return [
    `### ${title}`,
    "",
    ...(cards.length ? cards.flatMap((card) => [
      `- **[${inline(card.companyName)}](${COMPANY_SHARE_PAGE}#${fragment(card.companyId)})** · ${GROUP_LABELS[card.group]} · ${inline(card.lifecycleLabel)}`,
      `  - 为什么现在值得看：${inline(card.whyNow)}`,
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
