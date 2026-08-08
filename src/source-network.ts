import type { SourceRegistry, SourceRegistryEntry, SourceStatus, SourceTier } from "./types.js";

const tiers: SourceTier[] = ["官方公司与实验室", "开源发布", "权威产业媒体", "线索发现层"];
const statusOrder: SourceStatus[] = ["已启用", "观察", "已暂停"];

function statusSummary(items: SourceRegistryEntry[]): string {
  const groups = statusOrder.map((status) => `${status} ${items.filter((item) => item.status === status).length}`).join(" · ");
  return groups;
}

function score(entry: SourceRegistryEntry): string {
  if (entry.health.score === undefined) return "样本积累中";
  return `${entry.health.score}/100`;
}

function health(entry: SourceRegistryEntry): string {
  const percent = (value: number | undefined) => value === undefined ? "—" : `${Math.round(value * 100)}%`;
  return `健康 ${score(entry)}（成功 ${percent(entry.health.successRate)}／命中 ${percent(entry.health.hitRate)}／收录 ${percent(entry.health.inclusionRate)}／纠错 ${percent(entry.health.correctionRate)}）`;
}

/** A public, credential-free view of source roles and their measured quality. */
export function formatSourceNetwork(registry: SourceRegistry): string {
  const lines = [
    "# 信源网络", "", "本页公开说明每个来源的职责与运行健康度；不包含密钥、请求日志或未核验线索正文。",
    "", "## 使用规则", "",
    "- **官方公司与实验室**：可作为一手事实证据。",
    "- **开源发布**：用于验证代码、模型、数据与版本发布。",
    "- **权威产业媒体**：可补充产品与部署；融资须有一手证据或两家独立媒体交叉确认。",
    "- **线索发现层**：Google News、Hacker News、X 和自动发现 RSS 只进入候选层，不能直接出现在公开资讯中。",
    "", "## 健康分", "", "健康分 = 成功率 40% + 相关命中率 20% + 最终公开收录率 25% + 事后纠错质量 15%。没有新内容时采用中性先验，不把安静但稳定的官方源误判为低质量；累计样本不足 5 次不自动降权，低于 65 分进入观察，连续低于 45 分或访问受限则暂停。", "",
  ];
  for (const tier of tiers) {
    const items = registry.sources.filter((source) => source.tier === tier);
    lines.push(`## ${tier}`, "", `状态：${statusSummary(items)}`, "");
    if (!items.length) { lines.push("暂无已登记来源。", ""); continue; }
    for (const item of items.sort((a, b) => (b.health.score ?? -1) - (a.health.score ?? -1) || a.name.localeCompare(b.name))) {
      const reason = item.statusReason ? `；${item.statusReason}` : "";
      lines.push(`- **${item.name}** · ${item.status} · ${item.publicationPolicy} · ${health(item)}${reason}`);
    }
    lines.push("");
  }
  lines.push("---", "", `*更新时间：${registry.updatedAt.slice(0, 10)}；统计窗口：最近 ${registry.windowDays} 天。*`, "");
  return lines.join("\n");
}
