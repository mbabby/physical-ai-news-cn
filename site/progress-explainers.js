// Presentation only: identity, order and copy come from the published artifact.
const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const labels = { updated: "有新解读", "no-new-content": "本轮无新内容", constrained: "本轮受限", unavailable: "暂不可用" };
const plain = (v) => typeof v === "string" && v.trim().length > 0;
const chinese = (v) => plain(v) && /[\u3400-\u9fff]/u.test(v);
const array = (v, predicate) => Array.isArray(v) && v.every(predicate);
const exact = (v, keys) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
const id = (v) => plain(v) && /^[a-z0-9][a-z0-9:._-]*$/i.test(v);
const date = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)?$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v.slice(0, 10);
const clock = (v) => date(v) && v.includes("T");
const provenance = (v) => v === "unknown" || date(v);
const safeLink = (v) => { try { const url = new URL(v); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password; } catch { return false; } };

function validCard(card, checkedAt) {
  if (!card || typeof card !== "object") return false;
  const fields = ["titleZh", "factsZh.0", "factsZh.1", "changeZh", "meaningZh"];
  if (!array(card.limitationsZh, chinese) || !card.limitationsZh.length || !array(card.contexts, chinese)) return false;
  card.limitationsZh.forEach((_, i) => fields.push(`limitationsZh.${i}`));
  card.contexts.forEach((_, i) => fields.push(`contexts.${i}`));
  const optional = [];
  if (card.backgroundZh !== undefined) { optional.push("backgroundZh"); fields.push("backgroundZh"); if (!chinese(card.backgroundZh)) return false; }
  if (card.comparison !== undefined) {
    optional.push("comparison");
    const keys = ["beforeZh", "afterZh", "task", "conditions"];
    if (!exact(card.comparison, keys) || !keys.every((k) => chinese(card.comparison[k]))) return false;
    keys.forEach((k) => fields.push(`comparison.${k}`));
  }
  return exact(card, ["titleZh", "factsZh", "changeZh", "meaningZh", "limitationsZh", "contexts", "fieldRefs", "id", "revision", "canonicalId", "sourceRevision", "kind", "evidence", "eventDate", "publishedAt", "materiallyChangedAt", "checkedAt", "historical", ...optional])
    && [card.titleZh, card.changeZh, card.meaningZh].every(chinese)
    && array(card.factsZh, chinese) && card.factsZh.length === 2
    && exact(card.fieldRefs, fields) && fields.every((k) => array(card.fieldRefs[k], id) && card.fieldRefs[k].length > 0)
    && id(card.id) && plain(card.canonicalId) && !/[\s\u0000-\u001f]/u.test(card.canonicalId)
    && typeof card.revision === "string" && /^[a-f0-9]{64}$/.test(card.revision) && id(card.sourceRevision)
    && ["event", "research"].includes(card.kind) && typeof card.historical === "boolean"
    && [card.eventDate, card.publishedAt, card.materiallyChangedAt].every(provenance) && card.checkedAt === checkedAt
    && array(card.evidence, (e) => exact(e, ["evidenceId", "url", "source"]) && id(e.evidenceId) && plain(e.source) && plain(e.url) && safeLink(e.url))
    && card.evidence.length > 0 && new Set(card.evidence.map((e) => e.evidenceId)).size === card.evidence.length;
}

function validArtifact(a) {
  return exact(a, ["schemaVersion", "generatedAt", "lastContentUpdatedAt", "checkedAt", "status", "cards"])
    && a.schemaVersion === 1 && Object.hasOwn(labels, a.status) && clock(a.checkedAt) && a.generatedAt === a.checkedAt
    && (a.lastContentUpdatedAt === null || (clock(a.lastContentUpdatedAt) && Date.parse(a.lastContentUpdatedAt) <= Date.parse(a.checkedAt)))
    && array(a.cards, (c) => validCard(c, a.checkedAt)) && a.cards.length <= 3
    && new Set(a.cards.map((c) => c.id)).size === a.cards.length && new Set(a.cards.map((c) => c.canonicalId)).size === a.cards.length;
}

const time = (value) => value === "unknown" ? "未知" : `<time datetime="${escape(value)}">${escape(value.replace("T", " ").replace(/(?:\.\d{3})?Z$/, " UTC"))}</time>`;

function cardHtml(card) {
  return `<article class="explainer-card" data-explainer-id="${escape(card.id)}" aria-labelledby="${escape(card.id)}-title">
    <h3 id="${escape(card.id)}-title">${escape(card.titleZh)}</h3>
    ${card.historical ? '<p class="explainer-context">历史进展</p>' : ""}
    <p class="explainer-facts">${card.factsZh.map(escape).join(" ")} ${escape(card.changeZh)}</p>
    <p><strong>解读：</strong>${escape(card.meaningZh)} <strong>局限：</strong>${card.limitationsZh.map(escape).join(" ")}</p>
    <details><summary>背景与证据</summary>
    <p class="explainer-context">${card.kind === "research" ? "研究进展" : "产业进展"}${card.contexts.length ? ` · ${card.contexts.map(escape).join(" · ")}` : ""}</p>
    ${card.backgroundZh ? `<p>${escape(card.backgroundZh)}</p>` : ""}
    ${card.comparison ? `<p><strong>同条件对比：</strong>${escape(card.comparison.beforeZh)} → ${escape(card.comparison.afterZh)}</p><p>任务：${escape(card.comparison.task)}；条件：${escape(card.comparison.conditions)}</p>` : ""}
    <dl class="explainer-dates"><div><dt>事件日期</dt><dd>${time(card.eventDate)}</dd></div><div><dt>披露日期</dt><dd>${time(card.publishedAt)}</dd></div><div><dt>实质变化</dt><dd>${time(card.materiallyChangedAt)}</dd></div></dl>
    <ul class="explainer-evidence">${card.evidence.map((e) => `<li><a href="${escape(e.url)}" target="_blank" rel="noopener noreferrer">${escape(e.source)} ↗<span class="sr-only">（在新标签页打开）</span></a></li>`).join("")}</ul></details>
  </article>`;
}

/** @param {unknown} artifact @returns {string} */
export function renderProgressExplainers(artifact) {
  if (!validArtifact(artifact)) return '<p class="explainer-status" data-status="unavailable">解读暂不可用：加载失败或数据未通过校验；检查时间未知。</p>';
  const explanations = { updated: "本轮发布了新的解读。", "no-new-content": "本轮没有可发布的新内容；已有解读保留原有时间。", constrained: "本轮生成或上游证据受限；仅展示仍然有效的已发布解读。", unavailable: "当前无法提供新的合格解读，不以新闻候选补位。" };
  return `<p class="explainer-status" data-status="${artifact.status}">${labels[artifact.status]}：${explanations[artifact.status]} 内容更新：${artifact.lastContentUpdatedAt ? time(artifact.lastContentUpdatedAt) : "尚未生成"}；<span class="explainer-check">最近检查：${time(artifact.checkedAt)}</span></p>${artifact.cards.map(cardHtml).join("")}`;
}

export async function loadProgressExplainers(mount, fetcher = fetch) {
  try {
    const response = await fetcher("data/progress-explainers.json", { cache: "no-store" });
    if (!response.ok) throw new Error("explainer fetch failed");
    mount.innerHTML = renderProgressExplainers(await response.json());
  } catch { mount.innerHTML = renderProgressExplainers(null); }
}

if (typeof document !== "undefined") {
  const mount = document.getElementById("progress-explainers");
  if (mount) void loadProgressExplainers(mount);
}
