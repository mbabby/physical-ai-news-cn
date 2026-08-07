import type { Article } from "./types.js";
import { hasCompleteChineseCopy } from "./publication.js";

type ResourcePage = "models" | "datasets" | "tools";
interface CoreResource { name: string; link: string; description: string; group: string; rank: number; }
type Catalog = Record<ResourcePage, CoreResource[]>;

const PAGE_META: Record<ResourcePage, { title: string; scope: string }> = {
  models: { title: "模型与开源项目", scope: "VLA、策略学习与机器人开发框架" },
  datasets: { title: "数据集与基准", scope: "真实数据、任务基准与可复现实验" },
  tools: { title: "仿真与工具", scope: "仿真、训练、运行时与机器人软件栈" },
};

function content(article: Article): string { return `${article.title} ${article.titleZh ?? ""} ${article.excerpt} ${article.tags.join(" ")}`.toLowerCase(); }
function pageFor(article: Article): ResourcePage | undefined {
  const value = content(article);
  if (/dataset|数据集|benchmark|基准|evaluation|评测/.test(value)) return "datasets";
  if (/simulat|仿真|isaac|mujoco|ros ?2|gazebo|maniskill|robosuite|framework|工具链/.test(value)) return "tools";
  if (article.kind === "开源项目" || /open.?source|github release|release|vla|openpi|lerobot|openvla|groot|policy|模型/.test(value)) return "models";
  return undefined;
}
function dynamicScore(article: Article): number {
  const age = Math.max(0, (Date.now() - article.publishedAt.getTime()) / 86_400_000);
  const freshness = age <= 2 ? 30 : age <= 7 ? 22 : age <= 14 ? 12 : 5;
  const value = content(article);
  const release = /github release|release|发布|v\d/.test(value) ? 20 : 8;
  const source = Math.min(30, article.sourceWeight * 3);
  const relevance = /vla|robot|具身|manipulation|机器人|physical ai/.test(value) ? 20 : 8;
  return source + freshness + release + relevance;
}
function title(article: Article): string { return article.titleZh!.trim(); }
function brief(article: Article): string {
  const value = article.summaryZh!.replace(/\s+/g, " ").trim();
  return value.length > 150 ? `${value.slice(0, 150)}…` : value;
}
function groupedCore(resources: CoreResource[]): Map<string, CoreResource[]> {
  const groups = new Map<string, CoreResource[]>();
  for (const resource of [...resources].sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name))) {
    groups.set(resource.group, [...(groups.get(resource.group) ?? []), resource]);
  }
  return groups;
}

export function formatResourcePage(page: ResourcePage, catalog: Catalog, articles: Article[], now = new Date()): string {
  const meta = PAGE_META[page];
  const cutoff = now.getTime() - 30 * 86_400_000;
  const dynamic = articles.filter((article) => article.publishedAt.getTime() >= cutoff && pageFor(article) === page && hasCompleteChineseCopy(article))
    .sort((a, b) => dynamicScore(b) - dynamicScore(a) || b.publishedAt.getTime() - a.publishedAt.getTime());
  const seen = new Set<string>();
  const recent = dynamic.filter((article) => {
    const key = article.link.replace(/[?#].*$/, "").toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);
  const lines = [`# ${meta.title}`, "", `> 面向物理 AI 从业者的${meta.scope}资源库。核心资源按实用性与行业影响排序；“近期更新”每日从已验证日报和重点 GitHub Releases 自动汇总，滚动保留 30 天。`, ""];
  for (const [group, resources] of groupedCore(catalog[page] ?? [])) {
    lines.push(`## ${group}`, "");
    for (const resource of resources) lines.push(`- [${resource.name}](${resource.link})：${resource.description}`);
    lines.push("");
  }
  lines.push("## 近期已验证更新（自动）", "");
  if (!recent.length) lines.push("近 30 天暂无达到收录阈值的更新；每日任务会继续扫描官方发布与重点 GitHub Releases。", "");
  for (const article of recent) lines.push(`- [${title(article)}](${article.link}) · ${article.source} · ${article.publishedAt.toISOString().slice(0, 10)}<br>${brief(article)}`, "");
  lines.push("## 排序与收录", "", "- 核心资源：先按行业影响与可复用性排序，再按类别组织。", "- 自动更新：相关性、官方/开源信源等级、发布活跃度、发布时间四项综合排序。", "- 仅保留可追溯链接；自动条目进入更新雷达，不会自动替换核心库。", "");
  return lines.join("\n");
}
