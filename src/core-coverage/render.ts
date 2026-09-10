import { join } from "node:path";
import { markdownDestination } from "../markdown.js";
import { isDeepStrictEqual } from "node:util";
import { validateCoreCoverageArtifact, type CoreCoverageArtifact } from "./materialize.js";
import { escapeXml, normalizeHttpsBase } from "../decision-products/subscriptions.js";
import type { FileTransaction } from "../runtime/storage.js";
import { shanghaiDailyDateForTimestamp } from "../runtime/daily-date.js";
import type { CoreCoveragePublicHistory } from "./materialize.js";

export const CORE_COVERAGE_FEED_PATH = "feeds/core-coverage.xml";
export const CORE_COVERAGE_START = "<!-- CORE_COVERAGE_START -->";
export const CORE_COVERAGE_END = "<!-- CORE_COVERAGE_END -->";
const DEFAULT_PAGES_URL = "https://mbabby.github.io/physical-ai-news-cn";
const PUBLIC_FACT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function markdownText(value: string): string {
  return value.replace(/[\\`*_[\]<>]/g, "\\$&").replace(/\r?\n/g, " ");
}

function companyName(artifact: CoreCoverageArtifact, companyId: string): string {
  return artifact.subjects.find((subject) => subject.companyId === companyId)?.name ?? companyId;
}

function assertPublicFactIds(artifact: CoreCoverageArtifact): void {
  if (artifact.briefs.some((brief) => brief.knownClaimIds.some((claimId) => !PUBLIC_FACT_ID.test(claimId)))) {
    throw new Error("Core 30 事实 ID 不符合公开标识格式");
  }
}

export function formatCoreCoverageReadme(artifact: CoreCoverageArtifact, pagesUrl = DEFAULT_PAGES_URL): string {
  validateCoreCoverageArtifact(artifact);
  assertPublicFactIds(artifact);
  const base = normalizeHttpsBase(pagesUrl, "Core 30 Pages 基址");
  const complete = artifact.briefs.filter((brief) => brief.completeness === "complete");
  const lines = [
    `> 固定研究覆盖 ${artifact.coverage.version}（${artifact.coverage.effectiveFrom} 生效） · 已核验身份 ${artifact.metrics.coveredSubjects}/30 · 完整 Brief ${artifact.metrics.completeBriefs}/30。覆盖地区是研究资源配置，不代表法律国籍。`,
    `> [订阅独立 Feed](${base}/${CORE_COVERAGE_FEED_PATH})`,
  ];
  if (!complete.length) return [...lines, "", "> 当前没有证据链完整的 Brief；30 个覆盖主体仍按公开缺口展示。"].join("\n");
  lines.push("", ...complete.map((brief) => {
    const markers = brief.knownClaimIds.map((claimId) => `<!-- core-fact:${claimId} -->`).join(" ");
    const fieldLabels: Record<string, string> = { eventDate: "事件日期", round: "轮次", amount: "融资金额", valuation: "估值", investors: "投资方", product: "产品", customer: "客户", deployment: "部署", productionStage: "验证阶段" };
    return [
      markers,
      `### ${markdownText(companyName(artifact, brief.companyId))}`,
      "", markdownText(brief.positioningZh), "", markdownText(brief.summaryZh),
      `最近实质变化：${markdownText(brief.lastMaterialChangeAt)}`,
      ...brief.identityEvidence.map((proof) => `- 身份证据：[${markdownText(proof.source)}](${markdownDestination(proof.link)}) · ${markdownText(proof.supports)}（核验：${markdownText(proof.checkedAt)}）`),
      ...brief.knownFacts.flatMap((fact) => [
        `- 事实：${markdownText(fact.summaryZh)}${fact.needsReview ? "（待复核）" : ""}`,
        `  - 事件日期：${markdownText(fact.occurredOn)}；披露日期：${markdownText(fact.publishedOn)}；实质变化：${markdownText(fact.materialChangeAt)}`,
        ...Object.entries(fieldLabels).map(([key, label]) => {
          const field = fact.fields[key as keyof typeof fact.fields];
          return field?.status === "verified"
            ? `  - ${label}：${markdownText(Array.isArray(field.value) ? field.value.join("；") : String(field.value))} · ${field.evidenceUrls.map((url) => `[直接证据](${markdownDestination(url)})`).join(" · ")}`
            : `  - ${label}：unknown（现有证据不足）`;
        }),
      ]),
      ...brief.analyses.map((analysis) => `- 解读：${markdownText(analysis.textZh)}；局限：${markdownText(analysis.limitationZh)}；下一验证：${markdownText(analysis.nextValidationZh)}（${analysis.status === "valid" ? "有效" : "待复核"}）`),
      ...brief.gapsZh.map((gap) => `- 缺口：${markdownText(gap)}`),
      ...brief.nextValidationZh.map((point) => `- 下一验证：${markdownText(point)}`),
      "",
    ].join("\n");
  }));
  return lines.join("\n");
}

export function replaceCoreCoverageReadme(readme: string, artifact?: CoreCoverageArtifact, pagesUrl = DEFAULT_PAGES_URL): string {
  const start = readme.indexOf(CORE_COVERAGE_START);
  const end = readme.indexOf(CORE_COVERAGE_END);
  if (start < 0 || end < start || readme.indexOf(CORE_COVERAGE_START, start + 1) >= 0 || readme.indexOf(CORE_COVERAGE_END, end + 1) >= 0) {
    throw new Error("README 缺少唯一的 Core 30 占位标记");
  }
  const content = artifact
    ? formatCoreCoverageReadme(artifact, pagesUrl)
    : "> Core 30 当前不可用：本轮没有已启用并通过联合校验的公开工件。";
  return `${readme.slice(0, start)}${CORE_COVERAGE_START}\n\n${content}\n\n${readme.slice(end)}`;
}

function inCurrentWindow(value: string, artifact: CoreCoverageArtifact): boolean {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : shanghaiDailyDateForTimestamp(value);
  if (!day) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && day >= artifact.windows.currentStart && day <= artifact.windows.through;
}

export function renderCoreCoverageFeed(artifact: CoreCoverageArtifact, pagesUrl: string): string {
  validateCoreCoverageArtifact(artifact);
  assertPublicFactIds(artifact);
  const base = normalizeHttpsBase(pagesUrl, "Core 30 Feed Pages 基址");
  const emitted = new Set<string>();
  const items = artifact.briefs.flatMap((brief) => {
    if (brief.completeness !== "complete") return [];
    return brief.knownFacts.flatMap((fact) => {
      if (emitted.has(fact.claimId) || fact.materialChangeAt === "unknown" || !inCurrentWindow(fact.materialChangeAt, artifact)) return [];
      const occurredCurrent = fact.occurredOn !== "unknown" && inCurrentWindow(fact.occurredOn, artifact);
      const disclosedCurrent = fact.publishedOn !== "unknown" && inCurrentWindow(fact.publishedOn, artifact);
      if (!occurredCurrent && !disclosedCurrent) return [];
      emitted.add(fact.claimId);
      const name = companyName(artifact, brief.companyId);
      const dateLabel = occurredCurrent ? "事件日期" : "披露日期";
      const date = occurredCurrent ? fact.occurredOn : fact.publishedOn;
      const clocks = [fact.occurredOn !== "unknown" ? `事件日期：${fact.occurredOn}` : "", fact.publishedOn !== "unknown" ? `披露日期：${fact.publishedOn}` : ""].filter(Boolean).join("；");
      return [[
        "    <item>",
        `      <title>${escapeXml(`${name} · ${dateLabel} ${date}`)}</title>`,
        `      <link>${escapeXml(`${base}/core-coverage.html#company-${encodeURIComponent(brief.companyId)}`)}</link>`,
        `      <guid isPermaLink="false">${escapeXml(`urn:physical-ai:core30:${fact.claimId}`)}</guid>`,
        `      <description>${escapeXml(`规范事实 ${fact.claimId}。${clocks}。${fact.summaryZh}`)}</description>`,
        "    </item>",
      ]];
    });
  }).flat();
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    "  <channel>",
    `    <title>${escapeXml("Physical AI · Core 30 实质变化")}</title>`,
    `    <link>${escapeXml(`${base}/core-coverage.html`)}</link>`,
    `    <description>${escapeXml(`固定研究覆盖 ${artifact.coverage.version}；仅发布当前窗口内有明确事件或披露日期、且具备已核验事实依赖的实质变化。`)}</description>`,
    ...items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}

export function validateCoreCoverageSurfaces(_input: {
  artifact: CoreCoverageArtifact;
  history: CoreCoveragePublicHistory;
  readme: string;
  feed: string;
  pagesUrl: string;
}): void {
  const input = _input;
  validateCoreCoverageArtifact(input.artifact);
  if (input.history.generatedAt !== input.artifact.generatedAt
    || input.history.schemaVersion !== 1
    || !Array.isArray(input.history.versions)
    || !Array.isArray(input.history.corrections)
    || !input.history.versions.some((version) => isDeepStrictEqual(version, input.artifact.coverage))) {
    throw new Error("Core 30 公开历史与当前工件时钟/版本不一致");
  }
  if (replaceCoreCoverageReadme(input.readme, input.artifact, input.pagesUrl) !== input.readme) {
    throw new Error("Core 30 README 镜像与当前工件不一致");
  }
  if (renderCoreCoverageFeed(input.artifact, input.pagesUrl) !== input.feed) {
    throw new Error("Core 30 Feed 镜像与当前工件不一致");
  }
}

export function stageCoreCoverageSurfaces(_input: {
  root: string;
  transaction: Pick<FileTransaction, "stage">;
  artifact: CoreCoverageArtifact;
  history: CoreCoveragePublicHistory;
  readme: string;
  pagesUrl: string;
}): string {
  const input = _input;
  const readme = replaceCoreCoverageReadme(input.readme, input.artifact, input.pagesUrl);
  const feed = renderCoreCoverageFeed(input.artifact, input.pagesUrl);
  validateCoreCoverageSurfaces({ ...input, readme, feed });
  input.transaction.stage(join(input.root, "site", CORE_COVERAGE_FEED_PATH), feed);
  return readme;
}
